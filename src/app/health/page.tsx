import { headers } from 'next/headers'
import type { HealthReport } from '../../features/health/health.ts'

// Fetches live telemetry per request; never prerendered.
export const dynamic = 'force-dynamic'

interface Loaded {
  readonly ok: true
  readonly report: HealthReport
  readonly latencyMs: number
  readonly httpStatus: number
}
interface Failed {
  readonly ok: false
  readonly message: string
}

async function loadHealth(): Promise<Loaded | Failed> {
  try {
    const h = await headers()
    const host = h.get('host') ?? 'localhost:3000'
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
    const started = Date.now()
    const res = await fetch(`${proto}://${host}/api/health`, { cache: 'no-store' })
    const latencyMs = Date.now() - started
    const report = (await res.json()) as HealthReport
    return { ok: true, report, latencyMs, httpStatus: res.status }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'health fetch failed' }
  }
}

export default async function HealthPage() {
  const result = await loadHealth()

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-3xl font-bold tracking-tight">System health</h1>
        <p role="alert" className="mt-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-rose-800">
          Could not reach <code className="font-mono">/api/health</code>: {result.message}
        </p>
      </main>
    )
  }

  const { report, latencyMs, httpStatus } = result
  const invariants: readonly { label: string; pass: boolean; value: string }[] = [
    { label: 'Integer unit is Centavos', pass: report.domain.integerUnit === 'Centavos', value: report.domain.integerUnit },
    { label: 'Σ debits === Σ credits (ledger self-test)', pass: report.domain.debitsEqualCredits, value: String(report.domain.debitsEqualCredits) },
    { label: 'Repayment split loses no centavo', pass: report.domain.repaymentSplitExact, value: String(report.domain.repaymentSplitExact) },
    { label: '10-state transition table', pass: report.domain.supportedStates === 10, value: `${report.domain.supportedStates} states` },
  ]

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">System health</h1>
      <p className="mt-2 text-slate-600">
        This Server Component fetches <code className="font-mono">/api/health</code> on every request and
        renders the live result.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-accent px-3 py-1 font-mono text-sm font-semibold text-canvas">
          {httpStatus} OK · {report.status.toUpperCase()}
        </span>
        <span className="font-mono text-sm text-slate-500">latency {latencyMs}ms</span>
        <span className="font-mono text-xs text-slate-500">{report.timestamp}</span>
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
          {invariants.map((row) => (
            <tr key={row.label} className="border-t border-slate-200">
              <td className="py-1 pr-3">{row.label}</td>
              <td className="py-1 pr-3 font-mono">{row.value}</td>
              <td className="py-1 font-mono">
                <span className={row.pass ? 'text-accent' : 'text-rose-600'}>{row.pass ? '✓ pass' : '✗ fail'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-8 text-lg font-semibold">Environment variable structure</h2>
      <p className="mt-1 text-sm text-slate-600">Configured flags only. No value is ever read or shown.</p>
      <table className="mt-3 w-full text-left font-mono text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1 pr-3">Variable</th>
            <th className="py-1">Configured</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(report.env).map(([key, configured]) => (
            <tr key={key} className="border-t border-slate-200">
              <td className="py-1 pr-3">{key}</td>
              <td className="py-1">{configured ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">node {report.runtime.node} · runtime {report.runtime.nextRuntime}</p>
    </main>
  )
}
