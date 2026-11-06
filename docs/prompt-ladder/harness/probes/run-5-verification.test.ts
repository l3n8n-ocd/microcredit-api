import { describe, expect, it } from 'vitest'
import { applyForLoan, toCentavos, transitionLoan, type Loan, type LoanEvent } from './loanStateMachine'
let n = 500
const key = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const go = (l: Loan, e: Record<string, unknown>): Loan => {
  const r = transitionLoan(l, { ...e, idempotencyKey: key(), ifMatch: l.version } as LoanEvent)
  if (!r.ok) throw new Error(JSON.stringify(r)); return r.loan
}
const repaying = () => [
  { type: 'SUBMIT_FOR_REVIEW' }, { type: 'APPROVE', financeCharge: toCentavos(5000) },
  { type: 'DISBURSE', wallet: 'gcash' }, { type: 'START_REPAYMENT' },
].reduce(go, applyForLoan({ id: 'L', borrowerId: 'B', principal: toCentavos(100000) }))
describe('run 5 regression probe (same checks that caught run 4)', () => {
  it('interest cannot be over-booked: a ₱1.00 payment books at most the outstanding interest', () => {
    const r = transitionLoan(repaying(), { type: 'RECORD_REPAYMENT', amount: toCentavos(100), channel: 'gcash', idempotencyKey: key(), ifMatch: 5 } as LoanEvent)
    expect(r.ok && r.journalEntry?.lines).toEqual([
      { account: 'wallet_clearing:gcash', side: 'DEBIT', amount: 100 }, { account: 'interest_income', side: 'CREDIT', amount: 100 }])
  })
  it('DELINQUENT loans accept partial repayments', () => {
    const d = go(repaying(), { type: 'MARK_DELINQUENT' })
    expect(go(d, { type: 'RECORD_REPAYMENT', amount: toCentavos(1000), channel: 'maya' }).status).toBe('DELINQUENT')
  })
})
