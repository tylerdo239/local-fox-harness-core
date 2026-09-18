'use client'

// UI clone plan Đợt 2 Phase M — restyle only (design tokens instead of raw
// amber/green/red Tailwind), no logic change. Kept, not removed to match
// example-2 (see conversation.tsx's own header comment): approval-gated
// tool calls are a real capability of THIS app (dsh-user-approval) with no
// equivalent in example-2's different backend architecture at all.
import { useMutation } from '@tanstack/react-query'
import { respondApproval } from '../../../lib/api'
import { useChatStore } from '../../../lib/store'
import { useLocale } from '../../../lib/i18n/locale'
import { Button } from '../../primitives/button'

export function Approvals() {
  const { t } = useLocale()
  const pendingApprovals = useChatStore(state => state.pendingApprovals)
  const setPendingApprovals = useChatStore(state => state.setPendingApprovals)

  const respond = useMutation({
    mutationFn: (input: { callId: string; outcome: 'allowed-once' | 'rejected' }) =>
      respondApproval(input.callId, input.outcome),
    onSuccess: (_result, input) => {
      setPendingApprovals(pendingApprovals.filter(approval => approval.callId !== input.callId))
    },
  })

  if (pendingApprovals.length === 0) return null

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-bubble-live px-4 py-3">
      {pendingApprovals.map(approval => (
        <div key={approval.callId} className="flex items-center justify-between gap-3 text-sm text-fg">
          <span>
            {t('approvals.approve')} <strong className="font-semibold">{approval.toolName}</strong>
            {approval.reason !== undefined && approval.reason !== '' ? ` — ${approval.reason}` : ''}?
          </span>
          <div className="flex flex-none gap-2">
            <Button
              variant="outline"
              disabled={respond.isPending}
              onClick={() => { respond.mutate({ callId: approval.callId, outcome: 'rejected' }) }}
            >
              {t('approvals.reject')}
            </Button>
            <Button
              variant="primary"
              disabled={respond.isPending}
              onClick={() => { respond.mutate({ callId: approval.callId, outcome: 'allowed-once' }) }}
            >
              {t('approvals.allow')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
