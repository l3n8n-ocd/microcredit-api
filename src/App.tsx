import { useState } from 'react'
import { createDisbursementServer, DisbursementForm, SEED_LOANS } from './features/disbursement/index.ts'

/** Simulated round-trip so the in-flight (disabled, aria-busy) state is visible in the demo. */
const DEMO_LATENCY_MS = 600

export function App() {
  const [server] = useState(() => createDisbursementServer(SEED_LOANS, { latencyMs: DEMO_LATENCY_MS }))

  return (
    <main className="min-h-dvh bg-slate-950 px-4 py-12 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-xs font-semibold tracking-widest text-emerald-400 uppercase">
          Disbursement demo · in-memory mock API
        </p>
        <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">MicroCredit API</h1>
        <p className="mt-2 text-base text-slate-300">
          Loan disbursement that cannot pay a borrower twice: every payout carries an Idempotency-Key and an
          If-Match version.
        </p>
        <DisbursementForm server={server} />
      </div>
    </main>
  )
}
