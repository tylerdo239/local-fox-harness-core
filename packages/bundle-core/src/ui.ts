// P1 — serves the Next.js static export (apps/web/out/) at the root,
// replacing dsh's own chat UI in the browser without touching dsh-web-app.
// See docs/cordis-agent-implementation-plan.md §5.1 (parent local-agent-core
// checkout) for why this is a named 'prefix' route at '' via
// ctx.webServer.register(), reusing serveStatic() — NOT
// ctx.webServer.registerFallback / dsh-host-frontend-static's own apply(),
// which dsh-web-app's web-runtime row already claims unconditionally for
// its OWN dist. A prefix route at '' matches before the fallback is ever
// reached (exact table, then longest prefix, then fallback), so both
// coexist and ours always wins without disabling or fighting web-runtime
// for the seat.
//
// UI clone plan Phase A (docs/cordis-ui-clone-plan.md, confirmed decision):
// the index shell is now served PUBLICLY (no cookie required) so our own
// login screen (auth.ts) has something to render — only `/api/v1/*` stays
// behind dsh's real cookie check, the standard "public app shell, protected
// data" SPA model. `authorizeIndex` is still called, but ONLY on an actual
// `?token=` exchange (its mint-cookie-and-redirect side effect must still
// run for that path, exactly as before — auth.ts's login route depends on
// it via `ctx.connection.authenticatedUrl()`); every other request just
// gets the shell directly, since `authorizeIndex` already fully owns `res`
// whenever it returns false (a 401 in the old behavior) and there is no way
// to inspect that decision without risking writing to `res` twice.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { serveStatic } from '@deepseek-ai/dsh-host-frontend-static'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'

export const name = 'cordis-ui'
export const inject = ['webServer', 'connection']

function resolveDistIndex(): string {
  const override = process.env.CORDIS_UI_DIST_INDEX
  if (override !== undefined) return override
  // Dev layout: this compiles to lib/ui.js under packages/bundle-core/; the
  // export lives at apps/web/out/index.html, three levels up then across.
  // Docker may lay the two trees out differently and set the env var above
  // instead of relying on this relative path.
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/out/index.html')
}

export function apply(ctx: Context): void {
  const distIndex = resolveDistIndex()
  if (!existsSync(distIndex)) {
    throw new Error(
      `cordis-ui: no built frontend at ${distIndex} — run "pnpm --dir apps/web run build" `
      + 'first (or set CORDIS_UI_DIST_INDEX)',
    )
  }
  const distRoot = dirname(distIndex)
  const renderIndex = async (): Promise<string> => ctx.webServer.renderIndex(await readFile(distIndex, 'utf8'))
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '',
    handler: (req, res) => {
      const url = new URL(req.url ?? '/', 'http://cordis-ui.internal')
      const pathname = decodeURIComponent(url.pathname)
      const isTokenExchange = url.searchParams.has('token')
      // SPA fallback for client-side "routes" like `/chat/<sessionId>`
      // (Đợt 2: real `/chat/<id>` URLs via history.pushState, matching
      // example-2's own pattern — see apps/web/lib/use-app-route.ts).
      // serveStatic() itself has none ("missing paths return 404", per its
      // own doc comment) — every real dist file has an extension
      // (`_next/static/*.js`, `favicon.ico`, ...), so an extensionless,
      // non-root path can only be an app route, never a missing asset;
      // rewritten to `/` before serveStatic() ever sees it so it hits the
      // exact `target === distRoot` index branch instead of a 404.
      const isAppRoute = pathname !== '/' && extname(pathname) === ''
      return serveStatic(
        isAppRoute ? '/' : pathname, res, distRoot, distIndex,
        () => isTokenExchange ? ctx.connection.authorizeIndex(req, res) : true,
        renderIndex,
      )
    },
  }), 'cordis-ui: root static route')
}
