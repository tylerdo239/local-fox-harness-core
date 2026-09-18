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

  useEffect(() => { setSessionId(sessionId) }, [sessionId, setSessionId])
  useSessionStream(sessionId)

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
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
  const { route, goToSession, goToAutomations } = useAppRoute()
  const { frameRef, gridTemplateColumns, collapsed, toggleCollapse } = useLayoutColumns()
  const [dialog, setDialog] = useState<ModalDialog>(undefined)
  const sessionId = route.kind === 'chat' ? route.sessionId : undefined
  const queryClient = useQueryClient()
  const events = useChatStore(state => state.events)

  // Real gap fixed ("flow tạo session mới ... chưa có, check lại và thêm"):
  // nothing invalidated the sidebar's `['sessions']` query after creating a
  // session, so a brand-new chat only showed up in HistoryChat once some
  // OTHER action (rename/delete) happened to refetch it, or on a full page
  // reload — "+ New chat" visibly opened the center pane with nothing to
  // show for it in the sidebar.
  //
  // Second gap fixed the same pass, matching example-2's own real
  // `hasChatted`/`newSessionDisabled` behavior (App.tsx): clicking
  // "+ New chat" while already viewing a session nobody has typed into yet
  // used to spawn ANOTHER brand-new backend session+agent every single
  // time — a real chat platform reuses the empty draft instead of
  // multiplying "Untitled" rows. `hasChatted` is false only while viewing
  // an actual (already-created) session with zero real messages so far —
  // landing on `/` with sessionId still undefined (the auto-create effect
  // below hasn't resolved yet) is unaffected.
  const hasChatted = sessionId === undefined || hasRealUserMessage(events)
  const newSessionDisabled = route.kind === 'chat' && !hasChatted

  function startNew(replace = false): void {
    if (newSessionDisabled) return
    createSession()
      .then(({ sessionId: newId }) => {
        goToSession(newId, replace)
        void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      })
      .catch((error: unknown) => { console.error('failed to create session', error) })
  }

  // Real gap fixed ("khung chat trung tâm ... tôi cần khung chat có input
  // hiện ra sẵn luôn ... chứ ko phải 1 nút ấn"): example-2's own App.tsx
  // ALWAYS connects a fresh "new" session the instant it loads/logs in
  // (`connect(..., sessionIdFromUrl() ?? "new")`) — landing on `/` is never
  // a bare click-through screen there. Mirrors that here: land on `/` with
  // no chat route yet -> create one immediately, same call "+ New chat"
  // makes. `replace` (not `push`) since this is a correction the app makes
  // on the user's behalf, not a click — matches example-2's own
  // replaceState-vs-pushState rule (App.tsx's own comment on
  // replaceChatUrl/pushChatUrl). Guarded by a ref, not just the `route.kind`
  // dependency, so React's dev-mode double-invoke of a fresh effect can't
  // fire this twice and spawn 2 sessions.
  const autoCreatingRef = useRef(false)
  useEffect(() => {
    if (route.kind !== 'home') { autoCreatingRef.current = false; return }
    if (autoCreatingRef.current) return
    autoCreatingRef.current = true
    startNew(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.kind])

  function switchSession(id: string): void {
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
        onNewSession={() => { startNew() }}
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
