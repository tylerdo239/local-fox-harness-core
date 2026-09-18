'use client'

// UI clone plan Phase D — adapted from example-2's AccountMenu.tsx: single
// fixed "Admin" account (no email — confirmed decision, no per-user
// identity at all), otherwise the same popup-above-trigger pattern,
// portaled to document.body for the same reason theirs is (the sidebar's
// own `overflow: hidden`, needed for the collapse-to-rail width transition,
// would otherwise clip it).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LogOut, MoreHorizontal, Settings } from 'lucide-react'
import { useLocale } from '../../../lib/i18n/locale'
import { MenuItem } from '../../primitives/menu-item'

export function AccountMenu({
  compact,
  onOpenSettings,
  onLogout,
}: {
  compact: boolean
  onOpenSettings: () => void
  onLogout: () => void
}) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  function openMenu(): void {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    setPosition({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent): void {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) === true || popupRef.current?.contains(target) === true) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={t('account.menuTitle')}
        className={`flex h-11 items-center gap-2.5 rounded-xl text-left text-fg hover:bg-bg-hover ${compact ? 'justify-center px-0' : 'px-2'}`}
        onClick={() => { if (open) setOpen(false); else openMenu() }}
      >
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent text-[0.8em] font-semibold text-accent-contrast">A</span>
        {!compact ? (
          <>
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.85em]">{t('account.name')}</span>
            <MoreHorizontal size={16} className="flex-none text-muted" />
          </>
        ) : null}
      </button>
      {open && position !== null && mounted
        ? createPortal(
            <div
              ref={popupRef}
              className="fixed z-50 min-w-[200px] rounded-xl border border-border bg-bg p-1 shadow-fh-lv2"
              style={{ left: position.left, bottom: position.bottom }}
            >
              <MenuItem variant="popup" onClick={() => { setOpen(false); onOpenSettings() }}>
                <Settings size={15} />
                {t('account.settings')}
              </MenuItem>
              <MenuItem variant="popup" onClick={() => { setOpen(false); onLogout() }}>
                <LogOut size={15} />
                {t('account.logout')}
              </MenuItem>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
