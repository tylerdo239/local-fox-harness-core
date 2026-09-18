'use client'

// UI clone plan Phase B — visual values (heights/radii/padding) match
// example-2's real style.css button rules exactly (`.fh-btn-*`), rebuilt as
// Tailwind classes against our own tokens instead of ported CSS classes.
import type { ComponentPropsWithoutRef } from 'react'

const VARIANT_CLASSES = {
  // Base `button {}` rule in their stylesheet: accent fill, 34px, 12px
  // radius — `.fh-btn-primary` only adds the pill shape + wider padding on
  // top of that base.
  primary: 'h-[34px] rounded-full border border-accent bg-accent px-[1.3em] text-accent-contrast disabled:opacity-40',
  raised: 'h-[38px] rounded-full border border-border bg-bg-raised px-4 text-sm font-medium text-fg transition-colors duration-100 ease-fh hover:bg-bg-hover disabled:opacity-40',
  outline: 'h-[34px] rounded-full border border-border bg-transparent px-4 text-[0.85em] text-fg transition-colors duration-100 ease-fh hover:bg-bg-hover disabled:opacity-40',
  link: 'h-7 rounded-[14px] border-none bg-transparent px-2.5 text-[0.85em] text-accent-text hover:underline disabled:opacity-40',
} as const

export function Button({
  variant,
  className,
  type = 'button',
  ...rest
}: ComponentPropsWithoutRef<'button'> & { variant: keyof typeof VARIANT_CLASSES }) {
  return (
    <button
      {...rest}
      type={type}
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 ${VARIANT_CLASSES[variant]}${className ? ` ${className}` : ''}`}
    />
  )
}
