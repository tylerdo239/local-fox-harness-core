'use client'

// UI clone plan Phase D — ported from example-2's App.tsx: the same 2-column
// (sidebar | center) concession algorithm as dsh's real client-ui-layout
// (sidebar shrinks first, then center, `details` stays 0 here since nothing
// occupies it — we only ever exercise the first two branches in practice).
// Same breakpoint (1024px) and rail width (56px); deliberately no
// drag-to-resize, same as example-2's own choice.
import { useEffect, useRef, useState } from 'react'

export const SIDEBAR_AUTO_COLLAPSE = 1024
const SIDEBAR_RAIL_WIDTH = 56
export const SIDEBAR_EXPANDED_WIDTH = 280
const STORAGE_SIDEBAR_PINNED_COLLAPSED = 'cordis/sidebarCollapsed'

function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

function computeColumns(viewport: number, sidebar: number): { sidebar: number; center: number } {
  const s = sidebar === 0 ? SIDEBAR_RAIL_WIDTH : clampWidth(sidebar, 264, 420)
  return { sidebar: s, center: Math.max(0, viewport - s) }
}

export function useLayoutColumns(): {
  frameRef: React.RefObject<HTMLDivElement | null>
  gridTemplateColumns: string
  collapsed: boolean
  toggleCollapse: () => void
} {
  const frameRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [manuallyExpanded, setManuallyExpanded] = useState(false)
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false)

  useEffect(() => {
    setPinnedCollapsed(localStorage.getItem(STORAGE_SIDEBAR_PINNED_COLLAPSED) === '1')
  }, [])

  useEffect(() => {
    const el = frameRef.current
    if (el === null) return
    const observer = new ResizeObserver(() => { setViewportWidth(el.getBoundingClientRect().width) })
    observer.observe(el)
    setViewportWidth(el.getBoundingClientRect().width)
    return () => { observer.disconnect() }
  }, [])

  const narrow = viewportWidth < SIDEBAR_AUTO_COLLAPSE
  const collapsed = narrow ? !manuallyExpanded : pinnedCollapsed

  function toggleCollapse(): void {
    if (narrow) {
      setManuallyExpanded(v => !v)
      return
    }
    setPinnedCollapsed((v) => {
      const next = !v
      localStorage.setItem(STORAGE_SIDEBAR_PINNED_COLLAPSED, next ? '1' : '0')
      return next
    })
  }

  const cols = computeColumns(viewportWidth, collapsed ? 0 : SIDEBAR_EXPANDED_WIDTH)

  return {
    frameRef,
    gridTemplateColumns: `${cols.sidebar}px ${cols.center}px`,
    collapsed,
    toggleCollapse,
  }
}
