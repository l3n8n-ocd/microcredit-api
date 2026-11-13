'use client'

import { useId, useState, type FormEvent } from 'react'
import { PENDING_IDEMPOTENCY_KEY, useIdempotencyKey } from '../../hooks/useIdempotencyKey.ts'
import { formatPHP, parsePesosToCentavos, sumCentavos, type Centavos } from '../../utils/index.ts'
import {
  formatIfMatch,
  isReversed,
  journalTotals,
  outstandingPrincipal,
  type JournalEntry,
  type LoanCommandRequest,
  type LoanCommandResponse,
  type LoanOf,
  type LoanState,
} from '../disbursement/index.ts'
import { describeCommand, type Announcement } from './announcement.ts'
import { formatBps, INTEREST_RATE_BPS, payoffAmount, splitRepayment } from './scoreEngine.ts'

export interface RepaymentPanelProps {
  readonly loans: readonly LoanState[]
  readonly ledger: readonly JournalEntry[]
  readonly inFlight: boolean
  readonly createKey: () => string
  readonly send: (request: LoanCommandRequest) => Promise<LoanCommandResponse | null>
  readonly onAnnounce: (announcement: Announcement) => void
}

type RepayableLoan = LoanOf<'DISBURSED' | 'REPAYING'>
type RepayField = 'loanId' | 'amount'
type RepayErrors = Partial<Record<RepayField, string>>

function isRepayable(loan: LoanState): loan is RepayableLoan {
  return loan.status === 'DISBURSED' || loan.status === 'REPAYING'
}

const RATE_LABEL = formatBps(INTEREST_RATE_BPS)

/** Reversible = a REPAYMENT not yet reversed, on a loan that still accepts a reversal. */
function reversibleEntries(ledger: readonly JournalEntry[], loans: readonly LoanState[]): readonly JournalEntry[] {
  return ledger.filter((entry) => {
    if (entry.kind !== 'REPAYMENT' || isReversed(ledger, entry.id)) return false
    const loan = loans.find((candidate) => candidate.id === entry.loanId)
    return loan?.status === 'REPAYING' || loan?.status === 'DELINQUENT'
  })
}

function entryTotal(entry: JournalEntry): Centavos {
  return sumCentavos(entry.lines.filter((line) => line.side === 'DEBIT').map((line) => line.amount))
}

export function RepaymentPanel({ loans, ledger, inFlight, createKey, send, onAnnounce }: RepaymentPanelProps) {
  const id = useId()
  const fieldId = (field: RepayField): string => `${id}-${field}`

  const [loanId, setLoanId] = useState('')
  const [amount, setAmount] = useState('')
  const [errors, setErrors] = useState<RepayErrors>({})
  const [summary, setSummary] = useState<string | null>(null)
  // Both keys are created in the browser only, so the server HTML and the hydrated page match.
  const [repayKey, renewRepayKey] = useIdempotencyKey(createKey)

  const [reverseId, setReverseId] = useState('')
  const [reverseError, setReverseError] = useState<string | null>(null)
  const [reverseKey, renewReverseKey] = useIdempotencyKey(createKey)

  const repayable = loans.filter(isRepayable)
  const loan = repayable.find((candidate) => candidate.id === loanId) ?? null
  const owed = loan === null ? null : outstandingPrincipal(loan)
  const parsed = parsePesosToCentavos(amount)
  const preview = parsed.ok && parsed.value > 0 ? splitRepayment(parsed.value) : null
  const reversible = reversibleEntries(ledger, loans)
  const totals = journalTotals(ledger.flatMap((entry) => entry.lines))

  function validate(): { readonly loan: RepayableLoan; readonly total: Centavos } | null {
    const next: RepayErrors = {}
    if (loan === null) next.loanId = 'Select a DISBURSED or REPAYING loan.'
    if (!parsed.ok || parsed.value <= 0) {
      next.amount = 'Enter an amount in pesos, e.g. 1,000.00.'
    } else if (loan !== null && owed !== null && splitRepayment(parsed.value).principal > owed) {
      next.amount = `This is more than the payoff of ${formatPHP(payoffAmount(owed))}.`
    }
    setErrors(next)
    const invalid = (['loanId', 'amount'] as const).filter((field) => next[field] !== undefined)
    if (invalid.length > 0 || loan === null || !parsed.ok) {
      setSummary(`Fix ${invalid.length} ${invalid.length === 1 ? 'field' : 'fields'} before posting.`)
      const first = invalid[0]
      if (first !== undefined) document.getElementById(fieldId(first))?.focus()
      return null
    }
    setSummary(null)
    return { loan, total: parsed.value }
  }

  async function handleRepay(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (repayKey === PENDING_IDEMPOTENCY_KEY) return
    const valid = validate()
    if (valid === null) return
    const response = await send({
      headers: { 'Idempotency-Key': repayKey, 'If-Match': formatIfMatch(valid.loan.version) },
      body: { type: 'POST_REPAYMENT', loanId: valid.loan.id, split: splitRepayment(valid.total) },
    })
    if (response === null) return
    onAnnounce(describeCommand(valid.loan.id, response))
    if (response.kind === 'APPLIED') {
      // The intent is done: the next repayment is a new intent with a new key.
      setAmount('')
      renewRepayKey()
      if (response.loan.status === 'SETTLED') setLoanId('')
    }
  }

  async function handleReverse(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (reverseKey === PENDING_IDEMPOTENCY_KEY) return
    const entry = reversible.find((candidate) => candidate.id === reverseId)
    const target = entry === undefined ? undefined : loans.find((candidate) => candidate.id === entry.loanId)
    if (entry === undefined || target === undefined) {
      setReverseError('Select a repayment to reverse.')
      document.getElementById(`${id}-reverse`)?.focus()
      return
    }
    setReverseError(null)
    const response = await send({
      headers: { 'Idempotency-Key': reverseKey, 'If-Match': formatIfMatch(target.version) },
      body: { type: 'REVERSE_REPAYMENT', loanId: target.id, reversesEntryId: entry.id },
    })
    if (response === null) return
    onAnnounce(describeCommand(target.id, response))
    if (response.kind === 'APPLIED') {
      setReverseId('')
      renewReverseKey()
    }
  }

  function describedBy(field: RepayField, hintId: string): string {
    return errors[field] === undefined ? hintId : `${hintId} ${fieldId(field)}-error`
  }

  const input =
    'w-full rounded-md border bg-slate-950 px-3 py-2 text-slate-100 focus:ring-2 focus:ring-emerald-400 focus:outline-none'
  const border = (invalid: boolean): string => (invalid ? 'border-rose-400' : 'border-slate-500')
  const submit =
    'rounded-md px-4 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-6 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="space-y-1">
        <h3 id={`${id}-title`} className="text-lg font-semibold">
          Repayment &amp; compensating reversal
        </h3>
        <p className="text-sm text-slate-300">
          DEBIT <code>wallet_clearing</code>, CREDIT <code>loans_receivable</code> + <code>interest_income</code>. Σ
          debits === Σ credits on every entry.
        </p>
        <p aria-live="polite" className="text-sm font-mono">
          Ledger: Σ debits {formatPHP(totals.debits)} {totals.balanced ? '===' : '!=='} Σ credits{' '}
          {formatPHP(totals.credits)} ({totals.balanced ? 'balanced' : 'UNBALANCED'}, {ledger.length}{' '}
          {ledger.length === 1 ? 'entry' : 'entries'})
        </p>
      </div>

      <form noValidate onSubmit={(event) => void handleRepay(event)} aria-labelledby={`${id}-repay-title`} className="space-y-4">
        <h4 id={`${id}-repay-title`} className="font-medium">
          Post a repayment
        </h4>
        {summary !== null && (
          <p role="alert" className="rounded-md border border-rose-400 bg-rose-950 p-3 text-sm text-rose-100">
            <span aria-hidden="true">⚠ </span>
            {summary}
          </p>
        )}

        <div className="space-y-1">
          <label htmlFor={fieldId('loanId')} className="block text-sm font-medium">
            Loan to repay
          </label>
          <select
            id={fieldId('loanId')}
            value={loanId}
            onChange={(event) => {
              setLoanId(event.target.value)
              renewRepayKey()
            }}
            aria-invalid={errors.loanId === undefined ? 'false' : 'true'}
            aria-describedby={describedBy('loanId', `${id}-loanId-hint`)}
            className={`${input} ${border(errors.loanId !== undefined)}`}
          >
            <option value="">Select a loan…</option>
            {repayable.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.id} · {candidate.status} · owes {formatPHP(outstandingPrincipal(candidate))} · v{candidate.version}
              </option>
            ))}
          </select>
          <p id={`${id}-loanId-hint`} className="text-xs text-slate-300">
            {repayable.length === 0
              ? 'No loan takes repayments yet: Disburse one above first.'
              : 'Only DISBURSED or REPAYING loans take repayments.'}
          </p>
          {errors.loanId !== undefined && (
            <p id={`${fieldId('loanId')}-error`} className="text-sm text-rose-300">
              {errors.loanId}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor={fieldId('amount')} className="block text-sm font-medium">
            Repayment amount (PHP)
          </label>
          <input
            id={fieldId('amount')}
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value)
              renewRepayKey()
            }}
            aria-invalid={errors.amount === undefined ? 'false' : 'true'}
            aria-describedby={describedBy('amount', `${id}-amount-hint`)}
            className={`${input} ${border(errors.amount !== undefined)}`}
          />
          <p id={`${id}-amount-hint`} className="text-xs text-slate-300">
            {owed === null
              ? `Principal plus ${RATE_LABEL} flat interest, e.g. 1,050.00.`
              : `Payoff for this loan: ${formatPHP(payoffAmount(owed))} (principal ${formatPHP(owed)} + ${RATE_LABEL} interest).`}
          </p>
          {errors.amount !== undefined && (
            <p id={`${fieldId('amount')}-error`} className="text-sm text-rose-300">
              {errors.amount}
            </p>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-300">Principal</dt>
          <dd className="text-right font-mono">
            {preview === null ? '—' : formatPHP(preview.principal)}
          </dd>
          <dt className="text-slate-300">Interest</dt>
          <dd className="text-right font-mono">
            {preview === null ? '—' : formatPHP(preview.interest)}
          </dd>
          <dt className="text-slate-300">If-Match</dt>
          <dd className="text-right font-mono">{loan === null ? '—' : formatIfMatch(loan.version)}</dd>
          <dt className="text-slate-300">Idempotency-Key</dt>
          <dd className="truncate text-right font-mono text-xs">{repayKey}</dd>
        </dl>

        <button type="submit" disabled={inFlight} aria-busy={inFlight} className={`${submit} bg-emerald-500 text-slate-950`}>
          {inFlight ? 'Posting…' : 'Post repayment'}
        </button>
      </form>

      <form noValidate onSubmit={(event) => void handleReverse(event)} aria-labelledby={`${id}-reverse-title`} className="space-y-4">
        <h4 id={`${id}-reverse-title`} className="font-medium">
          Reverse a repayment
        </h4>
        <div className="space-y-1">
          <label htmlFor={`${id}-reverse`} className="block text-sm font-medium">
            Repayment to reverse
          </label>
          <select
            id={`${id}-reverse`}
            value={reverseId}
            onChange={(event) => {
              setReverseId(event.target.value)
              renewReverseKey()
            }}
            aria-invalid={reverseError === null ? 'false' : 'true'}
            aria-describedby={reverseError === null ? `${id}-reverse-hint` : `${id}-reverse-hint ${id}-reverse-error`}
            className={`${input} ${border(reverseError !== null)}`}
          >
            <option value="">Select a repayment…</option>
            {reversible.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id} · {entry.loanId} · {formatPHP(entryTotal(entry))}
              </option>
            ))}
          </select>
          <p id={`${id}-reverse-hint`} className="text-xs text-slate-300">
            Posts a new mirrored entry that names the original. The original is never edited, and each repayment
            can be reversed once.
          </p>
          {reverseError !== null && (
            <p id={`${id}-reverse-error`} role="alert" className="text-sm text-rose-300">
              {reverseError}
            </p>
          )}
        </div>
        <button type="submit" disabled={inFlight} aria-busy={inFlight} className={`${submit} bg-rose-700 text-white`}>
          Post compensating reversal
        </button>
      </form>
    </section>
  )
}
