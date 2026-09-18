'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { listApprovals, streamUrl, type SessionEvent } from './api'
import { useChatStore } from './store'

/**
 * Owns the SSE connection for one session: appends every replayed and live
 * event to the store, and refreshes the pending-approval list whenever an
 * approval/asked or approval/decided event arrives (event-driven, no
 * polling). Native EventSource already resends Last-Event-ID on its own
 * automatic reconnect, so cordis-gateway's session-stream route replays
 * exactly the missed suffix — no manual reconnect bookkeeping needed here.
 *
 * Real gap found ("khung chat trung tâm ... flow tạo session mới ... chưa
 * có, check lại và thêm"): dsh-session-title/-llm/-first-prompt-llm append
 * a log-only `session/title` event once a real title is derived from the
 * first message — nothing was invalidating the sidebar's `['sessions']`
 * query cache for it, so a freshly-created chat stayed "Untitled" in
 * HistoryChat forever unless the whole page was reloaded. Same event-driven
 * pattern as the existing approval refresh, not polling.
 */
export function useSessionStream(sessionId: string | undefined): void {
  const addEvent = useChatStore(state => state.addEvent)
  const setConnection = useChatStore(state => state.setConnection)
  const setPendingApprovals = useChatStore(state => state.setPendingApprovals)
  const queryClient = useQueryClient()

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
      if (event.type === 'session/title') void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    })

    refreshApprovals()

    return () => {
      source.close()
      setConnection('idle')
    }
  }, [sessionId, addEvent, setConnection, setPendingApprovals, queryClient])
}
