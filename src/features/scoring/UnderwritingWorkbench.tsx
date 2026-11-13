'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createIdempotencyKey, formatPHP } from '../../utils/index.ts'
import { formatIfMatch, type DisbursementServer, type LoanCommand, type LoanCommandResponse } from '../disbursement/index.ts'
import { describeCommand, type Announcement } from './announcement.ts'
import { APPLICANT_PROFILES, type ApplicantProfile } from './applicants.ts'
import { RepaymentPanel } from './RepaymentPanel.tsx'
import { MAX_SCORE, REASON_TEXT } from './scoreEngine.ts'
import { QUEUE_FILTERS, useUnderwritingQueue, type QueueFilter, type QueueRow } from './useUnderwritingQueue.ts'

export interface UnderwritingWorkbenchProps {
  readonly server: DisbursementServer
  /** Bumped by the Disburse form on the same screen after it changes the server. */
  readonly revision?: number
  /** Called after the workbench changes the server, so the Disburse form re-reads. */
  readonly onServerChange?: () => void
  /** Injectable for deterministic tests; defaults to crypto.randomUUID(). */
  readonly createKey?: () => string
  /** Search debounce. Defaults to 250 ms. */
  readonly debounceMs?: number
  readonly profiles?: readonly ApplicantProfile[]
}

const NO_OP = (): void => {}

export function UnderwritingWorkbench({
  server,
  revision = 0,
  onServerChange = NO_OP,
  createKey = createIdempotencyKey,
  debounceMs = 250,
  profiles = APPLICANT_PROFILES,
}: UnderwritingWorkbenchProps) {
  const id = useId()
  const queue = useUnderwritingQueue(server, { profiles, revision, onServerChange, debounceMs })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)

  const detailHeadingRef = useRef<HTMLHeadingElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const focusDetail = useRef(false)
  useEffect(() => {
    if (focusDetail.current) {
      focusDetail.current = false
      detailHeadingRef.current?.focus()
    }
  })

  const selected = queue.rows.find((row) => row.loan.id === selectedId) ?? null

  const select = useCallback((row: QueueRow) => {
    focusDetail.current = true
    setSelectedId(row.loan.id)
  }, [])

  const { send } = queue
  const runCommand = useCallback(
    async (command: LoanCommand, version: number): Promise<LoanCommandResponse | null> => {
      const response = await send({
        headers: { 'Idempotency-Key': createKey(), 'If-Match': formatIfMatch(version) },
        body: command,
      })
      if (response !== null) {
        setAnnouncement(describeCommand(command.loanId, response))
        // The buttons just pressed may be gone (the state changed): keep focus on the panel.
        focusDetail.current = true
      }
      return response
    },
    [send, createKey],
  )

  const filterHintId = `${id}-filter-hint`
  const searchId = `${id}-search`
  const searchHintId = `${id}-search-hint`
  const countId = `${id}-count`
  const approveHintId = `${id}-approve-hint`

  return (
    <section aria-labelledby={`${id}-title`} className="mt-10 space-y-6 border-t border-slate-800 pt-8">
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="text-2xl font-semibold">
          Underwriting workbench
        </h2>
        <p className="text-sm text-slate-300">
          Score alt-data, then Approve offer (UNDER_REVIEW → APPROVED) to send a loan to the Disburse form above.
        </p>
      </div>

      <div role="status" aria-live="polite" className="text-sm">
        {announcement?.tone === 'success' && (
          <p className="rounded-md border border-emerald-400 bg-emerald-950 p-3 text-emerald-100">
            <span aria-hidden="true">✓ </span>
            {announcement.text}
          </p>
        )}
      </div>
      <div role="alert" className="text-sm">
        {announcement?.tone === 'alert' && (
          <p className="rounded-md border border-rose-400 bg-rose-950 p-3 text-rose-100">
            <span aria-hidden="true">⚠ </span>
            {announcement.text}
          </p>
        )}
      </div>

      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Filter by state</legend>
          <p id={filterHintId} className="text-xs text-slate-300">
            Arrow keys move between states.
          </p>
          <div className="flex flex-wrap gap-2">
            {QUEUE_FILTERS.map((filter) => {
              const radioId = `${id}-filter-${filter}`
              return (
                <div key={filter} className="flex items-center">
                  <input
                    id={radioId}
                    type="radio"
                    name={`${id}-filter`}
                    value={filter}
                    checked={queue.filter === filter}
                    onChange={() => {
                      queue.setFilter(filter)
                    }}
                    aria-invalid="false"
                    aria-describedby={filterHintId}
                    className="peer sr-only"
                  />
                  <label
                    htmlFor={radioId}
                    className="cursor-pointer rounded border border-slate-700 px-2 py-1 font-mono text-xs text-slate-200 peer-checked:border-emerald-400 peer-checked:bg-emerald-950 peer-checked:text-emerald-100 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400"
                  >
                    {filter}
                  </label>
                </div>
              )
            })}
          </div>
        </fieldset>

        <div className="space-y-1">
          <label htmlFor={searchId} className="block text-sm font-medium">
            Search borrower name or loan ID
          </label>
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            value={queue.query}
            onChange={(event) => {
              queue.setQuery(event.target.value)
            }}
            aria-invalid="false"
            aria-describedby={`${searchHintId} ${countId}`}
            className="w-full rounded-md border border-slate-500 bg-slate-950 px-3 py-2 text-base text-slate-100 focus:ring-2 focus:ring-emerald-400 focus:outline-none"
          />
          <p id={searchHintId} className="text-xs text-slate-300">
            e.g. Liza or L-1044. The list updates when you stop typing.
          </p>
        </div>

        <p id={countId} aria-live="polite" className="text-sm text-slate-300">
          Showing {queue.visibleRows.length} of {queue.rows.length} loans.
        </p>

        {queue.visibleRows.length === 0 ? (
          <NoResults
            filter={queue.filter}
            query={queue.activeQuery}
            total={queue.rows.length}
            sample={queue.rows.find((row) => row.loan.status === 'APPLIED') ?? null}
            onReset={() => {
              queue.resetFilters()
              searchRef.current?.focus()
            }}
            onOpenSample={(row) => {
              queue.resetFilters()
              select(row)
            }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Underwriting queue</caption>
              <thead className="text-slate-300">
                <tr>
                  <th scope="col" className="py-1 pr-3">Loan</th>
                  <th scope="col" className="py-1 pr-3">Borrower</th>
                  <th scope="col" className="py-1 pr-3">State</th>
                  <th scope="col" className="py-1 pr-3">Trust score</th>
                  <th scope="col" className="py-1">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {queue.visibleRows.map((row) => (
                  <tr
                    key={row.loan.id}
                    aria-current={row.loan.id === selectedId ? 'true' : undefined}
                    className={`border-t border-slate-800 ${row.loan.id === selectedId ? 'bg-slate-800/60' : ''}`}
                  >
                    <td className="py-1 pr-3 font-mono">{row.loan.id}</td>
                    <td className="py-1 pr-3">{row.profile?.name ?? row.loan.borrowerId}</td>
                    <td className="py-1 pr-3 font-mono">{row.loan.status}</td>
                    <td className="py-1 pr-3 font-mono">{row.score === null ? '—' : `${row.score.score} · ${row.score.band}`}</td>
                    <td className="py-1">
                      <button
                        type="button"
                        aria-label={`Review ${row.loan.id}`}
                        onClick={() => {
                          select(row)
                        }}
                        className="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected !== null && (
        <section aria-labelledby={`${id}-detail`} className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h3
            id={`${id}-detail`}
            ref={detailHeadingRef}
            tabIndex={-1}
            className="text-lg font-semibold focus:ring-2 focus:ring-emerald-400 focus:outline-none"
          >
            {selected.loan.id} · {selected.profile?.name ?? selected.loan.borrowerId} ·{' '}
            <span className="font-mono">{selected.loan.status}</span>
          </h3>

          {selected.score === null ? (
            <p className="text-sm text-slate-300">No alternative data on file for this borrower.</p>
          ) : (
            <>
              <p aria-live="polite" aria-atomic="true" data-testid="trust-score" className="text-base">
                Trust score <span className="font-mono text-2xl font-semibold">{selected.score.score}</span> / {MAX_SCORE}
                {' · '}
                <span className="font-mono">{selected.score.band}</span> risk
              </p>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Score breakdown</caption>
                <thead className="text-slate-300">
                  <tr>
                    <th scope="col" className="py-1 pr-3">Signal</th>
                    <th scope="col" className="py-1 text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.score.factors.map((factor) => (
                    <tr key={factor.id} className="border-t border-slate-800">
                      <th scope="row" className="py-1 pr-3 font-normal">{factor.label}</th>
                      <td className="py-1 text-right font-mono">
                        {factor.points} / {factor.maxPoints}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-sm">
                <p className="font-medium">Reason codes</p>
                {selected.score.reasonCodes.length === 0 ? (
                  <p className="text-slate-300">None: no adverse signal.</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5">
                    {selected.score.reasonCodes.map((code) => (
                      <li key={code}>
                        <code className="font-mono">{code}</code>: {REASON_TEXT[code]}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="text-sm">
                Recommended limit:{' '}
                <span className="font-mono">
                  {selected.score.recommendedLimit > 0 ? formatPHP(selected.score.recommendedLimit) : 'no offer'}
                </span>
              </p>

              <ReviewActions row={selected} inFlight={queue.inFlight} approveHintId={approveHintId} onCommand={runCommand} />
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setSelectedId(null)
              searchRef.current?.focus()
            }}
            className="text-sm text-emerald-300 underline focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
          >
            Back to queue
          </button>
        </section>
      )}

      <RepaymentPanel
        loans={queue.loans}
        ledger={queue.ledger}
        inFlight={queue.inFlight}
        createKey={createKey}
        send={queue.send}
        onAnnounce={setAnnouncement}
      />
    </section>
  )
}

interface NoResultsProps {
  readonly filter: QueueFilter
  readonly query: string
  readonly total: number
  /** An APPLIED loan to open instead, or null when there is none. */
  readonly sample: QueueRow | null
  readonly onReset: () => void
  readonly onOpenSample: (row: QueueRow) => void
}

/**
 * FE-08 zero-results state. It names what is filtering the list and offers two
 * ways out: reset to every loan, or open a sample application to review.
 */
function NoResults({ filter, query, total, sample, onReset, onOpenSample }: NoResultsProps) {
  const trimmed = query.trim()
  const button =
    'min-h-11 rounded-md px-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none'
  return (
    <div className="rounded-lg border border-dashed border-slate-600 bg-slate-900/60 p-4" data-testid="queue-empty">
      <p className="text-base font-semibold text-slate-100">No loans match this view.</p>
      <p className="mt-1 text-sm text-slate-300">
        State filter <code className="font-mono text-slate-100">{filter}</code>
        {trimmed === '' ? (
          ' has no loans right now.'
        ) : (
          <>
            {' '}
            and search <code className="font-mono text-slate-100">“{trimmed}”</code> match nothing.
          </>
        )}{' '}
        Search looks at the loan ID, borrower ID and business name.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onReset} className={`${button} bg-emerald-500 text-slate-950`}>
          Reset filters &amp; show all loans ({total})
        </button>
        {sample !== null && (
          <button
            type="button"
            onClick={() => onOpenSample(sample)}
            className={`${button} border border-slate-500 text-slate-100 hover:bg-slate-800`}
          >
            Load sample borrower application ({sample.loan.id} · {sample.loan.status})
          </button>
        )}
      </div>
    </div>
  )
}

interface ReviewActionsProps {
  readonly row: QueueRow
  readonly inFlight: boolean
  readonly approveHintId: string
  readonly onCommand: (command: LoanCommand, version: number) => Promise<unknown>
}

/** Renders only the transitions the current state allows (README: the UI never offers an illegal one). */
function ReviewActions({ row, inFlight, approveHintId, onCommand }: ReviewActionsProps) {
  const { loan, score } = row
  if (score === null) return null
  const button =
    'rounded-md px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60'

  if (loan.status === 'APPLIED') {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={inFlight}
          aria-busy={inFlight}
          onClick={() => void onCommand({ type: 'START_REVIEW', loanId: loan.id }, loan.version)}
          className={`${button} bg-slate-700 text-white`}
        >
          Start review
        </button>
      </div>
    )
  }
  if (loan.status !== 'UNDER_REVIEW') return null

  const canOffer = score.recommendedLimit > 0
  const reasonCodes = score.reasonCodes.length > 0 ? score.reasonCodes : ['REVIEWER_DECISION']
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={inFlight || !canOffer}
          aria-busy={inFlight}
          aria-describedby={approveHintId}
          onClick={() => void onCommand({ type: 'APPROVE', loanId: loan.id }, loan.version)}
          className={`${button} bg-emerald-500 text-slate-950`}
        >
          Approve offer
        </button>
        <button
          type="button"
          disabled={inFlight}
          aria-busy={inFlight}
          onClick={() => void onCommand({ type: 'REJECT', loanId: loan.id, reasonCodes }, loan.version)}
          className={`${button} bg-rose-700 text-white`}
        >
          Reject with reason codes
        </button>
      </div>
      <p id={approveHintId} className="text-xs text-slate-300">
        {canOffer
          ? `Sends Idempotency-Key and If-Match: ${formatIfMatch(loan.version)}. Reject records: ${reasonCodes.join(', ')}.`
          : 'Score is below 400: no offer can be approved. Reject records the reason codes.'}
      </p>
    </div>
  )
}
