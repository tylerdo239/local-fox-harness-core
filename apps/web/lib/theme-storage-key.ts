// Split out of use-theme.ts (real build failure hit importing that file
// directly, "use client" hooks and all, from app/layout.tsx's server
// component — Next.js correctly refuses to bundle React hooks into
// server-rendered code). This one constant has no such dependency, so both
// use-theme.ts (the client-side toggle) and layout.tsx (the pre-hydration
// inline script that reads the same key) import it from here instead of
// duplicating the literal.
export const STORAGE_THEME = 'cordis/theme'
