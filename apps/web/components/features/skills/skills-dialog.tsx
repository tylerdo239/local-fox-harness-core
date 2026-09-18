'use client'

// UI clone plan Đợt 5 — full create/edit/delete, replacing Phase H's
// view-only dialog. Matches example-2's real SkillsDialog.tsx layout: nav
// rail with "+ New skill" / "My skills" (editable) / "Built-in skills"
// (read-only) sections, content panel switching between a create/edit form
// and a read-only view. Real persistence via gateway.ts's new
// /skill-create, /skill-update, /skill-delete routes (writing
// $DSH_HOME/skills/<name>/SKILL.md — dsh-skill-filesystem's own real
// "user-dsh" root, confirmed with a live boot test before this UI was
// built) — not example-2's own per-user Postgres/browser-mediated flow,
// which doesn't apply to this single-admin app at all.
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Plus, Sparkles, Trash2 } from 'lucide-react'
import { createSkill, deleteSkill, getSkillContent, listSkills, updateSkill, type SkillSummary } from '../../../lib/api'
import { useLocale } from '../../../lib/i18n/locale'
import { IconButton } from '../../primitives/icon-button'
import { MenuItem } from '../../primitives/menu-item'
import { Input } from '../../primitives/input'
import { Button } from '../../primitives/button'

type Selection = { kind: 'new' } | { kind: 'skill'; name: string }

interface Draft {
  name: string
  description: string
  content: string
}

const EMPTY_DRAFT: Draft = { name: '', description: '', content: '' }
const DESCRIPTION_MAX = 280

export function SkillsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale()
  const queryClient = useQueryClient()
  const skills = useQuery({ queryKey: ['skills'], queryFn: listSkills, enabled: open })
  const [selection, setSelection] = useState<Selection>({ kind: 'new' })
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [error, setError] = useState<string | undefined>(undefined)

  const list = skills.data?.skills ?? []
  const mine = list.filter(skill => skill.source === 'user-dsh')
  const builtin = list.filter(skill => skill.source !== 'user-dsh')
  const selectedBuiltin: SkillSummary | undefined = selection.kind === 'skill' ? builtin.find(skill => skill.name === selection.name) : undefined

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['skills'] })
  }

  function pick(next: Selection): void {
    setSelection(next)
    setError(undefined)
    if (next.kind === 'new') {
      setDraft(EMPTY_DRAFT)
      return
    }
    const builtinMatch = builtin.find(skill => skill.name === next.name)
    if (builtinMatch !== undefined) {
      setDraft({ name: builtinMatch.name, description: builtinMatch.description, content: '' })
      return
    }
    getSkillContent(next.name)
      .then(full => { setDraft({ name: full.name, description: full.description, content: full.content }) })
      .catch((loadError: unknown) => { setError(loadError instanceof Error ? loadError.message : String(loadError)) })
  }

  useEffect(() => {
    if (open) pick(mine[0] !== undefined ? { kind: 'skill', name: mine[0].name } : { kind: 'new' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const save = useMutation({
    mutationFn: () => (selection.kind === 'skill' && mine.some(skill => skill.name === selection.name)
      ? updateSkill(draft)
      : createSkill(draft)),
    onSuccess: (result) => {
      refresh()
      pick({ kind: 'skill', name: result.name })
    },
    onError: (saveError: Error) => { setError(saveError.message) },
  })

  const remove = useMutation({
    mutationFn: (name: string) => deleteSkill(name),
    onSuccess: () => {
      refresh()
      pick({ kind: 'new' })
    },
    onError: (removeError: Error) => { setError(removeError.message) },
  })

  function confirmDelete(): void {
    if (selection.kind !== 'skill') return
    if (!window.confirm(t('skills.deleteConfirm', { name: selection.name }))) return
    remove.mutate(selection.name)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-overlay-mask backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-label={t('skills.title')}
        className="relative flex h-[min(560px,80vh)] w-[min(760px,92vw)] flex-col rounded-3xl border border-border bg-bg shadow-fh-lv3"
      >
        <div className="flex flex-none items-center justify-between border-b border-border px-4 py-3">
          <h2 className="m-0 text-lg font-medium text-fg">{t('skills.title')}</h2>
          <IconButton variant="plain" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[200px] flex-none flex-col gap-0.5 overflow-y-auto border-r border-border p-3">
            <MenuItem variant="nav" active={selection.kind === 'new'} onClick={() => { pick({ kind: 'new' }) }}>
              <Plus size={16} />
              {t('skills.new')}
            </MenuItem>

            <div className="mb-1 mt-3 px-3 text-[0.75em] font-medium text-muted">{t('skills.mine')}</div>
            {skills.isLoading ? <p className="px-3 text-xs text-muted">{t('skills.loading')}</p> : null}
            {!skills.isLoading && mine.length === 0 ? <p className="px-3 text-xs text-muted">{t('skills.emptyMine')}</p> : null}
            {mine.map(skill => (
              <MenuItem key={skill.name} variant="nav" active={selection.kind === 'skill' && selection.name === skill.name} onClick={() => { pick({ kind: 'skill', name: skill.name }) }}>
                <Sparkles size={15} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{skill.name}</span>
              </MenuItem>
            ))}

            <div className="mb-1 mt-3 px-3 text-[0.75em] font-medium text-muted">{t('skills.builtin')}</div>
            {builtin.map(skill => (
              <MenuItem key={skill.name} variant="nav" active={selection.kind === 'skill' && selection.name === skill.name} onClick={() => { pick({ kind: 'skill', name: skill.name }) }}>
                <Sparkles size={15} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{skill.name}</span>
              </MenuItem>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {selectedBuiltin !== undefined ? (
              <div className="flex flex-col gap-3">
                <h3 className="m-0 font-mono text-base font-semibold text-fg">/{selectedBuiltin.name}</h3>
                <p className="m-0 text-sm text-muted">{selectedBuiltin.description}</p>
                <p className="m-0 text-xs text-muted">{t('skills.builtinReadonly', { name: selectedBuiltin.name })}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5 text-[0.8em] text-muted">
                  {t('skills.name')}
                  <Input
                    type="text"
                    placeholder={t('skills.namePlaceholder')}
                    disabled={selection.kind === 'skill'}
                    value={draft.name}
                    onChange={(event) => { setDraft({ ...draft, name: event.target.value.toLowerCase().replace(/\s+/g, '-') }) }}
                  />
                  <span className="text-[0.85em] text-muted">{t('skills.nameHint')}</span>
                </label>

                <label className="flex flex-col gap-1.5 text-[0.8em] text-muted">
                  <span className="flex items-center justify-between">
                    <span>{t('skills.description')}</span>
                    <span>{draft.description.length}/{DESCRIPTION_MAX}</span>
                  </span>
                  <textarea
                    className="min-h-[4.5em] resize-none rounded-lg border border-border bg-bg px-[0.7em] py-[0.5em] text-fg outline-none focus:border-accent"
                    maxLength={DESCRIPTION_MAX}
                    value={draft.description}
                    onChange={(event) => { setDraft({ ...draft, description: event.target.value }) }}
                  />
                </label>

                <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-[0.8em] text-muted">
                  {t('skills.content')}
                  <textarea
                    className="min-h-[10em] flex-1 resize-none whitespace-pre-wrap rounded-lg border border-border bg-bg px-[0.7em] py-[0.5em] font-mono text-[0.85em] text-fg outline-none focus:border-accent"
                    spellCheck={false}
                    value={draft.content}
                    onChange={(event) => { setDraft({ ...draft, content: event.target.value }) }}
                  />
                </label>

                <div className="flex items-center justify-between gap-2">
                  {error !== undefined ? <span className="text-[0.85em] text-error">{error}</span> : <span />}
                  <div className="flex flex-none gap-2">
                    {selection.kind === 'skill' ? (
                      <Button variant="outline" disabled={remove.isPending} onClick={confirmDelete}>
                        <Trash2 size={14} />
                        {t('skills.delete')}
                      </Button>
                    ) : null}
                    <Button variant="primary" disabled={save.isPending} onClick={() => { save.mutate() }}>
                      {save.isPending ? t('skills.saving') : t('skills.save')}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
