// UI clone plan Phase B — ported near-verbatim from example-2's useTheme.ts,
// one adaptation: `systemDark`'s initial value moved into an effect instead
// of `useState`'s lazy initializer — this app is a Next.js static export, so
// the initial render can run during `next build`'s prerender pass, where
// `window` doesn't exist yet; reading `matchMedia` there would throw.
// Deliberately does NOT persist anything until the user actually toggles:
// until then this follows the OS `prefers-color-scheme` live, with no
// `data-theme` attribute set — globals.css's dark block is scoped
// `:root:not([data-theme="light"])` and there's a separate
// `:root[data-theme="dark"]` block, so setting the attribute is the whole
// mechanism, no other wiring needed.
import { useEffect, useState } from 'react'
import { STORAGE_THEME } from './theme-storage-key'

export type Theme = 'light' | 'dark'

function storedOverride(): Theme | null {
  const stored = localStorage.getItem(STORAGE_THEME)
  return stored === 'light' || stored === 'dark' ? stored : null
}

export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (next: Theme) => void } {
  const [override, setOverride] = useState<Theme | null>(storedOverride)
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const onChange = (): void => { setSystemDark(mq.matches) }
    mq.addEventListener('change', onChange)
    return () => { mq.removeEventListener('change', onChange) }
  }, [])

  const theme: Theme = override ?? (systemDark ? 'dark' : 'light')

  useEffect(() => {
    if (override !== null) document.documentElement.dataset.theme = override
    else delete document.documentElement.dataset.theme
  }, [override])

  function setTheme(next: Theme): void {
    localStorage.setItem(STORAGE_THEME, next)
    setOverride(next)
  }

  function toggle(): void {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  return { theme, toggle, setTheme }
}
