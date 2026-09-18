// Cloned and adapted from example-2's packages/llm/openai-compat/src/adapter.ts.
// Deliberate simplification vs. the original (documented, not an oversight):
// the original resolves baseURL/apiKeyEnv/idle-timeout/extra-body through
// `@deepseek-ai/dsh-launch-environment` (env vars) with `ctx.credentials` only
// as a secondary path for the API key — this app has no env-var-editing UI at
// all (Settings only edits `ctx.credentials` refs, see settings-models.tsx),
// so env-var fallbacks would be dead code here. Everything user-configurable
// goes through `ctx.credentials` instead: `baseURL` and the API key are both
// real credential refs (Settings > Model & credentials can set either), one
// consistent mechanism instead of two. Idle timeout is a fixed constant
// (120s, the original's own default) and the extra-body merge feature is
// dropped entirely — advanced knobs with no UI to configure them anyway.
import type { Context } from '@deepseek-ai/cordis'
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  LlmAdapter,
  LlmError,
  QUOTA_EXCEEDED_CODE,
  assertUsableApiKey,
  attributionHeaders,
  isContextWindowExceededError,
  isQuotaExceededError,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

import { parseSse } from './sse.ts'
import { serializeRequest } from './serialize.ts'
import { translate } from './translate.ts'
import type { Config } from './index.ts'

const PACKAGE_NAME = '@cordis-app/llm-openai-compat'
const IDLE_TIMEOUT_MS = 120_000
const BASE_URL_REF = 'OPENAI_BASE_URL'

// Same status -> code mapping as @deepseek-ai/dsh-llm-deepseek's adapter.
// These codes are what dsh-llm-retry (RATE_LIMIT, SERVER, TIMEOUT,
// TRANSPORT) and compaction-basic (CONTEXT_WINDOW_EXCEEDED) act on.
function httpErrorCode(status: number, body: string): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (isQuotaExceededError(body)) return QUOTA_EXCEEDED_CODE
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400 && isContextWindowExceededError(body)) return CONTEXT_WINDOW_EXCEEDED_CODE
  if (status >= 500) return 'SERVER'
  return 'REQUEST_FAILED'
}

/**
 * Generic OpenAI-compatible chat-completions adapter — works against real
 * OpenAI, Azure OpenAI, and most self-hosted servers (Ollama, vLLM, LM
 * Studio, OpenRouter, ...) that speak the same `/chat/completions` SSE
 * protocol. `stream()` is the only method `LlmAdapter` requires — this
 * intentionally does not override `providerInfo`/`listModels`, relying on
 * the base class's defaults (same choice the original made, "NOT verified"
 * in its own README).
 *
 * `LlmRuntime.stream()` (the `ctx.llm` service wrapping this adapter)
 * normalizes any thrown error into a terminal `error`/`aborted` finish
 * chunk on its own — this method does not need a top-level try/catch.
 */
export class OpenAiCompatAdapter extends LlmAdapter {
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {
    super()
  }

  private async resolveBaseURL(): Promise<string> {
    const ref = credentialRef(BASE_URL_REF)
    const resolved = await this.ctx.credentials.resolve(ref)
    return resolved !== undefined && resolved.value !== '' ? resolved.value : this.config.baseURL
  }

  private async resolveApiKey(): Promise<string> {
    const ref = credentialRef(this.config.apiKeyEnv)
    const resolved = await this.ctx.credentials.resolve(ref)
    if (resolved === undefined || resolved.value === '') {
      throw new LlmError(
        `no credential found for ${this.config.apiKeyEnv} — set it via Settings > Model & credentials`,
        'MISSING_CREDENTIAL',
      )
    }
    return assertUsableApiKey(resolved.value, PACKAGE_NAME, ref)
  }

  resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...(this.config.contextWindow !== undefined ? { context: { contextWindow: this.config.contextWindow } } : {}),
    })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const [apiKey, baseURL] = await Promise.all([this.resolveApiKey(), this.resolveBaseURL()])
    // Restored from example-2's original adapter (user request) — a plain
    // shallow merge, same as the original's `{ ...serializeRequest(options),
    // ...this.resolveExtraBody() }`, just reading a static Config field here
    // instead of an env var (see this.config's own doc comment for why).
    const body = { ...serializeRequest(options), ...this.config.extraBody }
    const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...attributionHeaders(),
        },
        body: JSON.stringify(body),
        signal: options.signal,
      })
    } catch (error) {
      // Real bug found and fixed (Đợt 20 — the Stop button silently hung
      // instead of ever closing the turn, confirmed via temporary console
      // instrumentation in a live test): when dsh-agent's `agent.cancel()`
      // aborts `options.signal`, it does `controller.abort({kind:'user'})`
      // — a CUSTOM abort reason (dsh-session's own `AgentCancelCause`
      // shape), not a DOMException. Per the WHATWG AbortSignal spec, fetch()
      // then rejects with that exact reason value, so `error` here was the
      // bare object `{kind:'user'}` — NOT an Error instance at all. The old
      // `throw error as Error` was a type-cast lie: at runtime it re-threw
      // that plain object, which the harness's own failure normalizer
      // doesn't handle the same way it handles a real Error, leaving the
      // turn stuck open forever (confirmed for real: 3+ minutes with zero
      // new session events, no `turn/end`). The real reference adapter
      // (@deepseek-ai/dsh-llm-deepseek) never hits this: it always wraps an
      // aborted signal's failure in a proper `LlmError` with `code:
      // 'ABORTED'` before throwing — same fix applied here.
      console.error('[DIAG] fetch catch, error=', error, 'aborted=', options.signal?.aborted)
      if (options.signal?.aborted) {
        const wrapped = new LlmError('request aborted by caller', 'ABORTED', { cause: error })
        console.error('[DIAG] throwing wrapped LlmError:', wrapped, 'instanceof Error=', wrapped instanceof Error, 'code=', wrapped.code)
        throw wrapped
      }
      throw new LlmError(`request to ${url} failed`, 'TRANSPORT', { cause: error })
    }

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      throw new LlmError(`request to ${url} failed: ${String(response.status)} ${response.statusText}`, httpErrorCode(response.status, text), {
        status: response.status,
        cause: text || undefined,
      })
    }

    try {
      yield* translate(parseSse(response.body, IDLE_TIMEOUT_MS))
    } catch (error) {
      // Same fix as above — parseSse's reader can also reject with the raw
      // `{kind:'user'}` abort reason (mid-stream cancellation), not just
      // the initial fetch() call.
      if (options.signal?.aborted) throw new LlmError('request aborted by caller', 'ABORTED', { cause: error })
      throw error
    }
  }
}
