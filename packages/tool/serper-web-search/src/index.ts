// Ported from example-2's packages/tool/serper-web-search (cloned per
// explicit user request). Registers NO tool of its own — dsh already ships
// every other piece:
//   `web_search` tool  -> @deepseek-ai/dsh-tool-web (what the model calls)
//   `ctx.web`          -> @deepseek-ai/dsh-web (routes a search to the
//                         selected source)
//   search source       -> THIS file (calls Serper, returns {sources, truncated})
//
// Lives at packages/tool/serper-web-search (own workspace package), not
// inside bundle-core — see llm/openai-compat/src/index.ts's own header
// comment for the full "why" (same packages/<group>/<name> convention
// example-2 itself uses, same `bundles`-array wiring requirement).
//
// Real gap found while porting (checked via `dsh --profile cordis-app
// --dump-config`, not assumed): `dsh-tool-web` is mounted but `disabled:
// true` in this composition (dsh-web-app's own patch layer disables it —
// pre-existing, unrelated to this change), and `ctx.web`'s `searchProvider`
// defaults to `deepseek-official` (needs DEEPSEEK_API_KEY). Both re-enabled
// in `bundle-core`'s own cordis.patch.yml (NOT this package's — matches
// example-2's own separation: a reusable search-source package stays
// product-decision-free, the app's top composing bundle decides which
// source wins, same as example-2's own profile-template layer does for
// them) — without that override, registering this source would have had
// nothing to select it and no tool to ever call it.
//
// Deliberately simplified vs. the original (documented, not an oversight):
// the original also falls back to `@deepseek-ai/dsh-launch-environment`
// (an env var) when `ctx.credentials` has no key — dropped here for the
// same reason llm-openai-compat/adapter.ts drops it: this app has no
// env-var-editing UI, only Settings' credentials list, so the fallback
// path would be dead code.
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { WebError, type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web'

export const name = 'cordis-tool-serper-web-search'
export const inject = ['web', 'credentials']

const API_KEY_REF = 'SERPER_API_KEY'
const SERPER_URL = 'https://google.serper.dev/search'

interface SerperOrganicResult {
  title?: string
  link?: string
  snippet?: string
  date?: string
}

// Maps only `organic` results; answerBox/peopleAlsoAsk/knowledgeGraph are
// ignored. No field is set to `undefined`: the result lands in the session
// log, which rejects explicit undefined values.
async function serperSearch(apiKey: string, request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
  const response = await fetch(SERPER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ q: request.query, ...(request.maxResults ? { num: request.maxResults } : {}) }),
    signal,
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200)
    throw new WebError(`Serper search failed: HTTP ${String(response.status)} ${detail}`, 'WEB_PROVIDER_ERROR')
  }

  const data = await response.json() as { organic?: SerperOrganicResult[] }
  const sources = (data.organic ?? []).flatMap(item =>
    item.link !== undefined
      ? [{ url: item.link, title: item.title ?? '', snippet: item.snippet ?? '', ...(item.date !== undefined ? { publishedAt: item.date } : {}) }]
      : [],
  )
  return { sources, truncated: false }
}

export function apply(ctx: Context): void {
  async function resolveApiKey(): Promise<string> {
    const ref = credentialRef(API_KEY_REF)
    const resolved = await ctx.credentials.resolve(ref)
    if (resolved === undefined || resolved.value === '') {
      throw new WebError(`Serper search has no API key — set ${API_KEY_REF} via Settings > Model & credentials`, 'WEB_PROVIDER_CREDENTIAL_MISSING')
    }
    return resolved.value
  }

  ctx.effect(
    () => ctx.web.registerSearchProvider({
      id: 'serper',
      // Always selectable: the key is checked per search, so a missing key
      // surfaces as the clear error above instead of a generic "unavailable".
      available: () => true,
      search: async (request, signal) => serperSearch(await resolveApiKey(), request, signal),
    }),
    'cordis-tool-serper-web-search: registerSearchProvider()',
  )
}
