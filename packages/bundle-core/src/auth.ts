// UI clone plan Phase A — a single-admin login gate bridging our own
// username/password check to dsh's real (token+cookie, no username/password,
// no logout) auth. See docs/cordis-ui-clone-plan.md §0 for the full research
// this is built from:
//
// - dsh mints exactly one random "launch token" per process (private field,
//   never exposed on ctx) and exchanges it for a signed cookie only via
//   `GET /` (`ctx.connection.authorizeIndex`, already used by ui.ts). There
//   is no username/password concept and no server-side logout anywhere in
//   dsh itself (confirmed from `dsh-client-connection`'s own README).
// - The bridge is `ctx.connection.authenticatedUrl(baseUrl)` — a PUBLIC
//   method (confirmed in `lib/types/rpc-host.d.ts`) that mints a fresh
//   `?token=...` URL on demand, entirely server-side. Our login handler
//   checks username/password itself, then calls this to hand the browser a
//   URL that completes dsh's own real cookie exchange — we never touch or
//   replicate dsh's cookie-signing logic ourselves.
// - This route CANNOT go through `ctx.connection.fetch.register()`: those
//   routes require the cookie BEFORE dispatch, which would make logging in
//   require already being logged in. It must be a raw `ctx.webServer`
//   route, same primitive n8n.ts's webhook ingress uses, that does its own
//   auth entirely.
// - Real cookie name confirmed by inspecting a live `Set-Cookie` header:
//   `dsh-auth-<hash>=v1.<base64 JSON>.<signature>`, HttpOnly, host+port bound.
//   We don't need to replicate the hash or verify the signature ourselves
//   for logout — the browser presents whatever cookie it currently holds
//   under whatever name dsh gave it; we just echo that exact name back with
//   `Max-Age=0` to expire it.
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'

export const name = 'cordis-auth'
export const inject = ['webServer', 'connection', 'credentials']

// Single fixed account by design (docs/cordis-ui-clone-plan.md's confirmed
// decision: no registration, no multi-user) — "admin" is not configurable,
// only the password is (via the existing generic /api/v1/credentials route
// from Phase 4, same ref name).
const ADMIN_USERNAME = 'admin'
const ADMIN_PASSWORD_REF = 'ADMIN_PASSWORD'
const DEFAULT_ADMIN_PASSWORD = '12345678'

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA) // burn comparable time so a length mismatch isn't distinguishably faster
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

async function readJsonBody(req: IncomingMessage, maxBytes = 4096): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length
    if (total > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function handleLogin(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  let body: Record<string, unknown>
  try {
    body = await readJsonBody(req)
  } catch {
    sendJson(res, 413, { error: 'request body too large' })
    return
  }
  const username = typeof body.username === 'string' ? body.username : undefined
  const password = typeof body.password === 'string' ? body.password : undefined
  if (username === undefined || password === undefined) {
    sendJson(res, 400, { error: 'username and password are required' })
    return
  }
  const credential = await ctx.credentials.resolve(credentialRef(ADMIN_PASSWORD_REF))
  const validUsername = safeCompare(username, ADMIN_USERNAME)
  const validPassword = credential !== undefined && credential.value !== '' && safeCompare(password, credential.value)
  if (!validUsername || !validPassword) {
    sendJson(res, 401, { error: 'invalid username or password' })
    return
  }
  // Host header, not a hardcoded scheme+port: must match whatever authority
  // the browser actually used, since dsh binds the minted cookie to that
  // exact authority (confirmed in the decoded cookie payload:
  // {"authority":"127.0.0.1:3099",...}) — a mismatched authority here would
  // mint a token for the wrong host:port and the browser would just 401 again.
  const redirectUrl = ctx.connection.authenticatedUrl(`http://${req.headers.host ?? 'localhost'}`)
  sendJson(res, 200, { redirectUrl })
}

function handleLogout(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  const cookieHeader = req.headers.cookie ?? ''
  const match = /(dsh-auth-[^=;]+)=/.exec(cookieHeader)
  if (match !== null) {
    res.setHeader('set-cookie', `${match[1]}=; Path=/; Max-Age=0`)
  }
  sendJson(res, 200, { ok: true })
}

export async function apply(ctx: Context): Promise<void> {
  const passwordRef = credentialRef(ADMIN_PASSWORD_REF)
  const info = await ctx.credentials.describe(passwordRef)
  if (!info.configured) await ctx.credentials.set(passwordRef, DEFAULT_ADMIN_PASSWORD)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/auth/login',
    handler: (req, res) => handleLogin(ctx, req, res),
  }), 'cordis-auth: login route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/v1/auth/logout',
    handler: (req, res) => { handleLogout(req, res) },
  }), 'cordis-auth: logout route')

  // Through the normal ctx.connection.fetch gate (unlike login/logout above)
  // — reaching this handler at all already proves the cookie is valid, so
  // the body only needs to exist, not say anything.
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/v1/auth/status',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => Response.json({ ok: true }),
  }), 'cordis-auth: status route')
}
