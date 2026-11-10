import { SEED_LOANS } from '../../features/disbursement/seedLoans.ts'
import { APPLICANT_PROFILES } from '../../features/scoring/applicants.ts'
import { scoreApplicant } from '../../features/scoring/scoreEngine.ts'
import { StreamingUnderwritingChat } from '../../features/ai-copilot/StreamingUnderwritingChat.tsx'
import { UnderwritingStandalone } from '../../features/scoring/UnderwritingStandalone.tsx'
import { STARTER_PROMPTS, describeEngine } from '../../lib/ai/underwriting-model.ts'

/**
 * The engine label depends on which API key is set, and Vercel env vars can
 * change between deploys, so the page is rendered per request, not at build time.
 */
export const dynamic = 'force-dynamic'

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
    <main className="mx-auto max-w-5xl px-4 py-8">
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
          <div key={stat.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-xs text-slate-500">{stat.label}</dt>
            <dd className="mt-1 font-mono text-lg font-semibold">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-8">
        <StreamingUnderwritingChat starterPrompts={STARTER_PROMPTS} engine={describeEngine()} />
      </div>

      <section className="mt-8 rounded-lg border border-slate-800 bg-slate-950 p-4 text-slate-100">
        <UnderwritingStandalone />
      </section>

    </main>
  )
}
