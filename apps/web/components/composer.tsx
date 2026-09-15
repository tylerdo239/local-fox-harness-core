'use client'

import { useMutation } from '@tanstack/react-query'
import { interruptSession, sendMessage } from '../lib/api'
import { useChatStore } from '../lib/store'

export function Composer({ sessionId }: { sessionId: string }) {
  const composerText = useChatStore(state => state.composerText)
  const setComposerText = useChatStore(state => state.setComposerText)

  const send = useMutation({
    mutationFn: (text: string) => sendMessage(sessionId, text),
    onSuccess: () => { setComposerText('') },
  })
  const interrupt = useMutation({ mutationFn: () => interruptSession(sessionId) })

  const submit = (): void => {
    const text = composerText.trim()
    if (text === '' || send.isPending) return
    send.mutate(text)
  }

  return (
    <div className="flex flex-col gap-1 border-t border-neutral-200 dark:border-neutral-800 p-3">
      <div className="flex gap-2">
        <textarea
          className="flex-1 resize-none rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
          rows={2}
          placeholder="Message the agent…"
          value={composerText}
          onChange={(event) => { setComposerText(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            disabled={send.isPending}
            onClick={submit}
          >
            Send
          </button>
          <button
            type="button"
            className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={interrupt.isPending}
            onClick={() => { interrupt.mutate() }}
          >
            Stop
          </button>
        </div>
      </div>
      {send.isError ? <p className="text-xs text-red-600">{(send.error as Error).message}</p> : null}
    </div>
  )
}
