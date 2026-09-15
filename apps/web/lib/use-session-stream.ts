'use client'

import { useEffect } from 'react'
import { listApprovals, streamUrl, type SessionEvent } from './api'
import { useChatStore } from './store'

/**
 * Owns the SSE connection for one session: appends every replayed and live
 * event to the store, and refreshes the pending-approval list whenever an
 * approval/asked or approval/decided event arrives (event-driven, no
 * polling). Native EventSource already resends Last-Event-ID on its own
 * automatic reconnect, so cordis-gateway's session-stream route replays
 * exactly the missed suffix — no manual reconnect bookkeeping needed here.
 */
export function useSessionStream(sessionId: string | undefined): void {
  const addEvent = useChatStore(state => state.addEvent)
  const setConnection = useChatStore(state => state.setConnection)
  const setPendingApprovals = useChatStore(state => state.setPendingApprovals)

  useEffect(() => {
    if (sessionId === undefined) return
    setConnection('connecting')
    const source = new EventSource(streamUrl(sessionId))

    const refreshApprovals = (): void => {
      listApprovals(sessionId).then(({ approvals }) => { setPendingApprovals(approvals) }).catch(() => {
        // Transient — the next approval/asked or approval/decided event retries this.
      })
    }

    source.addEventListener('open', () => { setConnection('open') })
    source.addEventListener('error', () => {
      // A closed EventSource never reconnects on its own; anything else is a
      // transient drop the browser is already retrying.
      setConnection(source.readyState === EventSource.CLOSED ? 'closed' : 'connecting')
    })
    source.addEventListener('session-event', (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as SessionEvent
      addEvent(event)
      if (event.type === 'approval/asked' || event.type === 'approval/decided') refreshApprovals()
    })

    refreshApprovals()

    return () => {
      source.close()
      setConnection('idle')
    }
  }, [sessionId, addEvent, setConnection, setPendingApprovals])
}
