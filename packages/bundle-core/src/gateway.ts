// P2 — REST + SSE gateway, plus the approval answerer every deployment needs
// (dsh-user-approval ships no built-in answerer; without one every
// approval/request fails closed to 'unavailable'). See
// docs/cordis-agent-implementation-plan.md §4 (parent local-agent-core
// checkout) for the researched API surface this is built from.
//
// Endpoint paths are static (no `:id` segments): ctx.connection.fetch.register()
// keys routes by EXACT pathname (packages/client/connection/src/rpc-host.ts
// assertFetchRoute -> endpointFromPath, segments must match
// /^[A-Za-z0-9_$.-]+$/ — no ':'). Identity travels in the JSON body (POST) or
// a query parameter (GET), matching the convention dsh's own Typert /api
// dispatch already uses (POST /api/<namespace>/<method> with a JSON `args`
// body, never a path param).
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
// Context/Events declaration-merge augmentations only apply when the file
// that declares them is part of the compiled program — these three are never
// referenced by name below, only through the ctx.<key> they add.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { SessionId, SessionLogOffset, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-skill'
// UI clone plan Đợt 2, Phase I: no new dependency, no new cordis.patch.yml
// row — a real `dsh --profile cordis-app --dump-config` run confirmed
// `session-title`/`session-title-llm` are ALREADY mounted, inherited
// transparently from dsh-base through dsh-web-app (neither our own patch
// nor dsh-web-app's restates those rows, so dsh-base's own real config —
// fallbackMaxWords:5/fallbackMaxBytes:40/maxTitleBytes:80,
// targetWords:5/targetCjkCharacters:10/maxInputBytes:4096/
// maxOutputTokens:64/timeoutMs:60000 — already applies). This import only
// pulls in the Context augmentation so `ctx.sessionTitle` type-checks.
import type {} from '@deepseek-ai/dsh-session-title'
// Pulls in the Context augmentation so `ctx.sessionController` type-checks —
// the package is already mounted (dsh-web-app depends on it transitively;
// confirmed via `dsh --profile cordis-app --dump-config`, `id: session-
// controller` present, never disabled). See docs/add-openrouter-model-
// switch-plan.md for why this plugin now uses its selectModel()/
// modelCatalog() instead of rolling its own.
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

export const name = 'cordis-gateway'
// Every ctx.<key> this plugin reads as a property, plus 'approval' so this
// plugin only activates once there is an approval service for our answerer
// to actually serve — reading ctx.<key> without declaring it here throws
// "cannot get property ... without inject" (confirmed by a real boot
// failure while writing this). 'llm' and 'credentials' back the P3 model +
// credential routes below. 'skills' backs Phase H's read-only /skills route.
// 'sessionTitle' backs Đợt 2 Phase I's title/rename routes.
// 'sessionController' backs /model-catalog and /session-select-model — the
// user-facing "switch model for this chat" feature (see
// docs/add-openrouter-model-switch-plan.md). @deepseek-ai/dsh-api-session-
// controller is already mounted by dsh-web-app; this only starts USING its
// ctx.sessionController service, not adding a new package.
export const inject = ['connection', 'agents', 'sessions', 'sessionQuery', 'agentDefaultModel', 'approval', 'llm', 'credentials', 'skills', 'sessionTitle', 'sessionController']

// Fixed set of credential references the Models settings page describes
// without a query — covers the OpenAI-compatible gateways the architecture
// doc names (DeepSeek direct, plus OpenAI/Anthropic/OpenRouter routes a
// deployment adds to llm-pi-ai's `providers` map via profile patch). Not
// exhaustive: POST accepts any POSIX-identifier ref name, this list only
// drives what GET returns with no round trip per provider.
// `OPENAI_BASE_URL`/`SERPER_API_KEY` added for the cloned
// llm-openai-compat/tool-serper-web-search plugins (see their own file
// headers) — both real credential refs those plugins resolve through
// `ctx.credentials`, same mechanism as every other ref here.
// `N8N_API_KEY`/`N8N_WEBHOOK_SECRET` added for the Settings "Config" tab
// (apps/web's settings-dialog.tsx) — same `@cordis-app/tool-n8n` refs
// already settable via this same POST route, just missing from GET's own
// allow-list before now, so the UI's "configured?" status never showed.
const KNOWN_CREDENTIAL_REFS = [
  'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'ZAI_API_KEY', 'SERPER_API_KEY',
  'N8N_API_KEY', 'N8N_WEBHOOK_SECRET',
] as const

// The provider id @cordis-app/llm-openai-compat registers under — matches
// packages/llm/openai-compat/cordis.patch.yml's own `provider: openai-compat`.
// Used by /model-catalog below to always surface this deployment's
// self-hosted route, independent of ctx.agentDefaultModel's CURRENT
// selection. Real bug found live (2026-09-22): the model picker used to
// build its "self-hosted" entry from ctx.sessionController.modelCatalog()'s
// own `default` field — which is the MUTABLE deployment default (changeable
// via POST /model or a session-local select), not a fixed pointer to this
// route. Once something moved `default` to openrouter, the synthesized
// entry's id collided with the real openrouter group's id (both
// 'openrouter'), and React silently dropped one — the self-hosted entry
// vanished from the dropdown with no error anywhere. openai-compat's
// adapter has no listModels() override (confirmed: it never appears in
// modelCatalog()'s own `groups`), so there is no live catalog to read its
// configured model from either — OPENAI_MODEL_ID (the same env var
// packages/llm/openai-compat/cordis.patch.yml's own agent-default-model
// override reads) is the actual fixed, boot-time source of truth.
const SELF_HOSTED_PROVIDER = 'openai-compat'

const API_PREFIX = '/api/v1'
// ctx.connection.fetch.register()'s own ConnectionFetchMethod type is fixed
// to 'GET' | 'HEAD' | 'POST' (confirmed in dsh-client-connection's rpc.d.ts)
// — no PATCH/DELETE at all, a real framework constraint, not a choice made
// here. Rename/delete below are verb-suffixed POST routes
// (/session-rename, /session-delete), same convention as the existing
// /session-interrupt, /session-fork, /session-approval-respond.
type Method = 'GET' | 'POST'
type Handler = (request: Request) => Promise<Response>

/** Cold-session resume in flight, keyed by session id — dedupes concurrent requests for the same id. */
const resuming = new Map<string, Promise<Agent | undefined>>()
/**
 * The handle of every agent this gateway created or resumed, by session id.
 * `handle.dispose()` is the one way to let a live agent go before dsh's own
 * idle sweep does, and deleting a session needs exactly that: without it every
 * recently used chat answered "session is still live" until the sweep came
 * round, which in practice meant deleting a chat just failed. The handles were
 * being dropped the moment they were returned.
 */
const handles = new Map<string, AgentHandle>()

interface PendingApproval {
  readonly sessionId: string
  readonly toolName: string
  readonly callId: string
  readonly reason: string | undefined
  readonly resolve: (outcome: ApprovalOutcome) => void
}

/** Approvals awaiting a human decision via POST session-approval-respond, keyed by callId. */
const pendingApprovals = new Map<string, PendingApproval>()

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function badRequest(message: string): Response {
  return json({ error: message }, 400)
}

function notFoundResponse(message: string): Response {
  return json({ error: message }, 404)
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json()
    return typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function requireString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Scan backward for the nearest turn marker — true when the last one is an unclosed 'turn/start'. */
function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const type = events[i]?.type
    if (type === 'turn/start') return true
    if (type === 'turn/end') return false
  }
  return false
}

/**
 * Real gap fixed (user: "khi tạo mới mà chưa chat thì đừng lưu và show trên
 * sidebar phần history") — matches example-2's own real
 * `sessions.first_message_at IS NOT NULL` filter on `GET /sessions/mine`: a
 * session nobody has typed a real message into yet must never appear in the
 * sidebar's history list, even though dsh already created it (the center
 * pane already shows its composer — Đợt 8's auto-create-on-landing). Scans
 * the session's own live `surface` (already-maintained in-memory
 * projection, no extra log read) for a `user/message` node actually
 * authored by a person — the exact same `source.kind` criteria the
 * frontend's `hasRealUserMessage` (conversation.tsx) already uses, so
 * server and client can never disagree on what counts as "chatted".
 */
function isRealUserMessage(event: SessionEvent | undefined): boolean {
  if (event?.type !== 'user/message') return false
  const source = event.data.source as { kind?: string } | undefined
  return source?.kind === undefined || source.kind === 'user'
}

function sessionHasRealUserMessage(session: Session): boolean {
  for (const seq of session.surface.nodes) {
    if (isRealUserMessage(session.eventAt(seq))) return true
  }
  return false
}

interface SessionSummary {
  sessionId: string
  cwd?: string
  seq: number
  createdAt: number
  title: string | null
}

// ctx.sessions only holds sessions loaded in memory: a restart empties it, and
// dsh's idle sweep evicts quiet ones. The sidebar must list what is on disk
// too, so persisted sessions are read through ctx.sessionQuery. A session that
// is not live cannot change, so its summary is read once and cached; going
// live again drops the cache entry so a later eviction re-reads it.
const persistedSummaries = new Map<string, SessionSummary | null>()

async function summarizeSession(ctx: Context, record: SessionRecord): Promise<SessionSummary | null> {
  const id = record.header.id
  const live = ctx.sessions.get(id)
  if (live !== undefined) {
    persistedSummaries.delete(id)
    if (!sessionHasRealUserMessage(live)) return null
    return {
      sessionId: live.id,
      cwd: live.header.cwd,
      seq: live.seq,
      createdAt: live.header.createdAt,
      title: ctx.sessionTitle.get(live)?.title ?? null,
    }
  }
  const cached = persistedSummaries.get(id)
  if (cached !== undefined) return cached
  let summary: SessionSummary | null = null
  try {
    const snapshot = await ctx.sessionQuery.readSession(id)
    if (snapshot.events.some(isRealUserMessage)) {
      summary = {
        sessionId: id,
        cwd: record.header.cwd,
        seq: snapshot.events.at(-1)?.seq ?? 0,
        createdAt: record.header.createdAt,
        title: (await ctx.sessionQuery.readTitle(id))?.title ?? null,
      }
    }
  } catch {
    // An unreadable log must not take the whole list down with it.
  }
  persistedSummaries.set(id, summary)
  return summary
}

function workspaceRoot(): string {
  // NEVER process.cwd() — that's the dsh checkout root when run via `dsh
  // --profile`, and a real request without an explicit cwd landed session
  // workspace directories directly inside this git repo during testing.
  // Docker (Phase 3) sets CORDIS_WORKSPACE_ROOT to the compose `workspace`
  // volume; os.tmpdir() is only the local-dev fallback.
  return process.env.CORDIS_WORKSPACE_ROOT ?? join(tmpdir(), 'cordis-workspace')
}

/** Remove every on-disk artifact of one idle session — see the DELETE route's own comment for the real, empirically-confirmed layout this walks. */
async function deleteSessionFiles(sessionId: string): Promise<void> {
  const home = resolveDshHome()
  const sessionsRoot = join(home, 'sessions')
  const buckets = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => [])
  await Promise.all(buckets
    .filter(entry => entry.isDirectory())
    .map(bucket => rm(join(sessionsRoot, bucket.name, sessionId), { recursive: true, force: true })))
  await rm(join(home, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`), { force: true })
}

// Same NAME_RE/limits as @cordis-app/tool-create-skill (a small, deliberate
// duplication rather than a new inter-package dependency for ~15 lines —
// both write the exact same real target, dsh-skill-filesystem's own
// "user-dsh" root, confirmed by a live boot test: create a file directly at
// $DSH_HOME/skills/<name>/SKILL.md, watch it appear with `source:
// "user-dsh"` in GET /api/v1/skills with no restart needed).
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const SKILL_MAX_DESCRIPTION_CHARS = 280
const SKILL_MAX_CONTENT_BYTES = 64 * 1024

function skillFrontmatter(skillName: string, description: string): string {
  const escape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `---\nname: "${escape(skillName)}"\ndescription: "${escape(description)}"\n---\n\n`
}

/** Shared by /skill-create and /skill-update — the only difference is whether the name is allowed to already exist as a user-dsh skill. */
async function writeUserSkill(ctx: Context, body: Record<string, unknown>, options: { requireNew: boolean }): Promise<string> {
  const skillName = (requireString(body, 'name') ?? '').trim()
  if (!SKILL_NAME_RE.test(skillName)) throw new Error(`invalid name "${skillName}": use kebab-case, e.g. "weekly-report"`)
  const description = (requireString(body, 'description') ?? '').trim()
  if (description === '' || description.length > SKILL_MAX_DESCRIPTION_CHARS) {
    throw new Error(`description is required and at most ${String(SKILL_MAX_DESCRIPTION_CHARS)} characters`)
  }
  const content = (requireString(body, 'content') ?? '').trim()
  if (content === '' || Buffer.byteLength(content, 'utf8') > SKILL_MAX_CONTENT_BYTES) {
    throw new Error(`content is required and at most ${String(SKILL_MAX_CONTENT_BYTES)} bytes`)
  }
  const skills = await ctx.skills.list()
  const existing = skills.find(skill => skill.name === skillName)
  if (options.requireNew && existing !== undefined) {
    throw new Error(`a skill named "${skillName}" already exists — choose a different name`)
  }
  if (!options.requireNew && existing?.source !== 'user-dsh') {
    throw new Error(`no editable skill named "${skillName}"`)
  }
  const skillDir = join(resolveDshHome(), 'skills', skillName)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), skillFrontmatter(skillName, description) + content + '\n', 'utf8')
  return skillName
}

export function apply(ctx: Context): void {
  registerApprovalAnswerer(ctx)

  registerRoute(ctx, '/sessions', {
    POST: async (request) => {
      const body = await readJson(request)
      const cwd = requireString(body, 'cwd') ?? join(workspaceRoot(), randomUUID())
      await mkdir(cwd, { recursive: true })
      const sessionId = SessionId(randomUUID())
      const handle = await ctx.agents.create({
        sessionId,
        meta: { cwd },
        agentOptions: ctx.agentDefaultModel.currentSelection(),
      })
      handles.set(sessionId, handle)
      const { agent } = handle
      return json({ sessionId: agent.session.id, cwd })
    },
    GET: async () => {
      const records = await ctx.sessionQuery.listSessions()
      const summaries = await Promise.all(records.map(record => summarizeSession(ctx, record)))
      return json({ sessions: summaries.filter(summary => summary !== null) })
    },
  })

  // Rename: real API (`ctx.sessionTitle.rename`), not invented storage —
  // appends a `source: 'user'` `session/title` event that PINS the title
  // (automatic generation stops for this session afterward). rename() needs a
  // live Session, so an evicted one is resumed first, as sending a message does.
  registerRoute(ctx, '/session-rename', {
    POST: async (request) => {
      const body = await readJson(request)
      const sessionId = requireString(body, 'sessionId')
      const title = requireString(body, 'title')
      if (sessionId === undefined || title === undefined) return badRequest('sessionId and title are required')
      await resolveAgent(ctx, SessionId(sessionId))
      const session = ctx.sessions.get(SessionId(sessionId))
      if (session === undefined) return notFoundResponse(`session ${sessionId} not found`)
      try {
        const snapshot = ctx.sessionTitle.rename(session, title)
        return json({ title: snapshot.title })
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : String(error))
      }
    },
  })

  // Delete: dsh-session-persistence's public surface (create/open/flush/
  // stat/list, confirmed by reading its full .d.ts) has NO delete/remove —
  // append-only by design. Real on-disk layout confirmed by inspecting a
  // live $DSH_HOME: `sessions/<cwd-bucket>/<sessionId>/{session.lock,
  // session.v3.jsonl.zstd}` plus a cached projection at
  // `storages/session_projcache/sessions/<sessionId>.json`. Deliberately
  // does NOT reconstruct dsh's own cwd-escaping scheme for the bucket name
  // (undocumented, could change) — searches every bucket for a child
  // directory named exactly `sessionId` instead, which only depends on the
  // one stable fact (the leaf dir is the session id). Refuses a still-live
  // session (dsh-agent's `Agent.dispose()` needs the original create/resume
  // `AgentHandle`, which this gateway never retains past its own call —
  // confirmed via dsh-agent's own .d.ts comment, "ctx.agents.get(id) still
  // returns a bare Agent" — deleting its files out from under an active
  // write-lease would be unsafe, not just unsupported) — idle sessions
  // (dsh's own idle sweep hibernates them out of ctx.agents) are the only
  // ones this ever touches.
  registerRoute(ctx, '/session-delete', {
    POST: async (request) => {
      const body = await readJson(request)
      const sessionId = requireString(body, 'sessionId')
      if (sessionId === undefined) return badRequest('sessionId is required')
      const live = ctx.agents.get(SessionId(sessionId))
      if (live !== undefined) {
        const handle = handles.get(sessionId)
        // Opened by something other than this gateway (a scheduled or
        // webhook-started run): its owner holds the handle, not us.
        if (handle === undefined) {
          return json({ error: 'session is still live — wait for it to go idle before deleting' }, 409)
        }
        // Deleting is an explicit stop: a turn still running is cancelled
        // and allowed to settle before its agent is let go.
        if (live.status === 'running') {
          live.cancel({ kind: 'user' })
          await live.whenIdle()
        }
        await handle.dispose()
      }
      handles.delete(sessionId)
      await deleteSessionFiles(sessionId)
      return json({ ok: true })
    },
  })

  registerRoute(ctx, '/model', {
    GET: async () => json(ctx.agentDefaultModel.currentSelection()),
    POST: async (request) => {
      const body = await readJson(request)
      const provider = requireString(body, 'provider')
      const model = requireString(body, 'model')
      if (provider === undefined || model === undefined) return badRequest('provider and model are required')
      const reasoningEffort = requireString(body, 'reasoningEffort')
      await ctx.agentDefaultModel.saveSelection({
        provider,
        model,
        ...reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) },
      })
      return json(ctx.agentDefaultModel.currentSelection())
    },
  })

  // Replaces the old /model-providers + /model-catalog?provider= pair (2
  // round trips, raw ctx.llm.listProviders()/listConfigurableProviders()/
  // listModels(), not session-aware, no per-provider failure reason).
  // ctx.sessionController.modelCatalog() already groups by provider, names
  // the deployment default, and reports WHY an unconfigured provider (e.g.
  // OpenRouter with no credential yet) can't serve a request — one call, no
  // hand-rolled catalog. Confirmed unused by any prior frontend code before
  // removing the 2 old routes (see docs/add-openrouter-model-switch-plan.md).
  registerRoute(ctx, '/model-catalog', {
    GET: async () => {
      const catalog = await ctx.sessionController.modelCatalog()
      // Prepended, not merged into whatever catalog.groups already has — the
      // real API response confirmed openai-compat never appears there on
      // its own (see SELF_HOSTED_PROVIDER's own comment for why), so there
      // is nothing to collide with.
      const selfHostedModel = process.env.OPENAI_MODEL_ID ?? 'unconfigured-model'
      const selfHostedGroup = {
        id: SELF_HOSTED_PROVIDER,
        name: SELF_HOSTED_PROVIDER,
        models: [{ id: selfHostedModel, name: selfHostedModel }],
      }
      return json({ ...catalog, groups: [selfHostedGroup, ...catalog.groups] })
    },
  })

  // Session-local model override — distinct from POST /model above, which
  // only sets the deployment DEFAULT for sessions created after it. This
  // changes the model of ONE already-live (or cold, auto-resumed) session,
  // taking effect from its next step (ctx.sessionController's own contract:
  // "Select one Session-local model after explicitly resuming the Session").
  //
  // Real, confirmed-in-source behavior found live (2026-09-23), NOT
  // documented in that "Session-local" contract:
  // dsh-api-session-controller's compiled selectModel()
  // (lib/types/commands.js) ALWAYS also calls
  // `ctx.agentDefaultModel.saveSelection(selected)` internally — every call
  // silently overwrites the DEPLOYMENT-WIDE default too, confirmed with a
  // controlled test (select a model for session A, GET /api/v1/model showed
  // it as the default even for a brand-new, never-touched session B).
  // apps/web's ModelPicker tells the user this only affects THIS
  // conversation (model-picker.tsx's own `modelPicker.scopeHint` string) —
  // snapshotting the default here and restoring it right after the call is
  // what actually makes that claim true, not just documentation.
  registerRoute(ctx, '/session-select-model', {
    POST: async (request) => {
      const body = await readJson(request)
      const sessionId = requireString(body, 'sessionId')
      const provider = requireString(body, 'provider')
      const model = requireString(body, 'model')
      if (sessionId === undefined || provider === undefined || model === undefined) {
        return badRequest('sessionId, provider and model are required')
      }
      const agent = await resolveAgent(ctx, SessionId(sessionId))
      if (agent === undefined) return notFoundResponse(`session ${sessionId} not found`)
      const reasoningEffort = requireString(body, 'reasoningEffort')
      try {
        const previousDefault = ctx.agentDefaultModel.currentSelection()
        const result = await ctx.sessionController.selectModel({
          sessionId: SessionId(sessionId),
          provider,
          model,
          ...reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) },
        })
        await ctx.agentDefaultModel.saveSelection(previousDefault)
        return json(result)
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : String(error))
      }
    },
  })

  registerRoute(ctx, '/credentials', {
    // No secret value ever crosses this route in either direction — only
    // ctx.credentials.describe()'s {configured, source, writable} facts,
    // matching the package's own "never the value" contract.
    GET: async () => {
      const credentials = await Promise.all(KNOWN_CREDENTIAL_REFS.map(async (ref) => ({
        ref,
        ...await ctx.credentials.describe(credentialRef(ref)),
      })))
      return json({ credentials })
    },
    POST: async (request) => {
      const body = await readJson(request)
      const ref = requireString(body, 'ref')
      if (ref === undefined || !isCredentialRefName(ref)) return badRequest('ref must be a POSIX shell identifier')
      try {
        if (body['unset'] === true) {
          await ctx.credentials.unset(credentialRef(ref))
        } else {
          const value = requireString(body, 'value')
          if (value === undefined) return badRequest('value is required unless unset is true')
          await ctx.credentials.set(credentialRef(ref), value)
        }
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 409)
      }
      return json({ ref, ...await ctx.credentials.describe(credentialRef(ref)) })
    },
  })

  registerRoute(ctx, '/skills', {
    // No longer view-only (Phase H's original scope) — Đợt 5 added real
    // create/update/delete below, once `@cordis-app/tool-create-skill`
    // proved the exact real write target ($DSH_HOME/skills/<name>/SKILL.md,
    // dsh-skill-filesystem's own "user-dsh" root) via a live boot test.
    GET: async () => json({ skills: await ctx.skills.list() }),
  })

  registerRoute(ctx, '/skill-content', {
    // Full body (SkillSummary alone has no `content`) — needed to
    // pre-populate the edit form for an existing skill.
    GET: async (request) => {
      const url = new URL(request.url)
      const skillName = url.searchParams.get('name')
      if (skillName === null) return badRequest('missing name')
      const skill = await ctx.skills.get(skillName)
      if (skill === undefined) return notFoundResponse(`skill ${skillName} not found`)
      return json({ name: skill.name, description: skill.description, content: skill.content, source: skill.source })
    },
  })

  registerRoute(ctx, '/skill-create', {
    POST: async (request) => {
      const body = await readJson(request)
      try {
        const saved = await writeUserSkill(ctx, body, { requireNew: true })
        return json({ name: saved })
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : String(error))
      }
    },
  })

  registerRoute(ctx, '/skill-update', {
    POST: async (request) => {
      const body = await readJson(request)
      try {
        const saved = await writeUserSkill(ctx, body, { requireNew: false })
        return json({ name: saved })
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : String(error))
      }
    },
  })

  registerRoute(ctx, '/skill-delete', {
    // Only ever removes $DSH_HOME/skills/<name>/ (the user-dsh root) — never
    // touches packages/skills (bundled, read-only by design). Refuses
    // anything that isn't currently a live user-dsh skill, so this can never
    // be pointed at a bundled skill's name to make it vanish.
    POST: async (request) => {
      const body = await readJson(request)
      const skillName = requireString(body, 'name')
      if (skillName === undefined) return badRequest('name is required')
      const skills = await ctx.skills.list()
      const existing = skills.find(skill => skill.name === skillName)
      if (existing === undefined || existing.source !== 'user-dsh') {
        return badRequest(`no editable skill named "${skillName}"`)
      }
      await rm(join(resolveDshHome(), 'skills', skillName), { recursive: true, force: true })
      return json({ ok: true })
    },
  })

  registerRoute(ctx, '/session-events', {
    GET: async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id')
      if (id === null) return badRequest('missing id')
      const since = Number(url.searchParams.get('since') ?? '0')
      try {
        using observation = await ctx.sessionQuery.observeSession(SessionId(id))
        return json({
          events: observation.events.filter(event => event.seq >= since),
          cursor: observation.cursor,
        })
      } catch {
        return notFoundResponse(`session ${id} not found`)
      }
    },
  })

  registerRoute(ctx, '/session-stream', {
    GET: async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id')
      if (id === null) return badRequest('missing id')
      const sessionId = SessionId(id)
      const lastEventId = request.headers.get('last-event-id')
      const since = lastEventId !== null
        ? Number(lastEventId) + 1
        : Number(url.searchParams.get('since') ?? '0')

      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: SessionEvent): void => {
            controller.enqueue(encoder.encode(
              `id: ${String(event.seq)}\nevent: session-event\ndata: ${JSON.stringify(event)}\n\n`,
            ))
          }
          // Registered BEFORE the initial snapshot read below so nothing
          // appended between the two can be lost (session-controller history.ts
          // follows the same order for the same reason).
          const dispose = ctx.on('session/event', (session: Session, event: SessionEvent) => {
            if (session.id !== sessionId) return
            if (event.seq >= since) send(event)
          }, { global: true })
          request.signal.addEventListener('abort', () => {
            dispose()
            try { controller.close() } catch { /* already closed */ }
          })
          void (async () => {
            try {
              using observation = await ctx.sessionQuery.observeSession(sessionId)
              for (const event of observation.events) {
                if (event.seq >= since) send(event)
              }
            } catch (error) {
              controller.error(error)
              dispose()
            }
          })()
        },
      })
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
      })
    },
  })

  registerRoute(ctx, '/session-messages', {
    POST: async (request) => {
      const body = await readJson(request)
      const sessionId = requireString(body, 'sessionId')
      const text = requireString(body, 'text')
      if (sessionId === undefined || text === undefined) return badRequest('sessionId and text are required')
      const agent = await resolveAgent(ctx, SessionId(sessionId))
      if (agent === undefined) return notFoundResponse(`session ${sessionId} not found`)
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      return json({ ok: true })
    },
  })

  registerRoute(ctx, '/session-interrupt', {
    POST: async (request) => {
      const body = await readJson(request)
      const sessionId = requireString(body, 'sessionId')
      if (sessionId === undefined) return badRequest('sessionId is required')
      const agent = ctx.agents.get(SessionId(sessionId))
      if (agent === undefined) return notFoundResponse(`session ${sessionId} is not live`)
      // keepInbox (dsh-agent's own CancelOptions, README: "aborts only the
      // turn and preserves pending items") is what the composer's 2 buttons
      // map to — a soft "Dừng" (true, resumable via a follow-up) vs a hard
      // "Huỷ bỏ task" (omitted, also clears queued/steering work).
      agent.cancel({ kind: 'user' }, { keepInbox: body['keepInbox'] === true })
      return json({ ok: true })
    },
  })

  registerRoute(ctx, '/session-fork', {
    POST: async (request) => {
      const body = await readJson(request)
      const sourceId = requireString(body, 'sessionId')
      if (sourceId === undefined) return badRequest('sessionId is required')
      let observation
      try {
        observation = await ctx.sessionQuery.observeSession(SessionId(sourceId))
      } catch {
        return notFoundResponse(`session ${sourceId} not found`)
      }
      using sourceObservation = observation
      const events = sourceObservation.events
      if (hasOpenTurn(events)) {
        return badRequest('cannot fork a session with an open turn — wait for the current turn to end')
      }
      const newSessionId = SessionId(randomUUID())
      const sourceCwd = sourceObservation.header.cwd
      const handle = await ctx.agents.create({
        sessionId: newSessionId,
        meta: {
          ...sourceCwd === undefined ? {} : { cwd: sourceCwd },
          parentSession: SessionId(sourceId),
          isSeeded: true,
        },
        inheritedEventCount: SessionLogOffset(events.length),
        seed: events,
        agentOptions: ctx.agentDefaultModel.currentSelection(),
      })
      handles.set(newSessionId, handle)
      return json({ sessionId: handle.agent.session.id })
    },
  })

  // The chat's own working directory, readable from the UI. Until now nothing
  // outside the agent could see it: the model writes a file, says where it put
  // it, and the user has no way to open it. `workspace-files` lists,
  // `workspace-file` serves one. Both resolve the directory from the session
  // itself, never from the request, and refuse any path that leaves it.
  registerRoute(ctx, '/workspace-files', {
    GET: async (request) => {
      const id = new URL(request.url).searchParams.get('id')
      if (id === null) return badRequest('missing id')
      const agent = await resolveAgent(ctx, SessionId(id))
      const cwd = agent?.session.header.cwd
      if (cwd === undefined) return notFoundResponse(`session ${id} has no working directory`)
      return json({ files: await listWorkspace(cwd) })
    },
  })

  registerRoute(ctx, '/workspace-file', {
    GET: async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id')
      const path = url.searchParams.get('path')
      if (id === null || path === null) return badRequest('id and path are required')
      const agent = await resolveAgent(ctx, SessionId(id))
      const cwd = agent?.session.header.cwd
      if (cwd === undefined) return notFoundResponse(`session ${id} has no working directory`)
      const absolute = insideWorkspace(cwd, path)
      if (absolute === undefined) return badRequest('path leaves the working directory')
      const body = await readFile(absolute).catch(() => undefined)
      if (body === undefined) return notFoundResponse(`no file ${path}`)
      const dot = path.lastIndexOf('.')
      const type = dot === -1 ? undefined : PREVIEWABLE[path.slice(dot).toLowerCase()]
      return new Response(new Uint8Array(body), {
        headers: {
          'content-type': type ?? 'application/octet-stream',
          'content-disposition': `${type === undefined ? 'attachment' : 'inline'}; filename="${path.split('/').pop() ?? 'file'}"`,
        },
      })
    },
  })

  registerRoute(ctx, '/session-approvals', {
    GET: async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id')
      const approvals = [...pendingApprovals.entries()]
        .filter(([, pending]) => id === null || pending.sessionId === id)
        .map(([callId, pending]) => ({
          callId,
          sessionId: pending.sessionId,
          toolName: pending.toolName,
          reason: pending.reason,
        }))
      return json({ approvals })
    },
  })

  registerRoute(ctx, '/session-approval-respond', {
    POST: async (request) => {
      const body = await readJson(request)
      const callId = requireString(body, 'callId')
      const outcome = requireString(body, 'outcome')
      if (callId === undefined || outcome === undefined) return badRequest('callId and outcome are required')
      if (outcome !== 'allowed-once' && outcome !== 'rejected') {
        return badRequest('outcome must be "allowed-once" or "rejected"')
      }
      const pending = pendingApprovals.get(callId)
      if (pending === undefined) return notFoundResponse(`no pending approval ${callId}`)
      pending.resolve(outcome)
      return json({ ok: true })
    },
  })
}

/** Get a live Agent, or resume its cold session — deduped so two concurrent requests for the same cold id don't race two resumes. */
async function resolveAgent(ctx: Context, sessionId: SessionId): Promise<Agent | undefined> {
  const live = ctx.agents.get(sessionId)
  if (live !== undefined) return live
  const key = sessionId as string
  let pending = resuming.get(key)
  if (pending === undefined) {
    pending = ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: ctx.agentDefaultModel.currentSelection(),
    }).then((handle) => { handles.set(key, handle); return handle.agent }).catch(() => undefined).finally(() => resuming.delete(key))
    resuming.set(key, pending)
  }
  return pending
}

/**
 * The one composed answerer this deployment has. Without it, dsh-user-approval
 * fails every request closed to 'unavailable' (README: "the service itself
 * never prompts a human"). Routes the decision out to whichever client polls
 * GET session-approvals and answers POST session-approval-respond.
 */
function registerApprovalAnswerer(ctx: Context): void {
  ctx.on('approval/request', (request, next) => {
    // No callId means no way to key a REST reply on this request — delegate
    // rather than strand it as a pending approval nobody can ever answer.
    if (request.callId === undefined) return next()
    const callId = request.callId
    return new Promise<ApprovalOutcome>((resolve) => {
      pendingApprovals.set(callId, {
        sessionId: request.agent.session.id,
        toolName: request.toolName,
        callId,
        reason: request.reason,
        resolve: (outcome) => {
          pendingApprovals.delete(callId)
          resolve(outcome)
        },
      })
      request.signal?.addEventListener('abort', () => {
        if (pendingApprovals.delete(callId)) resolve('cancelled')
      }, { once: true })
    })
  })
}

/** How many files one workspace listing returns; a runaway output directory must not become a runaway response. */
const MAX_WORKSPACE_FILES = 200
/** Content types worth naming so the browser can show the file instead of only downloading it. */
const PREVIEWABLE: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

/** Every file under a session's working directory, newest first, dot-entries skipped. */
async function listWorkspace(cwd: string): Promise<Array<{ path: string; size: number; modified: number }>> {
  const found: Array<{ path: string; size: number; modified: number }> = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(join(cwd, dir), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.') || found.length >= MAX_WORKSPACE_FILES) continue
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) {
        const info = await stat(join(cwd, path)).catch(() => undefined)
        if (info !== undefined) found.push({ path, size: info.size, modified: info.mtimeMs })
      }
    }
  }
  await walk('')
  return found.sort((a, b) => b.modified - a.modified)
}

/** The absolute path of `path` inside `cwd`, or undefined when it escapes — the only guard between a query string and the host filesystem. */
function insideWorkspace(cwd: string, path: string): string | undefined {
  const absolute = resolve(cwd, path)
  const rel = relative(cwd, absolute)
  if (rel === '' || rel.startsWith('..') || rel.startsWith(`..${sep}`) || resolve(cwd, rel) !== absolute) return undefined
  return absolute
}

function registerRoute(ctx: Context, path: string, handlers: Partial<Record<Method, Handler>>): void {
  const methods = Object.keys(handlers) as Method[]
  ctx.connection.fetch.register({
    path: `${API_PREFIX}${path}`,
    methods,
    requestBody: 'buffered',
    fetch: async (request) => {
      const handler = handlers[request.method as Method]
      if (handler === undefined) return new Response('method not allowed', { status: 405 })
      return handler(request)
    },
  })
}
