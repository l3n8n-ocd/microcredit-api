import { toCentavos, formatPHP } from '../../utils/money.ts'
import { buildDisbursementJournal, journalTotals } from '../../features/disbursement/ledger.ts'
import type { LoanOf } from '../../features/disbursement/types.ts'
import { splitRepayment } from '../../features/scoring/scoreEngine.ts'

const APPROVED: LoanOf<'APPROVED'> = { id: 'L-1042', borrowerId: 'borrower-42', version: 3, status: 'APPROVED' }

/** `/ledger` — Server Component. A worked double-entry example computed from the real domain code. */
export default function LedgerPage() {
  const journal = buildDisbursementJournal({
    id: 'JE-0001',
    loan: APPROVED,
    amount: toCentavos(500_000),
    provider: 'gcash',
    idempotencyKey: '00000000-0000-4000-8000-000000000000',
  })
  const totals = journalTotals(journal.lines)
  const split = splitRepayment(toCentavos(105_000))

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">Double-entry centavo ledger</h1>
      <p className="mt-2 max-w-2xl text-slate-600">
        Every movement is integer centavos (<code className="font-mono">₱1.00 = 100</code>), posts a
        balanced debit/credit pair, and is reversed only by a compensating entry — never edited. These
        figures are computed on the server by the same functions the app ships.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Disbursement entry (₱5,000.00)</h2>
      <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[22rem] text-left font-mono text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1 pr-3">Account</th>
            <th className="py-1 pr-3 text-right">Debit</th>
            <th className="py-1 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {journal.lines.map((line) => (
            <tr key={line.account} className="border-t border-slate-200">
              <td className="py-1 pr-3">{line.account}</td>
              <td className="py-1 pr-3 text-right">{line.side === 'DEBIT' ? formatPHP(line.amount) : ''}</td>
              <td className="py-1 text-right">{line.side === 'CREDIT' ? formatPHP(line.amount) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-main font-semibold">
            <td className="py-1 pr-3">Σ {totals.balanced ? '(balanced)' : '(UNBALANCED)'}</td>
            <td className="py-1 pr-3 text-right">{formatPHP(totals.debits)}</td>
            <td className="py-1 text-right">{formatPHP(totals.credits)}</td>
          </tr>
        </tfoot>
      </table>
      </div>
      <p className="mt-2 text-sm text-accent">
        Σ debits === Σ credits: {String(totals.balanced)}
      </p>

      <h2 className="mt-8 text-lg font-semibold">Repayment split preview (₱1,050.00)</h2>
      <p className="mt-2 font-mono text-sm">
        principal {formatPHP(split.principal)} + interest {formatPHP(split.interest)} ={' '}
        {formatPHP(toCentavos(split.principal + split.interest))} — remainder allocated so no centavo is lost.
      </p>

      <aside className="mt-8 rounded-lg border border-dashed border-main/40 bg-white p-6">
        <h2 className="text-lg font-semibold">Live reversal audit log</h2>
        <p className="mt-2 text-sm text-slate-600">
          Post repayments and compensating reversals on the interactive <a className="text-accent underline" href="/">Disburse</a> screen; this view is the
          read-only explainer. A server-fetched audit feed slots in here for FE-06+.
        </p>
      </aside>
    </main>
  )
}
