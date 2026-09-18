'use client'

// UI clone plan Phase C — adapted from example-2's ConnectForm.tsx: no
// email (username instead), no register mode (confirmed decision: single
// fixed admin account, no registration). On success, a full browser
// navigation to `redirectUrl` (auth.ts's bridge — see
// docs/cordis-ui-clone-plan.md §0) completes dsh's own real cookie
// exchange; the page reloads from scratch and the auth-status check in
// page.tsx naturally sees the new cookie.
import { useState } from 'react'
import { login } from '../../../lib/api'
import { useLocale } from '../../../lib/i18n/locale'
import { Button } from '../../primitives/button'
import { Input } from '../../primitives/input'
import { ThemeToggle } from './theme-toggle'
import { LanguageSelect } from '../language-select'

export function LoginForm() {
  const { t } = useLocale()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      const { redirectUrl } = await login(username, password)
      window.location.href = redirectUrl
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-bg p-4">
      <div className="absolute right-5 top-5 flex items-center gap-2">
        <LanguageSelect />
        <ThemeToggle />
      </div>
      <div className="flex w-full max-w-[360px] flex-col gap-5 rounded-2xl border border-border bg-surface p-8 shadow-fh-lv2">
        <div>
          <h1 className="m-0 mb-1.5 text-lg font-semibold text-fg">{t('login.title')}</h1>
          <p className="m-0 text-sm text-muted">{t('login.subtitle')}</p>
        </div>
        <form
          className="flex flex-col gap-3.5"
          onSubmit={(event) => { event.preventDefault(); void handleSubmit() }}
        >
          <Input
            label={t('login.username')}
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(event) => { setUsername(event.target.value) }}
          />
          <Input
            label={t('login.password')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => { setPassword(event.target.value) }}
          />
          <Button variant="primary" type="submit" disabled={busy} className="mt-1 w-full">
            {busy ? t('login.pleaseWait') : t('login.submit')}
          </Button>
          {error !== null ? <span className="text-[0.85em] text-error">{error}</span> : null}
        </form>
      </div>
    </div>
  )
}
