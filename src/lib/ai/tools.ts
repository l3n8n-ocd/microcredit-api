/**
 * FE-07 tool contracts for the Underwriting & Ledger Copilot.
 *
 * One file holds, per tool: the Zod input schema (every field `.describe()`d,
 * because the description is what the model reads), the Zod output schema
 * (the browser validates every result against it before drawing it), field
 * metadata the cards and the retry sanitizer share, and a deterministic
 * `execute`.
 *
 *   evaluateBorrowerTrustScore   alt-data summary → 0–1000 score, 3 pillars, limit in centavos
 *   verifyLedgerAndIdempotency   dry-run a payout on a fresh seed ledger: Σ debits === Σ credits,
 *                                and what a same-key retry gets back
 *   proposeDisbursementExecution builds an APPROVED → DISBURSED proposal. It changes nothing:
 *                                the officer confirms in the UI, and only then does the browser
 *                                send `Idempotency-Key` + `If-Match`
 *
 * Isomorphic on purpose (no `server-only`, no env, no AI SDK import): the
 * server executes the tools, and the client imports the same schemas to
 * validate what comes back. The AI SDK `tool()` wrappers live in
 * underwriting-model.ts. Leaf imports, not feature barrels: the barrels
 * re-export `'use client'` components.
 */
import { z } from 'zod'
import { createDisbursementServer, formatIfMatch } from '../../features/disbursement/disbursementServer.ts'
import { buildDisbursementJournal, journalTotals } from '../../features/disbursement/ledger.ts'
import { SAMPLE_PAYOUT, SEED_LOANS } from '../../features/disbursement/seedLoans.ts'
import type { DisbursementResponse, JournalLine, WalletProvider } from '../../features/disbursement/types.ts'
import { MAX_DISBURSEMENT, MIN_DISBURSEMENT } from '../../features/disbursement/validation.ts'
import { APPLICANT_PROFILES } from '../../features/scoring/applicants.ts'
import { MAX_SCORE, REASON_TEXT, recommendLimit } from '../../features/scoring/scoreEngine.ts'
import { createIdempotencyKey } from '../../utils/idempotency.ts'
import { toCentavos } from '../../utils/money.ts'

// ── Shared vocabulary ───────────────────────────────────────────────────────

export const TOOL_NAMES = ['evaluateBorrowerTrustScore', 'verifyLedgerAndIdempotency', 'proposeDisbursementExecution'] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export function isToolName(value: unknown): value is ToolName {
  return typeof value === 'string' && (TOOL_NAMES as readonly string[]).includes(value)
}

/** Every way a tool call can fail. Each code has one recovery in the error card. */
export type ToolErrorCode =
  | 'ERR_TOOL_SCHEMA_BOUNDS'
  | 'ERR_LEDGER_LOAN_NOT_FOUND'
  | 'ERR_ILLEGAL_TRANSITION'
  | 'ERR_STALE_IF_MATCH'
  | 'ERR_TOOL_EXECUTION'

/** A tool failure the model and the UI can both name. Thrown by `execute`, caught by `runTool`. */
export class ToolFailure extends Error {
  readonly code: ToolErrorCode
  constructor(code: ToolErrorCode, message: string) {
    super(message)
    this.name = 'ToolFailure'
    this.code = code
  }
}

const centavos = z.number().int()
const WALLETS = ['GCash', 'Maya'] as const
const walletKey = (wallet: (typeof WALLETS)[number]): WalletProvider => (wallet === 'GCash' ? 'gcash' : 'maya')
const LOAN_ID = /^L-\d{4}$/
const FULL_PERCENT = 100

const journalLineSchema = z.object({
  account: z.string(),
  side: z.enum(['DEBIT', 'CREDIT']),
  centavos: centavos.nonnegative(),
})
export type ToolJournalLine = z.infer<typeof journalLineSchema>

function toToolLines(lines: readonly JournalLine[]): ToolJournalLine[] {
  return lines.map((line) => ({ account: line.account, side: line.side, centavos: line.amount }))
}

// ── Tool 1 · evaluateBorrowerTrustScore ─────────────────────────────────────

export const BUSINESS_TYPES = ['sari-sari', 'market-vendor', 'tricycle-operator', 'carinderia'] as const

export const trustScoreInputSchema = z.object({
  borrowerName: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .describe('Business name as the officer wrote it, e.g. "Nena\'s Sari-Sari Store". Shown on the card; it does not change the score.'),
  businessType: z
    .enum(BUSINESS_TYPES)
    .describe('Kind of micro-business. Shown on the card; it does not change the score.'),
  monthlyUtilityOnTimeRatio: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Whole percent of the last 12 Meralco/water bills paid on time, 0-100. Below 80 adds reason code UTIL_LATE_PAYMENTS.'),
  supplierInvoiceCount: z
    .number()
    .int()
    .min(0)
    .max(50)
    .describe('Supplier invoices on record in the last 12 months, 0-50. 24 or more earns full supplier points; fewer than 6 adds SUPPLIER_THIN_HISTORY.'),
  gcashLoadWeeklyCadence: z
    .number()
    .int()
    .min(0)
    .max(30)
    .describe('GCash/Maya load top-ups per week, 0-30. 7 or more earns full points; 0 adds LOAD_IRREGULAR.'),
  requestedCentavos: centavos
    .min(MIN_DISBURSEMENT)
    .max(MAX_DISBURSEMENT)
    .optional()
    .describe(
      'Amount the borrower asked for, in integer centavos (₱1.00 = 100), between 50000 and 5000000. Omit it when the request names no amount: the card then shows the recommended limit only.',
    ),
})
export type TrustScoreInput = z.infer<typeof trustScoreInputSchema>

export const RISK_TIERS = ['LOW_RISK', 'MODERATE_RISK', 'HIGH_RISK'] as const

export const trustScoreOutputSchema = z.object({
  borrowerName: z.string(),
  businessType: z.enum(BUSINESS_TYPES),
  score: z.number().int().min(0).max(MAX_SCORE),
  maxScore: z.literal(MAX_SCORE),
  riskTier: z.enum(RISK_TIERS),
  pillars: z
    .array(
      z.object({
        id: z.enum(['utility', 'supplier', 'gcash']),
        label: z.string(),
        points: z.number().int().nonnegative(),
        maxPoints: z.number().int().positive(),
        basis: z.string(),
      }),
    )
    .length(3),
  recommendedLimitCentavos: centavos.nonnegative(),
  /** null when `requestedCentavos` was omitted: the card shows its fallback badge. */
  requested: z
    .object({ centavos: centavos.positive(), decision: z.enum(['WITHIN_LIMIT', 'ABOVE_LIMIT', 'NO_OFFER']) })
    .nullable(),
  reasonCodes: z.array(z.object({ code: z.string(), text: z.string() })),
})
export type TrustScoreOutput = z.infer<typeof trustScoreOutputSchema>

/** `numerator / denominator` of `max` points, floored; the same rule as scoreEngine.ts. */
function pillarPoints(max: number, numerator: number, denominator: number): number {
  return Math.floor((max * Math.min(numerator, denominator)) / denominator)
}

export function evaluateBorrowerTrustScore(input: TrustScoreInput): TrustScoreOutput {
  const pillars: TrustScoreOutput['pillars'] = [
    {
      id: 'utility',
      label: 'Utility consistency',
      points: pillarPoints(350, input.monthlyUtilityOnTimeRatio, FULL_PERCENT),
      maxPoints: 350,
      basis: `${input.monthlyUtilityOnTimeRatio}% of bills on time`,
    },
    {
      id: 'supplier',
      label: 'Supplier history',
      points: pillarPoints(350, input.supplierInvoiceCount, 24),
      maxPoints: 350,
      basis: `${input.supplierInvoiceCount} invoices (full at 24)`,
    },
    {
      id: 'gcash',
      label: 'GCash cadence',
      points: pillarPoints(300, input.gcashLoadWeeklyCadence, 7),
      maxPoints: 300,
      basis: `${input.gcashLoadWeeklyCadence} top-ups a week (full at 7)`,
    },
  ]
  const score = pillars.reduce((total, pillar) => total + pillar.points, 0)
  const riskTier = score >= 700 ? 'LOW_RISK' : score >= 550 ? 'MODERATE_RISK' : 'HIGH_RISK'
  // The same score → limit table the workbench uses, so both always agree on a limit.
  const limit = recommendLimit(score)

  const reasonCodes: { code: string; text: string }[] = []
  if (input.monthlyUtilityOnTimeRatio < 80) reasonCodes.push({ code: 'UTIL_LATE_PAYMENTS', text: REASON_TEXT.UTIL_LATE_PAYMENTS })
  if (input.supplierInvoiceCount < 6) reasonCodes.push({ code: 'SUPPLIER_THIN_HISTORY', text: REASON_TEXT.SUPPLIER_THIN_HISTORY })
  if (input.gcashLoadWeeklyCadence < 1) reasonCodes.push({ code: 'LOAD_IRREGULAR', text: 'No load top-ups in a typical week' })

  let requested: TrustScoreOutput['requested'] = null
  if (input.requestedCentavos !== undefined) {
    const decision = limit === 0 ? 'NO_OFFER' : input.requestedCentavos <= limit ? 'WITHIN_LIMIT' : 'ABOVE_LIMIT'
    if (decision === 'ABOVE_LIMIT') reasonCodes.push({ code: 'REQUEST_ABOVE_LIMIT', text: 'Requested amount is above the recommended limit' })
    requested = { centavos: input.requestedCentavos, decision }
  }

  return {
    borrowerName: input.borrowerName,
    businessType: input.businessType,
    score,
    maxScore: MAX_SCORE,
    riskTier,
    pillars,
    recommendedLimitCentavos: limit,
    requested,
    reasonCodes,
  }
}

// ── Tool 2 · verifyLedgerAndIdempotency ─────────────────────────────────────

export const ledgerInputSchema = z.object({
  loanId: z.string().regex(LOAN_ID).describe('Loan to check, e.g. "L-1042". Seed loans are L-1042 to L-1046; only APPROVED ones can be disbursed.'),
  disbursementCentavos: centavos
    .min(MIN_DISBURSEMENT)
    .max(MAX_DISBURSEMENT)
    .describe('Payout amount in integer centavos (₱1.00 = 100), 50000-5000000 in ₱100.00 steps. ₱5,000.00 is 500000.'),
  walletProvider: z.enum(WALLETS).describe('Wallet the payout goes to. Picks the credit account wallet_clearing:gcash or wallet_clearing:maya.'),
  idempotencyKey: z.uuidv4().describe('UUID v4 for this one payout intent. The tool sends it twice to show that a retry replays the original.'),
  expectedVersion: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .describe('Loan version the officer saw; sent as If-Match. L-1042 is at version 3. A wrong version gets 409 VERSION_MISMATCH.'),
})
export type LedgerInput = z.infer<typeof ledgerInputSchema>

export const IDEMPOTENCY_STATUSES = ['NEW_INTENT_POSTED_ONCE', 'STALE_IF_MATCH_409', 'ILLEGAL_STATE_409', 'REJECTED_422'] as const

const attemptSchema = z.object({ status: z.number().int(), kind: z.string() })

export const ledgerOutputSchema = z.object({
  loanId: z.string(),
  stateBefore: z.string(),
  versionBefore: z.number().int(),
  stateAfter: z.string(),
  versionAfter: z.number().int(),
  idempotencyKey: z.string(),
  ifMatch: z.string(),
  firstAttempt: attemptSchema,
  retrySameKey: attemptSchema,
  ledgerEntriesPosted: z.number().int().nonnegative(),
  /**
   * `POSTED`: the entry the dry run posted. `PREVIEW`: nothing posted (e.g. a stale If-Match); the lines a
   * valid payout of this APPROVED loan would post. `NONE`: the loan is not APPROVED, so no payout entry exists.
   */
  linesSource: z.enum(['POSTED', 'PREVIEW', 'NONE']),
  journalLines: z.array(journalLineSchema),
  debitsCentavos: centavos.nonnegative(),
  creditsCentavos: centavos.nonnegative(),
  balanced: z.boolean(),
  idempotencyStatus: z.enum(IDEMPOTENCY_STATUSES),
})
export type LedgerOutput = z.infer<typeof ledgerOutputSchema>

function seedLoan(loanId: string) {
  const loan = SEED_LOANS.find((candidate) => candidate.id === loanId)
  if (loan === undefined) {
    throw new ToolFailure(
      'ERR_LEDGER_LOAN_NOT_FOUND',
      `No loan ${loanId} in the seed ledger. It holds ${SEED_LOANS.map((candidate) => candidate.id).join(', ')}.`,
    )
  }
  return loan
}

function idempotencyStatus(first: DisbursementResponse): LedgerOutput['idempotencyStatus'] {
  if (first.kind === 'CREATED' || first.kind === 'REPLAYED') return 'NEW_INTENT_POSTED_ONCE'
  if (first.kind === 'CONFLICT') return first.code === 'VERSION_MISMATCH' ? 'STALE_IF_MATCH_409' : 'ILLEGAL_STATE_409'
  return 'REJECTED_422'
}

/**
 * A dry run on a fresh copy of the seed ledger (the server keeps no state
 * between requests). It sends the same request twice, as a network retry
 * would, then reads what was posted.
 */
export async function verifyLedgerAndIdempotency(input: LedgerInput): Promise<LedgerOutput> {
  const before = seedLoan(input.loanId)
  const server = createDisbursementServer(SEED_LOANS)
  const ifMatch = formatIfMatch(input.expectedVersion)
  const request = {
    headers: { 'Idempotency-Key': input.idempotencyKey, 'If-Match': ifMatch },
    body: {
      loanId: input.loanId,
      provider: walletKey(input.walletProvider),
      recipientMobile: SAMPLE_PAYOUT.recipientMobile,
      amount: toCentavos(input.disbursementCentavos),
      referenceNote: 'Copilot ledger audit (dry run)',
    },
  } as const
  const first = await server.disburse(request)
  const retry = await server.disburse(request)
  const after = server.listLoans().find((loan) => loan.id === input.loanId) ?? before
  const posted = server.getLedger().filter((entry) => entry.loanId === input.loanId && entry.kind === 'DISBURSEMENT')

  // The discriminated union only lets an APPROVED loan build a payout journal: no preview for any other state.
  const linesSource: LedgerOutput['linesSource'] = posted.length > 0 ? 'POSTED' : before.status === 'APPROVED' ? 'PREVIEW' : 'NONE'
  const lines =
    posted.length > 0
      ? posted.flatMap((entry) => entry.lines)
      : before.status === 'APPROVED'
        ? buildDisbursementJournal({
            id: 'preview',
            loan: before,
            provider: walletKey(input.walletProvider),
            amount: toCentavos(input.disbursementCentavos),
            idempotencyKey: input.idempotencyKey,
          }).lines
        : []
  const totals = journalTotals(lines)

  return {
    loanId: input.loanId,
    stateBefore: before.status,
    versionBefore: before.version,
    stateAfter: after.status,
    versionAfter: after.version,
    idempotencyKey: input.idempotencyKey,
    ifMatch,
    firstAttempt: { status: first.status, kind: first.kind },
    retrySameKey: { status: retry.status, kind: retry.kind },
    ledgerEntriesPosted: posted.length,
    linesSource,
    journalLines: toToolLines(lines),
    debitsCentavos: totals.debits,
    creditsCentavos: totals.credits,
    balanced: totals.balanced,
    idempotencyStatus: idempotencyStatus(first),
  }
}

// ── Tool 3 · proposeDisbursementExecution ───────────────────────────────────

export const proposalInputSchema = z.object({
  loanId: z.string().regex(LOAN_ID).describe('APPROVED loan to pay out, e.g. "L-1042" (version 3) or "L-1043" (version 1).'),
  disbursementCentavos: centavos
    .min(MIN_DISBURSEMENT)
    .max(MAX_DISBURSEMENT)
    .describe('Payout amount in integer centavos (₱1.00 = 100), 50000-5000000 in ₱100.00 steps.'),
  walletProvider: z.enum(WALLETS).describe('Wallet the payout goes to.'),
  expectedVersion: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .describe('Loan version the officer saw; the confirmation sends it as If-Match.'),
})
export type ProposalInput = z.infer<typeof proposalInputSchema>

export const proposalOutputSchema = z.object({
  status: z.literal('AWAITING_CONFIRMATION'),
  loanId: z.string(),
  borrowerName: z.string(),
  amountCentavos: centavos.positive(),
  walletProvider: z.enum(WALLETS),
  fromState: z.literal('APPROVED'),
  toState: z.literal('DISBURSED'),
  ifMatch: z.string(),
  /** Minted once per proposal. A double-click on Confirm reuses it, so the server replays instead of paying twice. */
  idempotencyKey: z.string(),
  journalPreview: z.array(journalLineSchema),
  debitsCentavos: centavos.nonnegative(),
  creditsCentavos: centavos.nonnegative(),
  balanced: z.boolean(),
})
export type ProposalOutput = z.infer<typeof proposalOutputSchema>

/** Checks the proposal against the seed ledger and returns it for a human to confirm. Nothing is posted. */
export function proposeDisbursementExecution(input: ProposalInput): ProposalOutput {
  const loan = seedLoan(input.loanId)
  if (loan.status !== 'APPROVED') {
    throw new ToolFailure('ERR_ILLEGAL_TRANSITION', `${loan.id} is ${loan.status}. Only an APPROVED loan can move to DISBURSED.`)
  }
  if (loan.version !== input.expectedVersion) {
    throw new ToolFailure(
      'ERR_STALE_IF_MATCH',
      `${loan.id} is at version ${loan.version}, not ${input.expectedVersion}. A payout with If-Match: "${input.expectedVersion}" would get 409.`,
    )
  }
  const idempotencyKey = createIdempotencyKey()
  const preview = buildDisbursementJournal({
    id: 'preview',
    loan,
    provider: walletKey(input.walletProvider),
    amount: toCentavos(input.disbursementCentavos),
    idempotencyKey,
  })
  const totals = journalTotals(preview.lines)
  return {
    status: 'AWAITING_CONFIRMATION',
    loanId: loan.id,
    borrowerName: APPLICANT_PROFILES.find((profile) => profile.borrowerId === loan.borrowerId)?.name ?? loan.borrowerId,
    amountCentavos: input.disbursementCentavos,
    walletProvider: input.walletProvider,
    fromState: 'APPROVED',
    toState: 'DISBURSED',
    ifMatch: formatIfMatch(loan.version),
    idempotencyKey,
    journalPreview: toToolLines(preview.lines),
    debitsCentavos: totals.debits,
    creditsCentavos: totals.credits,
    balanced: totals.balanced,
  }
}

// ── Metadata shared by the model, the cards and the sanitizer ───────────────

export type FieldKind = 'text' | 'enum' | 'int' | 'percent' | 'centavos' | 'uuid' | 'loan'

export interface FieldMeta {
  readonly label: string
  readonly kind: FieldKind
  readonly optional?: true
  readonly min?: number
  readonly max?: number
  /** What the card shows when an optional field is missing. */
  readonly fallback?: string
}

export interface ToolMeta {
  readonly title: string
  /** The model reads this to choose a tool. */
  readonly description: string
  /** Shown in the "Choosing tool" banner: why this tool answers the request. */
  readonly whenToUse: string
  readonly fields: Readonly<Record<string, FieldMeta>>
}

export const TOOL_META: Readonly<Record<ToolName, ToolMeta>> = {
  evaluateBorrowerTrustScore: {
    title: 'Trust score',
    description:
      'Score a micro-business from three alternative-data numbers (utility bills on time, supplier invoices, GCash/Maya load cadence). Returns a 0-1000 score, a risk tier, a 3-pillar breakdown and a recommended limit in integer centavos. Use it whenever the officer asks for a score or a limit.',
    whenToUse: 'The request asks how creditworthy a borrower is, so the copilot scores the alt-data instead of guessing.',
    fields: {
      borrowerName: { label: 'Borrower', kind: 'text' },
      businessType: { label: 'Business', kind: 'enum' },
      monthlyUtilityOnTimeRatio: { label: 'Utility on time', kind: 'percent', min: 0, max: 100 },
      supplierInvoiceCount: { label: 'Supplier invoices', kind: 'int', min: 0, max: 50 },
      gcashLoadWeeklyCadence: { label: 'GCash top-ups / week', kind: 'int', min: 0, max: 30 },
      requestedCentavos: {
        label: 'Requested',
        kind: 'centavos',
        optional: true,
        min: MIN_DISBURSEMENT,
        max: MAX_DISBURSEMENT,
        fallback: 'not stated: recommended limit only',
      },
    },
  },
  verifyLedgerAndIdempotency: {
    title: 'Ledger & idempotency audit',
    description:
      'Dry-run one disbursement on a fresh copy of the seed ledger: send it twice with the same Idempotency-Key and the given If-Match version, then report the journal lines, Σ debits vs Σ credits in integer centavos, and what the retry got back. Use it for any question about the ledger balancing or double payouts.',
    whenToUse: 'The request is about the ledger or a retried payout, so the copilot runs the payout twice and shows what was posted.',
    fields: {
      loanId: { label: 'Loan', kind: 'loan' },
      disbursementCentavos: { label: 'Amount', kind: 'centavos', min: MIN_DISBURSEMENT, max: MAX_DISBURSEMENT },
      walletProvider: { label: 'Wallet', kind: 'enum' },
      idempotencyKey: { label: 'Idempotency-Key', kind: 'uuid' },
      expectedVersion: { label: 'If-Match version', kind: 'int', min: 1, max: 1000 },
    },
  },
  proposeDisbursementExecution: {
    title: 'Disbursement proposal',
    description:
      'Propose moving an APPROVED loan to DISBURSED. It checks the loan and returns a proposal; it posts nothing. A human must press Approve & Execute Payout in the UI. Use it when the officer asks to pay out a loan.',
    whenToUse: 'The request asks to pay a borrower, which moves money, so the copilot proposes it and waits for a human.',
    fields: {
      loanId: { label: 'Loan', kind: 'loan' },
      disbursementCentavos: { label: 'Amount', kind: 'centavos', min: MIN_DISBURSEMENT, max: MAX_DISBURSEMENT },
      walletProvider: { label: 'Wallet', kind: 'enum' },
      expectedVersion: { label: 'If-Match version', kind: 'int', min: 1, max: 1000 },
    },
  },
}

const INPUT_SCHEMAS = {
  evaluateBorrowerTrustScore: trustScoreInputSchema,
  verifyLedgerAndIdempotency: ledgerInputSchema,
  proposeDisbursementExecution: proposalInputSchema,
} as const

export const OUTPUT_SCHEMAS = {
  evaluateBorrowerTrustScore: trustScoreOutputSchema,
  verifyLedgerAndIdempotency: ledgerOutputSchema,
  proposeDisbursementExecution: proposalOutputSchema,
} as const

export type ToolOutput = TrustScoreOutput | LedgerOutput | ProposalOutput

// ── Running a tool ──────────────────────────────────────────────────────────

export type ToolRun =
  | { readonly ok: true; readonly input: Record<string, unknown>; readonly output: ToolOutput }
  | { readonly ok: false; readonly code: ToolErrorCode; readonly message: string }

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')
}

/** Validates `raw` against the tool's schema, then executes it. Never throws. */
export async function runTool(name: ToolName, raw: unknown): Promise<ToolRun> {
  try {
    switch (name) {
      case 'evaluateBorrowerTrustScore': {
        const parsed = trustScoreInputSchema.safeParse(raw)
        if (!parsed.success) return { ok: false, code: 'ERR_TOOL_SCHEMA_BOUNDS', message: describeIssues(parsed.error) }
        return { ok: true, input: parsed.data, output: evaluateBorrowerTrustScore(parsed.data) }
      }
      case 'verifyLedgerAndIdempotency': {
        const parsed = ledgerInputSchema.safeParse(raw)
        if (!parsed.success) return { ok: false, code: 'ERR_TOOL_SCHEMA_BOUNDS', message: describeIssues(parsed.error) }
        return { ok: true, input: parsed.data, output: await verifyLedgerAndIdempotency(parsed.data) }
      }
      case 'proposeDisbursementExecution': {
        const parsed = proposalInputSchema.safeParse(raw)
        if (!parsed.success) return { ok: false, code: 'ERR_TOOL_SCHEMA_BOUNDS', message: describeIssues(parsed.error) }
        return { ok: true, input: parsed.data, output: proposeDisbursementExecution(parsed.data) }
      }
    }
  } catch (error) {
    if (error instanceof ToolFailure) return { ok: false, code: error.code, message: error.message }
    return { ok: false, code: 'ERR_TOOL_EXECUTION', message: 'The tool failed while running. Nothing was posted.' }
  }
}

const TOOL_ERROR_CODES: readonly ToolErrorCode[] = [
  'ERR_TOOL_SCHEMA_BOUNDS',
  'ERR_LEDGER_LOAN_NOT_FOUND',
  'ERR_ILLEGAL_TRANSITION',
  'ERR_STALE_IF_MATCH',
  'ERR_TOOL_EXECUTION',
]

/**
 * Maps whatever a `tool-error` carries to a code. In AI SDK v7 that is our own
 * `ToolFailure` (thrown by `execute`, `code` intact) or, for input that fails
 * the schema, a string starting `AI_InvalidToolInputError:`.
 */
export function toolErrorCode(error: unknown): ToolErrorCode {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = TOOL_ERROR_CODES.find((known) => known === error.code)
    if (code !== undefined) return code
  }
  if (error instanceof z.ZodError) return 'ERR_TOOL_SCHEMA_BOUNDS'
  const text = typeof error === 'string' ? error : error instanceof Error ? `${error.name} ${error.message}` : ''
  return /InvalidToolInput|TypeValidation/i.test(text) ? 'ERR_TOOL_SCHEMA_BOUNDS' : 'ERR_TOOL_EXECUTION'
}

/**
 * A short, safe message for the error card. For the SDK's invalid-input string
 * it keeps only "field: problem" pairs, not the dump of the whole input.
 */
export function toolErrorText(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  if (typeof error === 'string') {
    const pairs = [...error.matchAll(/"path":\s*\[\s*"([^"]+)"[\s\S]*?\]\s*,\s*"message":\s*"([^"]+)"/g)].map(
      (match) => `${match[1] ?? 'input'}: ${match[2] ?? 'invalid'}`,
    )
    if (pairs.length > 0) return pairs.join('; ')
  }
  return 'The tool failed. Nothing was posted.'
}

// ── Retry with sanitized inputs ─────────────────────────────────────────────

export interface SanitizedInput {
  readonly input: Record<string, unknown>
  /** What changed, for the error card: "requestedCentavos −500000 → removed". */
  readonly changes: readonly { readonly field: string; readonly from: unknown; readonly to: unknown }[]
  /** False when no automatic change can make the input valid. */
  readonly fixable: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

const REMOVED = '(removed)'

/**
 * Makes the smallest changes that turn a failed call's input into a valid one:
 * an out-of-bounds optional field is dropped, a number is clamped to its
 * bounds, and an execution error swaps in the seed value it names. It never
 * invents a borrower or an amount the officer did not give.
 */
export function sanitizeToolInput(name: ToolName, raw: unknown, code: ToolErrorCode): SanitizedInput {
  const input = asRecord(raw)
  const changes: { field: string; from: unknown; to: unknown }[] = []
  const fields = TOOL_META[name].fields

  if (code === 'ERR_TOOL_SCHEMA_BOUNDS') {
    const parsed = INPUT_SCHEMAS[name].safeParse(input)
    const bad = parsed.success ? [] : [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')))]
    for (const field of bad) {
      const meta = fields[field]
      const value = input[field]
      if (meta === undefined) continue
      if (meta.optional === true) {
        changes.push({ field, from: value, to: REMOVED })
        delete input[field]
      } else if (typeof value === 'number' && Number.isFinite(value) && meta.min !== undefined && meta.max !== undefined) {
        const clamped = Math.min(Math.max(Math.trunc(value), meta.min), meta.max)
        changes.push({ field, from: value, to: clamped })
        input[field] = clamped
      }
    }
  } else if (code === 'ERR_LEDGER_LOAN_NOT_FOUND' || code === 'ERR_ILLEGAL_TRANSITION') {
    const approved = SEED_LOANS.find((loan) => loan.status === 'APPROVED')
    if (approved !== undefined) {
      changes.push({ field: 'loanId', from: input.loanId, to: approved.id })
      input.loanId = approved.id
      if ('expectedVersion' in fields) {
        changes.push({ field: 'expectedVersion', from: input.expectedVersion, to: approved.version })
        input.expectedVersion = approved.version
      }
    }
  } else if (code === 'ERR_STALE_IF_MATCH' && typeof input.loanId === 'string') {
    const loan = SEED_LOANS.find((candidate) => candidate.id === input.loanId)
    if (loan !== undefined) {
      changes.push({ field: 'expectedVersion', from: input.expectedVersion, to: loan.version })
      input.expectedVersion = loan.version
    }
  }

  return { input, changes, fixable: changes.length > 0 && INPUT_SCHEMAS[name].safeParse(input).success }
}
