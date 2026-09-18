'use client'

// UI clone plan Phase G — ported near-verbatim from example-2's locale.tsx.
// One shared Context (not a per-component hook like use-theme.ts): locale
// text needs to update live across every mounted component at once
// (Sidebar, SettingsDialog, LoginForm, ...) when LanguageSelect changes it —
// independent hook instances would mean picking a language does nothing to
// anything already on screen. Default 'vi' regardless of browser language,
// same explicit product decision as the app being cloned.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { en, vi, type Locale, type TranslationKey } from './translations'

const STORAGE_LOCALE = 'cordis/locale'
const DICTS: Record<Locale, Record<TranslationKey, string>> = { vi, en }

function storedLocale(): Locale {
  return localStorage.getItem(STORAGE_LOCALE) === 'en' ? 'en' : 'vi'
}

interface LocaleContextValue {
  locale: Locale
  t: (key: TranslationKey, params?: Record<string, string>) => string
  setLocale: (next: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Same SSR-safety pattern as use-theme.ts's `systemDark`: default value
  // set synchronously (never touches `localStorage` during the initial
  // render, since this component is mounted unconditionally at the root
  // and Next's static export prerender pass would otherwise execute it with
  // no `localStorage` global available), corrected from storage in an
  // effect after mount. Accepts the same brief default -> stored-value
  // flash useTheme.ts already accepts for the same reason — not hidden
  // behind a render gate, which would blank the ENTIRE app (this provider
  // wraps everything) until that effect fires.
  const [locale, setLocaleState] = useState<Locale>('vi')

  useEffect(() => { setLocaleState(storedLocale()) }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  function setLocale(next: Locale): void {
    localStorage.setItem(STORAGE_LOCALE, next)
    setLocaleState(next)
  }

  function t(key: TranslationKey, params?: Record<string, string>): string {
    let text = DICTS[locale][key]
    if (params) {
      for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, value)
    }
    return text
  }

  return <LocaleContext.Provider value={{ locale, t, setLocale }}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (ctx === null) throw new Error('cordis-web: useLocale() called outside <LocaleProvider>')
  return ctx
}
