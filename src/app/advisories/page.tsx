/** `/advisories` — Server Component. The concurrency + security guardrails, and the advisory format. */
export default function AdvisoriesPage() {
  const guards = [
    {
      name: 'Idempotency-Key replay',
      detail: 'A money mutation carries a UUID v4 Idempotency-Key. A repeat of the same key replays the stored result; no second ledger entry is posted.',
      code: '201 Idempotent replay',
    },
    {
      name: 'If-Match version check',
      detail: 'Each loan carries a version; a mutation sends If-Match. A stale version is rejected before any write, so two admins cannot both disburse.',
      code: '409 Conflict (VERSION_MISMATCH)',
    },
    {
      name: 'Replay before version',
      detail: 'The server looks up the Idempotency-Key BEFORE comparing If-Match, so a legitimate retry (which carries the pre-commit version) is never a false 409.',
      code: 'checked by src/features/disbursement/disbursementServer.ts',
    },
    {
      name: 'Compensating-reversal guard',
      detail: 'Only a repayment can be reversed, and only once. The ledger is append-only; a wrong entry is mirrored, never edited.',
      code: 'ALREADY_REVERSED · NOT_REVERSIBLE',
    },
  ]

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">Security &amp; concurrency guardrails</h1>
      <p className="mt-2 max-w-2xl text-slate-600">
        The checks that keep a double-click, a network retry, or two admins from paying a borrower
        twice — plus the sanitized advisory format from FL-02.
      </p>

      <ul className="mt-6 space-y-4">
        {guards.map((g) => (
          <li key={g.name} className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">{g.name}</h2>
            <p className="mt-1 text-sm text-slate-600">{g.detail}</p>
            <p className="mt-2 font-mono text-xs text-accent">{g.code}</p>
          </li>
        ))}
      </ul>

      <aside className="mt-8 rounded-lg border border-dashed border-main/40 bg-white p-6">
        <h2 className="text-lg font-semibold">Sanitized advisory template (FL-02)</h2>
        <p className="mt-2 text-sm text-slate-600">
          The vulnerability-advisory formatter turns verified PoC notes into a 6-section report with zero
          leaked secrets. See <code className="font-mono">docs/FL-02_PROMPTING_FUNDAMENTALS.md</code>. A
          live advisory feed slots in here for later weeks.
        </p>
      </aside>
    </main>
  )
}
