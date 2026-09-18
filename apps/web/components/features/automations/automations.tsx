'use client'

// UI clone plan Phase F — restyle only, no logic/route changes. Same page-chrome
// reduction as settings-models.tsx (Phase E): dropped the standalone "← back to
// chat" header, since Phase D made the sidebar a persistent frame — this renders
// straight in AppFrame's center column now, not a separate full-page route.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { listAutomations, listAutomationExecutions, type Automation } from '../../../lib/api'
import { useLocale } from '../../../lib/i18n/locale'

function ExecutionsPanel({ workflow }: { workflow: Automation }) {
  const { t } = useLocale()
  const executions = useQuery({
    queryKey: ['automation-executions', workflow.id],
    queryFn: () => listAutomationExecutions(workflow.id),
  })

  return (
    <div className="ml-1 flex flex-col gap-1 border-l border-border pl-3">
      <h3 className="text-xs font-medium text-muted">{t('automations.recentExecutions')}</h3>
      {executions.isLoading ? <p className="text-xs text-muted">{t('automations.loading')}</p> : null}
      {executions.isError ? <p className="text-xs text-error">{(executions.error as Error).message}</p> : null}
      <ul className="flex flex-col gap-1">
        {(executions.data?.data ?? []).map(execution => (
          <li key={execution.id} className="flex items-center gap-2 text-xs">
            <span className={execution.status === 'success' ? 'text-status-success' : execution.status === 'error' ? 'text-error' : 'text-muted'}>
              {execution.status}
            </span>
            <span className="text-muted">{execution.mode}</span>
            <span className="text-muted">#{execution.id}</span>
          </li>
        ))}
        {executions.data?.data.length === 0 ? <li className="text-xs text-muted">{t('automations.noExecutions')}</li> : null}
      </ul>
    </div>
  )
}

export function Automations() {
  const { t } = useLocale()
  const automations = useQuery({ queryKey: ['automations'], queryFn: listAutomations })
  const [expanded, setExpanded] = useState<string | undefined>(undefined)

  return (
    <div className="h-full overflow-y-auto bg-bg p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold text-fg">{t('automations.title')}</h1>
          <p className="mt-1 text-xs text-muted">{t('automations.readonlyHint')}</p>
        </div>

        {automations.isLoading ? <p className="text-sm text-muted">{t('automations.loading')}</p> : null}
        {automations.isError ? <p className="text-sm text-error">{(automations.error as Error).message}</p> : null}
        {automations.data?.workflows.length === 0 ? (
          <p className="text-sm text-muted">{t('automations.empty')}</p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {(automations.data?.workflows ?? []).map(workflow => (
            <li key={workflow.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
              <button
                type="button"
                className="flex items-center justify-between gap-2 text-left text-sm text-fg"
                onClick={() => { setExpanded(expanded === workflow.id ? undefined : workflow.id) }}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{workflow.name}</span>
                <span
                  className={`flex-none rounded-full px-2.5 py-1 text-xs font-medium ${workflow.active ? 'bg-status-success/15 text-status-success' : 'bg-status-neutral/15 text-status-neutral'}`}
                >
                  {workflow.active ? t('automations.active') : t('automations.inactive')}
                </span>
              </button>
              {workflow.editorUrl !== undefined ? (
                <a
                  href={workflow.editorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit items-center gap-1.5 self-end rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-100 ease-fh hover:bg-bg-hover"
                  onClick={(event) => { event.stopPropagation() }}
                >
                  {t('automations.openInN8n')}
                  <ExternalLink size={16} />
                </a>
              ) : null}
              {(workflow.tags ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {(workflow.tags ?? []).map(tag => (
                    <span key={tag.id} className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-muted">
                      {tag.name}
                    </span>
                  ))}
                </div>
              ) : null}
              {expanded === workflow.id ? <ExecutionsPanel workflow={workflow} /> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
