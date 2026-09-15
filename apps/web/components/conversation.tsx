'use client'

import ReactMarkdown from 'react-markdown'
import type { SessionEvent } from '../lib/api'

// Renders session/event by type, matching dsh's own ConversationNodeDefinition
// idea (architecture doc §3.1): one keyed renderer per event type, everything
// unrecognized falls into a compact generic line rather than being dropped —
// this is the "tool timeline" alongside the message bubbles, not just chat.
// MVP scope: renders the final committed user/assistant/system message, not
// the live token-by-token assistant/chunk stream (architecture doc's
// higher-fidelity target for a later pass).

interface ContentBlock {
  readonly type: string
  readonly text?: string
}

interface MessageLike {
  readonly role?: string
  readonly content?: ContentBlock[]
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
}

function MessageBubble({ role, text }: { role: string; text: string }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser ? 'bg-blue-600 text-white' : 'bg-neutral-100 dark:bg-neutral-800'
        }`}
      >
        {isUser ? text : <ReactMarkdown>{text}</ReactMarkdown>}
      </div>
    </div>
  )
}

function TurnBoundary({ label }: { label: string }) {
  return <div className="text-center text-xs text-neutral-400 py-1">{label}</div>
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded border border-red-400 bg-red-50 dark:bg-red-950 px-3 py-2 text-sm text-red-700 dark:text-red-300">
      {message}
    </div>
  )
}

function GenericEventLine({ event }: { event: SessionEvent }) {
  return (
    <div className="text-xs text-neutral-400 font-mono px-1">
      #{event.seq} {event.type}
    </div>
  )
}

function renderEvent(event: SessionEvent) {
  switch (event.type) {
    case 'user/message':
    case 'assistant/message':
    case 'system/message': {
      const message = extractMessage(event)
      if (message?.role === undefined) return <GenericEventLine key={event.seq} event={event} />
      const text = textOf(message)
      if (text === '') return <GenericEventLine key={event.seq} event={event} />
      return <MessageBubble key={event.seq} role={message.role} text={text} />
    }
    case 'turn/start':
      return <TurnBoundary key={event.seq} label={`turn ${String(event.data.turn ?? '')} started`} />
    case 'turn/end': {
      const reason = event.data.reason as { kind?: string; error?: { message?: string } } | undefined
      if (reason?.kind === 'error' && reason.error?.message !== undefined) {
        return <ErrorBanner key={event.seq} message={reason.error.message} />
      }
      return <TurnBoundary key={event.seq} label={`turn ${String(event.data.turn ?? '')} ended`} />
    }
    default:
      return <GenericEventLine key={event.seq} event={event} />
  }
}

export function Conversation({ events }: { events: SessionEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-neutral-400">No messages yet — say something below.</p>
  }
  return <div className="flex flex-col gap-2">{events.map(renderEvent)}</div>
}
