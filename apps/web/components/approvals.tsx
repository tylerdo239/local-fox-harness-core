'use client'

import { useMutation } from '@tanstack/react-query'
import { respondApproval } from '../lib/api'
import { useChatStore } from '../lib/store'

export function Approvals() {
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
    <div className="flex flex-col gap-2 border-b border-amber-300 bg-amber-50 dark:bg-amber-950 p-3">
      {pendingApprovals.map(approval => (
        <div key={approval.callId} className="flex items-center justify-between gap-3 text-sm">
          <span>
            Approve <strong>{approval.toolName}</strong>
            {approval.reason !== undefined && approval.reason !== '' ? ` — ${approval.reason}` : ''}?
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-green-600 px-2 py-1 text-xs text-white disabled:opacity-50"
              disabled={respond.isPending}
              onClick={() => { respond.mutate({ callId: approval.callId, outcome: 'allowed-once' }) }}
            >
              Allow
            </button>
            <button
              type="button"
              className="rounded bg-red-600 px-2 py-1 text-xs text-white disabled:opacity-50"
              disabled={respond.isPending}
              onClick={() => { respond.mutate({ callId: approval.callId, outcome: 'rejected' }) }}
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
