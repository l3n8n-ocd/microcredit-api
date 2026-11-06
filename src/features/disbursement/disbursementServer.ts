import { isCentavos, isUuidV4 } from '../../utils/index.ts'
import { buildDisbursementJournal, buildRepaymentJournal, buildReversalJournal } from './ledger.ts'
import { transitionLoan } from './loanStateMachine.ts'
import type {
  DisbursementRequest,
  DisbursementResponse,
  JournalEntry,
  LoanCommandRequest,
  LoanCommandResponse,
  LoanEvent,
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
  /**
   * In-memory stand-in for `POST /loans/:id/commands` (review decisions,
   * repayments, reversals). Same check order as `disburse`: replay first,
   * then validation, If-Match, the state machine, and one atomic commit.
   */
  command: (request: LoanCommandRequest) => Promise<LoanCommandResponse>
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

interface StoredCommand {
  readonly fingerprint: string
  readonly loan: LoanState
  readonly journalEntry: JournalEntry | null
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
  let commandResults = new Map<string, StoredCommand>()

  function nextEntryId(): string {
    return `JE-${String(ledger.length + 1).padStart(4, '0')}`
  }

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
    const journalEntryId = nextEntryId()
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

  function runCommand(request: LoanCommandRequest): LoanCommandResponse {
    const key = request.headers['Idempotency-Key']
    const { body } = request
    const print = JSON.stringify([request.headers['If-Match'], body])

    if (!isUuidV4(key)) {
      return { kind: 'BAD_REQUEST', status: 400, message: 'Idempotency-Key must be a UUID v4.' }
    }

    // 1. Idempotent replay, before If-Match (a retry carries the pre-commit version).
    const stored = commandResults.get(key)
    if (stored !== undefined) {
      if (stored.fingerprint !== print) {
        return {
          kind: 'UNPROCESSABLE',
          status: 422,
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'This Idempotency-Key was already used with a different payload.',
        }
      }
      return { kind: 'REPLAYED', status: 200, loan: stored.loan, journalEntry: stored.journalEntry }
    }

    // 2. Validation.
    const etag = ETAG.exec(request.headers['If-Match'])
    if (etag === null) {
      return { kind: 'BAD_REQUEST', status: 400, message: 'If-Match must be a quoted version, e.g. "3".' }
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

    // 4. Build the event and its journal entry without touching state.
    let event: LoanEvent
    let journalEntry: JournalEntry | null = null
    switch (body.type) {
      case 'START_REVIEW':
      case 'APPROVE':
        event = { type: body.type }
        break
      case 'REJECT':
        if (body.reasonCodes.length === 0) {
          return { kind: 'UNPROCESSABLE', status: 422, code: 'INVALID_BODY', message: 'A rejection needs at least one reason code.' }
        }
        event = { type: 'REJECT', reason: body.reasonCodes.join(', ') }
        break
      case 'POST_REPAYMENT': {
        const { principal, interest } = body.split
        if (!isCentavos(principal) || !isCentavos(interest) || principal <= 0 || interest < 0) {
          return { kind: 'UNPROCESSABLE', status: 422, code: 'INVALID_BODY', message: 'Repayment split must be whole centavos, principal > 0.' }
        }
        event = { type: 'POST_REPAYMENT', principal }
        if (loan.status === 'DISBURSED' || loan.status === 'REPAYING') {
          journalEntry = buildRepaymentJournal({ id: nextEntryId(), loan, split: body.split, idempotencyKey: key })
        }
        break
      }
      case 'REVERSE_REPAYMENT': {
        const reversal = buildReversalJournal({
          id: nextEntryId(),
          ledger,
          reversesEntryId: body.reversesEntryId,
          idempotencyKey: key,
        })
        if (!reversal.ok) {
          return { kind: 'UNPROCESSABLE', status: 422, code: reversal.code, message: reversal.message }
        }
        if (reversal.entry.loanId !== loan.id) {
          return {
            kind: 'UNPROCESSABLE',
            status: 422,
            code: 'NOT_REVERSIBLE',
            message: `${body.reversesEntryId} belongs to loan ${reversal.entry.loanId}, not ${loan.id}.`,
          }
        }
        event = { type: 'REVERSE_REPAYMENT', principal: reversal.principal }
        journalEntry = reversal.entry
        break
      }
      default: {
        const unreachable: never = body
        return unreachable
      }
    }

    // 5. State machine: illegal pair → 409, bad amount → 422. Nothing is posted.
    const transition = transitionLoan(loan, event)
    if (!transition.ok) {
      return transition.status === 409
        ? { kind: 'CONFLICT', status: 409, code: 'ILLEGAL_TRANSITION', message: transition.message, currentVersion: loan.version }
        : { kind: 'UNPROCESSABLE', status: 422, code: 'INVALID_AMOUNT', message: transition.message }
    }

    // 6. Commit: journal entry + new loan state + idempotency record, together.
    if (journalEntry !== null) ledger = [...ledger, journalEntry]
    loans = new Map(loans).set(loan.id, transition.loan)
    commandResults = new Map(commandResults).set(key, { fingerprint: print, loan: transition.loan, journalEntry })
    return { kind: 'APPLIED', status: 200, loan: transition.loan, journalEntry }
  }

  return {
    disburse: async (request) => {
      await wait(latencyMs)
      return commit(request)
    },
    listLoans: () => [...loans.values()],
    getLedger: () => ledger,
    command: async (request) => {
      await wait(latencyMs)
      return runCommand(request)
    },
    reset: () => {
      loans = new Map(seedLoans.map((loan) => [loan.id, loan]))
      ledger = []
      results = new Map()
      commandResults = new Map()
    },
  }
}
