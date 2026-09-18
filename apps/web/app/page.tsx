'use client'

// UI clone plan Đợt 2 — real `/chat/<sessionId>` URLs (see
// lib/use-app-route.ts's own header comment for the full "why", and
// ui.ts's SPA-fallback rewrite for the server half that makes a hard
// refresh on `/chat/<id>` actually work). Settings/Skills are pure
// client-modal state now (`dialog` below), never in the URL — opening one
// never disturbs whatever `/chat/<id>` is showing underneath, and closing
// it needs no "go back to what session" bookkeeping at all.
//
// UI clone plan Phase D: the sidebar is a PERSISTENT frame (like
// example-2's App.tsx), not a separate full-page SessionPicker — Settings/
// Skills render as overlays and Automations swaps the center column, all
// without ever hiding the sidebar itself.
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { createSession, getAuthStatus, logout } from '../lib/api'
import { useChatStore } from '../lib/store'
import { useSessionStream } from '../lib/use-session-stream'
import { useLayoutColumns } from '../lib/use-layout-columns'
import { useAppRoute } from '../lib/use-app-route'
import { useLocale } from '../lib/i18n/locale'
import { Conversation, hasRealUserMessage } from '../components/features/conversation/conversation'
import { Composer } from '../components/features/conversation/composer'
import { Approvals } from '../components/features/conversation/approvals'
import { SettingsDialog } from '../components/features/settings/settings-dialog'
import { SkillsDialog } from '../components/features/skills/skills-dialog'
import { Automations } from '../components/features/automations/automations'
import { LoginForm } from '../components/features/auth/login-form'
import { Sidebar } from '../components/features/sidebar/sidebar'

function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg">
      <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-border border-t-accent" />
    </div>
  )
}

// Only ever shown for the brief network round-trip of AppFrame's own
// auto-create-on-landing effect below — sessionId is undefined for a moment
// while `POST /sessions` is in flight, never because of a "click to start"
// step a person has to get through (real gap fixed: "tôi cần khung chat có
// input hiện ra sẵn luôn ... chứ ko phải 1 nút ấn mở trò truyện").
function CenterLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-border border-t-accent" />
    </div>
  )
}

// UI clone plan Đợt 8 — matches example-2's real Conversation.tsx: no
// separate "click to start" screen at all. A brand-new session (nobody has
// typed into it yet) shows a centered welcome heading + an enlarged
// composer right where the message log would otherwise be — the composer
// itself IS the empty state, not something behind a button. Whole column
// capped at 760px and centered (example-2's real `#center-col > *` rule,
// read from its actual style.css) — the full-bleed width this used to
// stretch to was the other half of "chỉnh lại UI khung chat trung tâm".
function ChatView({ sessionId }: { sessionId: string }) {
  const { t } = useLocale()
  const setSessionId = useChatStore(state => state.setSessionId)
  const events = useChatStore(state => state.events)
  const isEmpty = !hasRealUserMessage(events)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setSessionId(sessionId) }, [sessionId, setSessionId])
  useSessionStream(sessionId)

  // Real gap fixed (user: "UI chat đang chưa có auto scroll như dsh hay
  // claude") — ported from example-2's own real Conversation.tsx, which
  // does exactly this unconditional scroll-to-bottom on every events change
  // (no "only if already near bottom" check there either — matching it
  // exactly rather than inventing a fancier policy). Covers both a message
  // streaming in during an active turn AND opening/switching to a session
  // (events repopulate from empty as history loads, landing at the latest
  // message instead of the top).
  useEffect(() => {
    const el = logRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [events])

  return (
    <div className="flex h-full flex-col bg-bg">
      <Approvals />
      <div className={`mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col ${isEmpty ? 'justify-center gap-6' : 'min-h-0'}`}>
        {isEmpty ? (
          <div className="flex flex-col items-center gap-2 text-accent">
            <Bot size={48} />
            <h2 className="m-0 text-[1.4em] font-medium text-fg">{t('conversation.emptyHeading')}</h2>
          </div>
        ) : (
          <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            <Conversation events={events} />
          </div>
        )}
        <Composer sessionId={sessionId} large={isEmpty} />
      </div>
    </div>
  )
}

type ModalDialog = 'settings' | 'skills' | undefined

function AppFrame() {
  const { route, goToSession, goToAutomations, goHome } = useAppRoute()
  const { frameRef, gridTemplateColumns, collapsed, toggleCollapse } = useLayoutColumns()
  const [dialog, setDialog] = useState<ModalDialog>(undefined)
  const queryClient = useQueryClient()
  const events = useChatStore(state => state.events)

  // Real gap fixed (user: "UI flow sai rồi ... URL đã tạo và show route 1
  // session chat rồi ... nên ẩn đi chờ chat thì mới dẫn đến route id chat
  // đó") — ported from example-2's own real, DELIBERATE behavior
  // (App.tsx's `handleFrame` `case "session"`, its own comment verbatim:
  // "Deliberately does NOT touch the URL here — receiving a session frame
  // just means a session id was assigned, not that it has any real content
  // yet. The URL only transitions to /chat/<id> at the moment a real
  // message is actually sent"). A freshly created session lives here,
  // separate from the route, until hasRealUserMessage flips true.
  const [pendingSessionId, setPendingSessionId] = useState<string | undefined>(undefined)
  const sessionId = route.kind === 'chat' ? route.sessionId : pendingSessionId

  // Matches example-2's own `hasChatted`/`newSessionDisabled` guard exactly
  // (no `route.kind === 'chat'` condition — a hidden pending draft counts
  // the same as a visible-but-empty `/chat/<id>` one): clicking "+ New
  // chat" while already on an empty draft is a no-op (real chat platforms
  // don't spawn a second empty conversation either), not a fresh backend
  // session every click.
  const hasChatted = sessionId === undefined || hasRealUserMessage(events)
  const newSessionDisabled = !hasChatted

  function startNew(): void {
    if (newSessionDisabled) return
    setPendingSessionId(undefined)
    createSession()
      .then(({ sessionId: newId }) => { setPendingSessionId(newId) })
      .catch((error: unknown) => { console.error('failed to create session', error) })
  }

  // The actual URL reveal — always a replaceState, matching example-2's own
  // unconditional `replaceChatUrl` at this exact transition (this isn't a
  // "new page" the user navigated to, it's the current draft finally
  // becoming real). No manual sidebar-refresh needed here: sending the
  // first message also fires a `session/title` event, and
  // use-session-stream.ts already invalidates the `['sessions']` query on
  // that — the newly-real session picks itself up in HistoryChat for free.
  //
  // Real race found and fixed via a live headless-browser test (Puppeteer,
  // "+ New chat" from an already-chatted session): the URL promoted to the
  // BRAND NEW pending session within ~100ms, before it had ever received a
  // message. Root cause — `events` here can still be the OLD session's
  // real messages for one render: ChatView's own effect is what clears the
  // store to the new sessionId, and effects run child-before-parent in the
  // same commit, but THIS effect's closure over `events` was captured at
  // render time, before that clear runs. Gating on the store's own
  // `sessionId` actually matching `pendingSessionId` (not just it being
  // defined) skips exactly that one stale render instead of trusting
  // `events` before they can possibly belong to the pending session.
  const storeSessionId = useChatStore(state => state.sessionId)
  useEffect(() => {
    if (pendingSessionId !== undefined && storeSessionId === pendingSessionId && hasRealUserMessage(events)) {
      goToSession(pendingSessionId, true)
      setPendingSessionId(undefined)
    }
  }, [pendingSessionId, storeSessionId, events, goToSession])

  // Real gap fixed ("khung chat trung tâm ... tôi cần khung chat có input
  // hiện ra sẵn luôn ... chứ ko phải 1 nút ấn"): example-2's own App.tsx
  // ALWAYS connects a fresh "new" session the instant it loads/logs in —
  // landing on `/` is never a bare click-through screen there. Mirrors that
  // here: land on `/` with no chat route yet -> create one immediately,
  // same call "+ New chat" makes; no navigation needed since `/` is already
  // exactly where a hidden pending draft belongs.
  //
  // Fires at most ONCE per page load — real race bug found and fixed via a
  // live headless-browser test (Puppeteer): resetting this ref whenever
  // `route.kind !== 'home'` meant clicking "+ New chat" from an existing
  // chat (which itself calls `goHome()`, transitioning route.kind back to
  // 'home') re-armed this effect, which then fired ITS OWN `startNew()` in
  // a race against the click handler's own explicit call — 2 sessions
  // created, the second one's pendingSessionId winning arbitrarily. "+ New
  // chat" and this effect are 2 different, mutually-exclusive triggers for
  // the exact same action; only ever needing the auto-trigger once, on
  // whichever render first sees a bare `/` with nothing to show yet, avoids
  // the overlap entirely — every subsequent return to `/` is already
  // someone else's explicit call (startNew() above).
  const autoCreateDoneRef = useRef(false)
  useEffect(() => {
    if (autoCreateDoneRef.current || route.kind !== 'home') return
    autoCreateDoneRef.current = true
    startNew()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.kind])

  function switchSession(id: string): void {
    setPendingSessionId(undefined)
    goToSession(id)
  }

  function handleLogout(): void {
    logout().catch(() => {}).finally(() => { window.location.href = '/' })
  }

  return (
    <div ref={frameRef} className="grid h-dvh" style={{ gridTemplateColumns }}>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        onNewSession={() => {
          // Real pushState — an explicit "New chat" click deserves its own
          // back-button entry, same category as switchSession (matches
          // example-2's own `pushHomeUrl()` at this exact call site). A
          // no-op when already home: pushing `/` again on top of `/` would
          // just be a redundant history entry.
          if (route.kind !== 'home') goHome()
          startNew()
        }}
        newSessionDisabled={newSessionDisabled}
        activeSessionId={sessionId}
        onSwitchSession={switchSession}
        onOpenSettings={() => { setDialog('settings') }}
        onOpenSkills={() => { setDialog('skills') }}
        onOpenAutomations={() => { goToAutomations() }}
        onLogout={handleLogout}
      />
      <div className="min-w-0 overflow-hidden">
        {route.kind === 'automations' ? (
          <Automations />
        ) : sessionId === undefined ? (
          <CenterLoading />
        ) : (
          <ChatView sessionId={sessionId} />
        )}
      </div>
      <SettingsDialog open={dialog === 'settings'} onClose={() => { setDialog(undefined) }} onLogout={handleLogout} />
      <SkillsDialog open={dialog === 'skills'} onClose={() => { setDialog(undefined) }} />
    </div>
  )
}

function Home() {
  const authStatus = useQuery({ queryKey: ['auth-status'], queryFn: getAuthStatus, retry: false })

  if (authStatus.isLoading) return <LoadingScreen />
  if (authStatus.isError) return <LoginForm />
  return <AppFrame />
}

export default function Page() {
  return <Home />
}
