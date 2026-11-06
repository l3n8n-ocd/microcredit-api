import type { LoanState } from './types.ts'

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
