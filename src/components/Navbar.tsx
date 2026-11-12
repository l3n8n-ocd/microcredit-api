'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** The 5 routed screens defined in SPEC.md. */
const NAV_LINKS = [
  { href: '/', label: 'Disburse' },
  { href: '/underwriting', label: 'Underwriting' },
  { href: '/ledger', label: 'Ledger' },
  { href: '/advisories', label: 'Advisories' },
  { href: '/health', label: 'Health' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/playground', label: 'Playground' },
] as const

/**
 * Responsive top nav. A single slim row that scrolls inside itself on narrow
 * phones, so the page never scrolls sideways at 375px. The active route gets an
 * emerald underline (Verification Emerald, the one accent that means "here").
 */
export function Navbar() {
  const pathname = usePathname()
  return (
    <header className="border-b border-slate-200 bg-canvas">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-12 max-w-5xl items-center gap-4 overflow-x-auto px-4 whitespace-nowrap"
      >
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold" aria-label="MicroCredit API home">
          <img src="/favicon.svg" width={24} height={24} alt="" aria-hidden="true" />
          <span className="text-sm">MicroCredit API</span>
        </Link>
        <ul className="flex items-center gap-1 text-sm">
          {/* Quick launch for the FE-06 chat. An in-page anchor, so it is never the "current page". */}
          <li>
            <Link
              href="/underwriting#copilot"
              className="flex items-center gap-1.5 rounded-full border border-main px-2.5 py-0.5 font-semibold text-ink transition-colors hover:bg-slate-100"
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
              AI Copilot
            </Link>
          </li>
          {NAV_LINKS.map((link) => {
            const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href)
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={`block border-b-2 px-2 py-1 transition-colors ${
                    active
                      ? 'border-accent font-semibold text-ink'
                      : 'border-transparent text-slate-500 hover:text-ink'
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </header>
  )
}
