// User request (2026-09-23, extended 2026-09-24): once the user has
// configured an OpenRouter or Z.ai API key, work that touches n8n should
// prefer a stronger model instead of this deployment's own default —
// automatically, not something the user has to switch by hand every time.
// Extended to a PRIORITIZED CANDIDATE LIST (not a single hardcoded target):
// user request was "nếu có config zai thì dùng glm-5.3" (prefer Z.ai's
// glm-5.3 when Z.ai is configured) without saying to drop the earlier
// OpenRouter/Sonnet-5 preference — so this tries each candidate's own
// credential in order and switches to the first one that resolves,
// keeping OpenRouter/Sonnet-5 as a real fallback rather than replacing it.
//
// Trigger: EITHER the n8n-workflow-builder SKILL loading successfully, OR
// any `n8n_*` tool call (regardless of outcome — even a failed validate/
// upsert still means the model is doing n8n work). Originally this only
// watched the skill load (prompt.ts's OPERATING_POLICY rule 3 tells the
// model to load a skill before the task, and n8n-workflow-builder's own
// frontmatter says to use it for "MỌI yêu cầu có nhắc tới n8n"). Real
// gap found checking that assumption against this deployment's own audit
// history (.dev-state/harness/audit/*.jsonl, 2026-09-23): of 20 sessions
// that touched n8n tools, 58 individual n8n_* tool calls happened with NO
// preceding skill load anywhere in that same session — one session called
// n8n_upsert_workflow five times in a row and never loaded the skill once.
// The policy is a instruction to the model, not a guarantee; skill-load-only
// would have missed the majority of real n8n work. Watching the tool calls
// directly closes that gap regardless of whether the model bothered to load
// the skill first.
//
// Switching on the skill load (when it does happen) still has one real
// advantage over waiting for the first tool call: dsh-agent's own model-
// selection contract says a switch "takes effect on a later step", so
// triggering on the skill (which normally precedes the first n8n_* call by
// at least one step) gives the switch a step of lead time the tool-call
// trigger alone cannot — which is exactly why both triggers stay, not just
// the more complete one.
//
// Sticky, not reversible mid-conversation: once switched, this session stays
// on that route for the rest of the conversation — no attempt to detect
// "the user is done with n8n now" and switch back, because there is no
// reliable signal for that. If this turns out to be the wrong default, it
// is one config field away from being reconsidered.
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-default-model'

export const name = 'cordis-skill-model-preference'
export const inject = ['tools', 'credentials', 'sessionController', 'agentDefaultModel']

export interface ModelCandidate {
  /** Provider route to switch to — must already be a live ctx.llm route. */
  readonly provider: string
  /** Model id on that provider. */
  readonly model: string
  readonly reasoningEffort?: string
  /** Credential ref that must resolve to a non-empty value for this candidate to be picked. */
  readonly credentialRefName: string
}

// No `.required()` anywhere in this schema (including nested here), unlike
// llm-openai-compat's own Config — real boot failure hit while writing this
// file's first version: bundle-core's cordis.patch.yml inserts this row with
// NO `config:` block at all (same situation audit.ts's own header comment
// documents), which makes the loader resolve the WHOLE schema against
// `undefined`. `.required()` combined with `.default()` threw "$.skillName
// missing required value" in that exact case — llm-openai-compat never hits
// this because its own patch row always supplies an explicit `config:`
// block. `.default()` alone (audit.ts's own pattern) is what actually
// survives an absent config block.
const ModelCandidate: z<ModelCandidate> = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
  credentialRefName: z.string().role('credential-ref'),
})

export interface Config {
  /** Skill name whose successful load triggers the switch. */
  readonly skillName: string
  /** Tool-name prefix that also triggers the switch, regardless of that call's own outcome — matches every real n8n_* tool (upsert, validate, list, activate, ...) without naming each one. */
  readonly toolNamePrefix: string
  // Not `readonly ModelCandidate[]` — schemastery's own generated Schema<Config>
  // type expects a mutable array here (real tsc error hit: "readonly ... cannot
  // be assigned to the mutable type" against z.array()'s inferred shape).
  /** Tried in order; the session switches to the first candidate whose credential resolves to a non-empty value. None configured — the session silently stays on its current model. */
  readonly candidates: ModelCandidate[]
}

export const Config: z<Config> = z.object({
  skillName: z.string().default('n8n-workflow-builder'),
  toolNamePrefix: z.string().default('n8n_'),
  // Z.ai first: real id confirmed against pi-ai's own installed catalog
  // (node_modules/@earendil-works/pi-ai/dist/providers/data/zai.json,
  // 2026-09-24) — contextWindow 1_000_000, compat.zaiToolStream: true.
  // OpenRouter/Sonnet-5 kept as the fallback this replaces (real id
  // confirmed against a live GET /api/v1/model-catalog on 2026-09-23) —
  // user asked to prefer Z.ai when configured, not to drop the earlier
  // preference outright.
  candidates: z.array(ModelCandidate).default([
    { provider: 'zai', model: 'glm-5.3', credentialRefName: 'ZAI_API_KEY' },
    { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', credentialRefName: 'OPENROUTER_API_KEY' },
  ]),
})

export function apply(ctx: Context, config: Config): void {
  // Guards against re-switching every time a later n8n_* call or skill
  // reference happens in the same conversation (compaction, a second n8n
  // request later in the same session, ...) — a same-value reselect is
  // still a real provider/model-change event appended to the log
  // (dsh-agent's own model-selection contract), not a silent no-op, so
  // repeating it would spam the transcript with redundant "switched model"
  // notices. Left UNSET when no candidate is configured yet (see below), so
  // setting a key mid-conversation and touching n8n again still switches on
  // that later attempt.
  const switchedSessions = new Set<string>()

  const maybeSwitch = (sessionId: SessionId): void => {
    if (switchedSessions.has(sessionId)) return
    // Marked SYNCHRONOUSLY, before any `await` — real race found live: this
    // deployment's own audit history has n8n_upsert_workflow retries firing
    // single-digit milliseconds apart (7ms between two real calls,
    // 2026-09-16 log), easily enough for two `tools/result` events to both
    // pass the `has()` check above before either reached the credential
    // check that used to sit ahead of `add()`. That ordering let the same
    // session get `selectModel()` called twice in a row — harmless in
    // outcome (same target model both times) but a real, avoidable
    // duplicate "switched model" notice in the session log.
    switchedSessions.add(sessionId)
    void (async () => {
      try {
        for (const candidate of config.candidates) {
          const credential = await ctx.credentials.resolve(credentialRef(candidate.credentialRefName))
          if (credential === undefined || credential.value === '') continue // this candidate isn't configured — try the next one
          // Real, confirmed-in-source behavior found live (2026-09-23), not
          // documented in dsh-api-session-controller's own .d.ts comment
          // ("Session-local model selection"): its compiled selectModel()
          // (lib/types/commands.js) ALWAYS also calls
          // `ctx.agentDefaultModel.saveSelection(selected)` — every call
          // silently overwrites the DEPLOYMENT-WIDE default too, not just
          // this one session. Confirmed with a controlled test against this
          // exact production container: selecting a model for session A
          // changed what a brand-new, untouched session B started on.
          // Snapshotting the default before the call and restoring it right
          // after is the only way to keep this plugin's whole point —
          // switch ONE session for its n8n work — from silently redirecting
          // every OTHER new chat the user starts afterward onto a route
          // with no relation to n8n at all.
          const previousDefault = ctx.agentDefaultModel.currentSelection()
          await ctx.sessionController.selectModel({
            sessionId,
            provider: candidate.provider,
            model: candidate.model,
            ...candidate.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(candidate.reasoningEffort) },
          })
          await ctx.agentDefaultModel.saveSelection(previousDefault)
          return // stop at the first configured candidate — do not also apply lower-priority ones
        }
        switchedSessions.delete(sessionId) // no candidate configured yet — allow retry once the user sets one, on a later trigger in this same session
      } catch (error) {
        switchedSessions.delete(sessionId) // allow retry on a later trigger in the same session
        ctx.logger.warn(`cordis-skill-model-preference: switching session ${sessionId} failed:`, error)
      }
    })()
  }

  ctx.on('tools/result', (exec, result) => {
    const sessionId = exec.agent?.session.id
    if (sessionId === undefined) return
    if (exec.name.startsWith(config.toolNamePrefix)) {
      maybeSwitch(sessionId) // every n8n_* call counts, success or failure — the failure itself is still n8n work
      return
    }
    if (result.isError || exec.name !== 'skill') return
    const args = exec.arguments as { name?: unknown } | undefined
    if (args?.name === config.skillName) maybeSwitch(sessionId)
  }, { global: true })
}
