'use client'

// "Is anything happening?" — the question the chat could not answer before this.
// A turn takes seconds to minutes here; until now the screen simply sat still
// for all of it, with no spinner, no step name and no clock, so a slow turn and
// a dead one looked identical. Ported in spirit from fox-harness-core's own
// status row (its `conversation.thinking` / `runningTool` / `elapsedSeconds`
// labels), reading the event stream this app already streams into the store
// rather than adding any new backend call.
import { useEffect, useState } from 'react'
import { useLocale } from '../../../lib/i18n/locale'

export function RunStatus({ run }: { run: { running: boolean; since: number; tool?: string; skill?: string } }) {
  const { t } = useLocale()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!run.running) return undefined
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [run.running])

  if (!run.running) return null

  const seconds = Math.max(0, Math.round((now - run.since) / 1000))
  const elapsed = seconds < 60
    ? t('conversation.elapsedSeconds', { seconds: String(seconds) })
    : t('conversation.elapsedMinutes', { minutes: String(Math.floor(seconds / 60)), seconds: String(seconds % 60).padStart(2, '0') })
  const what = run.skill !== undefined
    ? t('conversation.skillLoading', { name: run.skill })
    : run.tool !== undefined
      ? t('conversation.runningTool', { name: run.tool })
      : t('conversation.thinking')

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
      <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-accent" />
      <span className="truncate">{what}</span>
      <span className="flex-none tabular-nums">{elapsed}</span>
    </div>
  )
}
