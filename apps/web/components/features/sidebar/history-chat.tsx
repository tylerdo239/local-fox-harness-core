'use client'

// UI clone plan Đợt 2 Phase I — adapted from example-2's real HistoryChat.tsx
// (448 dòng): date-grouping, per-row "…" popup (rename/delete), inline
// rename input. Simplified vs. the original where OUR data model genuinely
// has less: no `status`/`flow`/`projectId` fields (SessionSummary has none
// of those — no project/data-analysis concept here), so no flow icon, no
// status tooltip. Grouped by `createdAt` (approximation, documented in
// docs/cordis-ui-clone-plan.md — dsh's SessionHeader has no `updatedAt`).
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { deleteSession, renameSession, type SessionSummary } from '../../../lib/api'
import { useLocale } from '../../../lib/i18n/locale'
import type { TranslationKey } from '../../../lib/i18n/translations'
import { Input } from '../../primitives/input'
import { IconButton } from '../../primitives/icon-button'
import { MenuItem } from '../../primitives/menu-item'

const GROUP_ORDER = ['today', 'yesterday', 'week', 'month', 'older'] as const
type GroupKey = (typeof GROUP_ORDER)[number]

const GROUP_LABEL_KEY: Record<GroupKey, TranslationKey> = {
  today: 'historyChat.groupToday',
  yesterday: 'historyChat.groupYesterday',
  week: 'historyChat.group7d',
  month: 'historyChat.group30d',
  older: 'historyChat.groupOlder',
}

function dayBucket(createdAt: number, now: Date): GroupKey {
  const then = new Date(createdAt)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysAgo = Math.floor(
    (startOfToday.getTime() - new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / 86_400_000,
  )
  if (daysAgo <= 0) return 'today'
  if (daysAgo === 1) return 'yesterday'
  if (daysAgo <= 7) return 'week'
  if (daysAgo <= 30) return 'month'
  return 'older'
}

function rowLabel(session: SessionSummary, t: (key: TranslationKey, params?: Record<string, string>) => string): string {
  return session.title ?? t('historyChat.untitled', { id: session.sessionId.slice(0, 8) })
}

export function HistoryChat({
  sessions,
  query,
  activeSessionId,
  onSwitchSession,
}: {
  sessions: SessionSummary[]
  query: string
  activeSessionId: string | undefined
  onSwitchSession: (sessionId: string) => void
}) {
  const { t } = useLocale()
  const queryClient = useQueryClient()
  const [menuSession, setMenuSession] = useState<SessionSummary | undefined>(undefined)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | undefined>(undefined)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const menuPopupRef = useRef<HTMLDivElement>(null)
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined)
  const [renameValue, setRenameValue] = useState('')
  const [rowError, setRowError] = useState<string | undefined>(undefined)
  const renameInputRef = useRef<HTMLInputElement>(null)

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  const rename = useMutation({
    mutationFn: (input: { sessionId: string; title: string }) => renameSession(input.sessionId, input.title),
    onSuccess: () => { refresh() },
    onError: (error: Error) => { setRowError(error.message) },
  })
  const remove = useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: () => { refresh() },
    onError: (error: Error) => { setRowError(error.message) },
  })

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q === '' ? sessions : sessions.filter(session => rowLabel(session, t).toLowerCase().includes(q))
    const now = new Date()
    const byGroup = new Map<GroupKey, SessionSummary[]>()
    for (const session of filtered) {
      const bucket = dayBucket(session.createdAt, now)
      const list = byGroup.get(bucket)
      if (list) list.push(session)
      else byGroup.set(bucket, [session])
    }
    return GROUP_ORDER.map(key => ({ key, label: t(GROUP_LABEL_KEY[key]), rows: byGroup.get(key) ?? [] }))
      .filter(group => group.rows.length > 0)
  }, [sessions, query, t])

  useEffect(() => {
    if (menuSession === undefined) return
    function onPointerDown(event: MouseEvent): void {
      const target = event.target as Node
      if (menuTriggerRef.current?.contains(target) === true || menuPopupRef.current?.contains(target) === true) return
      setMenuSession(undefined)
    }
    function onKeyDown(event: KeyboardEvent): void { if (event.key === 'Escape') setMenuSession(undefined) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuSession])

  function openRowMenu(session: SessionSummary, trigger: HTMLButtonElement): void {
    const rect = trigger.getBoundingClientRect()
    menuTriggerRef.current = trigger
    setMenuPosition({ top: rect.top, left: rect.right + 4 })
    setMenuSession(session)
  }

  function startRename(session: SessionSummary): void {
    setRenameValue(rowLabel(session, t))
    setRenamingId(session.sessionId)
  }

  useEffect(() => {
    if (renamingId === undefined) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renamingId])

  function commitRename(sessionId: string): void {
    const trimmed = renameValue.trim()
    setRenamingId(undefined)
    if (trimmed === '') return
    rename.mutate({ sessionId, title: trimmed })
  }

  function confirmDelete(session: SessionSummary): void {
    if (!window.confirm(t('historyChat.deleteConfirm'))) return
    remove.mutate(session.sessionId)
  }

  return (
    <div className="flex flex-col gap-3">
      {rowError !== undefined ? (
        <p className="mx-1.5 text-xs text-error">{rowError}</p>
      ) : null}
      {groups.map(group => (
        <div key={group.key} className="flex flex-col gap-0.5">
          <div className="mx-2.5 mb-1 text-[0.75em] font-medium text-muted">{group.label}</div>
          {group.rows.map(session => (
            <div
              key={session.sessionId}
              className={`group mx-1.5 flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[0.85em] hover:bg-bg-hover ${session.sessionId === activeSessionId ? 'bg-bg-hover' : ''}`}
              onClick={() => {
                if (renamingId === session.sessionId) return
                if (session.sessionId !== activeSessionId) onSwitchSession(session.sessionId)
              }}
            >
              {renamingId === session.sessionId ? (
                <Input
                  ref={renameInputRef}
                  type="text"
                  className="h-6 flex-1 px-1.5 text-[0.9em]"
                  value={renameValue}
                  onClick={(event) => { event.stopPropagation() }}
                  onChange={(event) => { setRenameValue(event.target.value) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      if (event.nativeEvent.isComposing) return
                      event.preventDefault()
                      commitRename(session.sessionId)
                    } else if (event.key === 'Escape') {
                      setRenamingId(undefined)
                    }
                  }}
                  onBlur={() => { setRenamingId(undefined) }}
                />
              ) : (
                <span className={`min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${session.sessionId === activeSessionId ? 'text-accent-text' : ''}`}>
                  {rowLabel(session, t)}
                </span>
              )}
              {renamingId !== session.sessionId ? (
                <IconButton
                  size="sm"
                  variant="plain"
                  className="flex-none opacity-0 group-hover:opacity-100"
                  title={t('historyChat.rowActions')}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (menuSession?.sessionId === session.sessionId) setMenuSession(undefined)
                    else openRowMenu(session, event.currentTarget)
                  }}
                >
                  <MoreHorizontal size={14} />
                </IconButton>
              ) : null}
            </div>
          ))}
        </div>
      ))}
      {menuSession !== undefined && menuPosition !== undefined
        ? createPortal(
            <div
              ref={menuPopupRef}
              className="fixed z-50 min-w-[160px] rounded-xl border border-border bg-bg p-1 shadow-fh-lv2"
              style={{ top: menuPosition.top, left: menuPosition.left }}
            >
              <MenuItem
                variant="popup"
                onClick={() => {
                  const session = menuSession
                  setMenuSession(undefined)
                  startRename(session)
                }}
              >
                <Pencil size={15} />
                {t('historyChat.rename')}
              </MenuItem>
              <MenuItem
                variant="popup"
                className="text-error"
                onClick={() => {
                  const session = menuSession
                  setMenuSession(undefined)
                  confirmDelete(session)
                }}
              >
                <Trash2 size={15} />
                {t('historyChat.delete')}
              </MenuItem>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
