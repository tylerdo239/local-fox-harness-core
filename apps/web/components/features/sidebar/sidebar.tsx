'use client'

// UI clone plan Phase D — adapted from example-2's Sidebar.tsx (brand row,
// collapse toggle, "+ New chat", scrollable session list, account footer).
//
// Đợt 2 Phase I closed the 2 reductions this used to document:
// - Search/rename/delete/date-grouping are now real (HistoryChat.tsx below,
//   backed by gateway.ts's new /session-rename + /session-delete routes and
//   ctx.sessionTitle for titles — see docs/cordis-ui-clone-plan.md's "Đợt 2"
//   section for the full research this is built from).
// - Skills moved from the footer (Phase H's placement) to directly under
//   "+ New chat", ABOVE the session list — matches the real Sidebar.tsx
//   layout exactly (confirmed by reading it for this pass); Phase H's
//   footer placement was a guess made before this file was actually read.
import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, PanelLeftClose, PanelLeftOpen, Plus, Search, Sparkles, Workflow } from 'lucide-react'
import { listSessions } from '../../../lib/api'
import { useLocale } from '../../../lib/i18n/locale'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { Input } from '../../primitives/input'
import { MenuItem } from '../../primitives/menu-item'
import { AccountMenu } from './account-menu'
import { HistoryChat } from './history-chat'

export function Sidebar({
  collapsed,
  onToggleCollapse,
  onNewSession,
  newSessionDisabled,
  activeSessionId,
  onSwitchSession,
  onOpenSettings,
  onOpenSkills,
  onOpenAutomations,
  onLogout,
}: {
  collapsed: boolean
  onToggleCollapse: () => void
  onNewSession: () => void
  newSessionDisabled: boolean
  activeSessionId: string | undefined
  onSwitchSession: (sessionId: string) => void
  onOpenSettings: () => void
  onOpenSkills: () => void
  onOpenAutomations: () => void
  onLogout: () => void
}) {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: listSessions })
  const { t } = useLocale()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={`flex h-full flex-col overflow-hidden border-r border-border bg-surface ${collapsed ? 'items-center p-1.5' : 'p-1.5 px-3'}`}>
      <div className={`flex flex-none items-center gap-2 overflow-hidden ${collapsed ? 'h-9 justify-center' : 'h-[60px] justify-end py-2 pl-1'}`}>
        {!collapsed ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <span className="flex-none text-accent"><Bot size={24} /></span>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-lg font-semibold tracking-wide text-accent">Fox Harness</span>
          </div>
        ) : null}
        {!collapsed ? (
          <IconButton
            onClick={() => { setSearchOpen(true); setTimeout(() => { searchInputRef.current?.focus() }, 0) }}
            title={t('sidebar.search')}
          >
            <Search size={14} />
          </IconButton>
        ) : null}
        <IconButton onClick={onToggleCollapse} title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </IconButton>
      </div>

      {searchOpen && !collapsed ? (
        <div className="mb-1.5">
          <Input
            ref={searchInputRef}
            type="text"
            placeholder={t('sidebar.searchPlaceholder')}
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
            onBlur={() => { if (query === '') setSearchOpen(false) }}
          />
        </div>
      ) : null}

      <Button
        variant="raised"
        onClick={onNewSession}
        disabled={newSessionDisabled}
        title={newSessionDisabled ? t('sidebar.newChatDisabled') : undefined}
        className={collapsed ? 'mb-1.5 h-9 w-9 flex-none border-transparent bg-transparent p-0' : 'mx-0.5 mb-1.5 flex-none'}
      >
        <Plus size={16} />
        {!collapsed ? <span>{t('sidebar.newChat')}</span> : null}
      </Button>

      <MenuItem
        variant="nav"
        onClick={onOpenSkills}
        className={collapsed ? 'w-9 justify-center px-0' : undefined}
      >
        <Sparkles size={16} />
        {!collapsed ? <span>{t('sidebar.skills')}</span> : null}
      </MenuItem>

      <MenuItem
        variant="nav"
        onClick={onOpenAutomations}
        className={collapsed ? 'mb-1.5 w-9 justify-center px-0' : 'mb-1.5'}
      >
        <Workflow size={16} />
        {!collapsed ? <span>{t('automations.title')}</span> : null}
      </MenuItem>

      {!collapsed ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <HistoryChat
            sessions={sessions.data?.sessions ?? []}
            query={query}
            activeSessionId={activeSessionId}
            onSwitchSession={onSwitchSession}
          />
        </div>
      ) : <div className="min-h-0 flex-1" />}

      <div className="flex flex-none flex-col border-t border-border pt-1.5">
        <AccountMenu compact={collapsed} onOpenSettings={onOpenSettings} onLogout={onLogout} />
      </div>
    </div>
  )
}
