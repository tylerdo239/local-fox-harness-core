// Client-only UI state (architecture doc: Zustand owns "stream đang chạy,
// composer, panel" — the live, imperative bits; TanStack Query owns
// request/response server state like the session list).
import { create } from 'zustand'
import type { PendingApproval, SessionEvent } from './api'

export interface Toast {
  readonly id: number
  readonly message: string
}

// Only 'config' exists as a targetable tab today (model-picker.tsx's own
// use case) — kept a narrow literal rather than importing settings-dialog's
// full Tab union, since every other opener (Sidebar's Settings icon) wants
// no more than "open, default tab" and has no reason to name one.
export interface SettingsRequest {
  readonly id: number
  readonly tab?: 'config'
}

let nextToastId = 1

interface ChatState {
  sessionId: string | undefined
  events: SessionEvent[]
  connection: 'idle' | 'connecting' | 'open' | 'closed'
  pendingApprovals: PendingApproval[]
  composerText: string
  // model-picker.tsx: model-not-configured toast tells the user to go set a
  // credential, but the picker (deep under Composer) has no handle on
  // page.tsx's own dialog state. `id` is a monotonic counter, not a boolean
  // — AppFrame's effect fires on every INCREMENT, so a second request while
  // Settings is already open still re-focuses it instead of being a
  // same-value no-op.
  settingsRequest: SettingsRequest
  toasts: Toast[]
  setSessionId: (sessionId: string | undefined) => void
  addEvent: (event: SessionEvent) => void
  setConnection: (connection: ChatState['connection']) => void
  setPendingApprovals: (approvals: PendingApproval[]) => void
  setComposerText: (text: string) => void
  requestOpenSettings: (tab?: 'config') => void
  pushToast: (message: string) => void
  dismissToast: (id: number) => void
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: undefined,
  events: [],
  connection: 'idle',
  pendingApprovals: [],
  composerText: '',
  settingsRequest: { id: 0 },
  toasts: [],
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
  requestOpenSettings: (tab) => { set(state => ({ settingsRequest: { id: state.settingsRequest.id + 1, tab } })) },
  pushToast: (message) => {
    const id = nextToastId++
    set(state => ({ toasts: [...state.toasts, { id, message }] }))
  },
  dismissToast: (id) => { set(state => ({ toasts: state.toasts.filter(toast => toast.id !== id) })) },
}))
