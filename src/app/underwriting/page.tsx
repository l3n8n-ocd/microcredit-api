import { STAT_CARD_CLASS } from '../../components/ui/SkeletonCard.tsx'
import { SEED_LOANS } from '../../features/disbursement/seedLoans.ts'
import { APPLICANT_PROFILES } from '../../features/scoring/applicants.ts'
import { scoreApplicant } from '../../features/scoring/scoreEngine.ts'
import { StreamingUnderwritingChat } from '../../features/ai-copilot/StreamingUnderwritingChat.tsx'
import { UnderwritingStandalone } from '../../features/scoring/UnderwritingStandalone.tsx'
import { STARTER_PROMPTS, TOOL_PROMPTS, describeEngine } from '../../lib/ai/underwriting-model.ts'

/**
 * Static, with no loading.tsx (FE-10). The engine label depends on which API key is set; a changed
 * Vercel env var only takes effect in a new deployment, which rebuilds this page, so prerendering
 * shows the same label a per-request render did.
 *
 * Until FE-10 the page was `force-dynamic` with a `loading.tsx` skeleton. Next.js sent the skeleton
 * first and swapped the real page in from later in the HTML, and on a throttled phone that swap
 * delayed the LCP paragraph by ~400 ms (Lighthouse LCP ~3.2 s instead of ~0.76 s in 3 of 7 runs).
 */

/**
 * `/underwriting` — Server Component header + metrics, then two client islands:
 * the AI Copilot chat (FE-06) and the scoring workbench.
 *
 * The starter prompts and the engine label come from the server-only model
 * module and cross to the client as plain props. The API key never does.
 */
export default function UnderwritingPage() {
  const scores = APPLICANT_PROFILES.map((profile) => scoreApplicant(profile.signals).score)
  const avg = scores.length === 0 ? 0 : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  const underReview = SEED_LOANS.filter((loan) => loan.status === 'UNDER_REVIEW').length
  const applied = SEED_LOANS.filter((loan) => loan.status === 'APPLIED').length

  return (
    <main id="main-content" tabIndex={-1} className="focus:outline-none mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">Alternative-data underwriting</h1>
      <p className="mt-2 max-w-2xl text-slate-600">
        Score three alt-data signals (utility bills, supplier invoices, GCash/Maya load cadence) to a
        0–1000 trust score, then move a loan <code className="font-mono">APPLIED → UNDER_REVIEW → APPROVED</code>{' '}
        or <code className="font-mono">REJECTED</code>. An approved offer feeds the Disburse queue.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Applicants scored', value: String(APPLICANT_PROFILES.length) },
          { label: 'Average trust score', value: `${avg} / 1000` },
          { label: 'Awaiting review', value: String(applied + underReview) },
          { label: 'Score signals', value: '3' },
        ].map((stat) => (
          <div key={stat.label} className={STAT_CARD_CLASS}>
            <dt className="text-xs text-slate-600">{stat.label}</dt>
            <dd className="mt-1 font-mono text-lg font-semibold">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-8">
        <StreamingUnderwritingChat starterPrompts={STARTER_PROMPTS} toolPrompts={TOOL_PROMPTS} engine={describeEngine()} />
      </div>

      <section className="mt-8 rounded-lg border border-slate-800 bg-slate-950 p-4 text-slate-100">
        <UnderwritingStandalone />
      </section>

    </main>
  )
}
