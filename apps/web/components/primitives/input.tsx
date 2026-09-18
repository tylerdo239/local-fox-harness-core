'use client'

// UI clone plan Phase B — matches example-2's real input[type=...] rule
// (34px height, 8px radius, border-color-only focus ring, no browser glow).
import { forwardRef, type ComponentPropsWithoutRef } from 'react'

const INPUT_CLASSES = 'h-[34px] w-full rounded-lg border border-border bg-bg px-[0.7em] text-fg outline-none transition-colors duration-100 ease-fh focus:border-accent'

export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'> & { label?: string }>(
  function Input({ label, className, ...rest }, ref) {
    const input = <input {...rest} ref={ref} className={`${INPUT_CLASSES}${className ? ` ${className}` : ''}`} />
    if (label === undefined) return input
    return (
      <label className="flex flex-col gap-1.5 text-[0.8em] text-muted">
        {label}
        {input}
      </label>
    )
  },
)
