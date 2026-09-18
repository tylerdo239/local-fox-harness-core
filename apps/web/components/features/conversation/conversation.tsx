'use client'

// UI clone plan Đợt 2 Phase J — dropped the "technical harness" rendering
// this had before (raw `#seq type` debug lines for tool/call+tool/result,
// a visible "turn N started/ended" divider for every turn boundary): matches
// example-2's own real casual-chat redesign (its Conversation.tsx's own
// header comment, "hide hết và làm UI UX lại cho casual như các platform ai
// agent") — one collapsible pill per tool call, no turn-boundary chrome at
// all, user messages as a bubble, assistant replies as plain flowing text
// (no container). Computed fresh from the whole flat `events` array each
// render (`useMemo`) rather than example-2's own incremental reducer state
// machine — this app already stores every event in Zustand and re-renders
// the full list, no separate "live" reducer to keep in sync (that's Đợt 2
// Phase L's job, when live token streaming lands).
//
// Kept differently from example-2 ON PURPOSE (documented in
// docs/cordis-ui-clone-plan.md's Phase J section, not an oversight):
// - Assistant text renders through `<Markdown>` (react-markdown + our own
//   token-styled `components` map, see markdown.tsx) instead of example-2's
//   plain-text `linkify()`-only approach — this app's model can produce
//   real tables/code blocks worth rendering properly.
// - Approvals/interrupt (Composer's Stop button) are real capabilities of
//   THIS app (dsh-user-approval) that example-2 has no equivalent of at
//   all — kept, not removed to match.
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, Wrench } from 'lucide-react'
import type { SessionEvent } from '../../../lib/api'
import { useLocale } from '../../../lib/i18n/locale'
import type { TranslationKey } from '../../../lib/i18n/translations'
import { Markdown } from './markdown'

interface ContentBlock {
  readonly type: string
  readonly text?: string
}

interface MessageLike {
  readonly role?: string
  readonly content?: ContentBlock[]
}

interface ToolResultBlockLike {
  readonly toolCallId?: string
  readonly content?: ContentBlock[]
  readonly isError?: boolean
}

function extractMessage(event: SessionEvent): MessageLike | undefined {
  const data = event.data
  if (typeof data.message === 'object' && data.message !== null) return data.message as MessageLike
  if (Array.isArray(data.content)) return data as unknown as MessageLike
  return undefined
}

function textOf(message: MessageLike): string {
  return (message.content ?? [])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

// Matches `[label](url)` and bare `http(s)://` URLs — same minimal regex
// example-2's own `linkify()` uses for tool-result text, which is plain
// tool-output text, not markdown (a full parse would be overkill for it).
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')\]]+)/g

function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  for (const match of text.matchAll(LINK_RE)) {
    const index = match.index ?? 0
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index))
    const [full, mdLabel, mdUrl, bareUrl] = match
    const url = mdUrl ?? bareUrl
    nodes.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-text underline decoration-current/40 underline-offset-2 hover:decoration-current"
      >
        {mdLabel ?? bareUrl}
      </a>,
    )
    lastIndex = index + full.length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

// Exported for page.tsx's "+ New chat" no-op guard (matches example-2's
// real `hasChatted` behavior — see docs/cordis-ui-clone-plan.md's Đợt 7):
// same "did the person actually type something" criteria buildEntries'
// own `user/message` case below already uses, so the guard can never
// disagree with what the conversation view itself renders as a real
// message.
export function hasRealUserMessage(events: SessionEvent[]): boolean {
  return events.some((event) => {
    if (event.type !== 'user/message') return false
    const source = event.data.source as { kind?: string } | undefined
    if (source?.kind !== undefined && source.kind !== 'user') return false
    const message = extractMessage(event)
    return message?.role !== undefined && (message !== undefined ? textOf(message) : '') !== ''
  })
}

// Đợt 20 — exported for composer.tsx's Stop/Cancel-task buttons. The LATEST
// of `turn/start`/`turn/end` tells whether the agent is actively working —
// same simple derivation this file already uses events for elsewhere.
//
// REAL, CONFIRMED UPSTREAM BUG (not this app's code): a turn cancelled via
// `agent.cancel()` never actually gets a `turn/end` appended. Traced end to
// end with temporary console instrumentation directly in
// `node_modules/@deepseek-ai/dsh-agent-loop` (reverted after, not shipped):
// `ReactLoopAgent.turn()`'s own catch block correctly computes
// `turnEnds = {kind:'aborted', reason: signal.reason}` and reaches its
// `finally`, but `this.session.append('turn/end', {turn, reason: turnEnds})`
// itself THROWS — `signal.reason` (dsh-session's own frozen
// `AgentCancelCause`) is a null-prototype object, and dsh-session's
// `Session.append()` rejects any value that isn't JSON-serializable in this
// specific strict sense (`Object.getPrototypeOf(value) === Object.prototype`
// — a null-prototype object fails this check even though `JSON.stringify`
// on it works fine). The thrown error is then silently swallowed by
// `ReactLoopAgent.kick()`'s own empty `catch (_error) {}` — so the turn
// stays open forever, with zero further events and zero console output.
// Not fixable from this app (it's inside a 3rd-party dependency) — worked
// around below with `latestTurnStartSeq` instead of trusting `turn/end`.
export function isAgentRunning(events: SessionEvent[]): boolean {
  let running = false
  for (const event of events) {
    if (event.type === 'turn/start') running = true
    else if (event.type === 'turn/end') running = false
  }
  return running
}

// The seq of the most recent `turn/start` — lets composer.tsx tell "the
// turn I just told the agent to stop" apart from "a genuinely new turn
// started since", without relying on the `turn/end` that the bug above
// means never arrives for a cancelled turn.
export function latestTurnStartSeq(events: SessionEvent[]): number | undefined {
  let seq: number | undefined
  for (const event of events) if (event.type === 'turn/start') seq = event.seq
  return seq
}

type LogEntry =
  | { kind: 'notice'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; args: string; status: 'running' | 'done' | 'error'; resultText: string | null }
  | { kind: 'bubble'; id: string; role: string; text: string }

function buildEntries(events: SessionEvent[]): LogEntry[] {
  const entries: LogEntry[] = []
  const toolIndexByCallId = new Map<string, number>()

  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        // Real gap caught by inspecting a live session's events: dsh also
        // appends context for the model as `user/message` (runtime-context
        // snapshots from dsh-system-prompt, the skill catalog, a `/name`
        // skill body, ...) — every one carries a non-'user' `source.kind`.
        // Only what the person actually typed belongs in the chat log.
        const source = event.data.source as { kind?: string } | undefined
        if (source?.kind !== undefined && source.kind !== 'user') break
        const message = extractMessage(event)
        const text = message !== undefined ? textOf(message) : ''
        if (message?.role === undefined || text === '') break
        entries.push({ kind: 'bubble', id: `evt-${String(event.seq)}`, role: message.role, text })
        break
      }
      case 'assistant/message': {
        const message = extractMessage(event)
        const text = message !== undefined ? textOf(message) : ''
        if (message?.role === undefined || text === '') break
        entries.push({ kind: 'bubble', id: `evt-${String(event.seq)}`, role: message.role, text })
        break
      }
      // system/message is deliberately never rendered — confirmed via a real
      // session's events that its payload is the full internal system
      // prompt (thousands of characters), not chat content. Real bug caught
      // by inspecting live event data: the pre-Đợt-2 code grouped this into
      // the same case as user/assistant messages, so it rendered the whole
      // system prompt as a plain-text chat bubble. example-2's own
      // Conversation.tsx never has a `system/message` case at all — matches
      // that (falls through to the default no-op below).
      // turn/start is deliberately never rendered (no entry pushed) — same
      // reasoning as example-2's own turn/start case: no real consumer chat
      // platform shows turn-boundary chrome, and the boundary itself stays
      // tracked server-side regardless of whether the UI marks it.
      case 'turn/end': {
        const reason = event.data.reason as { kind?: string; error?: { message?: string } } | undefined
        if (reason?.kind === 'error' && reason.error?.message !== undefined) {
          entries.push({ kind: 'notice', id: `evt-${String(event.seq)}`, text: reason.error.message })
        } else if (reason?.kind !== undefined && reason.kind !== 'completed') {
          entries.push({ kind: 'notice', id: `evt-${String(event.seq)}`, text: reason.kind })
        }
        break
      }
      case 'tool/call': {
        const data = event.data as { callId?: string; name?: string; arguments?: string }
        if (typeof data.callId !== 'string' || typeof data.name !== 'string') break
        let pretty = data.arguments ?? ''
        try { pretty = JSON.stringify(JSON.parse(pretty), null, 2) } catch { /* not JSON — show raw */ }
        toolIndexByCallId.set(data.callId, entries.length)
        entries.push({ kind: 'tool', id: `tool-${data.callId}`, name: data.name, args: pretty, status: 'running', resultText: null })
        break
      }
      case 'tool/result': {
        const data = event.data as { message?: { content?: [ToolResultBlockLike] }; error?: { name?: string } }
        const block = data.message?.content?.[0]
        if (block?.toolCallId === undefined) break
        const index = toolIndexByCallId.get(block.toolCallId)
        if (index === undefined) break
        const entry = entries[index]
        if (entry === undefined || entry.kind !== 'tool') break
        const blockText = (block.content ?? [])
          .filter(b => b.type === 'text' && typeof b.text === 'string')
          .map(b => b.text)
          .join('\n')
        const isError = data.error !== undefined || block.isError === true
        entries[index] = {
          ...entry,
          status: isError ? 'error' : 'done',
          resultText: isError ? (data.error?.name ?? blockText) : truncate(blockText, 500),
        }
        break
      }
      default:
        break
    }
  }
  return entries
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[22px] bg-bubble-user px-[0.8em] py-[0.55em] text-fg shadow-fh-sm">
        {text}
      </div>
    </div>
  )
}

function AssistantText({ text }: { text: string }) {
  return (
    <div className="max-w-full break-words text-fg">
      <Markdown text={text} />
    </div>
  )
}

function ToolPill({
  entry,
  expanded,
  onToggle,
  t,
}: {
  entry: Extract<LogEntry, { kind: 'tool' }>
  expanded: boolean
  onToggle: () => void
  t: (key: TranslationKey, params?: Record<string, string>) => string
}) {
  const label = entry.status === 'running'
    ? t('conversation.toolRunning', { name: entry.name })
    : entry.status === 'error'
      ? t('conversation.toolFailed', { name: entry.name })
      : t('conversation.toolUsed', { name: entry.name })
  return (
    <div className="max-w-[85%] self-start overflow-hidden rounded-xl border border-border-subtle bg-bg-raised text-[0.85em]">
      <button
        type="button"
        className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover ${entry.status === 'error' ? 'text-error' : 'text-muted'}`}
        onClick={onToggle}
      >
        <Wrench size={13} className="flex-none" />
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
        <ChevronDown size={13} className={`ml-auto flex-none transition-transform duration-100 ease-fh ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded ? (
        <div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words border-t border-border-subtle px-3 pb-3 pt-2.5 font-mono text-[0.9em] text-muted">
          <div className="mb-2">{entry.args}</div>
          {entry.resultText !== null ? <div>{linkify(entry.resultText)}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function LogEntryView({
  entry,
  expanded,
  onToggleExpanded,
  t,
}: {
  entry: LogEntry
  expanded: boolean
  onToggleExpanded: () => void
  t: (key: TranslationKey, params?: Record<string, string>) => string
}) {
  switch (entry.kind) {
    case 'notice':
      return <div className="self-center text-[0.8em] text-error">{entry.text}</div>
    case 'tool':
      return <ToolPill entry={entry} expanded={expanded} onToggle={onToggleExpanded} t={t} />
    case 'bubble':
      return entry.role === 'user' ? <UserBubble text={entry.text} /> : <AssistantText text={entry.text} />
  }
}

// page.tsx's ChatView only ever renders this once hasRealUserMessage(events)
// is true (its own centered welcome heading covers the empty case instead —
// Đợt 8), so entries here is never actually empty; no empty-state branch
// needed.
export function Conversation({ events }: { events: SessionEvent[] }) {
  const { t } = useLocale()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const entries = useMemo(() => buildEntries(events), [events])

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.map(entry => (
        <LogEntryView key={entry.id} entry={entry} expanded={expanded.has(entry.id)} onToggleExpanded={() => { toggle(entry.id) }} t={t} />
      ))}
    </div>
  )
}
