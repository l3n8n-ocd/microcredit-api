import type { Centavos } from '../../utils/index.ts'

export type { Centavos } from '../../utils/index.ts'

// ── Loan state machine ──────────────────────────────────────────────────────

/**
 * The full lifecycle (README "Loan Lifecycle State Machine"):
 *   APPLIED → UNDER_REVIEW → APPROVED → DISBURSED → REPAYING → SETTLED
 *   UNDER_REVIEW → REJECTED, APPROVED → CANCELLED, DISBURSED → SETTLED (one full repayment),
 *   REPAYING ⇄ DELINQUENT, DELINQUENT → DEFAULTED.
 */
export type LoanStatus =
  | 'APPLIED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'DISBURSED'
  | 'REPAYING'
  | 'SETTLED'
  | 'DELINQUENT'
  | 'DEFAULTED'

interface LoanBase {
  readonly id: string
  readonly borrowerId: string
  /** Optimistic-concurrency version. Every successful transition increments it. */
  readonly version: number
}

/** Data that exists once money has left: what was sent, where, and by which journal entry. */
interface Funded {
  readonly disbursedAmount: Centavos
  readonly provider: WalletProvider
  readonly journalEntryId: string
}

/** Principal still owed. A DISBURSED loan owes its full `disbursedAmount`; a SETTLED loan owes 0. */
interface Outstanding {
  readonly outstandingPrincipal: Centavos
}

/** Discriminated on `status`: each state carries only the data that exists in it. */
export type LoanState =
  | (LoanBase & { readonly status: 'APPLIED' })
  | (LoanBase & { readonly status: 'UNDER_REVIEW' })
  | (LoanBase & { readonly status: 'APPROVED' })
  | (LoanBase & { readonly status: 'REJECTED'; readonly reason: string })
  | (LoanBase & { readonly status: 'CANCELLED'; readonly reason: string })
  | (LoanBase & Funded & { readonly status: 'DISBURSED' })
  | (LoanBase & Funded & Outstanding & { readonly status: 'REPAYING' })
  | (LoanBase & Funded & { readonly status: 'SETTLED' })
  | (LoanBase & Funded & Outstanding & { readonly status: 'DELINQUENT' })
  | (LoanBase & Funded & Outstanding & { readonly status: 'DEFAULTED' })

export type LoanOf<S extends LoanStatus> = Extract<LoanState, { readonly status: S }>

export type LoanEvent =
  | { readonly type: 'START_REVIEW' }
  | { readonly type: 'APPROVE' }
  | { readonly type: 'REJECT'; readonly reason: string }
  | {
      readonly type: 'DISBURSE'
      readonly amount: Centavos
      readonly provider: WalletProvider
      readonly journalEntryId: string
    }
  | { readonly type: 'CANCEL'; readonly reason: string }
  /** Principal part of a posted repayment. The loan settles when nothing is left. */
  | { readonly type: 'POST_REPAYMENT'; readonly principal: Centavos }
  /** Principal part of a repayment that a compensating entry just reversed. */
  | { readonly type: 'REVERSE_REPAYMENT'; readonly principal: Centavos }
  | { readonly type: 'MARK_DELINQUENT' }
  | { readonly type: 'CURE' }
  | { readonly type: 'MARK_DEFAULTED' }

export type LoanEventType = LoanEvent['type']

export type TransitionResult =
  | { readonly ok: true; readonly loan: LoanState }
  | {
      readonly ok: false
      readonly status: 409
      readonly code: 'ILLEGAL_TRANSITION'
      readonly from: LoanStatus
      readonly event: LoanEventType
      readonly message: string
    }
  | {
      /** The event is legal in this state, but its amount is not (e.g. repaying more than is owed). */
      readonly ok: false
      readonly status: 422
      readonly code: 'INVALID_AMOUNT'
      readonly from: LoanStatus
      readonly event: LoanEventType
      readonly message: string
    }

// ── Ledger ──────────────────────────────────────────────────────────────────

export type WalletProvider = 'gcash' | 'maya'

export type LedgerAccount =
  | `loans_receivable:${string}`
  | `wallet_clearing:${WalletProvider}`
  | 'interest_income'

export interface JournalLine {
  readonly account: LedgerAccount
  readonly side: 'DEBIT' | 'CREDIT'
  readonly amount: Centavos
}

interface JournalEntryBase {
  readonly id: string
  readonly loanId: string
  readonly idempotencyKey: string
  readonly lines: readonly JournalLine[]
}

/**
 * Append-only. A wrong entry is never edited: a REVERSAL entry mirrors it
 * (every DEBIT becomes a CREDIT and back) and names it in `reversesEntryId`.
 */
export type JournalEntry =
  | (JournalEntryBase & { readonly kind: 'DISBURSEMENT' | 'REPAYMENT' })
  | (JournalEntryBase & { readonly kind: 'REVERSAL'; readonly reversesEntryId: string })

export type JournalEntryKind = JournalEntry['kind']

/** A repayment split so that `principal + interest === total`, in integer centavos. */
export interface RepaymentSplit {
  readonly principal: Centavos
  readonly interest: Centavos
}

export interface JournalTotals {
  readonly debits: Centavos
  readonly credits: Centavos
  readonly balanced: boolean
}

// ── Disbursement API (mock HTTP contract) ───────────────────────────────────

export interface DisbursementRequestBody {
  readonly loanId: string
  readonly provider: WalletProvider
  readonly recipientMobile: string
  readonly amount: Centavos
  readonly referenceNote: string
}

export interface DisbursementRequest {
  readonly headers: {
    readonly 'Idempotency-Key': string
    /** Entity tag of the loan version the operator saw, e.g. `"3"`. */
    readonly 'If-Match': string
  }
  readonly body: DisbursementRequestBody
}

export type ConflictCode = 'VERSION_MISMATCH' | 'ILLEGAL_TRANSITION'

export type DisbursementResponse =
  | {
      readonly kind: 'CREATED'
      readonly status: 201
      readonly loan: LoanOf<'DISBURSED'>
      readonly journalEntry: JournalEntry
    }
  | {
      /** Same Idempotency-Key and payload as an earlier request: the original result, nothing new posted. */
      readonly kind: 'REPLAYED'
      readonly status: 201
      readonly loan: LoanOf<'DISBURSED'>
      readonly journalEntry: JournalEntry
    }
  | {
      readonly kind: 'CONFLICT'
      readonly status: 409
      readonly code: ConflictCode
      readonly message: string
      readonly currentVersion: number
    }
  | {
      readonly kind: 'UNPROCESSABLE'
      readonly status: 422
      readonly code: 'IDEMPOTENCY_KEY_REUSED' | 'INVALID_BODY'
      readonly message: string
    }
  | { readonly kind: 'BAD_REQUEST'; readonly status: 400; readonly message: string }
  | { readonly kind: 'NOT_FOUND'; readonly status: 404; readonly message: string }

// ── Loan commands API (mock HTTP contract) ──────────────────────────────────

/** `POST /loans/:id/commands`: review decisions, repayments and reversals. */
export type LoanCommand =
  | { readonly type: 'START_REVIEW'; readonly loanId: string }
  | { readonly type: 'APPROVE'; readonly loanId: string }
  | { readonly type: 'REJECT'; readonly loanId: string; readonly reasonCodes: readonly string[] }
  | { readonly type: 'POST_REPAYMENT'; readonly loanId: string; readonly split: RepaymentSplit }
  | { readonly type: 'REVERSE_REPAYMENT'; readonly loanId: string; readonly reversesEntryId: string }

export type LoanCommandType = LoanCommand['type']

/** Same headers as a disbursement: every money or state mutation carries both. */
export interface LoanCommandRequest {
  readonly headers: DisbursementRequest['headers']
  readonly body: LoanCommand
}

export type CommandRejectionCode =
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_BODY'
  | 'INVALID_AMOUNT'
  | 'ENTRY_NOT_FOUND'
  | 'NOT_REVERSIBLE'
  | 'ALREADY_REVERSED'

export type LoanCommandResponse =
  | {
      readonly kind: 'APPLIED'
      readonly status: 200
      readonly loan: LoanState
      /** The journal entry this command posted, or null for a review decision. */
      readonly journalEntry: JournalEntry | null
    }
  | {
      /** Same Idempotency-Key and payload as an earlier command: the original result, nothing new posted. */
      readonly kind: 'REPLAYED'
      readonly status: 200
      readonly loan: LoanState
      readonly journalEntry: JournalEntry | null
    }
  | {
      readonly kind: 'CONFLICT'
      readonly status: 409
      readonly code: ConflictCode
      readonly message: string
      readonly currentVersion: number
    }
  | { readonly kind: 'UNPROCESSABLE'; readonly status: 422; readonly code: CommandRejectionCode; readonly message: string }
  | { readonly kind: 'BAD_REQUEST'; readonly status: 400; readonly message: string }
  | { readonly kind: 'NOT_FOUND'; readonly status: 404; readonly message: string }
