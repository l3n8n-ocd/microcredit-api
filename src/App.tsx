'use client'

import { useCallback, useState } from 'react'
import { createDisbursementServer, DisbursementForm, SAMPLE_PAYOUT, SEED_LOANS } from './features/disbursement/index.ts'
import { UnderwritingWorkbench } from './features/scoring/index.ts'

/** Simulated round-trip so the in-flight (disabled, aria-busy) state is visible in the demo. */
const DEMO_LATENCY_MS = 600

export function App() {
  const [server] = useState(() => createDisbursementServer(SEED_LOANS, { latencyMs: DEMO_LATENCY_MS }))
  // Both panels share one server. Each bumps its own counter after a change, and the other re-reads.
  const [formRevision, setFormRevision] = useState(0)
  const [workbenchRevision, setWorkbenchRevision] = useState(0)
  const bumpForm = useCallback(() => {
    setFormRevision((value) => value + 1)
  }, [])
  const bumpWorkbench = useCallback(() => {
    setWorkbenchRevision((value) => value + 1)
  }, [])

  return (
    <main className="min-h-dvh bg-slate-950 px-4 py-4 text-slate-100 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <p className="hidden font-mono text-xs font-semibold tracking-widest text-emerald-400 uppercase sm:block">
          Disbursement demo · in-memory mock API
        </p>
        <h1 className="text-2xl font-semibold sm:mt-3 sm:text-4xl">MicroCredit API</h1>
        <p className="mt-1.5 text-sm text-slate-300 sm:mt-2 sm:text-base">
          Loan disbursement that cannot pay a borrower twice. Press Disburse, or Simulate a retry.
        </p>
        <DisbursementForm
          server={server}
          initialValues={SAMPLE_PAYOUT}
          revision={workbenchRevision}
          onServerChange={bumpForm}
        />
        <UnderwritingWorkbench
          server={server}
          revision={formRevision}
          onServerChange={bumpWorkbench}
        />
      </div>
    </main>
  )
}
