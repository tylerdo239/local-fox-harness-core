import type { Metadata } from 'next'
import { QueryProvider } from '../lib/query-provider'
import { LocaleProvider } from '../lib/i18n/locale'
import { STORAGE_THEME } from '../lib/theme-storage-key'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fox Harness',
}

// Real bug fixed (user: "refresh trang theme thành dark mặc dù theme là
// sáng") — "flash of incorrect theme". globals.css's dark palette applies
// via `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"])
// {...} }`, so at ANY moment <html> has no `data-theme` attribute yet — from
// first paint until use-theme.ts's own `useEffect` runs, which is only
// AFTER hydration — the OS preference wins regardless of what the user
// explicitly picked before. If the OS is dark but the user picked light,
// refreshing flashes dark first, then corrects a moment later; on a slow
// bundle load that correction can lag enough to look like the bug just
// stuck. Fix: a synchronous, render-blocking inline script — the standard
// fix for this exact class of bug in every SSR/static dark-mode app — sets
// the real attribute from localStorage before the browser paints anything
// at all, closing that window entirely. Interpolates `STORAGE_THEME` rather
// than a duplicated literal so the two can never drift out of sync.
const themeInitScript = `
try {
  var t = localStorage.getItem(${JSON.stringify(STORAGE_THEME)});
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <LocaleProvider>
          <QueryProvider>{children}</QueryProvider>
        </LocaleProvider>
      </body>
    </html>
  )
}
