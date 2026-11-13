import { SkeletonCard } from '../../components/ui/SkeletonCard.tsx'

/**
 * FE-08: shown while `/health` awaits its server-side `fetch('/api/health')`.
 * The invariant table keeps its real header and gets one `ledger-row`
 * skeleton per check (same `LEDGER_ROW_CLASS` / `LEDGER_CELL_CLASS` as the
 * real rows), so the rows land where the skeletons were.
 */
export default function HealthLoading() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8" aria-busy="true">
      <p role="status" className="sr-only">
        Checking system health.
      </p>
      <h1 className="text-3xl font-bold tracking-tight">System health</h1>
      <p className="mt-2 text-slate-600">
        This Server Component fetches <code className="font-mono">/api/health</code> on every request and renders
        the live result.
      </p>

      <div aria-hidden="true" className="mt-6 flex flex-wrap items-center gap-3">
        <span className="block h-7 w-36 rounded-full bg-slate-200" />
        <span className="block h-5 w-24 rounded bg-slate-200" />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Domain invariant verification</h2>
      <table className="mt-3 w-full text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1 pr-3">Check</th>
            <th className="py-1 pr-3">Result</th>
            <th className="py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3].map((index) => (
            <SkeletonCard key={index} variant="ledger-row" columns={3} />
          ))}
        </tbody>
      </table>
    </main>
  )
}
