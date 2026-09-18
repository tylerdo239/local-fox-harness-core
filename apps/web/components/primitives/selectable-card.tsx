'use client'

// UI clone plan Phase B — matches example-2's real .fh-selectable-card rule
// (a bordered card, icon stacked above the label, active state highlights
// with the accent border) — used by the theme/light-dark picker.
import type { ComponentPropsWithoutRef } from 'react'

export function SelectableCard({
  active,
  className,
  ...rest
}: ComponentPropsWithoutRef<'button'> & { active?: boolean }) {
  return (
    <button
      {...rest}
      type="button"
      className={`flex min-h-[92px] flex-1 flex-col items-center justify-center gap-2 rounded-xl border bg-transparent p-4 text-[0.85em] text-fg hover:bg-bg-hover ${active === true ? 'border-accent bg-bg-hover' : 'border-border'}${className ? ` ${className}` : ''}`}
    />
  )
}
