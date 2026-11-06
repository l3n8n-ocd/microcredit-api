import { isCentavos, isUuidV4 } from '../../utils/index.ts'
import { buildDisbursementJournal } from './ledger.ts'
import { transitionLoan } from './loanStateMachine.ts'
import type {
  DisbursementRequest,
  DisbursementResponse,
  JournalEntry,
  LoanOf,
  LoanState,
} from './types.ts'
import { isDisbursableAmount, isValidReferenceNote, isWalletProvider, PH_MOBILE_PATTERN } from './validation.ts'

/**
 * In-memory stand-in for `POST /loans/:id/disbursements`.
 *
 * Check order matters:
 *   1. Idempotency-Key seen before → replay the stored result. This runs BEFORE
 *      the If-Match check, because a legitimate retry carries the version that
 *      was current before its own first attempt committed.
 *   2. Body validation → 400 / 422.
 *   3. If-Match must equal the loan's current version → else 409 VERSION_MISMATCH.
 *   4. transitionLoan(APPROVED → DISBURSED) → else 409 ILLEGAL_TRANSITION.
 *   5. Post the journal entry, update the loan, store the result under the key.
 *
 * Steps 1–5 run synchronously after the simulated latency, so they behave like
 * one ACID transaction: two concurrent requests can never interleave inside it.
 */
export interface DisbursementServer {
  disburse: (request: DisbursementRequest) => Promise<DisbursementResponse>
  listLoans: () => readonly LoanState[]
  getLedger: () => readonly JournalEntry[]
  reset: () => void
}

export interface DisbursementServerOptions {
  /** Simulated network + processing latency in ms. Use 0 in tests. */
  readonly latencyMs?: number
}

interface StoredResult {
  readonly fingerprint: string
  readonly loan: LoanOf<'DISBURSED'>
  readonly journalEntry: JournalEntry
}

const ETAG = /^"(\d+)"$/

export function formatIfMatch(version: number): string {
  return `"${version}"`
}

function fingerprint(request: DisbursementRequest): string {
  const { body } = request
  return JSON.stringify([
    request.headers['If-Match'],
    body.loanId,
    body.provider,
    body.recipientMobile,
    body.amount,
    body.referenceNote,
  ])
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createDisbursementServer(
  seedLoans: readonly LoanState[],
  options: DisbursementServerOptions = {},
): DisbursementServer {
  const latencyMs = options.latencyMs ?? 0
  let loans = new Map(seedLoans.map((loan) => [loan.id, loan]))
  let ledger: JournalEntry[] = []
  let results = new Map<string, StoredResult>()

  function commit(request: DisbursementRequest): DisbursementResponse {
    const key = request.headers['Idempotency-Key']
    const { body } = request

    if (!isUuidV4(key)) {
      return { kind: 'BAD_REQUEST', status: 400, message: 'Idempotency-Key must be a UUID v4.' }
    }

    // 1. Idempotent replay.
    const stored = results.get(key)
    if (stored !== undefined) {
      if (stored.fingerprint !== fingerprint(request)) {
        return {
          kind: 'UNPROCESSABLE',
          status: 422,
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'This Idempotency-Key was already used with a different payload.',
        }
      }
      return { kind: 'REPLAYED', status: 201, loan: stored.loan, journalEntry: stored.journalEntry }
    }

    // 2. Validation (never trust the client).
    const etag = ETAG.exec(request.headers['If-Match'])
    if (etag === null) {
      return { kind: 'BAD_REQUEST', status: 400, message: 'If-Match must be a quoted version, e.g. "3".' }
    }
    if (
      !isCentavos(body.amount) ||
      !isDisbursableAmount(body.amount) ||
      !isWalletProvider(body.provider) ||
      !PH_MOBILE_PATTERN.test(body.recipientMobile) ||
      !isValidReferenceNote(body.referenceNote)
    ) {
      return { kind: 'UNPROCESSABLE', status: 422, code: 'INVALID_BODY', message: 'Request body failed validation.' }
    }

    const loan = loans.get(body.loanId)
    if (loan === undefined) {
      return { kind: 'NOT_FOUND', status: 404, message: `Loan ${body.loanId} not found.` }
    }

    // 3. Optimistic concurrency.
    if (Number(etag[1]) !== loan.version) {
      return {
        kind: 'CONFLICT',
        status: 409,
        code: 'VERSION_MISMATCH',
        message: `If-Match ${request.headers['If-Match']} is stale; loan ${loan.id} is at version ${loan.version}.`,
        currentVersion: loan.version,
      }
    }

    // 4. State machine.
    const journalEntryId = `JE-${String(ledger.length + 1).padStart(4, '0')}`
    const transition = transitionLoan(loan, {
      type: 'DISBURSE',
      amount: body.amount,
      provider: body.provider,
      journalEntryId,
    })
    if (!transition.ok) {
      return {
        kind: 'CONFLICT',
        status: 409,
        code: 'ILLEGAL_TRANSITION',
        message: transition.message,
        currentVersion: loan.version,
      }
    }
    if (loan.status !== 'APPROVED' || transition.loan.status !== 'DISBURSED') {
      throw new Error('Invariant violated: DISBURSE must move APPROVED → DISBURSED')
    }

    // 5. Commit: ledger entry + new loan state + idempotency record, together.
    const journalEntry = buildDisbursementJournal({
      id: journalEntryId,
      loan,
      amount: body.amount,
      provider: body.provider,
      idempotencyKey: key,
    })
    ledger = [...ledger, journalEntry]
    loans = new Map(loans).set(loan.id, transition.loan)
    results = new Map(results).set(key, {
      fingerprint: fingerprint(request),
      loan: transition.loan,
      journalEntry,
    })
    return { kind: 'CREATED', status: 201, loan: transition.loan, journalEntry }
  }

  return {
    disburse: async (request) => {
      await wait(latencyMs)
      return commit(request)
    },
    listLoans: () => [...loans.values()],
    getLedger: () => ledger,
    reset: () => {
      loans = new Map(seedLoans.map((loan) => [loan.id, loan]))
      ledger = []
      results = new Map()
    },
  }
}
