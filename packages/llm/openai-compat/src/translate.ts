// Cloned from example-2's packages/llm/openai-compat/src/translate.ts. ONE
// real API drift found and fixed against our installed @deepseek-ai/dsh-llm
// (0.1.5-rc.1 vs the 0.1.1-rc.2 this was originally written against):
// the branded tool-call-id type was renamed from `CallId` to `ToolCallId`
// (confirmed by grepping our installed .d.ts — `CallId` doesn't exist
// there at all, `ToolCallBlock.id`/`StreamChunk`'s `tool-call-delta.id`
// are both typed `ToolCallId`). Every other type/field used here matched
// exactly, checked one by one before porting.
import type { FinishReason, StreamChunk, TokenUsage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/**
 * OpenAI chat-completions streaming delta shapes — request-side fields
 * omitted, this is only what a `choices[0].delta` / chunk-level `usage`
 * looks like on the wire. Drops the DeepSeek-only assumption that every
 * server sends `reasoning_content`; kept as an optional pass-through since
 * some OpenAI-compatible reasoning models do send it too.
 */
interface WireToolCallDelta {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface WireDelta {
  content?: string
  reasoning_content?: string
  tool_calls?: WireToolCallDelta[]
}

interface WireUsage {
  prompt_tokens?: number
  completion_tokens?: number
}

interface WireChunk {
  choices?: Array<{ delta?: WireDelta; finish_reason?: string | null }>
  usage?: WireUsage
}

interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  callId?: ToolCallId
  name?: string
}

function mapFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return { kind: 'stop' }
    case 'tool_calls':
      return { kind: 'tool-calls' }
    case 'length':
      return { kind: 'max-tokens' }
    case null:
    case undefined:
      return { kind: 'stop' }
    default:
      return { kind: 'error', failure: { message: `unknown finish_reason: ${reason}`, code: reason.toUpperCase() } }
  }
}

function toContentBlock(block: OpenBlock): ContentBlock {
  if (block.kind === 'text') return { type: 'text', text: block.text }
  if (block.kind === 'reasoning') return { type: 'reasoning', text: block.text }
  return { type: 'tool-call', id: block.callId as ToolCallId, name: block.name ?? '', arguments: block.text }
}

/**
 * Turn parsed SSE payload strings (from sse.ts) into the harness's
 * `StreamChunk` protocol. All `block-end`/`usage`/`finish` chunks are
 * deferred until `[DONE]`, then emitted in the order blocks were opened.
 * `index` here is the HARNESS block index (a fresh counter), distinct from
 * the wire's own `tool_calls[].index` (which only disambiguates concurrent
 * tool-call deltas within one response and is never itself harness-visible).
 */
export async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  const openOrder: OpenBlock[] = []
  let textBlock: OpenBlock | undefined
  let reasoningBlock: OpenBlock | undefined
  const toolBlocksByWireIndex = new Map<number, OpenBlock>()
  let usage: TokenUsage | undefined
  let finishReason: FinishReason = { kind: 'stop' }

  function openBlock(kind: 'text' | 'reasoning'): OpenBlock {
    const block: OpenBlock = { index: nextIndex++, kind, text: '' }
    openOrder.push(block)
    return block
  }

  function openToolBlock(wireIndex: number, id: string | undefined, name: string | undefined): OpenBlock {
    let block = toolBlocksByWireIndex.get(wireIndex)
    if (!block) {
      block = { index: nextIndex++, kind: 'tool-call', text: '', callId: id as ToolCallId, name }
      toolBlocksByWireIndex.set(wireIndex, block)
      openOrder.push(block)
    }
    return block
  }

  for await (const payload of payloads) {
    if (payload === '[DONE]') break

    let chunk: WireChunk
    try {
      chunk = JSON.parse(payload) as WireChunk
    } catch (error) {
      // A malformed SSE payload is skipped, not fatal — one bad frame
      // shouldn't kill an otherwise-good turn — but logged so it isn't
      // silently invisible if a server occasionally sends a broken frame.
      console.error('cordis-llm-openai-compat: malformed SSE payload, skipping:', payload, error)
      continue
    }

    if (chunk.usage) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens ?? 0,
      }
    }

    const choice = chunk.choices?.[0]
    if (!choice) continue

    if (choice.finish_reason) finishReason = mapFinishReason(choice.finish_reason)

    const delta = choice.delta
    if (!delta) continue

    if (delta.content) {
      if (!textBlock) {
        textBlock = openBlock('text')
        yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
      }
      textBlock.text += delta.content
      yield { type: 'text-delta', index: textBlock.index, text: delta.content }
    }

    if (delta.reasoning_content) {
      if (!reasoningBlock) {
        reasoningBlock = openBlock('reasoning')
        yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
      }
      reasoningBlock.text += delta.reasoning_content
      yield { type: 'reasoning-delta', index: reasoningBlock.index, text: delta.reasoning_content }
    }

    for (const toolCallDelta of delta.tool_calls ?? []) {
      const isNew = !toolBlocksByWireIndex.has(toolCallDelta.index)
      const block = openToolBlock(toolCallDelta.index, toolCallDelta.id, toolCallDelta.function?.name)
      if (isNew) yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
      const argumentsDelta = toolCallDelta.function?.arguments ?? ''
      if (argumentsDelta) block.text += argumentsDelta
      if (toolCallDelta.function?.name && !block.name) block.name = toolCallDelta.function.name
      // An explicit `{ name: undefined }` is NOT the same as omitting the
      // key — dsh's session.append() rejects explicit `undefined` as
      // non-JSON-serializable (JSON.stringify would silently drop it; dsh's
      // own validator does not). Most deltas after the first one for a
      // given tool call have no `function.name` at all.
      yield {
        type: 'tool-call-delta',
        index: block.index,
        id: block.callId as ToolCallId,
        argumentsDelta,
        ...(toolCallDelta.function?.name ? { name: toolCallDelta.function.name } : {}),
      }
    }
  }

  for (const block of openOrder) {
    yield { type: 'block-end', index: block.index, block: toContentBlock(block) }
  }
  if (usage) yield { type: 'usage', usage }
  yield { type: 'finish', reason: finishReason }
}
