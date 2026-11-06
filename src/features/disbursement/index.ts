// Public API of the disbursement feature: idempotent payout form, loan commands, state machine, ledger.
export { DisbursementForm, type DisbursementFormProps } from './DisbursementForm.tsx'
export {
  createDisbursementServer,
  formatIfMatch,
  type DisbursementServer,
  type DisbursementServerOptions,
} from './disbursementServer.ts'
export {
  accountBalance,
  buildDisbursementJournal,
  buildRepaymentJournal,
  buildReversalJournal,
  isReversed,
  journalTotals,
  type ReversalResult,
} from './ledger.ts'
export { LEGAL_TRANSITIONS, outstandingPrincipal, transitionLoan } from './loanStateMachine.ts'
export { SAMPLE_PAYOUT, SEED_LOANS } from './seedLoans.ts'
export { validateDisbursement } from './validation.ts'
export type * from './types.ts'
