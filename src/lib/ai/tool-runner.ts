/**
 * FE-07 deterministic tool runner: the copilot's tool calls without a model.
 *
 * Used by the local rule engine (no API key), the `tool-error` drill, and
 * "Retry Tool Call with Sanitized Inputs". It emits the same lifecycle frames a
 * hosted model produces through the AI SDK, at a pace a person can watch:
 *
 *   tool-input-start → tool-input-delta × N (~40 ms apart) → tool-input-available
 *   → ~600 ms "running on the server" → tool-output-available | tool-output-error
 *   → a short text summary of the result, streamed as tokens
 *
 * `planLocalTool` picks the tool from the request's wording and builds the
 * input from the numbers the message states, with stated defaults. Same
 * message, same input (except the Idempotency-Key, which is new per intent).
 */
import type { ChatStreamEvent, WireMessage } from '../../features/ai-copilot/chatProtocol.ts'
import { SEED_LOANS } from '../../features/disbursement/seedLoans.ts'
import { APPLICANT_PROFILES } from '../../features/scoring/applicants.ts'
import { createIdempotencyKey } from '../../utils/idempotency.ts'
import { formatPHP, parsePesosToCentavos, toCentavos } from '../../utils/money.ts'
import { tokenize } from './local-engine.ts'
import {
  BUSINESS_TYPES,
  runTool,
  TOOL_META,
  type LedgerOutput,
  type ProposalOutput,
  type ToolName,
  type ToolRun,
  type TrustScoreOutput,
} from './tools.ts'

export interface ToolPlan {
  readonly toolName: ToolName
  /** Not yet validated: a bad input is how `output-error` is reached. */
  readonly input: Readonly<Record<string, unknown>>
  readonly rationale: string
}

export interface ToolTiming {
  /** Pause between input deltas. */
  readonly deltaMs: number
  /** How long `input-available` ("running on the server") stays on screen. */
  readonly executeMs: number
  /** Pause between summary tokens. */
  readonly tokenMs: number
}

export const TOOL_TIMING: ToolTiming = { deltaMs: 40, executeMs: 600, tokenMs: 22 }

/** The amount the error drill sends: negative centavos, outside every bound. */
export const TOOL_ERROR_DRILL_CENTAVOS = -500_000

const TRUST = /trust score tool|evaluateBorrowerTrustScore|run (?:the )?trust score|score (?:this|the) borrower/i
const LEDGER = /ledger audit tool|verifyLedgerAndIdempotency|audit the ledger|run (?:the )?ledger/i
const PROPOSE = /propose (?:a |the )?disburs|proposeDisbursementExecution|confirm tool/i
const TOOL_ERROR = /simulate tool error/i

function lastUserText(messages: readonly WireMessage[]): string {
  return messages.findLast((message) => message.role === 'user')?.content ?? ''
}

function firstInt(text: string, pattern: RegExp, fallback: number): number {
  const match = pattern.exec(text)
  return match?.[1] === undefined ? fallback : Number(match[1])
}

/** "₱15,000.00" → 1500000, through the one money parser (CLAUDE.md §11 rule 2). */
function pesoAmount(text: string): number | null {
  const match = /₱\s?([\d,]+(?:\.\d{1,2})?)/.exec(text)
  if (match?.[1] === undefined) return null
  const parsed = parsePesosToCentavos(match[1])
  return parsed.ok ? parsed.value : null
}

function borrowerFrom(text: string): { readonly name: string; readonly businessType: (typeof BUSINESS_TYPES)[number] } {
  const profile = APPLICANT_PROFILES.find((candidate) => {
    const first = candidate.name.split(/['’\s]/)[0] ?? ''
    return first.length > 2 && new RegExp(`\\b${first}\\b`, 'i').test(text)
  })
  const name = profile?.name ?? "Nena's Sari-Sari Store"
  const lower = name.toLowerCase()
  const businessType = lower.includes('carinderia')
    ? 'carinderia'
    : lower.includes('tricycle')
      ? 'tricycle-operator'
      : lower.includes('sari-sari')
        ? 'sari-sari'
        : 'market-vendor'
  return { name, businessType }
}

function trustInput(text: string, requested: number | null): Record<string, unknown> {
  const borrower = borrowerFrom(text)
  return {
    borrowerName: borrower.name,
    businessType: borrower.businessType,
    monthlyUtilityOnTimeRatio: firstInt(text, /(\d{1,3})\s?%/, 92),
    supplierInvoiceCount: firstInt(text, /(\d{1,2})\s+supplier invoices?/i, 18),
    gcashLoadWeeklyCadence: firstInt(text, /(\d{1,2})\s+(?:GCash |Maya )?(?:load )?top-ups?/i, 5),
    ...(requested === null ? {} : { requestedCentavos: requested }),
  }
}

function payoutInput(text: string): { loanId: string; disbursementCentavos: number; walletProvider: string; expectedVersion: number } {
  const loanId = /\bL-\d{4}\b/.exec(text)?.[0] ?? 'L-1042'
  const seedVersion = SEED_LOANS.find((loan) => loan.id === loanId)?.version ?? 1
  return {
    loanId,
    disbursementCentavos: pesoAmount(text) ?? 500_000,
    walletProvider: /\bmaya\b/i.test(text) ? 'Maya' : 'GCash',
    expectedVersion: firstInt(text, /version\s+(\d{1,4})/i, seedVersion),
  }
}

/** Picks the tool a request asks for, or null for a plain text answer. */
export function planLocalTool(messages: readonly WireMessage[], options: { readonly forceError?: boolean } = {}): ToolPlan | null {
  const text = lastUserText(messages)
  if (options.forceError === true || TOOL_ERROR.test(text)) {
    return {
      toolName: 'evaluateBorrowerTrustScore',
      input: trustInput(text, TOOL_ERROR_DRILL_CENTAVOS),
      rationale: `Tool error drill: the copilot calls evaluateBorrowerTrustScore with requestedCentavos ${TOOL_ERROR_DRILL_CENTAVOS}, which the Zod schema rejects.`,
    }
  }
  if (PROPOSE.test(text)) {
    return { toolName: 'proposeDisbursementExecution', input: payoutInput(text), rationale: TOOL_META.proposeDisbursementExecution.whenToUse }
  }
  if (LEDGER.test(text)) {
    return {
      toolName: 'verifyLedgerAndIdempotency',
      input: { ...payoutInput(text), idempotencyKey: createIdempotencyKey() },
      rationale: TOOL_META.verifyLedgerAndIdempotency.whenToUse,
    }
  }
  if (TRUST.test(text)) {
    return { toolName: 'evaluateBorrowerTrustScore', input: trustInput(text, pesoAmount(text)), rationale: TOOL_META.evaluateBorrowerTrustScore.whenToUse }
  }
  return null
}

const peso = (centavos: number): string => formatPHP(toCentavos(centavos))

/** Two or three sentences about the result. The card carries the detail. */
export function summarizeToolRun(toolName: ToolName, run: ToolRun): string {
  if (!run.ok) {
    return `The \`${toolName}\` call failed with \`${run.code}\`: ${run.message} Nothing was posted. The card keeps the inputs that caused it; **Retry Tool Call with Sanitized Inputs** re-runs it with only the bad fields fixed.`
  }
  switch (toolName) {
    case 'evaluateBorrowerTrustScore': {
      const out = run.output as TrustScoreOutput
      const request =
        out.requested === null
          ? 'No amount was requested, so the card shows the recommended limit only.'
          : `Requested ${peso(out.requested.centavos)}: \`${out.requested.decision}\`.`
      return `**${out.borrowerName}** scores **${out.score} / ${out.maxScore}** (\`${out.riskTier}\`). Recommended limit: ${peso(out.recommendedLimitCentavos)} (\`${out.recommendedLimitCentavos}\` centavos). ${request}`
    }
    case 'verifyLedgerAndIdempotency': {
      const out = run.output as LedgerOutput
      return `Dry run on ${out.loanId}: first request \`${out.firstAttempt.status} ${out.firstAttempt.kind}\`, retry with the same \`Idempotency-Key\` \`${out.retrySameKey.status} ${out.retrySameKey.kind}\`, ${out.ledgerEntriesPosted} ledger ${out.ledgerEntriesPosted === 1 ? 'entry' : 'entries'} posted. Σ debits ${peso(out.debitsCentavos)} ${out.balanced ? '===' : '!=='} Σ credits ${peso(out.creditsCentavos)}.`
    }
    case 'proposeDisbursementExecution': {
      const out = run.output as ProposalOutput
      return `Proposal ready: ${out.loanId} \`APPROVED → DISBURSED\`, ${peso(out.amountCentavos)} to ${out.walletProvider}. Nothing has moved yet. **Approve & Execute Payout** sends it once, with \`Idempotency-Key\` and \`If-Match: ${out.ifMatch}\`.`
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve()
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

/** Streams one tool call through all its lifecycle frames, then the summary. Returns the run. */
export async function streamLocalToolCall(
  plan: ToolPlan,
  signal: AbortSignal,
  send: (event: ChatStreamEvent) => void,
  timing: ToolTiming = TOOL_TIMING,
): Promise<ToolRun> {
  const toolCallId = `call_${createIdempotencyKey().slice(0, 8)}`
  send({ type: 'tool-input-start', toolCallId, toolName: plan.toolName, rationale: plan.rationale })
  const json = JSON.stringify(plan.input)
  for (let index = 0; index < json.length; index += 12) {
    await sleep(timing.deltaMs, signal)
    if (signal.aborted) return { ok: false, code: 'ERR_TOOL_EXECUTION', message: 'Stopped.' }
    send({ type: 'tool-input-delta', toolCallId, delta: json.slice(index, index + 12) })
  }
  send({ type: 'tool-input-available', toolCallId, toolName: plan.toolName, input: plan.input })
  await sleep(timing.executeMs, signal)
  const run = await runTool(plan.toolName, plan.input)
  if (signal.aborted) return run
  if (run.ok) send({ type: 'tool-output-available', toolCallId, output: run.output })
  else send({ type: 'tool-output-error', toolCallId, errorCode: run.code, errorText: run.message })

  for (const token of tokenize(summarizeToolRun(plan.toolName, run))) {
    await sleep(timing.tokenMs, signal)
    if (signal.aborted) return run
    send({ type: 'token', text: token })
  }
  return run
}
