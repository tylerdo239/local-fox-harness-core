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
import { mkdir } from 'node:fs/promises'
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
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

export const name = 'cordis-gateway'
// Every ctx.<key> this plugin reads as a property, plus 'approval' so this
// plugin only activates once there is an approval service for our answerer
// to actually serve — reading ctx.<key> without declaring it here throws
// "cannot get property ... without inject" (confirmed by a real boot
// failure while writing this).
export const inject = ['connection', 'agents', 'sessions', 'sessionQuery', 'agentDefaultModel', 'approval']

const API_PREFIX = '/api/v1'
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

function workspaceRoot(): string {
  // NEVER process.cwd() — that's the dsh checkout root when run via `dsh
  // --profile`, and a real request without an explicit cwd landed session
  // workspace directories directly inside this git repo during testing.
  // Docker (Phase 3) sets CORDIS_WORKSPACE_ROOT to the compose `workspace`
  // volume; os.tmpdir() is only the local-dev fallback.
  return process.env.CORDIS_WORKSPACE_ROOT ?? join(tmpdir(), 'cordis-workspace')
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
      const sessions = ctx.sessions.list().map(session => ({
        sessionId: session.id,
        cwd: session.header.cwd,
        seq: session.seq,
      }))
      return json({ sessions })
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
