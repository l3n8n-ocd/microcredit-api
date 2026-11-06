import { describe, expect, it } from 'vitest'
import { LoanService, toCents, cents, InvalidTransitionError, ConcurrencyError } from './impl'
const svc = () => new LoanService({ lateFee: toCents('25.00'), gracePeriodDays: 5, defaultAfterDays: 90 })
describe('run 0 probe', () => {
  it('transition() mutates its input and returns the same object (not pure)', () => {
    const s = svc(); const loan = s.createLoan({ borrowerId: 'B', principal: toCents('1000.00'), annualRateBps: 1200, termMonths: 3 })
    const out = s.transition(loan, { type: 'SUBMIT' }, 0)
    expect(out).toBe(loan); expect(loan.status).toBe('SUBMITTED')
  })
  it('illegal transition and stale version THROW instead of returning a typed 409', () => {
    const s = svc(); const loan = s.createLoan({ borrowerId: 'B', principal: toCents('1000.00'), annualRateBps: 1200, termMonths: 3 })
    expect(() => s.transition(loan, { type: 'APPROVE' }, 0)).toThrow(InvalidTransitionError)
    expect(() => s.transition(loan, { type: 'SUBMIT' }, 7)).toThrow(ConcurrencyError)
  })
  it('schedule nets to exactly the principal despite float rate math', () => {
    const s = svc(); const loan = s.createLoan({ borrowerId: 'B', principal: toCents('5000.00'), annualRateBps: 1200, termMonths: 12 })
    for (const [e, v] of [['SUBMIT', 0], ['START_REVIEW', 1], ['APPROVE', 2], ['DISBURSE', 3]] as const) s.transition(loan, { type: e }, v)
    expect(loan.schedule.reduce((a, i) => a + i.principalDue, 0)).toBe(500000)
  })
  it('idempotency map is keyed globally and ignores the payload: same key on a DIFFERENT loan returns the first loan\'s payment', () => {
    const s = svc()
    const mk = () => { const l = s.createLoan({ borrowerId: 'B', principal: toCents('1000.00'), annualRateBps: 0, termMonths: 2 }); for (const [e, v] of [['SUBMIT',0],['START_REVIEW',1],['APPROVE',2],['DISBURSE',3],['ACTIVATE',4]] as const) s.transition(l, { type: e }, v); return l }
    const a = mk(), b = mk()
    const p1 = s.applyPayment(a, cents(100), 'same-key')
    const p2 = s.applyPayment(b, cents(99999), 'same-key')
    expect(p2).toBe(p1); expect(b.payments.length).toBe(0)
  })
})
