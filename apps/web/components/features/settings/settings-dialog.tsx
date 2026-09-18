'use client'

// UI clone plan Phase E — visual shell adapted from example-2's real
// SettingsDialog.tsx (mask + centered panel, left nav rail switching
// tabs) — dimensions/radius/shadow match its real .fh-settings-* CSS
// exactly (720x520 capped panel, 180px nav rail, 24px radius, shadow-lv3).
// "Account" tab is new (Phase A's admin password change, reusing the
// generic /api/v1/credentials route from Phase 4 — no new backend needed).
//
// Đợt 6 — the generic "Model & credentials" tab (settings-models.tsx) was
// removed entirely, not just filtered: the default model is now a fixed,
// operator-set value (hard-coded via the credentials/model REST API at
// deploy time, see docs/cordis-ui-clone-plan.md's Đợt 6 §1), so there is
// nothing for an end user to pick here. The admin password still lives
// under Account, unaffected.
//
// 2026-09-18 — the model's own API key is back in this tab, as one more
// CredentialField. Removing the model PICKER was right (an end user has no
// business choosing the route), but it also took away the only place to store
// the key that route needs: on a fresh deploy the app boots, logs in and
// accepts a message, then every turn dies with MISSING_CREDENTIAL and nothing
// in the UI can fix it or even say where to go. Found by deploying this repo
// from scratch. The key stays write-only here, same as Serper's.
//
// Đợt 16 — the standalone "Web search" tab (Serper only) merged into a
// broader "Config" tab: user request, grouping Serper alongside n8n's own
// API key + webhook secret since all three are the same shape of thing
// (an external service's "set once at first start" secret, exactly like
// Serper already was) rather than scattering them across tabs.
import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, KeyRound, LogOut, Moon, Palette, Settings as ConfigIcon, Sun } from 'lucide-react'
import { listCredentials, setCredential, unsetCredential } from '../../../lib/api'
import { useLocale } from '../../../lib/i18n/locale'
import { IconButton } from '../../primitives/icon-button'
import { MenuItem } from '../../primitives/menu-item'
import { SelectableCard } from '../../primitives/selectable-card'
import { Button } from '../../primitives/button'
import { Input } from '../../primitives/input'
import { useTheme } from '../../../lib/use-theme'
import { LanguageSelect } from '../language-select'

type Tab = 'general' | 'config' | 'account'

// One credential field, reused for Serper/n8n below instead of tripling the
// same save/remove/status plumbing WebSearchTab used to have on its own.
//
// Đợt 19 — user request: once a credential is already configured, don't
// show a blank input sitting there by default (looks like it needs
// re-entering, and invites accidentally overwriting a working value) —
// collapse to a status line + "Thay đổi" (Change) button instead; only
// clicking it reveals the input + Lưu (Save) + Huỷ (Cancel). A never-
// configured field has no "collapsed" state to show, so it always renders
// the input directly (same as before this change).
function CredentialField({
  refName, title, hint, placeholder,
}: { refName: string; title: string; hint?: ReactNode; placeholder: string }) {
  const { t } = useLocale()
  const queryClient = useQueryClient()
  const credentials = useQuery({ queryKey: ['credentials'], queryFn: listCredentials })
  const credential = credentials.data?.credentials.find(entry => entry.ref === refName)
  const isConfigured = credential?.configured === true
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)

  const save = useMutation({
    mutationFn: () => setCredential(refName, value),
    onSuccess: () => {
      setValue('')
      setEditing(false)
      void queryClient.invalidateQueries({ queryKey: ['credentials'] })
    },
  })
  const remove = useMutation({
    mutationFn: () => unsetCredential(refName),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['credentials'] }) },
  })

  const showInput = !isConfigured || editing

  return (
    <div className="flex flex-col gap-2 border-b border-border pb-4 last:border-none last:pb-0">
      <div>
        <div className="mb-1 text-sm font-semibold text-fg">{title}</div>
        {hint !== undefined ? <p className="m-0 text-xs text-muted">{hint}</p> : null}
      </div>
      <span className={`text-xs ${isConfigured ? 'text-status-success' : 'text-muted'}`}>
        {isConfigured ? t('settings.configFieldConfigured') : t('settings.configFieldNotConfigured')}
      </span>
      {showInput ? (
        <Input
          type="password"
          placeholder={placeholder}
          value={value}
          onChange={(event) => { setValue(event.target.value) }}
        />
      ) : null}
      <div className="flex gap-2">
        {showInput ? (
          <>
            <Button variant="primary" className="self-start" disabled={value === '' || save.isPending} onClick={() => { save.mutate() }}>
              {t('skills.save')}
            </Button>
            {isConfigured ? (
              <Button variant="outline" className="self-start" onClick={() => { setValue(''); setEditing(false) }}>
                {t('settings.configFieldCancel')}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="outline" className="self-start" onClick={() => { setEditing(true) }}>
              {t('settings.configFieldChange')}
            </Button>
            <Button variant="outline" className="self-start" disabled={remove.isPending} onClick={() => { remove.mutate() }}>
              {t('models.remove')}
            </Button>
          </>
        )}
      </div>
      {save.isError ? <span className="text-[0.85em] text-error">{(save.error as Error).message}</span> : null}
    </div>
  )
}

function ConfigTab() {
  const { t } = useLocale()
  return (
    <div className="flex flex-col gap-4">
      <CredentialField
        refName="OPENAI_API_KEY"
        title={t('settings.modelKeyTitle')}
        hint={t('settings.modelKeyHint')}
        placeholder={t('settings.modelKeyPlaceholder')}
      />
      <CredentialField
        refName="OPENAI_BASE_URL"
        title={t('settings.modelBaseUrlTitle')}
        hint={t('settings.modelBaseUrlHint')}
        placeholder={t('settings.modelBaseUrlPlaceholder')}
      />
      <CredentialField
        refName="SERPER_API_KEY"
        title={t('settings.webSearchTitle')}
        hint={(
          <>
            {t('settings.webSearchHint')}{' '}
            <a href="https://serper.dev" target="_blank" rel="noopener noreferrer" className="text-accent-text underline">
              serper.dev
            </a>
          </>
        )}
        placeholder={t('settings.webSearchPlaceholder')}
      />
      <CredentialField
        refName="N8N_API_KEY"
        title={t('settings.n8nApiKeyTitle')}
        hint={t('settings.n8nApiKeyHint')}
        placeholder={t('settings.n8nApiKeyPlaceholder')}
      />
      <CredentialField
        refName="N8N_WEBHOOK_SECRET"
        title={t('settings.n8nWebhookSecretTitle')}
        hint={t('settings.n8nWebhookSecretHint')}
        placeholder={t('settings.n8nWebhookSecretPlaceholder')}
      />
    </div>
  )
}

function GeneralTab() {
  const { theme, setTheme } = useTheme()
  const { t } = useLocale()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-2.5 text-sm font-semibold text-fg">{t('settings.theme')}</div>
        <div className="flex gap-3">
          <SelectableCard active={theme === 'light'} onClick={() => { setTheme('light') }}>
            <Sun size={18} />
            {t('settings.themeLight')}
          </SelectableCard>
          <SelectableCard active={theme === 'dark'} onClick={() => { setTheme('dark') }}>
            <Moon size={18} />
            {t('settings.themeDark')}
          </SelectableCard>
        </div>
      </div>
      <div>
        <div className="mb-2.5 text-sm font-semibold text-fg">{t('language.label')}</div>
        <LanguageSelect />
      </div>
    </div>
  )
}

function AccountTab({ onLogout }: { onLogout: () => void }) {
  const { t } = useLocale()
  const [newPassword, setNewPassword] = useState('')
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined)
  const changePassword = useMutation({
    mutationFn: () => setCredential('ADMIN_PASSWORD', newPassword),
    onSuccess: () => { setNewPassword(''); setSavedAt(Date.now()) },
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-2.5 text-sm font-semibold text-fg">{t('settings.changePassword')}</div>
        <div className="flex flex-col gap-2">
          <Input
            type="password"
            placeholder={t('settings.newPasswordPlaceholder')}
            value={newPassword}
            onChange={(event) => { setNewPassword(event.target.value) }}
          />
          <Button
            variant="outline"
            className="self-start"
            disabled={newPassword === '' || changePassword.isPending}
            onClick={() => { changePassword.mutate() }}
          >
            <KeyRound size={15} />
            {t('settings.savePassword')}
          </Button>
          {changePassword.isError ? <span className="text-[0.85em] text-error">{(changePassword.error as Error).message}</span> : null}
          {savedAt !== undefined && !changePassword.isError ? <span className="text-[0.85em] text-status-success">{t('settings.passwordUpdated')}</span> : null}
        </div>
      </div>
      <div className="flex justify-end border-t border-border pt-4">
        <Button variant="outline" onClick={onLogout}>
          <LogOut size={15} />
          {t('settings.logout')}
        </Button>
      </div>
    </div>
  )
}

export function SettingsDialog({ open, onClose, onLogout }: { open: boolean; onClose: () => void; onLogout: () => void }) {
  const { t } = useLocale()
  const [tab, setTab] = useState<Tab>('general')

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-overlay-mask backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-label={t('settings.title')}
        className="relative flex h-[min(520px,80vh)] w-[min(720px,92vw)] flex-col rounded-3xl border border-border bg-bg shadow-fh-lv3"
      >
        <div className="flex flex-none items-center justify-between border-b border-border px-4 py-3">
          <h2 className="m-0 text-lg font-medium text-fg">{t('settings.title')}</h2>
          <IconButton variant="plain" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[180px] flex-none flex-col gap-0.5 border-r border-border p-3">
            <MenuItem variant="nav" active={tab === 'general'} onClick={() => { setTab('general') }}>
              <Palette size={16} />
              {t('settings.generalTab')}
            </MenuItem>
            <MenuItem variant="nav" active={tab === 'config'} onClick={() => { setTab('config') }}>
              <ConfigIcon size={16} />
              {t('settings.configTab')}
            </MenuItem>
            <MenuItem variant="nav" active={tab === 'account'} onClick={() => { setTab('account') }}>
              <KeyRound size={16} />
              {t('settings.accountTab')}
            </MenuItem>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {tab === 'general' ? <GeneralTab /> : null}
            {tab === 'config' ? <ConfigTab /> : null}
            {tab === 'account' ? <AccountTab onLogout={onLogout} /> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
