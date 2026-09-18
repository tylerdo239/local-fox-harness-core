'use client'

// The chat's working directory, shown to the user. Ported in spirit from
// fox-harness-core's WorkspacePanel.tsx (apps/web/src/components/features/
// conversation/), trimmed to what this single-user app actually has: no
// project-shared folder, no per-chat `generated/` split, no upload — one
// directory per chat, listed newest first, each row opening the file.
//
// It earns its place the moment the file tools exist: the agent writes
// ke-hoach.md, says where it put it, and until now nothing outside the agent
// could open it.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react'
import { listWorkspaceFiles, workspaceFileUrl } from '../../../lib/api'
import { useLocale } from '../../../lib/i18n/locale'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function WorkspaceFiles({ sessionId }: { sessionId: string }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  // Re-read on every turn boundary would need the event stream; a poll while the
  // panel is open is enough for a directory one agent writes to.
  const files = useQuery({
    queryKey: ['workspace-files', sessionId],
    queryFn: () => listWorkspaceFiles(sessionId),
    refetchInterval: open ? 5000 : 20000,
    retry: false,
  })

  const list = files.data?.files ?? []
  if (list.length === 0) return null

  return (
    <div className="mx-4 mb-2 rounded-xl border border-border bg-surface">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted hover:text-fg"
        onClick={() => { setOpen(!open) }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <FolderOpen size={14} />
        <span>{t('workspace.title')}</span>
        <span className="ml-auto tabular-nums">{list.length}</span>
      </button>
      {open ? (
        <ul className="m-0 max-h-48 list-none overflow-y-auto border-t border-border p-2">
          {list.map(file => (
            <li key={file.path} className="flex items-center gap-2 px-1 py-1 text-xs">
              <a
                href={workspaceFileUrl(sessionId, file.path)}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-accent-text hover:underline"
              >
                {file.path}
              </a>
              <span className="ml-auto flex-none tabular-nums text-muted">{formatSize(file.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
