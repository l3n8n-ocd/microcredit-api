'use client'

/**
 * FE-07 · One tool call, drawn as a state machine.
 *
 *                       tool-input-start
 *                              │
 *                              ▼
 *        ┌──────────────────────────────────────────┐  Q: What is the model deciding to call, and why?
 *        │ input-streaming                          │  Dashed frame. "Choosing tool" banner with the
 *        │ (tool-input-delta × N)                   │  rationale; one pill per argument, filling in.
 *        └─────────────────────┬────────────────────┘
 *                              │ tool-input-available
 *                              ▼
 *        ┌──────────────────────────────────────────┐  Q: With what exact inputs is the tool running?
 *        │ input-available                          │  Locked parameter bar in plain words (₱, %, IDs),
 *        └───────────┬──────────────────┬───────────┘  out-of-bounds values flagged, running dots.
 *   tool-output-     │                  │ tool-output-error
 *   available        ▼                  ▼
 *   ┌─────────────────────────┐  ┌───────────────────────────┐  Q: What went wrong, and how do I
 *   │ output-available        │  │ output-error              │     recover? Code, the preserved
 *   │ score card + SVG chart  │  │ code · message · inputs   │     inputs, the exact sanitizing
 *   │ ledger findings table   │  │ Retry Tool Call with      │     change, one retry button.
 *   │ confirm-payout widget   │  │ Sanitized Inputs          │
 *   └─────────────────────────┘  └───────────────────────────┘
 *   Q: What structured result came back? A component per tool, never raw JSON.
 *
 * Both bottom states are terminal: a call never goes back. A retry is a new
 * call in a new reply. Each state view enters with a 150 ms fade (the CLAUDE.md
 * §12 cap; the brief asked for 200 ms), off under `prefers-reduced-motion`.
 *
 * The inspector bar pins any state this call reached, so a reviewer can step
 * through them. Results are validated against the tool's Zod output schema
 * before they are drawn: a result that does not match is shown as an error.
 */
import { useId, useRef, useState, type ReactNode } from 'react'
import {
  OUTPUT_SCHEMAS,
  TOOL_META,
  isToolName,
  sanitizeToolInput,
  type FieldMeta,
  type LedgerOutput,
  type ProposalOutput,
  type ToolErrorCode,
  type ToolName,
  type TrustScoreOutput,
} from '../../lib/ai/tools.ts'
import { formatPHP, toCentavos } from '../../utils/money.ts'
import { TOOL_STATES, type ToolDecision, type ToolPart, type ToolState } from './chatTypes.ts'
import { executeProposal, replayProposal } from './copilotLedger.ts'
import { partialArguments } from './toolArgs.ts'

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const STATE_ENTER = 'transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none'
const CODE = 'font-mono text-xs'

export interface ToolInvocationCardProps {
  readonly part: ToolPart
  /** True while the reply that holds this call is still streaming. */
  readonly live: boolean
  readonly onDecision: (decision: ToolDecision) => void
  readonly onRetry: (toolName: ToolName, input: Record<string, unknown>, changes: string) => void
  /** Retry is off while another reply is streaming. */
  readonly retryDisabled: boolean
}

// ── Formatting ──────────────────────────────────────────────────────────────

function peso(centavos: number): string {
  return Number.isSafeInteger(centavos) && centavos >= 0 ? formatPHP(toCentavos(centavos)) : `${centavos} centavos`
}

function outOfBounds(meta: FieldMeta, value: unknown): boolean {
  if (typeof value !== 'number') return false
  return (meta.min !== undefined && value < meta.min) || (meta.max !== undefined && value > meta.max) || !Number.isInteger(value)
}

function formatField(meta: FieldMeta, value: unknown): string {
  if (value === undefined || value === null) return meta.fallback ?? '—'
  switch (meta.kind) {
    case 'centavos':
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? `${peso(value)} (${value} centavos)`
        : `${String(value)} centavos`
    case 'percent':
      return `${String(value)}%`
    case 'uuid':
      return typeof value === 'string' ? `${value.slice(0, 8)}…` : String(value)
    default:
      return String(value)
  }
}

function inputRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
}

// ── State views ─────────────────────────────────────────────────────────────

function StreamingView({ toolName, part }: { readonly toolName: ToolName; readonly part: ToolPart }) {
  const fields = Object.entries(TOOL_META[toolName].fields)
  const { done, writing } = partialArguments(part.inputText)
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">Choosing tool</p>
      <p className="mt-1 text-sm text-ink">
        <code className={`${CODE} font-semibold`}>{toolName}</code>: {part.rationale}
      </p>
      <p className="mt-2 text-xs text-slate-600">
        Arguments arriving: {done.size} of {fields.length}
      </p>
      <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Arguments so far">
        {fields.map(([key, meta]) => {
          const value = done.get(key)
          const isWriting = writing?.key === key
          return (
            <li
              key={key}
              className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs ${
                done.has(key) ? 'border-slate-400 bg-white text-ink' : 'border-dashed border-slate-300 text-slate-600'
              }`}
            >
              <span className="font-semibold">{meta.label}</span>
              {/* Each pill says its own status, so it is not carried by the border style alone. */}
              <span className="sr-only">{done.has(key) ? '(received)' : isWriting ? '(arriving)' : '(waiting)'}</span>
              {done.has(key) ? (
                <span className="font-mono">{formatField(meta, value)}</span>
              ) : isWriting ? (
                <span className="font-mono">{writing.raw}▍</span>
              ) : (
                <span aria-hidden="true" className="block h-2 w-10 rounded bg-slate-200" />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ParameterBar({ toolName, input }: { readonly toolName: ToolName; readonly input: Record<string, unknown> }) {
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-slate-200 bg-canvas p-2 text-xs">
      {Object.entries(TOOL_META[toolName].fields).map(([key, meta]) => {
        const value = input[key]
        const missing = value === undefined || value === null
        const bad = outOfBounds(meta, value)
        return (
          <div key={key} className="contents" data-param={key}>
            <dt className="text-slate-600">{meta.label}</dt>
            <dd className="min-w-0 font-mono break-words text-ink">
              {formatField(meta, value)}
              {missing && meta.optional === true && (
                <span className="ml-2 rounded border border-slate-300 bg-white px-1 font-sans text-[0.7rem] text-slate-700">fallback</span>
              )}
              {bad && (
                <span className="ml-2 rounded border border-rose-300 bg-rose-50 px-1 font-sans text-[0.7rem] text-rose-800">
                  out of bounds ({meta.min}–{meta.max})
                </span>
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

function AvailableView({ toolName, part, live }: { readonly toolName: ToolName; readonly part: ToolPart; readonly live: boolean }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-600 uppercase">
        <span aria-hidden="true">🔒</span> Inputs locked
        {live && (
          <span className="ml-auto inline-flex items-center gap-1.5 font-normal tracking-normal normal-case">
            <span aria-hidden="true" className="inline-flex items-center gap-1">
              <span className="copilot-dot" />
              <span className="copilot-dot" />
              <span className="copilot-dot" />
            </span>
            running on the server
          </span>
        )}
      </p>
      <p className="mt-1 text-sm text-ink">
        <code className={`${CODE} font-semibold`}>{toolName}</code> runs with exactly these inputs:
      </p>
      <ParameterBar toolName={toolName} input={inputRecord(part.input)} />
      {!live && part.state === 'input-available' && (
        <p className="mt-2 text-xs text-slate-700">The reply stopped before this tool returned. Nothing was posted.</p>
      )}
    </div>
  )
}

// ── Results: one component per tool ─────────────────────────────────────────

/** Hand-rolled SVG: three bars, each pillar's points out of its own maximum. */
function PillarChart({ result }: { readonly result: TrustScoreOutput }) {
  const id = useId()
  const track = 220
  const summary = result.pillars.map((pillar) => `${pillar.label} ${pillar.points} of ${pillar.maxPoints} points`).join('; ')
  return (
    <figure className="mt-3">
      <svg viewBox="0 0 320 102" className="w-full max-w-md" role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-desc`}>
        <title id={`${id}-title`}>Trust score breakdown, 3 pillars</title>
        <desc id={`${id}-desc`}>{summary}</desc>
        {result.pillars.map((pillar, row) => {
          const y = row * 34
          const width = pillar.maxPoints === 0 ? 0 : (track * pillar.points) / pillar.maxPoints
          return (
            <g key={pillar.id}>
              <text x="0" y={y + 11} className="fill-slate-700 font-sans text-[11px]">
                {pillar.label} · {pillar.basis}
              </text>
              <rect x="0" y={y + 16} width={track} height="11" rx="2" className="fill-slate-200" />
              <rect x="0" y={y + 16} width={width} height="11" rx="2" className="fill-slate-700" />
              <text x={track + 8} y={y + 25.5} className="fill-ink font-mono text-[11px]">
                {pillar.points}/{pillar.maxPoints}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="text-xs text-slate-600">Each bar is that pillar&apos;s points out of its maximum (350 / 350 / 300).</figcaption>
    </figure>
  )
}

function TrustScoreResult({ result }: { readonly result: TrustScoreOutput }) {
  const requested = result.requested
  return (
    <div>
      <p className="text-sm text-ink">
        <span className="font-semibold">{result.borrowerName}</span> · <span className={CODE}>{result.businessType}</span>
      </p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
        <span className="font-mono text-2xl font-semibold text-ink">
          {result.score} <span className="text-base text-slate-600">/ {result.maxScore}</span>
        </span>
        <span className="rounded border border-slate-400 bg-white px-1.5 py-0.5 font-mono text-xs text-ink">{result.riskTier}</span>
      </p>
      <PillarChart result={result} />
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-600">Recommended limit</dt>
        <dd className="font-mono text-ink">
          {result.recommendedLimitCentavos === 0 ? 'no offer' : peso(result.recommendedLimitCentavos)}{' '}
          <span className="text-xs text-slate-600">({result.recommendedLimitCentavos} centavos)</span>
        </dd>
        <dt className="text-slate-600">Requested</dt>
        <dd>
          {requested === null ? (
            <span className="rounded border border-slate-300 bg-canvas px-1.5 py-0.5 text-xs text-slate-700">
              Fallback: no amount requested, showing the recommended limit only
            </span>
          ) : (
            <span className="font-mono text-ink">
              {peso(requested.centavos)} ·{' '}
              <span className={requested.decision === 'WITHIN_LIMIT' ? 'text-emerald-800' : 'text-rose-800'}>
                {requested.decision === 'WITHIN_LIMIT' ? '✓ ' : '✗ '}
                {requested.decision}
              </span>
            </span>
          )}
        </dd>
      </dl>
      {result.reasonCodes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-700">
          {result.reasonCodes.map((reason) => (
            <li key={reason.code}>
              <code className={CODE}>{reason.code}</code>: {reason.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function JournalTable({ caption, lines, debits, credits }: { readonly caption: string; readonly lines: LedgerOutput['journalLines']; readonly debits: number; readonly credits: number }) {
  const balanced = debits === credits
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[20rem] text-left text-xs">
        <caption className="pb-1 text-left text-xs text-slate-600">{caption}</caption>
        <thead className="text-slate-600">
          <tr>
            <th scope="col" className="py-1 pr-3 font-semibold">Account</th>
            <th scope="col" className="py-1 pr-3 text-right font-semibold">Debit (centavos)</th>
            <th scope="col" className="py-1 text-right font-semibold">Credit (centavos)</th>
          </tr>
        </thead>
        <tbody className="font-mono text-ink">
          {lines.length === 0 ? (
            <tr className="border-t border-slate-200">
              <td colSpan={3} className="py-1 font-sans text-slate-700">No journal lines: nothing can be posted for this loan.</td>
            </tr>
          ) : (
            lines.map((line, index) => (
              <tr key={`${line.account}-${index}`} className="border-t border-slate-200">
                <td className="py-1 pr-3 break-all">{line.account}</td>
                <td className="py-1 pr-3 text-right">{line.side === 'DEBIT' ? line.centavos : ''}</td>
                <td className="py-1 text-right">{line.side === 'CREDIT' ? line.centavos : ''}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot className="font-mono">
          <tr className="border-t-2 border-main">
            <th scope="row" className="py-1 pr-3 text-left font-sans font-semibold">
              Σ debits {balanced ? '===' : '!=='} Σ credits
            </th>
            <td className="py-1 pr-3 text-right">{debits}</td>
            <td className="py-1 text-right">{credits}</td>
          </tr>
        </tfoot>
      </table>
      <p className={`mt-1 text-xs font-semibold ${balanced ? 'text-emerald-800' : 'text-rose-800'}`}>
        {balanced ? `✓ Balanced: ${peso(debits)} on each side.` : `✗ Unbalanced: ${peso(debits)} vs ${peso(credits)}.`}
      </p>
    </div>
  )
}

function LedgerFindings({ result }: { readonly result: LedgerOutput }) {
  const caption =
    result.linesSource === 'POSTED'
      ? `Journal entry posted by the dry run (${result.ledgerEntriesPosted} ${result.ledgerEntriesPosted === 1 ? 'entry' : 'entries'})`
      : result.linesSource === 'PREVIEW'
        ? 'Nothing posted. The entry a valid payout would post:'
        : 'Nothing posted.'
  const ok = (status: number): string => (status === 201 ? 'text-emerald-800' : 'text-rose-800')
  return (
    <div>
      <p className="text-sm text-ink">
        <span className="font-mono">{result.loanId}</span>: <span className={CODE}>{result.stateBefore} v{result.versionBefore}</span> →{' '}
        <span className={CODE}>{result.stateAfter} v{result.versionAfter}</span>
      </p>
      <JournalTable caption={caption} lines={result.journalLines} debits={result.debitsCentavos} credits={result.creditsCentavos} />
      <table className="mt-3 w-full text-left text-xs">
        <caption className="pb-1 text-left text-xs text-slate-600">
          Same request sent twice: <code className={CODE}>Idempotency-Key: {result.idempotencyKey.slice(0, 8)}…</code>,{' '}
          <code className={CODE}>If-Match: {result.ifMatch}</code>
        </caption>
        <tbody>
          <tr className="border-t border-slate-200">
            <th scope="row" className="py-1 pr-3 font-normal text-slate-700">First request</th>
            <td className={`py-1 font-mono font-semibold ${ok(result.firstAttempt.status)}`}>
              {result.firstAttempt.status} {result.firstAttempt.kind}
            </td>
          </tr>
          <tr className="border-t border-slate-200">
            <th scope="row" className="py-1 pr-3 font-normal text-slate-700">Retry, same key</th>
            <td className={`py-1 font-mono font-semibold ${ok(result.retrySameKey.status)}`}>
              {result.retrySameKey.status} {result.retrySameKey.kind}
              {result.retrySameKey.kind === 'REPLAYED' && <span className="font-sans font-normal text-slate-700"> (original receipt, nothing new posted)</span>}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 font-mono text-xs text-ink">
        Idempotency-Key status: <span>{result.idempotencyStatus}</span>
      </p>
    </div>
  )
}

function ProposalConfirm({
  proposal,
  decision,
  onDecision,
}: {
  readonly proposal: ProposalOutput
  readonly decision: ToolDecision | null
  readonly onDecision: (decision: ToolDecision) => void
}) {
  const [busy, setBusy] = useState(false)
  /** Set before the first await, so a double-click sends one request. */
  const lock = useRef(false)

  const run = async (work: () => Promise<ToolDecision>): Promise<void> => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      onDecision(await work())
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const button = `min-h-11 rounded-md border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`
  return (
    <div>
      <p className="text-sm font-semibold text-ink">
        Pay {peso(proposal.amountCentavos)} to {proposal.borrowerName}?
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-600">Transition</dt>
        <dd className="font-mono text-ink">
          {proposal.loanId} {proposal.fromState} → {proposal.toState}
        </dd>
        <dt className="text-slate-600">Wallet</dt>
        <dd className="text-ink">{proposal.walletProvider}</dd>
        <dt className="text-slate-600">If-Match</dt>
        <dd className="font-mono text-ink">{proposal.ifMatch}</dd>
        <dt className="text-slate-600">Idempotency-Key</dt>
        <dd className="font-mono break-all text-ink">{proposal.idempotencyKey}</dd>
      </dl>
      <JournalTable
        caption="Entry this payout would post"
        lines={proposal.journalPreview}
        debits={proposal.debitsCentavos}
        credits={proposal.creditsCentavos}
      />

      {decision === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            aria-busy={busy ? 'true' : 'false'}
            onClick={() => void run(() => executeProposal(proposal))}
            className={`smart-press ${button} border-main bg-main text-white hover:bg-slate-700`}
          >
            {busy ? 'Sending once…' : 'Approve & Execute Payout'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision({ kind: 'cancelled', at: new Date().toISOString() })}
            className={`${button} border-main bg-white text-ink hover:bg-slate-100`}
          >
            Cancel Action
          </button>
        </div>
      ) : decision.kind === 'cancelled' ? (
        <p className="mt-3 rounded-md border border-slate-300 bg-canvas px-3 py-2 text-sm text-ink" role="status">
          Cancelled by the officer. No request was sent; the loan stays {proposal.fromState}.
        </p>
      ) : (
        <div className="mt-3 rounded-md border border-slate-300 bg-canvas px-3 py-2 text-sm text-ink" role="status">
          <p className={`font-mono font-semibold ${decision.status === 201 ? 'text-emerald-800' : 'text-rose-800'}`}>
            {decision.status === 201 ? '✓' : '✗'} {decision.status} {decision.outcome}
          </p>
          <p className="mt-1">{decision.message}</p>
          <p className="mt-1 font-mono text-xs">
            {proposal.loanId}: {decision.loanStatus ?? '?'} v{decision.loanVersion ?? '?'} · disbursement entries for this loan:{' '}
            <span>{decision.entriesForLoan}</span>
            {decision.debitsCentavos !== null && decision.creditsCentavos !== null && (
              <> · Σ debits {decision.debitsCentavos} {decision.debitsCentavos === decision.creditsCentavos ? '===' : '!=='} Σ credits {decision.creditsCentavos}</>
            )}
          </p>
          {decision.status === 201 && (
            <>
              <button
                type="button"
                disabled={busy}
                aria-busy={busy ? 'true' : 'false'}
                onClick={() => void run(() => replayProposal(proposal, decision))}
                className={`${button} mt-2 border-amber-600 bg-white text-ink hover:bg-amber-50`}
              >
                {busy ? 'Re-sending…' : 'Re-send the same request (replay test)'}
              </button>
              {decision.lastReplay !== null && (
                <p className="mt-1 font-mono text-xs">
                  Replay {decision.replays}: {decision.lastReplay}. Entries for {proposal.loanId} still {decision.entriesForLoan}.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function OutputView({
  toolName,
  part,
  onDecision,
}: {
  readonly toolName: ToolName
  readonly part: ToolPart
  readonly onDecision: (decision: ToolDecision) => void
}) {
  let body: ReactNode = null
  switch (toolName) {
    case 'evaluateBorrowerTrustScore': {
      const parsed = OUTPUT_SCHEMAS.evaluateBorrowerTrustScore.safeParse(part.output)
      if (parsed.success) body = <TrustScoreResult result={parsed.data} />
      break
    }
    case 'verifyLedgerAndIdempotency': {
      const parsed = OUTPUT_SCHEMAS.verifyLedgerAndIdempotency.safeParse(part.output)
      if (parsed.success) body = <LedgerFindings result={parsed.data} />
      break
    }
    case 'proposeDisbursementExecution': {
      const parsed = OUTPUT_SCHEMAS.proposeDisbursementExecution.safeParse(part.output)
      if (parsed.success) body = <ProposalConfirm proposal={parsed.data} decision={part.decision} onDecision={onDecision} />
      break
    }
  }
  return (
    <div>
      {body ?? (
        <p className="text-sm text-rose-800" role="alert">
          <span className="font-mono font-semibold">ERR_TOOL_OUTPUT_SHAPE</span>: the result did not match the{' '}
          <code className={CODE}>{toolName}</code> output schema, so it is not drawn.
        </p>
      )}
    </div>
  )
}

function ErrorView({
  toolName,
  part,
  onRetry,
  retryDisabled,
}: {
  readonly toolName: ToolName
  readonly part: ToolPart
  readonly onRetry: ToolInvocationCardProps['onRetry']
  readonly retryDisabled: boolean
}) {
  const hintId = useId()
  const code = part.errorCode ?? 'ERR_TOOL_EXECUTION'
  const knownCode: ToolErrorCode = (
    ['ERR_TOOL_SCHEMA_BOUNDS', 'ERR_LEDGER_LOAN_NOT_FOUND', 'ERR_ILLEGAL_TRANSITION', 'ERR_STALE_IF_MATCH'] as const
  ).find((known) => known === code) ?? 'ERR_TOOL_EXECUTION'
  const sanitized = sanitizeToolInput(toolName, part.input, knownCode)
  const changes = sanitized.changes.map((change) => `${change.field}: ${String(change.from)} → ${String(change.to)}`)
  const disabled = retryDisabled || !sanitized.fixable
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-rose-800 uppercase">Tool failed · nothing was posted</p>
      <p className="mt-1 font-mono text-sm font-semibold text-ink">
        {code}
      </p>
      <p className="mt-1 text-sm text-ink">{part.errorText ?? 'The tool did not return a result.'}</p>
      <p className="mt-3 text-xs font-semibold text-slate-700">Inputs that triggered it (kept as sent)</p>
      <ParameterBar toolName={toolName} input={inputRecord(part.input)} />
      <p id={hintId} className="mt-2 text-xs text-slate-700">
        {sanitized.fixable ? (
          <>
            Retry changes only: <span className="font-mono">{changes.join('; ')}</span>
          </>
        ) : (
          'No automatic fix: change the request and send it again.'
        )}
        {retryDisabled && sanitized.fixable && ' Wait for the current reply to finish.'}
      </p>
      <button
        type="button"
        disabled={disabled}
        aria-describedby={hintId}
        onClick={() => onRetry(toolName, sanitized.input, changes.join('; '))}
        className={`mt-2 min-h-11 rounded-md border border-main bg-main px-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-600 ${FOCUS_RING}`}
      >
        Retry Tool Call with Sanitized Inputs
      </button>
    </div>
  )
}

// ── The card ────────────────────────────────────────────────────────────────

/** One frame per state, so the state reads before a word is read: draft, locked, result, failure. */
const FRAME: Readonly<Record<ToolState, string>> = {
  'input-streaming': 'border border-dashed border-slate-400 bg-canvas',
  'input-available': 'border border-slate-400 bg-slate-100',
  'output-available': 'border-2 border-main bg-white',
  'output-error': 'border border-l-4 border-slate-300 border-l-rose-600 bg-white',
}

function StateInspector({
  part,
  pinned,
  onPin,
}: {
  readonly part: ToolPart
  readonly pinned: ToolState | 'live'
  readonly onPin: (state: ToolState | 'live') => void
}) {
  const start = part.timeline[0]?.at ?? 0
  const pill = `min-h-8 rounded-full border px-2.5 font-mono text-[0.7rem] disabled:cursor-not-allowed disabled:border-dashed disabled:text-slate-500 aria-pressed:border-main aria-pressed:bg-main aria-pressed:text-white ${FOCUS_RING}`
  return (
    <div role="group" aria-label="Tool Lifecycle State Inspector" className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[0.7rem] font-semibold text-slate-600">State inspector</span>
      <button type="button" aria-pressed={pinned === 'live'} onClick={() => onPin('live')} className={`${pill} border-slate-300 bg-white text-ink`}>
        live
      </button>
      {TOOL_STATES.map((state) => {
        const step = part.timeline.find((entry) => entry.state === state)
        return (
          <button
            key={state}
            type="button"
            aria-pressed={pinned === state}
            disabled={step === undefined}
            title={step === undefined ? 'This call never reached this state.' : undefined}
            onClick={() => onPin(state)}
            className={`${pill} border-slate-300 bg-white text-ink`}
          >
            {state}
            {step !== undefined && <span className="ml-1 opacity-75">+{step.at - start} ms</span>}
          </button>
        )
      })}
    </div>
  )
}

export function ToolInvocationCard({ part, live, onDecision, onRetry, retryDisabled }: ToolInvocationCardProps) {
  const [pinned, setPinned] = useState<ToolState | 'live'>('live')
  const view: ToolState = pinned === 'live' ? part.state : pinned
  const toolName = part.toolName

  if (!isToolName(toolName)) {
    return (
      <div className="my-2 rounded-md border border-slate-300 bg-white p-3 text-sm" data-tool-state={part.state}>
        The model called an unknown tool, <code className={CODE}>{toolName}</code>. It is not drawn.
      </div>
    )
  }

  return (
    <section
      aria-label={`Tool call ${toolName}: ${part.state}`}
     
     
      data-tool-state={part.state}
     
      className={`my-2 rounded-lg p-3 text-sm ${FRAME[view]}`}
    >
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-700">
          <span className="font-semibold text-ink">{TOOL_META[toolName].title}</span> · tool{' '}
          <code className={CODE}>{toolName}</code> · <span className={CODE}>{part.state}</span>
        </p>
        <StateInspector part={part} pinned={pinned} onPin={setPinned} />
      </header>
      {/* Keyed by state: each state's view mounts fresh and fades in, so the change reads as a morph. */}
      <div key={view} className={STATE_ENTER}>
        {view === 'input-streaming' && <StreamingView toolName={toolName} part={part} />}
        {view === 'input-available' && <AvailableView toolName={toolName} part={part} live={live && part.state === 'input-available'} />}
        {view === 'output-available' && <OutputView toolName={toolName} part={part} onDecision={onDecision} />}
        {view === 'output-error' && <ErrorView toolName={toolName} part={part} onRetry={onRetry} retryDisabled={retryDisabled} />}
      </div>
    </section>
  )
}
