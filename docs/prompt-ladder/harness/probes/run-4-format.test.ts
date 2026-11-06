import { describe, expect, it } from 'vitest'
import { transitionLoan } from './stateMachine'
import type { Centavos, Loan, LoanEvent } from './types'
const k = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const c = (n: number) => n as Centavos
let n = 0
function step(loan: Loan, e: Record<string, unknown>, key = k(++n)) {
  const r = transitionLoan(loan, { ...e, idempotencyKey: key, ifMatch: loan.version } as LoanEvent)
  if (!r.ok) throw new Error(JSON.stringify(r))
  return { loan: r.loan, r, key }
}
function toRepaying(): Loan {
  let l: Loan = { id: 'L1', borrowerId: 'B1', principal: c(100000), version: 0, processed: {}, status: 'APPLIED' }
  for (const e of [{ type: 'SUBMIT_FOR_REVIEW' }, { type: 'APPROVE' }, { type: 'DISBURSE', channel: 'gcash' }, { type: 'START_REPAYMENT' }]) l = step(l, e).loan
  return l
}
describe('run 4 probe', () => {
  it('₱1,050.00 repayment posts a balanced 3-line entry and settles', () => {
    const s = step(toRepaying(), { type: 'REPAY', principal: c(100000), interest: c(5000), channel: 'gcash' })
    expect(s.r.ok && s.r.entry?.lines.map((l) => [l.account, l.side, l.amount])).toEqual([
      ['wallet_clearing:gcash', 'DEBIT', 105000], ['loans_receivable:B1', 'CREDIT', 100000], ['interest_income', 'CREDIT', 5000]])
    expect(s.loan.status).toBe('SETTLED')
  })
  it('replaying the same key returns replayed: true', () => {
    const before = toRepaying()
    const first = step(before, { type: 'REPAY', principal: c(50000), interest: c(0), channel: 'gcash' })
    const again = transitionLoan(first.loan, { type: 'REPAY', principal: c(50000), interest: c(0), channel: 'gcash', idempotencyKey: first.key, ifMatch: before.version } as LoanEvent)
    expect(again.ok && again.replayed).toBe(true)
  })
  it('stale If-Match and illegal transition both return 409', () => {
    const a = toRepaying()
    const stale = transitionLoan(a, { type: 'MARK_DELINQUENT', idempotencyKey: k(900), ifMatch: 0 } as LoanEvent)
    expect(!stale.ok && [stale.status, stale.code]).toEqual([409, 'VERSION_MISMATCH'])
    const bad = transitionLoan(a, { type: 'APPROVE', idempotencyKey: k(901), ifMatch: a.version } as LoanEvent)
    expect(!bad.ok && [bad.status, bad.code]).toEqual([409, 'ILLEGAL_TRANSITION'])
  })
  it('REGRESSION CHECK: interest is unbounded (caller can book any interest amount)', () => {
    const r = transitionLoan(toRepaying(), { type: 'REPAY', principal: c(1), interest: c(99_999_999), channel: 'gcash', idempotencyKey: k(950), ifMatch: 4 } as LoanEvent)
    expect(r.ok).toBe(true)
  })
  it('REGRESSION CHECK: DELINQUENT loans reject repayments', () => {
    const d = step(toRepaying(), { type: 'MARK_DELINQUENT' }).loan
    const r = transitionLoan(d, { type: 'REPAY', principal: c(1000), interest: c(0), channel: 'maya', idempotencyKey: k(960), ifMatch: d.version } as LoanEvent)
    expect(!r.ok && r.code).toBe('ILLEGAL_TRANSITION')
  })
  it('REGRESSION CHECK: CANCELLED keeps no reason (state data collapsed)', () => {
    let l: Loan = { id: 'L2', borrowerId: 'B2', principal: c(1), version: 0, processed: {}, status: 'APPLIED' }
    for (const e of [{ type: 'SUBMIT_FOR_REVIEW' }, { type: 'APPROVE' }, { type: 'CANCEL' }]) l = step(l, e).loan
    expect(l.status).toBe('CANCELLED')
    expect('reason' in l).toBe(false)
  })
})
