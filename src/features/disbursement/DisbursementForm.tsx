import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { createIdempotencyKey, formatPHP, parsePesosToCentavos } from '../../utils/index.ts'
import { formatIfMatch, type DisbursementServer } from './disbursementServer.ts'
import { buildDisbursementJournal, journalTotals } from './ledger.ts'
import type { DisbursementRequest, DisbursementResponse, JournalEntry, LoanState } from './types.ts'
import {
  findApprovedLoan,
  isDisbursableAmount,
  isWalletProvider,
  MAX_NOTE_LENGTH,
  validateDisbursement,
  WALLET_PROVIDERS,
  type FieldErrors,
  type FieldName,
  type FormValues,
  type ValidDisbursement,
} from './validation.ts'

export interface DisbursementFormProps {
  readonly server: DisbursementServer
  /** Injectable for deterministic tests; defaults to crypto.randomUUID(). */
  readonly createKey?: () => string
  /** Values the form starts with (and returns to on Reset). Defaults to an empty form. */
  readonly initialValues?: FormValues
}

type SimulationMode = 'retry' | 'second-admin'

interface LogEntry {
  readonly seq: number
  readonly source: string
  readonly request: DisbursementRequest
  readonly response: DisbursementResponse
}

type Banner =
  | { readonly tone: 'success'; readonly message: string }
  | { readonly tone: 'alert'; readonly message: string }

const EMPTY_VALUES: FormValues = {
  loanId: '',
  provider: '',
  recipientMobile: '',
  amount: '',
  dailyCap: '50,000.00',
  referenceNote: '',
}

const FIELD_ORDER: readonly FieldName[] = [
  'loanId',
  'provider',
  'recipientMobile',
  'amount',
  'dailyCap',
  'referenceNote',
]

const FIELD_LABELS: Readonly<Record<FieldName, string>> = {
  loanId: 'Approved loan',
  provider: 'Wallet provider',
  recipientMobile: 'Recipient mobile number',
  amount: 'Principal amount (PHP)',
  dailyCap: 'Max daily disbursement cap (PHP)',
  referenceNote: 'Reference note (optional)',
}

const FIELD_HINTS: Readonly<Record<FieldName, string>> = {
  loanId: 'Only loans in the APPROVED state can be disbursed.',
  provider: 'Funds are sent to this digital wallet.',
  recipientMobile: '11 digits starting with 09, e.g. 09171234567.',
  amount: '₱500.00 to ₱50,000.00, in ₱100.00 steps.',
  dailyCap: 'The amount may not exceed this cap. ₱500.00 to ₱200,000.00.',
  referenceNote: `Up to ${MAX_NOTE_LENGTH} characters. Shown as plain text only.`,
}

const controlClass =
  'mt-1 block w-full rounded-md border bg-slate-900 px-3 py-2 text-base text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

function describeResponse(response: DisbursementResponse): string {
  switch (response.kind) {
    case 'CREATED':
      return `201 Created · posted ${response.journalEntry.id}`
    case 'REPLAYED':
      return `201 Idempotent replay of ${response.journalEntry.id} · no new ledger entry`
    case 'CONFLICT':
      return `409 Conflict (${response.code}) · no ledger entry`
    case 'UNPROCESSABLE':
      return `422 ${response.code} · no ledger entry`
    case 'BAD_REQUEST':
      return `400 Bad Request · no ledger entry`
    case 'NOT_FOUND':
      return `404 Not Found · no ledger entry`
    default: {
      const unreachable: never = response
      return unreachable
    }
  }
}

function maskMobile(mobile: string): string {
  return mobile.length === 11 ? `${mobile.slice(0, 4)}•••${mobile.slice(-4)}` : '•••'
}

function buildRequest(value: ValidDisbursement, idempotencyKey: string): DisbursementRequest {
  return {
    headers: { 'Idempotency-Key': idempotencyKey, 'If-Match': formatIfMatch(value.loan.version) },
    body: {
      loanId: value.loan.id,
      provider: value.provider,
      recipientMobile: value.recipientMobile,
      amount: value.amount,
      referenceNote: value.referenceNote,
    },
  }
}

export function DisbursementForm({
  server,
  createKey = createIdempotencyKey,
  initialValues = EMPTY_VALUES,
}: DisbursementFormProps) {
  const id = useId()
  const fieldId = (field: FieldName): string => `${id}-${field}`

  const [values, setValues] = useState<FormValues>(initialValues)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [attempted, setAttempted] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(createKey)
  const [inFlight, setInFlight] = useState(false)
  const inFlightRef = useRef(false)
  const [loans, setLoans] = useState<readonly LoanState[]>(() => server.listLoans())
  const [ledger, setLedger] = useState<readonly JournalEntry[]>(() => server.getLedger())
  const [log, setLog] = useState<readonly LogEntry[]>([])
  const [banner, setBanner] = useState<Banner | null>(null)
  const [mode, setMode] = useState<SimulationMode>('retry')

  const approvedLoans = loans.filter((loan) => loan.status === 'APPROVED')
  const selectedLoan = findApprovedLoan(loans, values.loanId)

  function handleChange(field: FieldName) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const next = { ...values, [field]: event.target.value }
      setValues(next)
      // A changed payload is a new intent, so it gets a new key. Retries of the
      // same intent (same values) keep the old one.
      setIdempotencyKey(createKey())
      if (attempted) {
        const result = validateDisbursement(next, loans)
        setErrors(result.ok ? {} : result.errors)
      }
    }
  }

  async function send(requests: readonly DisbursementRequest[], source: string): Promise<void> {
    inFlightRef.current = true
    setInFlight(true)
    setBanner(null)
    try {
      const responses = await Promise.all(requests.map((request) => server.disburse(request)))
      setLog((previous) => [
        ...previous,
        ...responses.flatMap((response, index) => {
          const request = requests[index]
          if (request === undefined) return []
          const label = requests.length > 1 ? `${source} #${index + 1}` : source
          return [{ seq: previous.length + index + 1, source: label, request, response }]
        }),
      ])
      setLoans(server.listLoans())
      setLedger(server.getLedger())

      const summary = responses.map((response, index) => `Request ${index + 1}: ${describeResponse(response)}.`).join(' ')
      const created = responses.some((response) => response.kind === 'CREATED')
      const blocked = responses.some((response) => response.kind !== 'CREATED' && response.kind !== 'REPLAYED')
      setBanner({ tone: blocked ? 'alert' : 'success', message: summary })

      if (created) {
        // The intent is fulfilled: clear the loan so the next payout is a new intent.
        setValues((previous) => ({ ...previous, loanId: '' }))
        setIdempotencyKey(createKey())
        setAttempted(false)
        setErrors({})
      }
    } finally {
      inFlightRef.current = false
      setInFlight(false)
    }
  }

  function validateForSubmit(): ValidDisbursement | null {
    setAttempted(true)
    const result = validateDisbursement(values, loans)
    if (result.ok) {
      setErrors({})
      return result.value
    }
    setErrors(result.errors)
    const count = Object.keys(result.errors).length
    setBanner({ tone: 'alert', message: `Fix ${count} ${count === 1 ? 'field' : 'fields'} before disbursing.` })
    const firstInvalid = FIELD_ORDER.find((field) => result.errors[field] !== undefined)
    if (firstInvalid !== undefined) document.getElementById(fieldId(firstInvalid))?.focus()
    return null
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (inFlightRef.current) return
    const value = validateForSubmit()
    if (value !== null) await send([buildRequest(value, idempotencyKey)], 'Disburse')
  }

  async function handleSimulate(): Promise<void> {
    if (inFlightRef.current) return
    const value = validateForSubmit()
    if (value === null) return
    const first = buildRequest(value, idempotencyKey)
    // Retry: byte-identical request. Second admin: fresh intent (new key) but the same stale If-Match.
    const second = mode === 'retry' ? first : buildRequest(value, createKey())
    await send([first, second], mode === 'retry' ? 'Network retry' : 'Two admins')
  }

  function handleReset(): void {
    server.reset()
    setLoans(server.listLoans())
    setLedger(server.getLedger())
    setLog([])
    setBanner(null)
    setValues(initialValues)
    setErrors({})
    setAttempted(false)
    setIdempotencyKey(createKey())
  }

  function fieldProps(field: FieldName) {
    const error = errors[field]
    return {
      id: fieldId(field),
      name: field,
      value: values[field],
      onChange: handleChange(field),
      'aria-invalid': error !== undefined,
      'aria-describedby': error === undefined ? `${fieldId(field)}-hint` : `${fieldId(field)}-error ${fieldId(field)}-hint`,
      className: `${controlClass} ${error === undefined ? 'border-slate-600' : 'border-rose-400'}`,
    }
  }

  function fieldMeta(field: FieldName) {
    const error = errors[field]
    return (
      <>
        <p id={`${fieldId(field)}-hint`} className="mt-1 text-sm text-slate-300">
          {FIELD_HINTS[field]}
        </p>
        {error === undefined ? null : (
          <p id={`${fieldId(field)}-error`} className="mt-1 text-sm font-medium text-rose-300">
            <span aria-hidden="true">✕ </span>
            {error}
          </p>
        )}
      </>
    )
  }

  function label(field: FieldName) {
    return (
      <label htmlFor={fieldId(field)} className="block text-sm font-medium text-slate-100">
        {FIELD_LABELS[field]}
      </label>
    )
  }

  const previewAmount = parsePesosToCentavos(values.amount)
  const previewJournal =
    selectedLoan !== null && isWalletProvider(values.provider) && previewAmount.ok && isDisbursableAmount(previewAmount.value)
      ? buildDisbursementJournal({
          id: 'preview',
          loan: selectedLoan,
          amount: previewAmount.value,
          provider: values.provider,
          idempotencyKey,
        })
      : null
  const previewTotals = previewJournal === null ? null : journalTotals(previewJournal.lines)
  const ledgerLines = ledger.flatMap((entry) => entry.lines)
  const ledgerTotals = journalTotals(ledgerLines)

  return (
    <div className="mt-8 space-y-8">
      <form
        noValidate
        aria-labelledby={`${id}-title`}
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-5 rounded-lg border border-slate-800 bg-slate-900/60 p-4 sm:p-6"
      >
        <h2 id={`${id}-title`} className="text-xl font-semibold">
          Disburse an approved loan
        </h2>

        {banner?.tone === 'alert' ? (
          <div role="alert" className="rounded-md border border-rose-400 bg-rose-950 p-3 text-sm text-rose-100">
            <span aria-hidden="true">⚠ </span>
            {banner.message}
          </div>
        ) : null}
        <div role="status" aria-live="polite" className="text-sm">
          {banner?.tone === 'success' ? (
            <p className="rounded-md border border-emerald-400 bg-emerald-950 p-3 text-emerald-100">
              <span aria-hidden="true">✓ </span>
              {banner.message}
            </p>
          ) : null}
        </div>

        <section aria-labelledby={`${id}-preview`} className="rounded-md border border-slate-700 p-3">
          <h3 id={`${id}-preview`} className="text-sm font-semibold">
            Request &amp; journal preview
          </h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs text-slate-300">
            <dt>Idempotency-Key</dt>
            <dd className="break-all text-slate-100">{idempotencyKey}</dd>
            <dt>If-Match</dt>
            <dd className="text-slate-100">{selectedLoan === null ? '—' : formatIfMatch(selectedLoan.version)}</dd>
          </dl>
          <div aria-live="polite" className="mt-2 text-sm">
            {previewJournal === null || previewTotals === null ? (
              <p className="text-slate-300">Complete the form to preview the balanced journal entry.</p>
            ) : (
              <ul className="space-y-1 font-mono text-xs">
                {previewJournal.lines.map((line) => (
                  <li key={line.account}>
                    {line.side === 'DEBIT' ? 'DR' : 'CR'} {line.account} {formatPHP(line.amount)}
                  </li>
                ))}
                <li className="text-emerald-300">
                  Σ debits {formatPHP(previewTotals.debits)} = Σ credits {formatPHP(previewTotals.credits)}{' '}
                  {previewTotals.balanced ? '(balanced)' : '(UNBALANCED)'}
                </li>
              </ul>
            )}
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={inFlight}
            aria-busy={inFlight}
            className="rounded-md bg-emerald-400 px-5 py-2 font-semibold text-slate-950 hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-500"
          >
            {inFlight ? 'Disbursing…' : 'Disburse'}
          </button>
        </div>

        <fieldset className="space-y-3 rounded-md border border-amber-400/60 p-3">
          <legend className="px-1 text-sm font-semibold text-amber-200">Send the same payout twice</legend>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-mode`}
                value="retry"
                checked={mode === 'retry'}
                onChange={() => setMode('retry')}
              />
              Network retry (same key)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-mode`}
                value="second-admin"
                checked={mode === 'second-admin'}
                onChange={() => setMode('second-admin')}
              />
              Two admins (same If-Match)
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleSimulate()}
              disabled={inFlight}
              aria-busy={inFlight}
              className="rounded-md border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Simulate double-click / network retry
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={inFlight}
              className="rounded-md border border-slate-500 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200 disabled:opacity-60"
            >
              Reset demo
            </button>
          </div>
        </fieldset>
        <section aria-labelledby={`${id}-details`} className="space-y-4 border-t border-slate-800 pt-5">
          <h3 id={`${id}-details`} className="text-base font-semibold">
            Payout details
          </h3>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              {label('loanId')}
              <select {...fieldProps('loanId')}>
                <option value="">Select a loan…</option>
                {approvedLoans.map((loan) => (
                  <option key={loan.id} value={loan.id}>
                    {loan.id} · {loan.borrowerId} · v{loan.version}
                  </option>
                ))}
              </select>
              {fieldMeta('loanId')}
            </div>

            <div>
              {label('provider')}
              <select {...fieldProps('provider')}>
                <option value="">Select a wallet…</option>
                {WALLET_PROVIDERS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
              {fieldMeta('provider')}
            </div>

            <div>
              {label('recipientMobile')}
              <input {...fieldProps('recipientMobile')} type="tel" inputMode="numeric" autoComplete="off" maxLength={11} />
              {fieldMeta('recipientMobile')}
            </div>

            <div>
              {label('amount')}
              <input {...fieldProps('amount')} type="text" inputMode="decimal" autoComplete="off" />
              {fieldMeta('amount')}
            </div>

            <div>
              {label('dailyCap')}
              <input {...fieldProps('dailyCap')} type="text" inputMode="decimal" autoComplete="off" />
              {fieldMeta('dailyCap')}
            </div>

            <div>
              {label('referenceNote')}
              <textarea {...fieldProps('referenceNote')} rows={2} />
              {fieldMeta('referenceNote')}
            </div>
          </div>
        </section>
      </form>

      <section aria-labelledby={`${id}-log`} className="space-y-2">
        <h2 id={`${id}-log`} className="text-lg font-semibold">
          Request log
        </h2>
        {log.length === 0 ? (
          <p className="text-sm text-slate-300">No requests sent yet.</p>
        ) : (
          <ol className="space-y-2">
            {log.map((entry) => (
              <li
                key={entry.seq}
                data-testid="request-log-entry"
                className="rounded-md border border-slate-700 p-3 font-mono text-xs break-all text-slate-200"
              >
                <p className="font-semibold text-slate-100">
                  {entry.source}: POST /loans/{entry.request.body.loanId}/disbursements
                </p>
                <p>Idempotency-Key: {entry.request.headers['Idempotency-Key']}</p>
                <p>If-Match: {entry.request.headers['If-Match']}</p>
                <p>
                  {formatPHP(entry.request.body.amount)} → {entry.request.body.provider}{' '}
                  {maskMobile(entry.request.body.recipientMobile)}
                </p>
                <p className={entry.response.kind === 'CREATED' ? 'text-emerald-300' : 'text-amber-200'}>
                  → {describeResponse(entry.response)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby={`${id}-loans`} className="space-y-2">
        <h2 id={`${id}-loans`} className="text-lg font-semibold">
          Loans
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-300">
              <tr>
                <th scope="col" className="py-1 pr-3">Loan</th>
                <th scope="col" className="py-1 pr-3">Borrower</th>
                <th scope="col" className="py-1 pr-3">State</th>
                <th scope="col" className="py-1">Version</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => (
                <tr key={loan.id} className="border-t border-slate-800">
                  <td className="py-1 pr-3 font-mono">{loan.id}</td>
                  <td className="py-1 pr-3">{loan.borrowerId}</td>
                  <td className="py-1 pr-3 font-mono">{loan.status}</td>
                  <td className="py-1 font-mono">{loan.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby={`${id}-ledger`} className="space-y-2">
        <h2 id={`${id}-ledger`} className="text-lg font-semibold">
          Ledger (append-only)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-300">
              <tr>
                <th scope="col" className="py-1 pr-3">Entry</th>
                <th scope="col" className="py-1 pr-3">Account</th>
                <th scope="col" className="py-1 pr-3 text-right">Debit</th>
                <th scope="col" className="py-1 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-2 text-slate-300">
                    No entries yet.
                  </td>
                </tr>
              ) : (
                ledger.flatMap((entry) =>
                  entry.lines.map((line) => (
                    <tr key={`${entry.id}-${line.account}`} className="border-t border-slate-800">
                      <td className="py-1 pr-3 font-mono">{entry.id}</td>
                      <td className="py-1 pr-3 font-mono break-all">{line.account}</td>
                      <td className="py-1 pr-3 text-right font-mono">{line.side === 'DEBIT' ? formatPHP(line.amount) : ''}</td>
                      <td className="py-1 text-right font-mono">{line.side === 'CREDIT' ? formatPHP(line.amount) : ''}</td>
                    </tr>
                  )),
                )
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-600 font-semibold">
                <th scope="row" colSpan={2} className="py-1 pr-3">
                  Σ ({ledgerTotals.balanced ? 'balanced' : 'UNBALANCED'})
                </th>
                <td data-testid="ledger-total-debits" className="py-1 pr-3 text-right font-mono">
                  {formatPHP(ledgerTotals.debits)}
                </td>
                <td data-testid="ledger-total-credits" className="py-1 text-right font-mono">
                  {formatPHP(ledgerTotals.credits)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  )
}
