'use client'

// Single static route (`/`) reading ?session=<id> client-side, not a dynamic
// `/chat/[sessionId]` path segment: cordis-ui's serveStatic route
// (Phase 3) only serves an exact file or the dist index — deliberately no
// generic SPA fallback-to-index for arbitrary paths (same design as
// dsh-host-frontend-static itself) — so a path segment would 404 on reload.
// A query string on `/` still resolves to the one exported index.html.
import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation.js'
import { useQuery } from '@tanstack/react-query'
import { createSession, listSessions } from '../lib/api'
import { useChatStore } from '../lib/store'
import { useSessionStream } from '../lib/use-session-stream'
import { Conversation } from '../components/conversation'
import { Composer } from '../components/composer'
import { Approvals } from '../components/approvals'

function SessionPicker() {
  const router = useRouter()
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: listSessions })

  const startNew = (): void => {
    createSession()
      .then(({ sessionId }) => { router.push(`/?session=${sessionId}`) })
      .catch((error: unknown) => { console.error('failed to create session', error) })
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-8">
      <h1 className="text-lg font-semibold">Cordis Agent Core</h1>
      <button type="button" className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white self-start" onClick={startNew}>
        + New chat
      </button>
      <ul className="flex flex-col gap-1">
        {(sessions.data?.sessions ?? []).map(session => (
          <li key={session.sessionId}>
            <a className="text-sm text-blue-600 hover:underline" href={`/?session=${session.sessionId}`}>
              {session.sessionId}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChatView({ sessionId }: { sessionId: string }) {
  const setSessionId = useChatStore(state => state.setSessionId)
  const events = useChatStore(state => state.events)

  useEffect(() => { setSessionId(sessionId) }, [sessionId, setSessionId])
  useSessionStream(sessionId)

  return (
    <div className="flex h-dvh flex-col">
      <Approvals />
      <div className="flex-1 overflow-y-auto p-4">
        <Conversation events={events} />
      </div>
      <Composer sessionId={sessionId} />
    </div>
  )
}

function Home() {
  const sessionId = useSearchParams().get('session') ?? undefined
  return sessionId === undefined ? <SessionPicker /> : <ChatView sessionId={sessionId} />
}

export default function Page() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  )
}
