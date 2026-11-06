import { describe, expect, it } from 'vitest'
import { createApplication, transitionLoan, isBalanced, type LoanAggregate, type LoanEvent, type Centavos, type IdempotencyKey, type LoanVersion } from './impl'
const k = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as IdempotencyKey
const c = (n: number) => n as Centavos
let n = 0
function step(agg: LoanAggregate, e: Record<string, unknown>, key = k(++n)) {
  const r = transitionLoan(agg, { ...e, idempotencyKey: key, ifMatch: agg.loan.version as LoanVersion, occurredAt: '2026-11-06T00:00:00Z' } as LoanEvent)
  if (!r.ok) throw new Error(JSON.stringify(r))
  return { agg: r.next, r, key }
}
function toRepaying() {
  let a = createApplication({ id: 'L1', borrowerId: 'B1', requestedPrincipal: c(100000) })
  a = step(a, { type: 'START_REVIEW' }).agg
  a = step(a, { type: 'APPROVE', terms: { principal: c(100000), interest: c(5000) } }).agg
  a = step(a, { type: 'DISBURSE', wallet: 'gcash' }).agg
  return step(a, { type: 'BEGIN_REPAYMENT' }).agg
}
describe('run 3 probe', () => {
  it('₱1,050.00 repayment posts a balanced 3-line entry and allows SETTLE', () => {
    const s = step(toRepaying(), { type: 'POST_REPAYMENT', amount: c(105000), channel: 'gcash' })
    const e = s.r.ok ? s.r.response.journalEntry : null
    expect(e?.lines.map((l) => [l.account, l.side, l.amount])).toEqual([
      ['wallet_clearing:gcash', 'DEBIT', 105000], ['interest_income', 'CREDIT', 5000], ['loans_receivable:B1', 'CREDIT', 100000]])
    expect(e && isBalanced(e)).toBe(true)
    expect(step(s.agg, { type: 'SETTLE' }).agg.loan.status).toBe('SETTLED')
  })
  it('replaying the same key returns replayed: true and posts nothing new', () => {
    const before = toRepaying()
    const first = step(before, { type: 'POST_REPAYMENT', amount: c(50000), channel: 'gcash' })
    const again = transitionLoan(first.agg, { type: 'POST_REPAYMENT', amount: c(50000), channel: 'gcash', idempotencyKey: first.key, ifMatch: before.loan.version, occurredAt: 'x' } as LoanEvent)
    expect(again.ok && again.replayed).toBe(true)
    expect(again.ok ? again.next.journal.length : -1).toBe(first.agg.journal.length)
  })
  it('stale If-Match and illegal transition both return 409', () => {
    const a = toRepaying()
    const stale = transitionLoan(a, { type: 'MARK_DELINQUENT', idempotencyKey: k(900), ifMatch: 1 as LoanVersion, occurredAt: 'x' } as LoanEvent)
    expect(!stale.ok && [stale.status, stale.code]).toEqual([409, 'VERSION_MISMATCH'])
    const bad = transitionLoan(a, { type: 'APPROVE', terms: { principal: c(1), interest: c(0) }, idempotencyKey: k(901), ifMatch: a.loan.version, occurredAt: 'x' } as LoanEvent)
    expect(!bad.ok && [bad.status, bad.code]).toEqual([409, 'ILLEGAL_TRANSITION'])
  })
  it('DELINQUENT loans still accept repayments', () => {
    const d = step(toRepaying(), { type: 'MARK_DELINQUENT' }).agg
    expect(step(d, { type: 'POST_REPAYMENT', amount: c(1000), channel: 'maya' }).agg.loan.status).toBe('DELINQUENT')
  })
})
