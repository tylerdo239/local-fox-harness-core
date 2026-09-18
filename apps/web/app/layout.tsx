import type { Metadata } from 'next'
import { QueryProvider } from '../lib/query-provider'
import { LocaleProvider } from '../lib/i18n/locale'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fox Harness',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LocaleProvider>
          <QueryProvider>{children}</QueryProvider>
        </LocaleProvider>
      </body>
    </html>
  )
}
