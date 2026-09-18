'use client'

// UI clone plan Phase B — matches example-2's real .fh-icon-btn rules
// (28px bordered circle by default, 16px/4px-radius square "sm" variant,
// "plain" drops the border and starts muted, brightening to fg on hover).
import type { ComponentPropsWithoutRef } from 'react'

const SIZE_CLASSES = {
  md: 'h-7 w-7 rounded-full',
  sm: 'h-4 w-4 rounded',
} as const

const VARIANT_CLASSES = {
  bordered: 'border border-border text-fg',
  plain: 'border-none text-muted hover:text-fg',
} as const

export function IconButton({
  size = 'md',
  variant = 'bordered',
  className,
  ...rest
}: ComponentPropsWithoutRef<'button'> & { size?: keyof typeof SIZE_CLASSES; variant?: keyof typeof VARIANT_CLASSES }) {
  return (
    <button
      {...rest}
      type="button"
      className={`inline-flex items-center justify-center bg-transparent p-0 transition-colors duration-100 ease-fh hover:bg-bg-hover ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]}${className ? ` ${className}` : ''}`}
    />
  )
}
