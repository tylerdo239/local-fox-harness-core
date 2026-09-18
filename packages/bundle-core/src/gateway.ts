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
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Context/Events declaration-merge augmentations only apply when the file
// that declares them is part of the compiled program — these three are never
// referenced by name below, only through the ctx.<key> they add.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-query'
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
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

export const name = 'cordis-gateway'
// Every ctx.<key> this plugin reads as a property, plus 'approval' so this
// plugin only activates once there is an approval service for our answerer
// to actually serve — reading ctx.<key> without declaring it here throws
// "cannot get property ... without inject" (confirmed by a real boot
// failure while writing this). 'llm' and 'credentials' back the P3 model +
// credential routes below. 'skills' backs Phase H's read-only /skills route.
// 'sessionTitle' backs Đợt 2 Phase I's title/rename routes.
export const inject = ['connection', 'agents', 'sessions', 'sessionQuery', 'agentDefaultModel', 'approval', 'llm', 'credentials', 'skills', 'sessionTitle']

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
  'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'SERPER_API_KEY',
  'N8N_API_KEY', 'N8N_WEBHOOK_SECRET',
] as const

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
function sessionHasRealUserMessage(session: Session): boolean {
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq)
    if (event?.type !== 'user/message') continue
    const source = event.data.source as { kind?: string } | undefined
    if (source?.kind === undefined || source.kind === 'user') return true
  }
  return false
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
      const { agent } = await ctx.agents.create({
        sessionId,
        meta: { cwd },
        agentOptions: ctx.agentDefaultModel.currentSelection(),
      })
      return json({ sessionId: agent.session.id, cwd })
    },
    GET: async () => {
      const sessions = ctx.sessions.list()
        .filter(sessionHasRealUserMessage)
        .map(session => ({
          sessionId: session.id,
          cwd: session.header.cwd,
          seq: session.seq,
          createdAt: session.header.createdAt,
          // ctx.sessionTitle.get() folds the log-only `session/title` event
          // in memory — no extra I/O, session-title-llm/fallback already
          // append it automatically (see this file's own import comment).
          title: ctx.sessionTitle.get(session)?.title ?? null,
        }))
      return json({ sessions })
    },
  })

  // Rename: real API (`ctx.sessionTitle.rename`), not invented storage —
  // appends a `source: 'user'` `session/title` event that PINS the title
  // (automatic generation stops for this session afterward). Only live
  // sessions can be looked up via ctx.sessions.get() — same "live only"
  // limitation the rest of this route already lives with (Phase 2/D).
  registerRoute(ctx, '/session-rename', {
    POST: async (request) => {
      const body = await readJson(request)
      const sessionId = requireString(body, 'sessionId')
      const title = requireString(body, 'title')
      if (sessionId === undefined || title === undefined) return badRequest('sessionId and title are required')
      const session = ctx.sessions.get(SessionId(sessionId))
      if (session === undefined) return notFoundResponse(`session ${sessionId} is not live`)
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
      if (ctx.agents.get(SessionId(sessionId)) !== undefined) {
        return json({ error: 'session is still live — wait for it to go idle before deleting' }, 409)
      }
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

  registerRoute(ctx, '/model-providers', {
    // Live-registered routes plus every configurable-but-dormant route an
    // adapter declares (dsh-llm-pi-ai's own catalog and any custom route a
    // profile patch adds to its `providers` map) — real ctx.llm APIs, not a
    // hand-rolled catalog, so this never drifts from what can actually serve
    // a request.
    GET: async () => json({
      providers: ctx.llm.listProviders(),
      configurable: ctx.llm.listConfigurableProviders(),
    }),
  })

  registerRoute(ctx, '/model-catalog', {
    GET: async (request) => {
      const url = new URL(request.url)
      const provider = url.searchParams.get('provider')
      if (provider === null) return badRequest('missing provider')
      try {
        return json({ models: await ctx.llm.listModels(provider) })
      } catch (error) {
        return notFoundResponse(error instanceof Error ? error.message : `provider ${provider} not found`)
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
      agent.cancel({ kind: 'user' })
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
      const { agent } = await ctx.agents.create({
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
      return json({ sessionId: agent.session.id })
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
    }).then(handle => handle.agent).catch(() => undefined).finally(() => resuming.delete(key))
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
