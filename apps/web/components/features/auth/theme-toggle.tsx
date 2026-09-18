'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../../lib/use-theme'
import { useLocale } from '../../../lib/i18n/locale'
import { IconButton } from '../../primitives/icon-button'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const { t } = useLocale()

  return (
    <IconButton onClick={toggle} title={theme === 'light' ? t('theme.switchToDark') : t('theme.switchToLight')}>
      {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
    </IconButton>
  )
}
