'use client'

// UI clone plan Phase B — matches example-2's real .fh-menu-item rules:
// icon + label flat row, full-width, hover background. `popup` (account
// menu) and `nav` (settings rail) keep their real, deliberately different
// padding/radius/font-size instead of being forced to match.
import type { ComponentPropsWithoutRef } from 'react'

const VARIANT_CLASSES = {
  popup: 'w-full rounded-lg px-[0.6em] text-[0.85em]',
  nav: 'rounded-[10px] px-3 text-[0.9em]',
} as const

export function MenuItem({
  variant,
  active,
  className,
  ...rest
}: ComponentPropsWithoutRef<'button'> & { variant: keyof typeof VARIANT_CLASSES; active?: boolean }) {
  return (
    <button
      {...rest}
      type="button"
      className={`flex h-9 items-center gap-2.5 border-none bg-transparent text-left text-fg hover:bg-bg-hover ${VARIANT_CLASSES[variant]}${active === true ? ' bg-bg-hover font-semibold' : ''}${className ? ` ${className}` : ''}`}
    />
  )
}
