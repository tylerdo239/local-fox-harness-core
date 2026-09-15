import type { Metadata } from 'next'
import { QueryProvider } from '../lib/query-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cordis Agent Core',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
