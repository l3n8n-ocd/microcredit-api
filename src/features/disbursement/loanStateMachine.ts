import type { LoanEvent, LoanEventType, LoanState, LoanStatus, TransitionResult } from './types.ts'

/** The only legal (state, event) pairs. Everything else is a 409. */
export const LEGAL_TRANSITIONS: Readonly<Record<LoanStatus, readonly LoanEventType[]>> = {
  APPLIED: ['START_REVIEW'],
  UNDER_REVIEW: ['APPROVE', 'REJECT'],
  APPROVED: ['DISBURSE'],
  DISBURSED: [],
  REJECTED: [],
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

/** Pure: never mutates `loan`. A successful transition returns a new loan with `version + 1`. */
export function transitionLoan(loan: LoanState, event: LoanEvent): TransitionResult {
  const base = { id: loan.id, borrowerId: loan.borrowerId, version: loan.version + 1 }

  switch (loan.status) {
    case 'APPLIED':
      return event.type === 'START_REVIEW'
        ? { ok: true, loan: { ...base, status: 'UNDER_REVIEW' } }
        : illegal(loan, event)
    case 'UNDER_REVIEW':
      if (event.type === 'APPROVE') return { ok: true, loan: { ...base, status: 'APPROVED' } }
      if (event.type === 'REJECT') {
        return { ok: true, loan: { ...base, status: 'REJECTED', reason: event.reason } }
      }
      return illegal(loan, event)
    case 'APPROVED':
      return event.type === 'DISBURSE'
        ? {
            ok: true,
            loan: {
              ...base,
              status: 'DISBURSED',
              disbursedAmount: event.amount,
              provider: event.provider,
              journalEntryId: event.journalEntryId,
            },
          }
        : illegal(loan, event)
    case 'DISBURSED':
    case 'REJECTED':
      return illegal(loan, event)
    default: {
      const unreachable: never = loan
      return unreachable
    }
  }
}
