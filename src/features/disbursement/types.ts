import type { Centavos } from '../../utils/index.ts'

export type { Centavos } from '../../utils/index.ts'

// ── Loan state machine ──────────────────────────────────────────────────────

export type LoanStatus = 'APPLIED' | 'UNDER_REVIEW' | 'APPROVED' | 'DISBURSED' | 'REJECTED'

interface LoanBase {
  readonly id: string
  readonly borrowerId: string
  /** Optimistic-concurrency version. Every successful transition increments it. */
  readonly version: number
}

/** Discriminated on `status`: each state carries only the data that exists in it. */
export type LoanState =
  | (LoanBase & { readonly status: 'APPLIED' })
  | (LoanBase & { readonly status: 'UNDER_REVIEW' })
  | (LoanBase & { readonly status: 'APPROVED' })
  | (LoanBase & {
      readonly status: 'DISBURSED'
      readonly disbursedAmount: Centavos
      readonly provider: WalletProvider
      readonly journalEntryId: string
    })
  | (LoanBase & { readonly status: 'REJECTED'; readonly reason: string })

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

export interface JournalEntry {
  readonly id: string
  readonly loanId: string
  readonly idempotencyKey: string
  readonly lines: readonly JournalLine[]
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
