'use client'

// docs/add-openrouter-model-switch-plan.md — lets the user switch which
// model THIS conversation uses, live, from the composer. Reopens part of
// what settings-dialog.tsx's Đợt 6 comment closed on purpose ("an end user
// has no business choosing the route") — a deliberate product reversal per
// user request, not an oversight; see that file's own comment on the
// OPENROUTER_API_KEY field for the other half of this change.
//
// User request (2026-09-22): only 2 entries in the dropdown, not the full
// live provider roster ctx.sessionController.modelCatalog() can return
// (DeepSeek, any other configured route, ...) — "self-hosted (default)"
// (the operator-configured default this deployment already talks to,
// unpickable-elsewhere-but-shown-here) and OpenRouter's full catalog.
// Built by filtering the real catalog response, not a second backend route:
// the self-hosted entry is synthesized from `catalog.default` (openai-compat
// has no queryable model list of its own — confirmed for real, it never
// appears in `groups` at all, only as `default` — so there is nothing to
// filter FOR it, only to construct), and every group other than `openrouter`
// is dropped.
//
// Deliberately does NOT add a session-id-keyed field to store.ts for "current
// model": the `request/context` session event already carries {provider,
// model} for the step that just ran — the exact same event audit.ts reads
// server-side for the identical purpose — so reading it here can never
// disagree with the backend's own record. The only local state this needs is
// an optimistic override for the gap between "user clicked a model" and "the
// next request/context event proves it" (switching mid-conversation doesn't
// itself start a new step, so nothing re-derives that gap for free).
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown, Cpu } from 'lucide-react'
import { getModelCatalog, listCredentials, selectSessionModel, type SessionEvent } from '../../../lib/api'
import { useChatStore } from '../../../lib/store'
import { useLocale } from '../../../lib/i18n/locale'

const OPENROUTER_PROVIDER = 'openrouter'
const OPENROUTER_CREDENTIAL_REF = 'OPENROUTER_API_KEY'
// Matches gateway.ts's own SELF_HOSTED_PROVIDER — the id /model-catalog
// always prepends its self-hosted entry under, independent of the mutable
// `default` field. See groups-building comment below for the bug this fixes.
const SELF_HOSTED_PROVIDER = 'openai-compat'

interface ModelSelection {
  readonly provider: string
  readonly model: string
}

/** Latest request/context event's {provider, model} — undefined until this session has run at least one step. */
function latestModelFromEvents(events: readonly SessionEvent[]): ModelSelection | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event.type !== 'request/context') continue
    const data = event.data as { provider?: unknown; model?: unknown }
    if (typeof data.provider === 'string' && typeof data.model === 'string') {
      return { provider: data.provider, model: data.model }
    }
  }
  return undefined
}

export function ModelPicker({ sessionId, disabled = false }: { sessionId: string; disabled?: boolean }) {
  const { t } = useLocale()
  const events = useChatStore(state => state.events)
  const pushToast = useChatStore(state => state.pushToast)
  const requestOpenSettings = useChatStore(state => state.requestOpenSettings)
  const catalog = useQuery({ queryKey: ['model-catalog'], queryFn: getModelCatalog })
  // Same ['credentials'] cache key settings-dialog.tsx's CredentialField
  // already populates/invalidates — setting the key there refreshes this
  // picker's view of it too, no extra wiring needed.
  const credentials = useQuery({ queryKey: ['credentials'], queryFn: listCredentials })
  const [open, setOpen] = useState(false)
  // Set right after a successful switch, cleared once a FRESH request/context
  // event proves the real value — see file header comment.
  const [optimistic, setOptimistic] = useState<ModelSelection | undefined>(undefined)
  const eventsLengthAtSwitch = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setOptimistic(undefined); setOpen(false) }, [sessionId])

  useEffect(() => {
    if (optimistic === undefined) return
    if (events.length <= eventsLengthAtSwitch.current) return
    if (latestModelFromEvents(events) !== undefined) setOptimistic(undefined)
  }, [events, optimistic])

  useEffect(() => {
    if (!open) return undefined
    const onClickOutside = (event: MouseEvent): void => {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => { document.removeEventListener('mousedown', onClickOutside) }
  }, [open])

  const select = useMutation({
    mutationFn: (selection: ModelSelection) => selectSessionModel(sessionId, selection),
    onSuccess: (_result, selection) => {
      eventsLengthAtSwitch.current = events.length
      setOptimistic(selection)
      setOpen(false)
    },
  })

  const current = optimistic ?? latestModelFromEvents(events) ?? catalog.data?.default
  const openrouterConfigured = credentials.data?.credentials.some(
    credential => credential.ref === OPENROUTER_CREDENTIAL_REF && credential.configured,
  ) === true

  // Exactly 2 entries, never the full live provider roster
  // modelCatalog() can return (DeepSeek, any other configured route, ...) —
  // see file header comment for why. Real bug found live (2026-09-22):
  // building the self-hosted entry from `catalog.default` (the MUTABLE
  // deployment default — changeable via POST /model or a session-local
  // select) collided with the real openrouter group whenever `default` had
  // drifted to point at openrouter itself (same id on both, React silently
  // dropped one). gateway.ts's /model-catalog now always prepends a fixed
  // SELF_HOSTED_PROVIDER entry sourced from OPENAI_MODEL_ID, independent of
  // whatever `default` currently is — this just filters + orders it, no
  // longer builds it.
  const groups = (catalog.data?.groups ?? [])
    .filter(group => group.id === SELF_HOSTED_PROVIDER || group.id === OPENROUTER_PROVIDER)
    .map(group => group.id === SELF_HOSTED_PROVIDER ? { ...group, name: t('modelPicker.selfHostedGroupLabel') } : group)
    .sort((a, b) => (a.id === SELF_HOSTED_PROVIDER ? -1 : b.id === SELF_HOSTED_PROVIDER ? 1 : 0))

  function handlePick(groupId: string, modelId: string): void {
    if (groupId === OPENROUTER_PROVIDER && !openrouterConfigured) {
      pushToast(t('modelPicker.openrouterNotConfiguredToast'))
      requestOpenSettings('config')
      setOpen(false)
      return
    }
    select.mutate({ provider: groupId, model: modelId })
  }

  // Nothing routable yet (catalog still loading, or truly empty) — render
  // nothing rather than a picker with no choices in it.
  if (current === undefined) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen(previous => !previous) }}
        title={t('modelPicker.scopeHint')}
        className="inline-flex h-[34px] items-center gap-1.5 rounded-full border border-border bg-transparent px-3 text-[0.8em] text-fg transition-colors duration-100 ease-fh hover:bg-bg-hover disabled:opacity-40"
      >
        <Cpu size={13} />
        <span className="max-w-[160px] truncate">
          {select.isPending ? t('modelPicker.switching') : t('modelPicker.currentLabel', { provider: current.provider, model: current.model })}
        </span>
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div role="listbox" className="absolute bottom-full left-0 z-20 mb-1.5 max-h-[320px] w-[260px] overflow-y-auto rounded-xl border border-border bg-bg p-1 shadow-fh-lv2">
          {groups.map(group => (
            <div key={group.id} className="mb-1 last:mb-0">
              <div className="px-2.5 py-1 text-[0.7em] font-semibold uppercase tracking-wide text-muted">{group.name}</div>
              {group.models.map(model => {
                const active = current.provider === group.id && current.model === model.id
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={select.isPending}
                    onMouseDown={(event) => { event.preventDefault() }}
                    onClick={() => { handlePick(group.id, model.id) }}
                    className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-100 ease-fh hover:bg-bg-hover ${active ? 'bg-bg-hover' : ''}`}
                  >
                    <span className="text-[0.85em] font-medium text-fg">{model.name}</span>
                    {model.description !== undefined ? (
                      <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[0.75em] text-muted">{model.description}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ))}
          <div className="border-t border-border px-2.5 pt-1.5 text-[0.7em] text-muted">{t('modelPicker.mixWarning')}</div>
        </div>
      ) : null}
      {select.isError ? (
        <span className="absolute top-full left-0 mt-1 whitespace-nowrap text-[0.75em] text-error">{t('modelPicker.switchFailed')}</span>
      ) : null}
    </div>
  )
}
