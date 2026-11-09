import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Portfolio — Lenon D. Adriano',
  description: 'Near-blank portfolio shell: name, LA. monogram, one-line claim, and the 4 section frames ready for build week.',
}

/** The 3 mapped cases (docs/THE_THROUGH_LINE.md), strongest first. Populated in build week. */
const CASES = [
  { n: '01', title: 'MicroCredit API', note: 'Idempotent loan disbursement & integer-centavo ledger' },
  { n: '02', title: 'Node2Shell (CVE-2026-111497)', note: 'Sandboxed reproduction & remediation diff (VulnTech)' },
  { n: '03', title: 'RoadWatch', note: 'Geotagged incident reporting & verification workflow' },
] as const

/**
 * `/portfolio` — "Empty but Live" (Week 4). A Server Component shell in the
 * Identity Kit light theme: name, LA. monogram, the sharpened One-Line Claim,
 * and the 4 content-map frames (hero → flagship-proof → about → act) ready to
 * be filled in build week. It does not touch the `/` capstone demo.
 */
export default function PortfolioPage() {
  return (
    <div className="bg-canvas text-ink">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" width={28} height={28} alt="" aria-hidden="true" />
          <span className="font-semibold">Lenon D. Adriano</span>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-main/40 px-3 py-1 font-mono text-[11px] text-main">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
          WEEK 4 · EMPTY BUT LIVE · READY FOR BUILD
        </span>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-20">
        {/* Hero */}
        <section id="hero" className="border-t border-main/15 py-14 sm:py-20">
          <p className="font-mono text-xs font-semibold tracking-widest text-accent uppercase">Lenon D. Adriano</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
            I build loan disbursement flows that cannot pay a borrower twice.
          </h1>
          <p className="mt-4 max-w-2xl text-slate-600">
            A frontend engineer for Philippine micro-lending: <code className="font-mono">Idempotency-Key</code> +{' '}
            <code className="font-mono">If-Match</code> guards and an integer-centavo double-entry ledger.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <a
              href="/"
              className="rounded-md bg-accent px-5 py-2 font-semibold text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              Fire a duplicate payout in the live sandbox →
            </a>
            <a href="#act" className="font-semibold text-accent underline">
              Book a 15-min walkthrough
            </a>
          </div>
        </section>

        {/* Flagship proof — 3 case frames */}
        <section id="flagship-proof" className="border-t border-main/15 py-12">
          <h2 className="text-sm font-semibold tracking-widest text-main uppercase">Flagship proof</h2>
          <ul className="mt-4 space-y-3">
            {CASES.map((c) => (
              <li key={c.n} className="flex items-baseline gap-4 rounded-lg border border-main/20 p-5">
                <span className="font-mono text-sm text-accent">{c.n}</span>
                <div>
                  <p className="font-semibold">{c.title}</p>
                  <p className="text-sm text-slate-600">{c.note}</p>
                </div>
                <span className="ml-auto font-mono text-xs text-slate-400">case study · build week</span>
              </li>
            ))}
          </ul>
        </section>

        {/* About */}
        <section id="about" className="border-t border-main/15 py-12">
          <h2 className="text-sm font-semibold tracking-widest text-main uppercase">Why I build this way</h2>
          <div className="mt-4 rounded-lg border border-main/20 p-5">
            <p className="font-mono text-sm text-slate-600">
              Voice: &ldquo;Direct, technical, plainspoken, concrete, zero buzzwords.&rdquo;
            </p>
            <p className="mt-2 text-sm text-slate-400">Philosophy + verification strip — build week.</p>
          </div>
        </section>

        {/* Act — the One Action */}
        <section id="act" className="border-t border-main/15 py-12">
          <h2 className="text-sm font-semibold tracking-widest text-main uppercase">The one action</h2>
          <div className="mt-4 rounded-lg border border-main/20 p-5">
            <p className="text-lg font-semibold">Book a 15-minute technical walkthrough.</p>
            <p className="mt-2 text-sm text-slate-600">
              We walk <code className="font-mono">transitionLoan</code>, the replay-before-<code className="font-mono">If-Match</code>{' '}
              check, and the test suite — live, in the repo.
            </p>
            <a
              href="https://github.com/l3n8n-ocd"
              className="mt-4 inline-block font-semibold text-accent underline"
            >
              Reach me through github.com/l3n8n-ocd
            </a>
          </div>
        </section>
      </main>
    </div>
  )
}
