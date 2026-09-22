'use client'

// Minimal toast stack — no toast primitive existed in this app before
// model-picker.tsx needed one ("bấm model OpenRouter chưa cấu hình key thì
// báo lỗi toast"). Mounted once at AppFrame's root (page.tsx), fed by
// useChatStore's toasts/pushToast/dismissToast — any component can push
// without prop drilling, same reasoning as settingsRequestId in store.ts.
import { useEffect } from 'react'
import { useChatStore } from '../../lib/store'

const AUTO_DISMISS_MS = 4000

function ToastItem({ id, message }: { id: number; message: string }) {
  const dismissToast = useChatStore(state => state.dismissToast)

  useEffect(() => {
    const timer = setTimeout(() => { dismissToast(id) }, AUTO_DISMISS_MS)
    return () => { clearTimeout(timer) }
  }, [id, dismissToast])

  return (
    <div
      role="status"
      className="pointer-events-auto rounded-xl border border-border bg-bg px-4 py-2.5 text-sm text-fg shadow-fh-lv3"
    >
      {message}
    </div>
  )
}

export function ToastHost() {
  const toasts = useChatStore(state => state.toasts)
  if (toasts.length === 0) return null

  // top-4, not bottom — the composer (chat input) already docks at the
  // bottom of the screen (see composer.tsx's own container), so a
  // bottom-anchored toast rose up through/behind it. Top-center is clear of
  // every other fixed-position chrome this app has.
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[1200] flex flex-col items-center gap-2">
      {toasts.map(toast => <ToastItem key={toast.id} id={toast.id} message={toast.message} />)}
    </div>
  )
}
