import type { LoanState } from './types.ts'
import type { FormValues } from './validation.ts'

/** Demo portfolio: two loans can be disbursed; the rest show the state machine refusing. */
export const SEED_LOANS: readonly LoanState[] = [
  { id: 'L-1042', borrowerId: 'borrower-42', version: 3, status: 'APPROVED' },
  { id: 'L-1043', borrowerId: 'borrower-17', version: 1, status: 'APPROVED' },
  { id: 'L-1044', borrowerId: 'borrower-08', version: 2, status: 'UNDER_REVIEW' },
  { id: 'L-1045', borrowerId: 'borrower-05', version: 1, status: 'APPLIED' },
  {
    id: 'L-1046',
    borrowerId: 'borrower-31',
    version: 2,
    status: 'REJECTED',
    reason: 'Trust score below threshold',
  },
]

/**
 * A valid payout for the first APPROVED loan, so a visitor can press Disburse or
 * Simulate without typing first. Amounts stay strings: they still go through
 * parsePesosToCentavos on submit (CLAUDE.md §11 rule 2).
 */
export const SAMPLE_PAYOUT: FormValues = {
  loanId: 'L-1042',
  provider: 'gcash',
  recipientMobile: '09171234567',
  amount: '5,000.00',
  dailyCap: '50,000.00',
  referenceNote: 'Sari-sari store restock',
}
