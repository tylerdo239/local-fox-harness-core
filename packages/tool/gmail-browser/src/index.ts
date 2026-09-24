// Gmail in a real browser. The browser itself is Microsoft's playwright-mcp,
// running as the `playwright-mcp` compose service; this plugin is its MCP
// client and publishes its own small tool surface on top.
//
// Why not just mount @deepseek-ai/dsh-mcp-client against that server (a row
// in a patch file, no code at all) — measured against the real server before
// writing any of this:
//
//   - It always advertises all 25 of its "core" tools and has no flag to turn
//     any off (confirmed by reading its own source: `capability.startsWith
//     ("core")` is unconditional). That is ~17_400 characters of tool
//     definitions on EVERY model request — ~15% of this deployment's 32_000
//     window, in every chat, including the ones that never open a browser.
//     The six below cost about a fifth of that.
//   - Three of those 25 (browser_run_code_unsafe, browser_evaluate,
//     browser_file_upload) run arbitrary JavaScript or push local files into
//     a page. Not registering them is the only real way to keep them away
//     from the model.
//   - Its own --allowed-origins killed Gmail outright: with the three origins
//     the sign-in flow actually uses, navigation died in
//     chrome-error://chromewebdata (its route interception does not survive
//     the redirect chain), and its docs say it is "not a security boundary"
//     anyway. Checking the URL here is what keeps the agent on Gmail.
//
// ponytail: one MCP connection for the whole harness, so every session shares
// ONE browser tab — two sessions working on Gmail at the same time will walk
// over each other. Per-session browsers are the upgrade if that ever matters.
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {} from '@deepseek-ai/dsh-tools'
import '@deepseek-ai/dsh-system-prompt'

export const name = 'cordis-tool-gmail-browser'
export const inject = ['tools', 'systemPrompt']

export interface Config {
  readonly mcpUrl: string
  readonly callTimeoutMs: number
  readonly downloadDir: string
}
export const Config: z<Config> = z.object({
  mcpUrl: z.string().default('http://playwright-mcp:8931/mcp'),
  // A cold Gmail load plus its settle time runs well past the MCP SDK's own
  // 60s request default.
  callTimeoutMs: z.number().step(1).min(1000).default(120_000),
  // Where the browser saves what it downloads: a volume both containers
  // mount, since the browser runs in its own (deploy/docker-compose.yml).
  downloadDir: z.string().default('/downloads'),
})

/** An attachment bigger than this is left where it is: the workspace is for working files, not for shipping archives around. */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
/** How long to wait for the browser to finish writing a downloaded file. */
const DOWNLOAD_TIMEOUT_MS = 30_000

/** Gmail itself plus the sign-in origin it redirects to — nothing else is reachable through gmail_open. */
const ALLOWED_HOSTS = new Set(['mail.google.com', 'accounts.google.com'])
const GMAIL_BASE = 'https://mail.google.com/mail/u/0/'

const PROMPT_ORDER = 2860
const PROMPT = [
  'Gmail is available through a real browser. For anything about the messages themselves, use gmail_list (the inbox, or a Gmail search such as is:unread or from:...) and gmail_read (one message by the ref gmail_list gave): they answer in a few lines, where a raw page snapshot of the same inbox runs past 100_000 characters and will not fit.',
  'A gmail_list line already says whether a message is unread or starred and carries the ref of its star, so answer and act from that line — a snapshot taken just to check one of those costs more than the whole listing.',
  'An attachment is downloaded with gmail_download, using the ref gmail_read lists for it; the file lands in this session\'s workspace, where the user can open it and where `pdftotext <file> -` reads a PDF.',
  'gmail_send writes and sends one message in a single call — use it rather than opening the compose window and typing field by field.',
  'The lower-level tools are for everything else — gmail_open loads a Gmail URL, gmail_snapshot shows the whole page, gmail_find locates one element on it, and gmail_click / gmail_type / gmail_press_key act on it. Replying inside a thread and settings go through those.',
  'Reading, searching and opening a thread need no permission. Before you send, reply, forward, archive or delete anything, say what you are about to do and wait for the user to agree in their next message — unless the task itself already says it comes from an automation, in which case carry it out without asking.',
  'Only Gmail can be opened; any other address is refused.',
].join(' ')

// Lazily connected, so core boots fine while playwright-mcp is down, and one
// failure does not poison every later call.
let connecting: Promise<Client> | undefined

async function connect(config: Config): Promise<Client> {
  if (connecting === undefined) {
    const client = new Client({ name: 'cordis-tool-gmail-browser', version: '1.0.0' })
    client.onclose = () => { connecting = undefined }
    connecting = client.connect(new StreamableHTTPClientTransport(new URL(config.mcpUrl)))
      .then(() => client)
      .catch((error: unknown) => {
        connecting = undefined
        throw new Error(`the browser service is unreachable at ${config.mcpUrl}: ${error instanceof Error ? error.message : String(error)}`)
      })
  }
  return connecting
}

/**
 * Everything goes to ONE shared browser tab, so two commands in flight at once
 * can tear each other down: the keepalive opening the inbox the moment core
 * starts while a tool navigates too ended in "Frame was detached", seen for
 * real. Commands therefore run strictly one after another.
 */
let queue: Promise<unknown> = Promise.resolve()

/**
 * A navigation cut short by another one — a person clicking in the VNC window
 * while the agent works, which no queue here can prevent. Worth one retry;
 * anything else a tool reports is a real answer and is not retried.
 */
const INTERRUPTED_NAVIGATION = /Frame was detached|interrupted by another navigation|net::ERR_ABORTED/i

/**
 * The current tab itself is dead — its renderer crashed (Gmail is heavy, and
 * Docker Desktop gives its VM little memory) or the window was closed by hand
 * over VNC. Every later command on that tab fails the same way, however often
 * it is retried: reproduced by killing the renderer, which left navigation
 * answering "Page crashed" until a new tab was opened. A fresh tab is the only
 * way back.
 */
const DEAD_TAB = /Frame was detached|Frame has been detached|Page crashed|Target page, context or browser has been closed/i

/** Run one playwright-mcp tool and return its text, which is what the model reads (page snapshots, error text). */
function call(config: Config, tool: string, args: Record<string, unknown>): Promise<string> {
  const run = queue.then(() => callOnce(config, tool, args), () => callOnce(config, tool, args))
  queue = run.catch(() => undefined)
  return run
}

/**
 * The transport retry is not belt-and-braces: over Streamable HTTP the server
 * owns the MCP session, and restarting that container leaves this side holding
 * a dead one whose every call fails "Session not found" — hit for real.
 * Nothing closes the client for us, so a transport failure drops it and
 * reconnects once. Retries stay inside this one queued call: re-entering
 * `call` from here would wait behind itself forever.
 */
async function callOnce(config: Config, tool: string, args: Record<string, unknown>, attempt = 0): Promise<string> {
  const client = await connect(config)
  let result
  try {
    result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: config.callTimeoutMs })
  } catch (error) {
    connecting = undefined
    await client.close().catch(() => undefined)
    if (attempt === 0) return callOnce(config, tool, args, attempt + 1)
    throw error
  }
  const content = Array.isArray(result.content) ? result.content : []
  const text = content.flatMap(block => typeof block.text === 'string' ? [block.text] : []).join('\n').trim()
  if (result.isError === true) {
    // First: maybe just cut short by another navigation — wait and retry.
    if (attempt === 0 && (INTERRUPTED_NAVIGATION.test(text) || DEAD_TAB.test(text))) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      return callOnce(config, tool, args, attempt + 1)
    }
    // Still dead: the tab is gone for good, so move to a new one.
    // ponytail: the dead tab is left open (one per crash) — close it here if
    // crashes turn out frequent enough for tabs to pile up.
    if (attempt === 1 && DEAD_TAB.test(text)) {
      await client.callTool({ name: 'browser_tabs', arguments: { action: 'new' } }, undefined, { timeout: config.callTimeoutMs })
      return callOnce(config, tool, args, attempt + 1)
    }
    throw new Error(text === '' ? `${tool} failed` : text)
  }
  return text === '' ? 'ok' : text
}


// Measured on a real inbox: a full snapshot of the message list is 117_421
// characters, because every message appears six or seven times over (its
// checkbox, its star, its sender cell, its subject cell, its date cell...).
// The rows below carry the same information in 8_717 — the accessible name of
// one `row` node already reads "unread, sender, subject, time, snippet", and
// its ref is what gmail_click takes. Same reason gmail_read strips the
// annotations out of a thread: the model needs the text, not the tree.
// The ref is NOT always `e12`: Playwright prefixes it with a frame id
// (`f8e1778`) as soon as the page has an iframe, which Gmail does. Matching
// only the bare form made gmail_list answer "no messages" on a full inbox,
// and the model fell back to raw snapshots — 149_618 characters for one
// listing, measured in a real session.
const ROW_PATTERN = /^[ \t]*- row "(.*?)" \[ref=([^\]]+)\]/gm
/** One listed message never needs more than this; a long snippet adds nothing the thread itself does not hold. */
const ROW_MAX_CHARS = 300

/** One listed message: its ref plus the accessible name Gmail already writes as "unread, sender, subject, time, snippet". matchAll is used rather than test/exec so the global pattern keeps no position between calls. */
export function parseRows(snapshot: string): Array<{ ref: string; name: string; star?: string }> {
  const rows: Array<{ ref: string; name: string; star?: string }> = []
  const lines = snapshot.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const match = new RegExp(ROW_PATTERN.source).exec(lines[i])
    if (match === null) continue
    const [, name, ref] = match
    const indent = /^[ \t]*/.exec(lines[i])?.[0].length ?? 0
    // Gmail's first button inside a row is its star toggle. Taken by position
    // rather than by label ("Không được gắn dấu sao" / "Not starred"), which
    // changes with the interface language. Carrying it here is what lets the
    // model star a message straight off a listing: doing it from a raw
    // snapshot cost 101_685 characters in a real session, twice the inbox.
    let star: string | undefined
    for (let j = i + 1; j < lines.length; j += 1) {
      const deeper = (/^[ \t]*/.exec(lines[j])?.[0].length ?? 0) > indent
      if (!deeper) break
      const button = /- button [^[]*\[ref=([^\]]+)\]/.exec(lines[j])
      if (button !== null) { star = button[1]; break }
    }
    rows.push({
      ref,
      name: name.length > ROW_MAX_CHARS ? `${name.slice(0, ROW_MAX_CHARS)}…` : name,
      ...(star === undefined ? {} : { star }),
    })
  }
  return rows
}

/**
 * The listing gmail_read falls back to. A ref only lives as long as the page
 * that produced it: opening one message invalidates every ref from the list
 * it was picked from ("Ref e286 not found in the current page snapshot"), and
 * a real session burned four wasted calls rediscovering that. Remembering the
 * list's URL and each ref's row text lets gmail_read reopen the list and find
 * the same message again by name.
 */
let lastList: { url: string; nameOf: Map<string, string> } | undefined

/**
 * Roles a page snapshot must keep a ref for: the model can only act on these.
 * Playwright MCP refs EVERY node, including `generic`, `cell` and `rowgroup`;
 * on one real Gmail inbox that is 381 gridcells and 106 generics of pure
 * scaffolding. Published measurements of the same idea (Playwright MCP vs a
 * ref-the-interactive-only formatter) report 51-79% smaller snapshots; the
 * numbers for THIS page are in the plugin's own README-less comment below.
 */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
  'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'tab', 'treeitem', 'spinbutton', 'slider',
])
/** Annotations that cost tokens and change nothing the model can act on. */
const NOISE_ANNOTATIONS = / \[(?:cursor=\w+|active|level=\d+|aria-hidden|expanded=\w+|selected|checked=\w+)\]/g
const REF_ANNOTATION = / \[ref=[^\]]+\]/g

/** Names are compared loosely: Gmail writes the same subject as "Sender, Subject, 04:00" on the row and "Subject - snippet" on its link, so punctuation and case must not decide duplication. */
function normalizeName(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/**
 * Shrink one playwright-mcp snapshot to what the model can use: interactive
 * nodes keep their ref, everything else keeps only the text it carries of its
 * own, and link targets (`/url:`) go — Gmail's are session-scoped redirect
 * blobs, worthless to the model and hundreds of characters each.
 */
export function trimSnapshot(snapshot: string): string {
  const kept: string[] = []
  // Enclosing names by indentation, for the containment rule below.
  const enclosing: Array<{ indent: number; text: string }> = []
  for (const raw of snapshot.split('\n')) {
    const line = raw.replace(NOISE_ANNOTATIONS, '')
    const node = /^(\s*)- ([a-zA-Z]+)(.*)$/.exec(line)
    if (node === null) {
      if (!/^\s*- \/url:/.test(line)) kept.push(line)
      continue
    }
    const [, indent, role, rest] = node
    const withoutRef = rest.replace(REF_ANNOTATION, '')
    const text = normalizeName([...withoutRef.matchAll(/"([^"]*)"|:\s*(.+?)\s*$/g)].map(m => m[1] ?? m[2]).join(' '))
    while (enclosing.length > 0 && enclosing[enclosing.length - 1].indent >= indent.length) enclosing.pop()
    const parent = enclosing[enclosing.length - 1]
    if (text !== '') enclosing.push({ indent: indent.length, text })
    if (INTERACTIVE_ROLES.has(role)) {
      // Kept, always — this is what the model clicks. Its NAME still goes when
      // the enclosing node already says the same thing: one Gmail row repeats
      // its own subject inside its checkbox, its star and its link.
      kept.push(text !== '' && parent !== undefined && parent.text.includes(text)
        ? `${indent}- ${role}${rest.replace(/ "[^"]*"| '[^']*'/, '').replace(/:\s*.+$/, '')}`
        : line)
      continue
    }
    // A container with no name and no text of its own says nothing once its
    // ref is gone, and a child repeating what its parent already says is pure
    // duplication — Gmail spends 381 gridcells per inbox doing exactly that.
    if (text === '') continue
    if (parent !== undefined && parent.text.includes(text)) continue
    kept.push(`${indent}- ${role}${withoutRef}`)
  }
  return kept.join('\n')
}

/**
 * The one place a URL is checked — see ALLOWED_HOSTS. A bare `#inbox` or
 * `/mail/u/0/#sent` resolves against Gmail itself: the model writes those
 * often, and refusing them as "not a URL" only bought retries.
 */
export function resolveUrl(url: string): { url: string } | { refusal: string } {
  const absolute = url.startsWith('#') || url.startsWith('/') ? new URL(url, GMAIL_BASE).href : url
  let host: string
  try {
    host = new URL(absolute).hostname
  } catch {
    return { refusal: `not a URL: ${url}` }
  }
  return ALLOWED_HOSTS.has(host)
    ? { url: absolute }
    : { refusal: `only Gmail can be opened (${[...ALLOWED_HOSTS].join(', ')}), not ${host}` }
}

/** Tool results are page snapshots — plain text, already shaped for the model by playwright-mcp, so they pass straight through. */
const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string): ContentBlock[] => [{ type: 'text', text: value }],
} as const

const TARGET_DESCRIPTION = 'The element\'s `ref` from a snapshot, e.g. "e42"'

/**
 * The name a downloaded file gets inside the session workspace. The browser
 * names the file after whatever the site sent, so this is a trust boundary:
 * only the basename survives, and anything that is not a plain name character
 * becomes an underscore, so no path can lead out of the workspace.
 */
export function safeFileName(name: string): string {
  const base = basename(name).replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[._]+/, '')
  return base === '' ? 'download' : base.slice(0, 120)
}

/** The newest file the browser wrote after `since`, once it has stopped growing. */
async function newestDownload(config: Config, since: number): Promise<{ path: string; name: string; size: number } | undefined> {
  const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS
  let best: { path: string; name: string; size: number } | undefined
  while (Date.now() < deadline) {
    const names = await readdir(config.downloadDir).catch(() => [] as string[])
    for (const name of names) {
      // Snapshots and console logs are written to this same directory.
      if (name.endsWith('.yml') || name.endsWith('.log') || name.endsWith('.crdownload')) continue
      const path = join(config.downloadDir, name)
      const info = await stat(path).catch(() => undefined)
      if (info === undefined || !info.isFile() || info.mtimeMs < since) continue
      if (best === undefined || info.mtimeMs > since) best = { path, name, size: info.size }
    }
    if (best !== undefined) {
      // One more look: a file still being written grows between two reads.
      const first = best.size
      await new Promise(resolve => setTimeout(resolve, 700))
      const info = await stat(best.path).catch(() => undefined)
      if (info !== undefined && info.size === first) return { ...best, size: info.size }
      best = undefined
      continue
    }
    await new Promise(resolve => setTimeout(resolve, 700))
  }
  return undefined
}

/** Load one listing and remember it, so gmail_read can come back to it when its refs go stale. */
async function listRows(config: Config, url: string): Promise<ReturnType<typeof parseRows>> {
  await call(config, 'browser_navigate', { url })
  let rows = parseRows(await call(config, 'browser_snapshot', {}))
  // Gmail renders the list after the page shell, and a search takes longer
  // than the inbox does. One 3s wait was NOT enough, measured: `has:attachment
  // newer_than:1y` answered "no messages found" through this tool while the
  // same query opened by hand showed five. An empty list is indistinguishable
  // from a slow one, so it is retried before being believed.
  // Five attempts, not one: a cold browser loading Gmail for the first time
  // is far slower than a warm one, and that is exactly when a listing lands
  // empty.
  for (let attempt = 0; attempt < 5 && rows.length === 0; attempt += 1) {
    await call(config, 'browser_wait_for', { time: 3 })
    rows = parseRows(await call(config, 'browser_snapshot', {}))
  }
  if (rows.length > 0) lastList = { url, nameOf: new Map(rows.map(row => [row.ref, row.name])) }
  return rows
}

async function openMessage(config: Config, ref: string): Promise<string> {
  await call(config, 'browser_click', { target: ref, element: 'message in the list' })
  return trimSnapshot(await call(config, 'browser_snapshot', { target: 'div[role=main]' }))
}

/**
 * Keep the browser window up and on Gmail even when no one is asking it
 * anything: it is watched (and driven by hand) over VNC, and a window that
 * only exists during a tool call is no use for that.
 *
 * The browser belongs to this plugin's MCP session, so the window appears as
 * soon as this connects and stays for as long as it lasts — playwright-mcp
 * closes a headed browser on no idle timer of its own. The ping is
 * deliberately passive (a tools/list, not a navigation): whoever is using the
 * window by hand must not have the page pulled out from under them.
 */
const KEEPALIVE_MS = 5 * 60_000

function openGmail(ctx: Context, config: Config): void {
  void call(config, 'browser_navigate', { url: `${GMAIL_BASE}#inbox` })
    .catch((error: unknown) => {
      ctx.logger.info('cordis-tool-gmail-browser: browser not ready yet', error instanceof Error ? error.message : error)
    })
}

function startKeepalive(ctx: Context, config: Config): () => void {
  openGmail(ctx, config)
  const timer = setInterval(() => {
    void (async () => {
      try {
        await (await connect(config)).listTools()
      } catch {
        // The session died (the service restarted, say) — drop it and put a
        // fresh window back on Gmail.
        connecting = undefined
        openGmail(ctx, config)
      }
    })()
  }, KEEPALIVE_MS)
  return () => { clearInterval(timer) }
}

export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.section({ name: 'cordis-gmail-browser:usage', order: PROMPT_ORDER, text: PROMPT })
  ctx.effect(() => startKeepalive(ctx, config), 'cordis-tool-gmail-browser: keep the browser on Gmail')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'gmail_list',
    description: 'List messages: the inbox, or the results of a Gmail search (is:unread, from:..., newer_than:7d). One line per message — its ref, whether it is unread, sender, subject, time — which is what gmail_read and gmail_click take. Use this instead of gmail_open + gmail_snapshot for anything list-shaped.',
    parameters: {
      query: { type: 'string', description: 'Gmail search query; omit for the inbox' },
      limit: { type: 'number', description: 'How many messages to return, default 20' },
    },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      const url = args.query === undefined || args.query.trim() === ''
        ? `${GMAIL_BASE}#inbox`
        : `${GMAIL_BASE}#search/${encodeURIComponent(args.query)}`
      const rows = await listRows(config, url)
      if (rows.length === 0) return 'no messages found on this page — gmail_snapshot shows what it actually displays'
      const shown = rows.slice(0, Math.min(Math.max(args.limit ?? 20, 1), 100))
      const more = rows.length > shown.length ? `\n(${String(rows.length - shown.length)} more on this page)` : ''
      const lines = shown.map(row => `${row.ref} |${row.star === undefined ? '' : ` star=${row.star} |`} ${row.name}`)
      return `${String(rows.length)} messages, showing ${String(shown.length)}. Open one with gmail_read; gmail_click on a star= ref toggles that message's star.\n${lines.join('\n')}${more}`
    },
  })), 'cordis-tool-gmail-browser: gmail_list')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'gmail_read',
    description: 'Open one message from gmail_list by its ref and return its text: subject, sender, date and body, without the surrounding interface. Opening a message marks it read.',
    parameters: { ref: { type: 'string', required: true, description: 'A ref from gmail_list, e.g. "e1339"' } },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      try {
        return await openMessage(config, args.ref)
      } catch (error) {
        const stale = error instanceof Error && /not found in the current page snapshot/i.test(error.message)
        const wanted = lastList?.nameOf.get(args.ref)
        if (!stale || lastList === undefined || wanted === undefined) throw error
        // Reopen the listing this ref came from and find the same row again.
        const again = (await listRows(config, lastList.url)).find(row => row.name === wanted)
        if (again === undefined) throw new Error(`that message is no longer in the list — call gmail_list again: ${error.message}`)
        return openMessage(config, again.ref)
      }
    },
  })), 'cordis-tool-gmail-browser: gmail_read')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'gmail_send',
    description: 'Send a plain-text email from the signed-in account. One call — it fills Gmail\'s own compose window and sends with Ctrl+Enter, instead of clicking the interface step by step.',
    parameters: {
      to: { type: 'string', required: true, description: 'Recipient address; several are comma-separated' },
      subject: { type: 'string', required: true },
      body: { type: 'string', required: true, description: 'Plain text' },
      cc: { type: 'string' },
    },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      // Gmail's own compose URL carries every field, so nothing is typed and
      // no snapshot is read: the same send done by hand cost 4-5 snapshots,
      // ~4_000 tokens each, in a real session log.
      const params = new URLSearchParams({ view: 'cm', fs: '1', tf: '1', to: args.to, su: args.subject, body: args.body })
      if (args.cc !== undefined && args.cc !== '') params.set('cc', args.cc)
      await call(config, 'browser_navigate', { url: `${GMAIL_BASE}?${params.toString()}` })
      // The subject box is the compose window's one language-independent
      // handle (`name=subjectbox`); Gmail sends from any field on Ctrl+Enter.
      await call(config, 'browser_wait_for', { time: 3 })
      await call(config, 'browser_click', { target: 'input[name=subjectbox]', element: 'compose subject field' })
      await call(config, 'browser_press_key', { key: 'Control+Enter' })
      await call(config, 'browser_wait_for', { time: 2 })
      // Gmail leaves the compose URL once it has accepted the message, so a
      // page still on `view=cm` means it never went out. Checking the URL
      // rather than the window's own labels keeps this language-independent.
      const after = await call(config, 'browser_snapshot', {})
      const pageUrl = /Page URL: (\S+)/.exec(after)?.[1] ?? ''
      if (pageUrl.includes('view=cm') || pageUrl.includes('compose=')) {
        return `the compose window is still open — the message was NOT sent. What is on screen:\n${trimSnapshot(after)}`
      }
      // Not on Gmail at all means the tab died somewhere in the steps above and
      // the rest ran on the blank one callOnce moved to — "left the compose
      // URL" then proves nothing. Say so, and steer away from a blind resend,
      // which is the one outcome worse than a message that did not go out.
      if (!pageUrl.startsWith('https://mail.google.com/')) {
        return 'the browser tab was lost while sending, so it is NOT known whether the message went out — check the Sent folder (gmail_list with in:sent) before sending it again'
      }
      return `sent to ${args.to}${args.cc === undefined || args.cc === '' ? '' : ` (cc ${args.cc})`}: "${args.subject}"`
    },
  })), 'cordis-tool-gmail-browser: gmail_send')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'gmail_download',
    description: 'Download an attachment from the message on screen and put the file in this session\'s workspace, where the user can open it. Pass the ref of the attachment\'s own download control, which gmail_read lists. The file can then be read with the ordinary file tools (a PDF with `pdftotext <file> -`).',
    parameters: { ref: { type: 'string', required: true, description: 'Ref of the attachment download button or link, from gmail_read' } },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) throw new Error('gmail_download needs a session workspace to save into')
      const since = Date.now()
      await call(config, 'browser_click', { target: args.ref, element: 'attachment download' })
      const file = await newestDownload(config, since)
      if (file === undefined) {
        throw new Error('nothing was downloaded — that ref may open a preview rather than download; look for the attachment\'s own download control in gmail_read')
      }
      if (file.size > MAX_DOWNLOAD_BYTES) {
        throw new Error(`the file is ${String(Math.round(file.size / 1024 / 1024))} MB, over the ${String(MAX_DOWNLOAD_BYTES / 1024 / 1024)} MB limit — it stays in the browser's own download folder`)
      }
      await mkdir(cwd, { recursive: true })
      const name = safeFileName(file.name)
      await copyFile(file.path, join(cwd, name))
      return `saved ${name} (${String(Math.round(file.size / 1024))} KB) into the workspace; read it with the file tools, e.g. \`pdftotext ${name} -\` for a PDF`
    },
  })), 'cordis-tool-gmail-browser: gmail_download')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'gmail_open',
    description: 'Open a Gmail page in the browser and return a snapshot of it. Only Gmail addresses are allowed. Use #search/<query> for a search, #inbox for the inbox.',
    parameters: { url: { type: 'string', required: true, description: 'A Gmail address — full (https://mail.google.com/mail/u/0/#inbox) or short (#inbox, #search/is:unread)' } },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      const resolved = resolveUrl(args.url)
      if ('refusal' in resolved) throw new Error(resolved.refusal)
      return call(config, 'browser_navigate', { url: resolved.url })
    },
  })), 'cordis-tool-gmail-browser: gmail_open')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'gmail_snapshot',
    description: 'Show the current page: every element with its text and its `ref`, which gmail_click and gmail_type take. A whole Gmail page is long — prefer gmail_find when you already know what you are looking for.',
    parameters: {},
    output: TEXT_OUTPUT,
    execute: async () => trimSnapshot(await call(config, 'browser_snapshot', {})),
  })), 'cordis-tool-gmail-browser: gmail_snapshot')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'gmail_find',
    description: 'Find text on the current page and return only the matching elements with their `ref` and a little context — far cheaper than a full snapshot.',
    parameters: { text: { type: 'string', required: true, description: 'Text to look for, case-insensitive' } },
    output: TEXT_OUTPUT,
    execute: async (args) => trimSnapshot(await call(config, 'browser_find', { text: args.text })),
  })), 'cordis-tool-gmail-browser: gmail_find')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'gmail_click',
    description: 'Click an element and return a snapshot of the page that follows.',
    parameters: {
      target: { type: 'string', required: true, description: TARGET_DESCRIPTION },
      element: { type: 'string', description: 'What it is, in a few words, e.g. "Compose button"' },
    },
    output: TEXT_OUTPUT,
    execute: async (args) => call(config, 'browser_click', { target: args.target, ...(args.element === undefined ? {} : { element: args.element }) }),
  })), 'cordis-tool-gmail-browser: gmail_click')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'gmail_type',
    description: 'Type text into a field (a search box, a recipient, a message body).',
    parameters: {
      target: { type: 'string', required: true, description: TARGET_DESCRIPTION },
      text: { type: 'string', required: true },
      submit: { type: 'boolean', description: 'Press Enter afterwards' },
    },
    output: TEXT_OUTPUT,
    execute: async (args) => call(config, 'browser_type', {
      target: args.target,
      text: args.text,
      ...(args.submit === undefined ? {} : { submit: args.submit }),
    }),
  })), 'cordis-tool-gmail-browser: gmail_type')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'gmail_press_key',
    description: 'Press one key, e.g. "Enter", "Escape" or "ArrowDown".',
    parameters: { key: { type: 'string', required: true } },
    output: TEXT_OUTPUT,
    execute: async (args) => call(config, 'browser_press_key', { key: args.key }),
  })), 'cordis-tool-gmail-browser: gmail_press_key')
}
