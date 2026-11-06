import type { LoanCommandResponse } from '../disbursement/index.ts'

export interface Announcement {
  readonly tone: 'success' | 'alert'
  readonly text: string
}

/** One line per response, for the live region. */
export function describeCommand(loanId: string, response: LoanCommandResponse): Announcement {
  switch (response.kind) {
    case 'APPLIED':
    case 'REPLAYED': {
      const entry = response.journalEntry === null ? '' : ` Posted ${response.journalEntry.id}.`
      const queue = response.loan.status === 'APPROVED' ? ' It is now in the Disburse form.' : ''
      const replay = response.kind === 'REPLAYED' ? ' (idempotent replay, nothing new posted)' : ''
      return { tone: 'success', text: `${loanId} is now ${response.loan.status} (v${response.loan.version})${replay}.${entry}${queue}` }
    }
    case 'CONFLICT':
    case 'UNPROCESSABLE':
      return { tone: 'alert', text: `${loanId}: ${response.status} ${response.code}. ${response.message}` }
    case 'BAD_REQUEST':
    case 'NOT_FOUND':
      return { tone: 'alert', text: `${loanId}: ${response.status}. ${response.message}` }
    default: {
      const unreachable: never = response
      return unreachable
    }
  }
}
