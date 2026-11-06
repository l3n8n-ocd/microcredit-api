import { sumCentavos, toCentavos } from '../../utils/index.ts'
import type { LoanEvent, LoanEventType, LoanOf, LoanState, LoanStatus, TransitionResult } from './types.ts'

/** The only legal (state, event) pairs. Everything else is a 409. */
export const LEGAL_TRANSITIONS: Readonly<Record<LoanStatus, readonly LoanEventType[]>> = {
  APPLIED: ['START_REVIEW'],
  UNDER_REVIEW: ['APPROVE', 'REJECT'],
  APPROVED: ['DISBURSE', 'CANCEL'],
  REJECTED: [],
  CANCELLED: [],
  DISBURSED: ['POST_REPAYMENT'],
  REPAYING: ['POST_REPAYMENT', 'REVERSE_REPAYMENT', 'MARK_DELINQUENT'],
  SETTLED: [],
  DELINQUENT: ['REVERSE_REPAYMENT', 'CURE', 'MARK_DEFAULTED'],
  DEFAULTED: [],
}

function illegal(loan: LoanState, event: LoanEvent): TransitionResult {
  return {
    ok: false,
    status: 409,
    code: 'ILLEGAL_TRANSITION',
    from: loan.status,
    event: event.type,
    message: `Cannot ${event.type} a loan that is ${loan.status}.`,
  }
}

function invalidAmount(loan: LoanState, event: LoanEvent, message: string): TransitionResult {
  return { ok: false, status: 422, code: 'INVALID_AMOUNT', from: loan.status, event: event.type, message }
}

type FundedLoan = LoanOf<'DISBURSED' | 'REPAYING' | 'SETTLED' | 'DELINQUENT' | 'DEFAULTED'>

function funded(loan: FundedLoan) {
  return { disbursedAmount: loan.disbursedAmount, provider: loan.provider, journalEntryId: loan.journalEntryId }
}

/** Principal still owed. DISBURSED owes everything; SETTLED owes nothing. */
export function outstandingPrincipal(loan: FundedLoan) {
  switch (loan.status) {
    case 'DISBURSED':
      return loan.disbursedAmount
    case 'SETTLED':
      return toCentavos(0)
    default:
      return loan.outstandingPrincipal
  }
}

/** Pure: never mutates `loan`. A successful transition returns a new loan with `version + 1`. */
export function transitionLoan(loan: LoanState, event: LoanEvent): TransitionResult {
  if (!LEGAL_TRANSITIONS[loan.status].includes(event.type)) return illegal(loan, event)
  const base = { id: loan.id, borrowerId: loan.borrowerId, version: loan.version + 1 }

  switch (loan.status) {
    case 'APPLIED':
      return { ok: true, loan: { ...base, status: 'UNDER_REVIEW' } }
    case 'UNDER_REVIEW':
      if (event.type === 'APPROVE') return { ok: true, loan: { ...base, status: 'APPROVED' } }
      if (event.type === 'REJECT') return { ok: true, loan: { ...base, status: 'REJECTED', reason: event.reason } }
      return illegal(loan, event)
    case 'APPROVED':
      if (event.type === 'CANCEL') return { ok: true, loan: { ...base, status: 'CANCELLED', reason: event.reason } }
      if (event.type === 'DISBURSE') {
        return {
          ok: true,
          loan: {
            ...base,
            status: 'DISBURSED',
            disbursedAmount: event.amount,
            provider: event.provider,
            journalEntryId: event.journalEntryId,
          },
        }
      }
      return illegal(loan, event)
    case 'DISBURSED':
    case 'REPAYING':
    case 'DELINQUENT': {
      const owed = outstandingPrincipal(loan)
      if (event.type === 'POST_REPAYMENT') {
        if (event.principal <= 0 || event.principal > owed) {
          return invalidAmount(loan, event, `Principal must be more than 0 and at most the ${owed} centavos still owed.`)
        }
        const left = toCentavos(owed - event.principal)
        return left === 0
          ? { ok: true, loan: { ...base, ...funded(loan), status: 'SETTLED' } }
          : { ok: true, loan: { ...base, ...funded(loan), status: 'REPAYING', outstandingPrincipal: left } }
      }
      if (event.type === 'REVERSE_REPAYMENT') {
        const restored = sumCentavos([owed, event.principal])
        if (event.principal <= 0 || restored > loan.disbursedAmount) {
          return invalidAmount(loan, event, 'A reversal cannot restore more principal than was disbursed.')
        }
        // A reversal never changes REPAYING ⇄ DELINQUENT: only the balance moves.
        const status = loan.status === 'DELINQUENT' ? 'DELINQUENT' : 'REPAYING'
        return { ok: true, loan: { ...base, ...funded(loan), status, outstandingPrincipal: restored } }
      }
      if (event.type === 'MARK_DELINQUENT') {
        return { ok: true, loan: { ...base, ...funded(loan), status: 'DELINQUENT', outstandingPrincipal: owed } }
      }
      if (event.type === 'CURE') {
        return { ok: true, loan: { ...base, ...funded(loan), status: 'REPAYING', outstandingPrincipal: owed } }
      }
      if (event.type === 'MARK_DEFAULTED') {
        return { ok: true, loan: { ...base, ...funded(loan), status: 'DEFAULTED', outstandingPrincipal: owed } }
      }
      return illegal(loan, event)
    }
    case 'REJECTED':
    case 'CANCELLED':
    case 'SETTLED':
    case 'DEFAULTED':
      return illegal(loan, event)
    default: {
      const unreachable: never = loan
      return unreachable
    }
  }
}
