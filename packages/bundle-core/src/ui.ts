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
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
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
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://cordis-ui.internal').pathname)
      return serveStatic(
        pathname, res, distRoot, distIndex,
        () => ctx.connection.authorizeIndex(req, res),
        renderIndex,
      )
    },
  }), 'cordis-ui: root static route')
}
