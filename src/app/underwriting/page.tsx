import { SEED_LOANS } from '../../features/disbursement/seedLoans.ts'
import { APPLICANT_PROFILES } from '../../features/scoring/applicants.ts'
import { scoreApplicant } from '../../features/scoring/scoreEngine.ts'
import { UnderwritingStandalone } from '../../features/scoring/UnderwritingStandalone.tsx'

/** `/underwriting` — Server Component header + metrics, then the interactive workbench island. */
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

      <section className="mt-8 rounded-lg border border-slate-800 bg-slate-950 p-4 text-slate-100">
        <UnderwritingStandalone />
      </section>

      <aside className="mt-8 rounded-lg border border-dashed border-main/40 bg-white p-6">
        <h2 className="text-lg font-semibold">AI Underwriting Copilot — planned (FE-06 / FE-07)</h2>
        <p className="mt-2 text-sm text-slate-600">
          A server route will stream an explainable rationale for each trust score and suggest reason
          codes, using a tool-use call to the scoring engine. Keys stay server-side
          (<code className="font-mono">ANTHROPIC_API_KEY</code>, see <code className="font-mono">.env.example</code>).
          Not built yet.
        </p>
      </aside>
    </main>
  )
}
