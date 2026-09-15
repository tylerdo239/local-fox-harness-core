// Client-only UI state (architecture doc: Zustand owns "stream đang chạy,
// composer, panel" — the live, imperative bits; TanStack Query owns
// request/response server state like the session list).
import { create } from 'zustand'
import type { PendingApproval, SessionEvent } from './api'

interface ChatState {
  sessionId: string | undefined
  events: SessionEvent[]
  connection: 'idle' | 'connecting' | 'open' | 'closed'
  pendingApprovals: PendingApproval[]
  composerText: string
  setSessionId: (sessionId: string | undefined) => void
  addEvent: (event: SessionEvent) => void
  setConnection: (connection: ChatState['connection']) => void
  setPendingApprovals: (approvals: PendingApproval[]) => void
  setComposerText: (text: string) => void
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: undefined,
  events: [],
  connection: 'idle',
  pendingApprovals: [],
  composerText: '',
  setSessionId: (sessionId) => { set({ sessionId, events: [], connection: 'idle', pendingApprovals: [] }) },
  addEvent: (event) => {
    set(state => (
      // The stream can redeliver the tail on reconnect; last-event-id dedupes
      // most of that, but guard on seq too since a client can also open two
      // stream connections briefly during React strict-mode remounts.
      state.events.some(existing => existing.seq === event.seq)
        ? state
        : { events: [...state.events, event].sort((a, b) => a.seq - b.seq) }
    ))
  },
  setConnection: (connection) => { set({ connection }) },
  setPendingApprovals: (pendingApprovals) => { set({ pendingApprovals }) },
  setComposerText: (composerText) => { set({ composerText }) },
}))
