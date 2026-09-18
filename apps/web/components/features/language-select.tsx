'use client'

// UI clone plan Đợt 6 — replaced with a real trigger + popup, matching
// example-2's actual LanguageSelect.tsx exactly (a native <select> was our
// own earlier stand-in, not what the reference app really has). Portaled to
// document.body, same proven pattern AccountMenu.tsx and skills-dialog's
// row menus already use — the dialog panel this renders inside
// (settings-dialog.tsx) has `overflow-y: auto`, which would clip an
// inline-positioned popup the same way.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useLocale } from '../../lib/i18n/locale'
import type { Locale } from '../../lib/i18n/translations'
import { MenuItem } from '../primitives/menu-item'

export function LanguageSelect() {
  const { locale, setLocale } = useLocale()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | undefined>(undefined)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  function openMenu(): void {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    setPosition({ left: rect.left, top: rect.bottom + 4, width: rect.width })
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

  function choose(next: Locale): void {
    setLocale(next)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="flex h-[34px] min-w-[160px] items-center justify-between gap-2 rounded-lg border border-border bg-bg px-[0.75em] text-[0.85em] text-fg hover:bg-bg-hover"
        onClick={() => { if (open) setOpen(false); else openMenu() }}
      >
        <span>{locale === 'vi' ? 'Tiếng Việt' : 'English'}</span>
        <ChevronDown size={14} />
      </button>
      {open && position !== undefined && mounted
        ? createPortal(
            // z-[1100], not the usual z-50 other portaled popups use
            // (account-menu/history-chat row menus) — real bug caught: this
            // is the only popup that can open WHILE a z-[1000] dialog
            // (Settings) is also on screen, since it's used inside
            // settings-dialog.tsx's GeneralTab. Both portal to document.body
            // (DOM siblings, not nested), so z-50 rendered BEHIND the
            // dialog's own backdrop+panel instead of on top of it.
            <div
              ref={popupRef}
              className="fixed z-[1100] rounded-xl border border-border bg-bg p-1 shadow-fh-lv2"
              style={{ left: position.left, top: position.top, width: position.width }}
            >
              <MenuItem variant="popup" active={locale === 'vi'} onClick={() => { choose('vi') }}>
                Tiếng Việt
              </MenuItem>
              <MenuItem variant="popup" active={locale === 'en'} onClick={() => { choose('en') }}>
                English
              </MenuItem>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
