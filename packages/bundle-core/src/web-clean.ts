// Trims what `web_fetch` hands the model down to the page's actual prose.
//
// The measurement that produced this, taken from a real turn on 2026-09-18:
// fetching https://en.wikipedia.org/wiki/Nokia returned 5_743 characters
// (~1_641 tokens) of which 79% sat inside markdown link markup and 38% was URLs
// and link tooltips alone. The words "Idestam" and "Finnish" did not appear at
// all — the entire payload was Wikipedia's navigation chrome ("Jump to
// content", "Main menu", "Random article", "Learn to edit"), and the model then
// answered about Nokia from its own training data.
//
// The cause is where dsh's two caps apply. `dsh-web-fetch-http` slices the
// decoded body at `maxBodyChars`, and `dsh-tool-web`'s renderBody() slices it
// AGAIN at `fetchMaxOutputChars` — both on RAW HTML, before turndown converts
// anything. A page spends its first tens of kilobytes on <head>, inline CSS and
// navigation, so a prefix cut buys markup and never reaches the article. No
// option caps the extracted text, which is the only number that matters here.
//
// So both caps are raised in cordis.patch.yml until they stop binding, the
// whole page is converted (178 ms for a 1.3 MB page, measured), and this hook
// becomes the real budget: it drops link targets, navigation blocks and the
// table-of-contents scaffolding, then caps the PROSE. On that same Wikipedia
// page the result went from 5_743 characters that were 28% prose and missing
// the article, to 12_000 characters that are 97% prose and contain the lead,
// the 1865 founding and Idestam.
//
// Because the raised caps mean dsh no longer bounds anything, this hook is
// load-bearing: cleanFetchText() must never throw, and apply() falls back to a
// plain slice if it somehow does.
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'cordis-web-clean'

export interface Config {
  /** Characters of cleaned page text one `web_fetch` may put in the context. */
  readonly maxChars?: number
}

const DEFAULT_MAX_CHARS = 12_000

/** dsh-tool-web's own header and footer, kept verbatim so provenance survives. */
const HEADER = /^(Fetched [^\n]*\n\nExternal web content follows[^\n]*\n\n)([\s\S]*)$/
const FOOTER = '\n\n(Content truncated. Fetch a more specific URL or section for the full text.)'

/** Below this, a page yielded no usable prose — see EMPTY_NOTICE. */
const MIN_USEFUL_CHARS = 200

// A JavaScript-rendered page is served as a shell: blog.mean.ceo's 105_830-byte
// response converts to 95 characters, its title and nothing else. dsh reports
// that as ordinary truncation, and a model handed a bare title will answer from
// memory — observed. Saying plainly that there is no content is what stops it.
const EMPTY_NOTICE = 'This page returned no readable text — it likely renders its content with JavaScript, '
  + 'which this fetcher does not run. Treat the page as unread: do not answer from prior knowledge as if you had read it.'

/** Blocks made only of short bullets are menus, not content. */
const MENU_ITEM_MAX_CHARS = 45

function cleanBlock(block: string): boolean {
  const lines = block.split('\n').filter(line => line.trim() !== '')
  if (lines.length === 0) return false
  const bullets = lines.filter(line => /^\s*[-*+]\s/.test(line))
  if (bullets.length === lines.length && bullets.length >= 2) {
    const average = bullets.reduce((sum, line) => sum + line.replace(/^\s*[-*+]\s/, '').length, 0) / bullets.length
    return average >= MENU_ITEM_MAX_CHARS
  }
  return block.trim().length >= 30 || /^#{1,6}\s/.test(block.trim())
}

/** Total by contract — every branch returns a string, no call here can throw. */
export function cleanFetchText(text: string, maxChars: number): string {
  const match = HEADER.exec(text)
  if (match === null) return text
  const [, header, rest] = match as unknown as [string, string, string]
  const body = rest.endsWith(FOOTER) ? rest.slice(0, -FOOTER.length) : rest

  const stripped = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\s*[-*+]\s*$/gm, '')
    .replace(/^.*\bToggle\b.*\bsubsection\b.*$/gm, '')

  const kept = stripped.split(/\n{2,}/).filter(cleanBlock).join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  if (kept.length < MIN_USEFUL_CHARS) return `${header}${EMPTY_NOTICE}`
  return kept.length > maxChars ? `${header}${kept.slice(0, maxChars)}${FOOTER}` : `${header}${kept}`
}

export function apply(ctx: Context, config: Config = {}): void {
  const maxChars = config.maxChars ?? DEFAULT_MAX_CHARS
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (exec.name !== 'web_fetch' || decision.kind !== 'accept' || decision.value !== undefined) return decision
    const source: ContentBlock[] = decision.content ?? (result.isError ? [] : result.content)
    if (source.length === 0) return decision
    const content = source.map((block) => {
      if (block.type !== 'text') return block
      try {
        return { ...block, text: cleanFetchText(block.text, maxChars) }
      } catch (error) {
        ctx.logger.warn('cordis-web-clean: falling back to a plain cut:', error)
        return { ...block, text: block.text.slice(0, maxChars) }
      }
    })
    // Rebuilt rather than spread: PostToolDecision's accept arm is a union that
    // forbids `value` and `content` together, and a spread would carry `value`.
    return decision.additionalContexts === undefined
      ? { kind: 'accept', content }
      : { kind: 'accept', content, additionalContexts: decision.additionalContexts }
  })
}
