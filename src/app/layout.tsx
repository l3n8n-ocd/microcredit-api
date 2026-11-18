import './globals.css'
import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import type { ReactNode } from 'react'
import { Navbar } from '../components/Navbar.tsx'

// Self-hosted (docs/IDENTITY_KIT.md): next build cannot reach Google Fonts here or in CI,
// and a low-end Android phone on a slow network downloads these from our own origin.
const plusJakarta = localFont({
  src: [
    { path: './fonts/plus-jakarta-sans-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/plus-jakarta-sans-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/plus-jakarta-sans-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/plus-jakarta-sans-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-plus-jakarta',
  display: 'swap',
})

const jetbrains = localFont({
  src: [
    { path: './fonts/jetbrains-mono-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/jetbrains-mono-500.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-jetbrains',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'MicroCredit API — Idempotent Disbursement & Alternative-Data Underwriting',
  description: 'Loan disbursement flows that cannot pay a borrower twice: Idempotency-Key + If-Match guards and an integer-centavo double-entry ledger.',
  icons: { icon: '/favicon.svg' },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        {/* FE-10: the first Tab stop, parked above the viewport until focused. Every route's <main> is id="main-content" tabIndex={-1}, so focus lands inside it. */}
        <a
          href="#main-content"
          className="fixed top-2 left-2 z-50 -translate-y-24 rounded-md bg-main px-4 py-3 text-sm font-semibold text-white focus:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Skip to main content
        </a>
        <Navbar />
        {children}
        <footer className="border-t border-slate-200 bg-canvas px-4 py-6 text-sm text-slate-700">
          <p className="mx-auto max-w-5xl">
            MicroCredit API ·{' '}
            <a className="font-semibold text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href="https://github.com/l3n8n-ocd/microcredit-api">
              Source on GitHub
            </a>{' '}
            ·{' '}
            <a className="font-semibold text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href="https://github.com/l3n8n-ocd/microcredit-api/blob/main/AUDIT.md">
              Accessibility &amp; performance audit
            </a>
          </p>
        </footer>
      </body>
    </html>
  )
}
