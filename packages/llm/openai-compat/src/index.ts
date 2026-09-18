// Ported from example-2's packages/llm/openai-compat (2026-09-03 there —
// "Written by reading the real reference adapter's source" per that
// package's own README, not guessed). Cloned per explicit user request
// ("clone plugin ... vào core") to give this app a second, generic LLM
// route beside dsh-base's own DeepSeek-only default — any OpenAI-compatible
// server (real OpenAI, Azure OpenAI, Ollama, vLLM, LM Studio, OpenRouter,
// ...), configurable entirely through Settings > Model & credentials (no
// env vars — see adapter.ts's own header comment for why this differs from
// the original).
//
// Lives at packages/llm/openai-compat (own workspace package), not inside
// bundle-core — same packages/<group>/<name> convention example-2 itself
// uses once a category (llm/tool/skill) has more than one member, moved
// here from an initial bundle-core/src/llm-openai-compat/ subfolder after
// the user asked for the real structural parity, not just the runtime
// behavior. `bundle-core`'s own cordis.patch.yml lists this package in the
// profile's `bundles` array (deploy/entrypoint.sh) so its OWN
// cordis.patch.yml (a plain `insert:` for this one row) actually gets
// applied — a package's patch.yml existing is not enough by itself, dsh
// only reads it for bundles named in that array.
//
// API drift checked field-by-field against our installed
// @deepseek-ai/dsh-llm@0.1.5-rc.1 (the original targeted 0.1.1-rc.2) before
// porting: only `CallId` -> `ToolCallId` (a real rename) needed fixing, in
// translate.ts. Everything else — `LlmAdapter`, `GenerateOptions`,
// `StreamChunk`, `ContentBlock`, `Message`, `ctx.llm.registerAdapter()` —
// matched exactly.
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-credentials'

import { OpenAiCompatAdapter } from './adapter.ts'

export const name = 'cordis-llm-openai-compat'
export const inject = ['llm', 'credentials']

export interface Config {
  /** Provider route this adapter registers under (`GenerateOptions.provider`), and what Settings > Model & credentials lists it as. */
  readonly provider: string
  /** Base URL up to but not including `/chat/completions`, e.g. `https://api.openai.com/v1`. Real default: real OpenAI's own endpoint. Overridable at runtime via the `OPENAI_BASE_URL` credential ref (Settings), same mechanism as the API key. */
  readonly baseURL: string
  /** Credential ref name the API key is read from (Settings > Model & credentials). */
  readonly apiKeyEnv: string
  /** Optional context-window size in tokens — needed by dsh-compaction-basic to compact before the provider rejects an oversized request. */
  readonly contextWindow?: number
}

export const Config: z<Config> = z.object({
  provider: z.string().required().default('openai-compat').description('Provider route registered with ctx.llm.'),
  baseURL: z.string().required().default('https://api.openai.com/v1').description('Base URL up to but not including /chat/completions.'),
  apiKeyEnv: z.string().required().role('credential-ref').default('OPENAI_API_KEY').description('Credential ref the API key resolves from.'),
  contextWindow: z.number().description('Optional context-window size in tokens, for automatic compaction.'),
})

export function apply(ctx: Context, config: Config): void {
  // No credential seeding here (unlike auth.ts's ADMIN_PASSWORD): there is
  // no sensible non-empty default for an API key, and gateway.ts's
  // KNOWN_CREDENTIAL_REFS already lists both refs this adapter reads
  // (`OPENAI_API_KEY` was already there; `OPENAI_BASE_URL` added alongside
  // this plugin) — `ctx.credentials.describe()` on a never-set ref already
  // reports `configured: false` correctly, which Settings already renders
  // as "not set", so the refs show up in the UI with no seeding needed.
  const adapter = new OpenAiCompatAdapter(ctx, config)
  ctx.effect(
    () => ctx.llm.registerAdapter([config.provider], adapter),
    'cordis-llm-openai-compat: registerAdapter()',
  )
}

export { OpenAiCompatAdapter } from './adapter.ts'
