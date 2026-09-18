'use client'

// UI clone plan Đợt 2 — real `/chat/<sessionId>` URLs, matching example-2's
// own `history.pushState`/`popstate` pattern (App.tsx) instead of Next's own
// router: Next's file-based router can't own a dynamic `/chat/[id]` page
// under `output: 'export'` (no way to `generateStaticParams` for session ids
// created at runtime), so this is a small hand-rolled client-side router
// layered on the SAME single exported page, same technique example-2 itself
// uses on top of its own Vite SPA. ui.ts's own SPA-fallback rewrite (added
// alongside this) is what lets a hard refresh on `/chat/<id>` still boot the
// app instead of 404ing.
//
// Settings/Skills stay pure client-modal state in page.tsx (never in the
// URL) — deliberately simpler than example-2's own design: a modal doesn't
// need to be a navigable "page", and keeping it out of the URL means opening
// one never disturbs whatever `/chat/<id>` is currently showing underneath.
//
// `/automations` (Đợt 12) — unlike Settings/Skills, this DOES get a real
// route: the user asked for it explicitly ("mở nút automations phải mở 1
// route mới /"), and unlike a modal it already swaps the whole center
// column (page.tsx's old `centerView` state), so giving it a URL costs
// nothing extra and buys real back/forward + reload support for free.
import { useCallback, useEffect, useState } from 'react'

export type AppRoute = { kind: 'home' } | { kind: 'chat'; sessionId: string } | { kind: 'automations' }

function parseRoute(): AppRoute {
  const { pathname } = window.location
  if (pathname === '/automations' || pathname === '/automations/') return { kind: 'automations' }
  const match = /^\/chat\/([^/]+)\/?$/.exec(pathname)
  return match?.[1] !== undefined ? { kind: 'chat', sessionId: decodeURIComponent(match[1]) } : { kind: 'home' }
}

export function useAppRoute(): {
  route: AppRoute
  goToSession: (sessionId: string, replace?: boolean) => void
  goToAutomations: (replace?: boolean) => void
  goHome: (replace?: boolean) => void
} {
  // Lazy initializer reads `window.location` directly (unlike use-theme.ts/
  // locale.tsx's own SSR-safety fixes) — safe here because this hook is only
  // ever called from AppFrame, which page.tsx's Home() only reaches AFTER
  // its auth-status query has settled (isLoading/isError both false); during
  // `next build`'s prerender the query never settles, so Home() always
  // returns LoadingScreen and this initializer never actually runs there.
  const [route, setRoute] = useState<AppRoute>(parseRoute)

  useEffect(() => {
    function onPopState(): void { setRoute(parseRoute()) }
    window.addEventListener('popstate', onPopState)
    return () => { window.removeEventListener('popstate', onPopState) }
  }, [])

  const goToSession = useCallback((sessionId: string, replace = false) => {
    const path = `/chat/${encodeURIComponent(sessionId)}`
    if (replace) window.history.replaceState(null, '', path)
    else window.history.pushState(null, '', path)
    setRoute({ kind: 'chat', sessionId })
  }, [])

  const goToAutomations = useCallback((replace = false) => {
    if (replace) window.history.replaceState(null, '', '/automations')
    else window.history.pushState(null, '', '/automations')
    setRoute({ kind: 'automations' })
  }, [])

  const goHome = useCallback((replace = false) => {
    if (replace) window.history.replaceState(null, '', '/')
    else window.history.pushState(null, '', '/')
    setRoute({ kind: 'home' })
  }, [])

  return { route, goToSession, goToAutomations, goHome }
}
