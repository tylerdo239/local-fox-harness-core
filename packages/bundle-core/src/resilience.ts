// One tool call must not be able to kill the whole deployment.
//
// Found for real on 2026-09-18: a `web_fetch` took the container down and
// `restart: unless-stopped` brought it back ~10s later, dropping every live
// chat with it. The stack:
//
//   AggregateError [ENETUNREACH]
//       at @deepseek-ai/dsh-web-fetch-http/lib/index.js:230
//   Emitted 'error' event on TLSSocket instance at: …
//       connect ENETUNREACH 2606:4700:20::681a:5dc:443
//
// That address is an IPv4 one (104.26.5.220) embedded in IPv6 — the NAT64 form
// the fetch plugin synthesises when it believes the network is IPv6-capable.
// This container has no IPv6 route at all, so the connection can only fail, and
// the socket's `error` event reaches no listener: Node's default for that is to
// end the process. deploy/docker-compose.yml now disables IPv6 in the container
// so the NAT64 path never triggers, which is the actual fix; this file is the
// floor under it, for the next third-party async error nobody caught.
//
// Deliberately NOT a general error-swallower: it logs the whole error and keeps
// the process serving. A request that failed still fails — its own caller sees
// that — and the operator still gets the stack in `docker logs`.

import type { Context } from '@deepseek-ai/cordis'

export const name = 'cordis-resilience'
// No `inject`: `ctx.logger` is cordis's own API, not a registered service — declaring it here
// held the whole boot at "waiting for service: logger" until the entry timed out.

export function apply(ctx: Context): void {
  const survive = (kind: string) => (error: unknown) => {
    ctx.logger.error(`cordis-resilience: ${kind} did not reach a handler; the process stays up — ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  }
  const onException = survive('an exception')
  const onRejection = survive('a promise rejection')

  ctx.effect(() => {
    process.on('uncaughtException', onException)
    process.on('unhandledRejection', onRejection)
    return () => {
      process.off('uncaughtException', onException)
      process.off('unhandledRejection', onRejection)
    }
  }, 'cordis-resilience.process-guards')
}
