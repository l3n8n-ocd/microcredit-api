import { useState } from 'react'
import { formatPHP, parsePesosToCentavos, toCentavos } from '../../utils/index.ts'
import type { DisbursementServer, JournalEntry, LoanState } from '../disbursement/index.ts'

interface Applicant {
  borrowerId: string
  name: string
  utility: { provider: 'Meralco' | 'Water'; monthsOnTime: number; monthsObserved: number }
  supplier: { invoicesPaid: number; invoicesTotal: number; avgDaysLate: number }
  load: { topUpsPerMonth: number; monthsActive: number }
}

const APPLICANTS: Applicant[] = [
  {
    borrowerId: 'borrower-42',
    name: "Nena's Sari-Sari Store",
    utility: { provider: 'Meralco', monthsOnTime: 12, monthsObserved: 12 },
    supplier: { invoicesPaid: 23, invoicesTotal: 24, avgDaysLate: 1 },
    load: { topUpsPerMonth: 9, monthsActive: 24 },
  },
  {
    borrowerId: 'borrower-17',
    name: "Kuya Ben's Carinderia",
    utility: { provider: 'Meralco', monthsOnTime: 10, monthsObserved: 12 },
    supplier: { invoicesPaid: 14, invoicesTotal: 16, avgDaysLate: 4 },
    load: { topUpsPerMonth: 6, monthsActive: 18 },
  },
  {
    borrowerId: 'borrower-08',
    name: "Liza's Bigasan & Load",
    utility: { provider: 'Water', monthsOnTime: 9, monthsObserved: 12 },
    supplier: { invoicesPaid: 9, invoicesTotal: 12, avgDaysLate: 6 },
    load: { topUpsPerMonth: 5, monthsActive: 10 },
  },
  {
    borrowerId: 'borrower-05',
    name: "Mang Tonyo's Hardware",
    utility: { provider: 'Meralco', monthsOnTime: 5, monthsObserved: 8 },
    supplier: { invoicesPaid: 3, invoicesTotal: 5, avgDaysLate: 12 },
    load: { topUpsPerMonth: 3, monthsActive: 4 },
  },
  {
    borrowerId: 'borrower-31',
    name: "Rosa's Ukay-Ukay",
    utility: { provider: 'Water', monthsOnTime: 3, monthsObserved: 9 },
    supplier: { invoicesPaid: 2, invoicesTotal: 6, avgDaysLate: 21 },
    load: { topUpsPerMonth: 2, monthsActive: 3 },
  },
]

const INTEREST_RATE = 0.05

type RepaymentStatus = 'REPAYING' | 'SETTLED' | 'DELINQUENT' | 'DEFAULTED'

export function UnderwritingWorkbench({
  server,
  revision,
  onServerChange,
}: {
  server: DisbursementServer
  revision: number
  onServerChange: () => void
}) {
  const [loans, setLoans] = useState<readonly LoanState[]>(server.listLoans())
  const [ledger, setLedger] = useState<readonly JournalEntry[]>(server.getLedger())
  const [filter, setFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [message, setMessage] = useState('')
  const [repayLoanId, setRepayLoanId] = useState('')
  const [repayAmount, setRepayAmount] = useState('')
  const [reverseId, setReverseId] = useState('')
  const [repayments, setRepayments] = useState<Record<string, { status: RepaymentStatus; outstanding: number }>>({})

  const [seenRevision, setSeenRevision] = useState(revision)
  if (revision !== seenRevision) {
    setSeenRevision(revision)
    setLoans(server.listLoans())
    setLedger(server.getLedger())
  }

  function refresh() {
    setLoans(server.listLoans())
    setLedger(server.getLedger())
    onServerChange()
  }

  function score(applicant: Applicant) {
    const utilityPoints = Math.floor((350 * applicant.utility.monthsOnTime) / applicant.utility.monthsObserved)
    const supplierPoints = Math.max(
      0,
      Math.floor((350 * applicant.supplier.invoicesPaid) / applicant.supplier.invoicesTotal) -
        Math.min(applicant.supplier.avgDaysLate * 5, 100),
    )
    const loadPoints =
      Math.floor((200 * Math.min(applicant.load.topUpsPerMonth, 8)) / 8) +
      Math.floor((100 * Math.min(applicant.load.monthsActive, 12)) / 12)
    const codes: string[] = []
    if (applicant.utility.monthsOnTime / applicant.utility.monthsObserved < 0.8) codes.push('UTIL_LATE_PAYMENTS')
    if (applicant.supplier.avgDaysLate > 7) codes.push('SUPPLIER_PAYS_LATE')
    if (applicant.supplier.invoicesTotal < 6) codes.push('SUPPLIER_THIN_HISTORY')
    if (applicant.load.topUpsPerMonth < 4) codes.push('LOAD_IRREGULAR')
    if (applicant.load.monthsActive < 6) codes.push('LOAD_SHORT_HISTORY')
    const total = utilityPoints + supplierPoints + loadPoints
    let limit = 0
    if (total >= 800) limit = 5_000_000
    else if (total >= 700) limit = 2_500_000
    else if (total >= 550) limit = 1_000_000
    else if (total >= 400) limit = 500_000
    return { total, utilityPoints, supplierPoints, loadPoints, codes, limit: toCentavos(limit) }
  }

  function statusOf(loan: LoanState): string {
    return repayments[loan.id]?.status ?? loan.status
  }

  const rows = loans
    .filter((loan) => filter === 'ALL' || statusOf(loan) === filter)
    .filter((loan) => {
      const applicant = APPLICANTS.find((a) => a.borrowerId === loan.borrowerId)
      const q = search.toLowerCase()
      return (
        loan.id.toLowerCase().includes(q) ||
        loan.borrowerId.toLowerCase().includes(q) ||
        (applicant?.name.toLowerCase().includes(q) ?? false)
      )
    })

  const selected = loans.find((loan) => loan.id === selectedId)
  const selectedApplicant = APPLICANTS.find((a) => a.borrowerId === selected?.borrowerId)

  function act(type: 'START_REVIEW' | 'APPROVE' | 'REJECT') {
    if (selected === undefined || selectedApplicant === undefined) return
    const s = score(selectedApplicant)
    const result =
      type === 'REJECT'
        ? server.applyEvent(selected.id, { type: 'REJECT', reason: s.codes.join(', ') || 'Reviewer decision' })
        : server.applyEvent(selected.id, { type })
    refresh()
    if (result?.ok) setMessage(`${selected.id} is now ${result.loan.status}.`)
    else setMessage(result?.message ?? 'Loan not found')
  }

  const repayLoan = loans.find((loan) => loan.id === repayLoanId)

  function postRepayment() {
    if (repayLoan === undefined || repayLoan.status !== 'DISBURSED') return
    const parsed = parsePesosToCentavos(repayAmount)
    if (!parsed.ok) {
      setMessage('Invalid amount')
      return
    }
    const total = parsed.value
    const principal = toCentavos(Math.floor(total / (1 + INTEREST_RATE)))
    const interest = toCentavos(Math.floor((total * INTEREST_RATE) / (1 + INTEREST_RATE)))
    const outstanding = repayments[repayLoan.id]?.outstanding ?? repayLoan.disbursedAmount
    const id = `JE-${String(ledger.length + 1).padStart(4, '0')}`
    server.appendEntry({
      id,
      loanId: repayLoan.id,
      idempotencyKey: crypto.randomUUID(),
      lines: [
        { account: `wallet_clearing:${repayLoan.provider}`, side: 'DEBIT', amount: total },
        { account: `loans_receivable:${repayLoan.borrowerId}`, side: 'CREDIT', amount: principal },
        { account: 'interest_income', side: 'CREDIT', amount: interest },
      ],
    })
    refresh()
    const left = outstanding - principal
    setRepayments({ ...repayments, [repayLoan.id]: { status: left <= 0 ? 'SETTLED' : 'REPAYING', outstanding: left } })
    setMessage(`Posted ${id}: principal ${formatPHP(principal)}, interest ${formatPHP(interest)}.`)
  }

  function postReversal() {
    const original = ledger.find((entry) => entry.id === reverseId)
    if (original === undefined) return
    const id = `REV-${original.id}`
    server.appendEntry({
      id,
      loanId: original.loanId,
      idempotencyKey: crypto.randomUUID(),
      lines: original.lines.map((line) => ({ ...line, side: line.side === 'DEBIT' ? 'CREDIT' : 'DEBIT' })),
    })
    refresh()
    const principalLine = original.lines.find((line) => line.account.startsWith('loans_receivable'))
    const current = repayments[original.loanId]
    if (current !== undefined && principalLine !== undefined) {
      setRepayments({
        ...repayments,
        [original.loanId]: { status: 'REPAYING', outstanding: current.outstanding + principalLine.amount },
      })
    }
    setMessage(`Posted ${id} reversing ${original.id}.`)
  }

  return (
    <section className="mt-10 space-y-6 border-t border-slate-800 pt-8">
      <h2 className="text-2xl font-semibold">Underwriting workbench</h2>

      <div className="flex flex-wrap gap-2">
        {['ALL', 'APPLIED', 'UNDER_REVIEW', 'APPROVED', 'DISBURSED', 'REPAYING', 'SETTLED', 'REJECTED'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded px-2 py-1 font-mono text-xs ${filter === s ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}
          >
            {s}
          </button>
        ))}
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search borrower name or ID"
        className="w-full rounded bg-slate-900 px-3 py-2 text-slate-100"
      />

      <table className="w-full text-left text-sm">
        <thead className="text-slate-300">
          <tr>
            <th className="py-1 pr-3">Loan</th>
            <th className="py-1 pr-3">Borrower</th>
            <th className="py-1 pr-3">State</th>
            <th className="py-1">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((loan) => {
            const applicant = APPLICANTS.find((a) => a.borrowerId === loan.borrowerId)
            return (
              <tr
                key={loan.id}
                onClick={() => setSelectedId(loan.id)}
                className={`cursor-pointer border-t border-slate-800 ${selectedId === loan.id ? 'bg-slate-800' : ''}`}
              >
                <td className="py-1 pr-3 font-mono">{loan.id}</td>
                <td className="py-1 pr-3">{applicant?.name ?? loan.borrowerId}</td>
                <td className="py-1 pr-3 font-mono">{statusOf(loan)}</td>
                <td className="py-1 font-mono">{applicant ? score(applicant).total : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {selected && selectedApplicant && (
        <div className="space-y-3 rounded-lg border border-slate-800 p-4">
          <h3 className="text-lg font-semibold">
            {selected.id} · {selectedApplicant.name}
          </h3>
          <p className="text-3xl font-semibold">{score(selectedApplicant).total} / 1000</p>
          <ul className="text-sm text-slate-300">
            <li>Utility bill consistency ({selectedApplicant.utility.provider}): {score(selectedApplicant).utilityPoints} / 350</li>
            <li>Supplier invoice history: {score(selectedApplicant).supplierPoints} / 350</li>
            <li>Telco / GCash load top-up cadence: {score(selectedApplicant).loadPoints} / 300</li>
          </ul>
          <p className="text-sm">Reason codes: {score(selectedApplicant).codes.join(', ') || 'none'}</p>
          <p className="text-sm">Recommended limit: {formatPHP(score(selectedApplicant).limit)}</p>
          <div className="flex gap-2">
            {selected.status === 'APPLIED' && (
              <button type="button" onClick={() => act('START_REVIEW')} className="rounded bg-slate-700 px-3 py-2">
                Start review
              </button>
            )}
            {selected.status === 'UNDER_REVIEW' && (
              <>
                <button type="button" onClick={() => act('APPROVE')} className="rounded bg-emerald-600 px-3 py-2">
                  Approve offer
                </button>
                <button type="button" onClick={() => act('REJECT')} className="rounded bg-rose-700 px-3 py-2">
                  Reject with reason codes
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-slate-800 p-4">
        <h3 className="text-lg font-semibold">Repayment &amp; compensating reversal</h3>
        <select value={repayLoanId} onChange={(e) => setRepayLoanId(e.target.value)} className="rounded bg-slate-900 px-3 py-2">
          <option value="">Select a disbursed loan</option>
          {loans
            .filter((loan) => loan.status === 'DISBURSED')
            .map((loan) => (
              <option key={loan.id} value={loan.id}>
                {loan.id} ({repayments[loan.id]?.status ?? 'DISBURSED'})
              </option>
            ))}
        </select>
        <input
          value={repayAmount}
          onChange={(e) => setRepayAmount(e.target.value)}
          placeholder="Repayment amount in pesos"
          className="w-full rounded bg-slate-900 px-3 py-2"
        />
        <button type="button" onClick={postRepayment} className="rounded bg-emerald-600 px-3 py-2">
          Post repayment
        </button>
        <select value={reverseId} onChange={(e) => setReverseId(e.target.value)} className="rounded bg-slate-900 px-3 py-2">
          <option value="">Select a transaction to reverse</option>
          {ledger.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id}
            </option>
          ))}
        </select>
        <button type="button" onClick={postReversal} className="rounded bg-rose-700 px-3 py-2">
          Post compensating reversal
        </button>
      </div>

      {message && <p className="text-sm text-slate-300">{message}</p>}
    </section>
  )
}
