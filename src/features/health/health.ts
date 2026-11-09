import { toCentavos } from '../../utils/money.ts'
// Import the pure modules directly, not the feature barrels: the barrels also
// re-export 'use client' components, which must not enter a server graph.
import { buildDisbursementJournal, journalTotals } from '../disbursement/ledger.ts'
import { LEGAL_TRANSITIONS } from '../disbursement/loanStateMachine.ts'
import type { LoanOf } from '../disbursement/types.ts'
import { splitRepayment } from '../scoring/scoreEngine.ts'

export interface HealthReport {
  readonly status: 'healthy'
  readonly timestamp: string
  readonly runtime: { readonly node: string; readonly nextRuntime: string }
  readonly domain: {
    readonly integerUnit: 'Centavos'
    /** A real journal built from domain code balances: Σ debits === Σ credits. */
    readonly debitsEqualCredits: boolean
    /** A ₱1,050.00 repayment splits with no lost centavo: principal + interest === total. */
    readonly repaymentSplitExact: boolean
    readonly supportedStates: number
  }
  /** Whether optional env vars are configured. Booleans only — never the value. */
  readonly env: Readonly<Record<string, boolean>>
}

const SAMPLE_APPROVED: LoanOf<'APPROVED'> = {
  id: 'HEALTH-CHECK',
  borrowerId: 'health-probe',
  version: 1,
  status: 'APPROVED',
}

/** Runs the ledger and split invariants against real domain functions and reports the result. */
export function getHealthReport(): HealthReport {
  const journal = buildDisbursementJournal({
    id: 'JE-HEALTH',
    loan: SAMPLE_APPROVED,
    amount: toCentavos(500_000),
    provider: 'gcash',
    idempotencyKey: '00000000-0000-4000-8000-000000000000',
  })
  const { principal, interest } = splitRepayment(toCentavos(105_000))

  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    runtime: { node: process.version, nextRuntime: process.env.NEXT_RUNTIME ?? 'nodejs' },
    domain: {
      integerUnit: 'Centavos',
      debitsEqualCredits: journalTotals(journal.lines).balanced,
      repaymentSplitExact: principal + interest === 105_000,
      supportedStates: Object.keys(LEGAL_TRANSITIONS).length,
    },
    env: {
      NEXT_PUBLIC_APP_ENV: Boolean(process.env.NEXT_PUBLIC_APP_ENV),
      NEXT_PUBLIC_APP_URL: Boolean(process.env.NEXT_PUBLIC_APP_URL),
      ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
      WEBHOOK_HMAC_SECRET: Boolean(process.env.WEBHOOK_HMAC_SECRET),
    },
  }
}
