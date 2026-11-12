import { buildDisbursementJournal, journalTotals } from '../src/features/disbursement/ledger.ts'
import { LEGAL_TRANSITIONS } from '../src/features/disbursement/loanStateMachine.ts'
import type { LoanOf, LoanStatus } from '../src/features/disbursement/types.ts'
import { formatPHP, toCentavos } from '../src/utils/money.ts'

/**
 * Tab panel content, shared by the hand-built Tabs and the shadcn/ui Tabs.
 * Every fact is read from the app's own modules, so the playground cannot
 * drift from the state machine or the ledger.
 */

const STATES = Object.keys(LEGAL_TRANSITIONS) as LoanStatus[]

export function LifecyclePanel() {
  return (
    <>
      <p>
        A loan is one discriminated union of {STATES.length} states. An event that is not listed for a state returns a
        typed <code className="font-mono">409 ILLEGAL_TRANSITION</code>.
      </p>
      <ul className="mt-3 space-y-1">
        {STATES.map((state) => {
          const events = LEGAL_TRANSITIONS[state]
          return (
            <li key={state}>
              <code className="font-mono">{state}</code>: {events.length === 0 ? 'terminal' : events.join(', ')}
            </li>
          )
        })}
      </ul>
    </>
  )
}

const SAMPLE_LOAN: LoanOf<'APPROVED'> = { id: 'L-1042', borrowerId: 'borrower-42', version: 3, status: 'APPROVED' }

export function LedgerPanel() {
  const entry = buildDisbursementJournal({
    id: 'JE-0001',
    loan: SAMPLE_LOAN,
    amount: toCentavos(500_000),
    provider: 'gcash',
    idempotencyKey: 'demo',
  })
  const totals = journalTotals(entry.lines)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <caption className="pb-2 text-left">
          Journal entry <code className="font-mono">{entry.id}</code> for a {formatPHP(toCentavos(500_000))} GCash
          payout.
        </caption>
        <thead>
          <tr className="border-b border-slate-300">
            <th scope="col" className="py-1 pr-4 font-semibold">
              Side
            </th>
            <th scope="col" className="py-1 pr-4 font-semibold">
              Account
            </th>
            <th scope="col" className="py-1 text-right font-semibold">
              Amount
            </th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {entry.lines.map((line) => (
            <tr key={`${line.side}-${line.account}`} className="border-b border-slate-200">
              <td className="py-1 pr-4">{line.side}</td>
              <td className="py-1 pr-4">{line.account}</td>
              <td className="py-1 text-right">{formatPHP(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 font-mono">
        Σ debits {formatPHP(totals.debits)} === Σ credits {formatPHP(totals.credits)}:{' '}
        {totals.balanced ? 'balanced' : 'NOT balanced'}
      </p>
    </div>
  )
}

export function ConcurrencyPanel() {
  return (
    <ul className="list-disc space-y-2 pl-5">
      <li>
        <code className="font-mono">Idempotency-Key</code> names one user intent. A retry with the same key gets the
        stored <code className="font-mono">201</code> back and posts nothing new.
      </li>
      <li>
        <code className="font-mono">If-Match</code> carries the loan version the admin saw. A stale version returns{' '}
        <code className="font-mono">409 VERSION_MISMATCH</code>.
      </li>
      <li>
        The server checks the key before the version, in{' '}
        <code className="font-mono">src/features/disbursement/disbursementServer.ts</code>.
      </li>
    </ul>
  )
}
