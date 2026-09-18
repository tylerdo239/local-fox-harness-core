// P5 — audit trail: every tool call plus per-step token usage/cost, appended
// to $DSH_HOME/audit/*.jsonl. See docs/cordis-agent-implementation-plan.md
// §9 for the researched API surface — architecture doc's original sketch
// named a `telemetry/*` event family that does not exist in the real dsh
// event vocabulary (verified: no `telemetry/*` Cordis event anywhere in
// node_modules; `@deepseek-ai/dsh-session-telemetry-otel` is an unrelated
// opt-in OTel *feedback* exporter, not a generic audit hook). The real
// events used instead:
// - `tools/result` (dsh-tools, `@mode emit`, pure observer) — NOT
//   `tools/post-execute` (a waterfall meant for active participants like a
//   spill policy that can replace content; a passive logger has no business
//   calling its `next()` and risking the pipeline).
// - `session/event` (dsh-session, same global-listener pattern gateway.ts
//   already uses for its SSE stream) filtered to `request/context` (learn
//   the session's current provider/model) and `assistant/message` (carries
//   `usage?: TokenUsage` for the step that just completed — there is no
//   separate usage event).
// - `@deepseek-ai/dsh-home-paths`'s `dshHomePath()` for `$DSH_HOME/audit` —
//   a direct library import (its own README: "not through cordis.yml"), not
//   a ctx service.
import { appendFile, mkdir } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

export const name = 'cordis-audit'
export const inject = ['tools']

export interface PriceEntry {
  /** US dollars per 1,000,000 uncached input tokens. */
  readonly inputPerMillion: number
  /** US dollars per 1,000,000 output tokens. */
  readonly outputPerMillion: number
}

const PriceEntry: z<PriceEntry> = z.object({
  inputPerMillion: z.number().required(),
  outputPerMillion: z.number().required(),
})

export interface Config {
  /** Directory audit JSONL files are written into. Default: $DSH_HOME/audit — left unset here (computed in apply(), not a static schema default) since it depends on runtime env, not a fixed literal. */
  readonly auditRoot?: string
  /** Max bytes kept per redacted/truncated field before appending a truncation marker. */
  readonly maxFieldBytes: number
  /** Keyed by "provider/model" (matches request/context's fields joined with "/"). Entries absent here log tokens with no cost field, rather than guessing a price. */
  readonly prices: Record<string, PriceEntry>
}

// Bundle-tier row (packages/bundle-core/cordis.patch.yml) inserts this
// plugin with NO `config:` block at all — confirmed for real this makes
// Cordis loader call apply(ctx, undefined) unless a Config schema is
// exported here for it to normalize `undefined` through (every field must
// resolve via .default(), not just carry a TS-level optional `?`, which has
// no runtime effect).
export const Config: z<Config> = z.object({
  auditRoot: z.string(),
  maxFieldBytes: z.number().step(1).min(1).default(2000),
  prices: z.dict(PriceEntry).default({}),
})

const SECRET_KEY_PATTERN = /token|secret|password|api[-_]?key|credential/i
const MAX_REDACT_DEPTH = 6

/** Recursively masks values whose OWN key looks secret-shaped — heuristic, not a guarantee (documented limitation, see plan §9). */
function redact(value: unknown, depth = 0): unknown {
  if (depth >= MAX_REDACT_DEPTH) return '[max-depth]'
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redact(item, depth + 1)
    }
    return out
  }
  return value
}

function truncate(value: unknown, maxBytes: number): string {
  const text = (() => {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  })()
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  return `${text.slice(0, maxBytes)}…(truncated)`
}

interface AuditRecord {
  readonly type: 'tool_call' | 'usage'
  readonly ts: string
  readonly sessionId: string
  readonly [key: string]: unknown
}

function auditFilePath(root: string): string {
  const day = new Date().toISOString().slice(0, 10)
  return `${root}/audit-${day}.jsonl`
}

async function appendRecord(root: string, record: AuditRecord): Promise<void> {
  await mkdir(root, { recursive: true })
  await appendFile(auditFilePath(root), `${JSON.stringify(record)}\n`, 'utf8')
}

function costOf(usage: TokenUsage, price: PriceEntry): number {
  const input = usage.inputTokens * price.inputPerMillion / 1_000_000
  const output = usage.outputTokens * price.outputPerMillion / 1_000_000
  return Math.round((input + output) * 1_000_000) / 1_000_000
}

export function apply(ctx: Context, config: Config): void {
  const root = config.auditRoot ?? dshHomePath('audit')
  const { maxFieldBytes, prices } = config

  // Tracks each session's most recently logged route so a step's usage can
  // be priced — request/context only logs on a CHANGE (dsh-session's own
  // doc comment), so this is last-known-good, not a per-event read.
  const currentRoute = new Map<string, { provider: string; model: string }>()

  const logFailure = (context: string, error: unknown): void => {
    ctx.logger.warn(`cordis-audit: ${context} failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  ctx.on('tools/result', (exec, result) => {
    const sessionId = exec.agent?.session.id
    if (sessionId === undefined) return // no session to attribute this call to (e.g. a bare PTC sub-dispatch context) — nothing useful to audit
    void appendRecord(root, {
      type: 'tool_call',
      ts: new Date().toISOString(),
      sessionId,
      toolName: exec.name,
      callId: exec.callId,
      arguments: truncate(redact(exec.arguments), maxFieldBytes),
      isError: result.isError,
      result: truncate(redact(result.isError ? result.error : result.value), maxFieldBytes),
    }).catch((error: unknown) => { logFailure('writing tool_call record', error) })
  }, { global: true })

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type === 'request/context') {
      const data = event.data as { provider: string; model: string }
      currentRoute.set(session.id, { provider: data.provider, model: data.model })
      return
    }
    if (event.type !== 'assistant/message') return
    const data = event.data as { turn: number; step: number; usage?: TokenUsage }
    if (data.usage === undefined) return
    const route = currentRoute.get(session.id)
    const priceKey = route !== undefined ? `${route.provider}/${route.model}` : undefined
    const price = priceKey !== undefined ? prices[priceKey] : undefined
    void appendRecord(root, {
      type: 'usage',
      ts: new Date().toISOString(),
      sessionId: session.id,
      turn: data.turn,
      step: data.step,
      provider: route?.provider,
      model: route?.model,
      usage: data.usage,
      ...price === undefined ? {} : { costUsd: costOf(data.usage, price) },
    }).catch((error: unknown) => { logFailure('writing usage record', error) })
  }, { global: true })
}
