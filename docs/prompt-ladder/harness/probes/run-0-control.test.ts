import { describe, expect, it } from 'vitest'
import { Loan, LoanError, type LoanTerms } from './loan'

const TERMS: LoanTerms = {
  principal: 10_000_000,
  annualInterestRate: 0.24,
  termMonths: 12,
  gracePeriodDays: 5,
  lateFee: 50_000,
  defaultAfterDays: 90,
}

function active(id: string): Loan {
  const loan = new Loan(id, TERMS, '2026-01-20')
  loan.approve('2026-01-25')
  loan.disburse('2026-01-31')
  return loan
}

describe('run 0 control probe (same checks as the subagent baseline)', () => {
  it('lifecycle methods mutate the loan in place (not pure)', () => {
    const loan = new Loan('L-1', TERMS, '2026-01-20')
    const result = loan.approve('2026-01-25')
    expect(result).toBeUndefined()
    expect(loan.status).toBe('APPROVED')
  })

  it('illegal transitions THROW a LoanError instead of returning a typed 409', () => {
    const loan = new Loan('L-2', TERMS, '2026-01-20')
    expect(() => loan.disburse('2026-01-21')).toThrow(LoanError)
  })

  it('idempotency is per loan and payload-aware: the subagent baseline’s cross-loan bug is absent', () => {
    const a = active('A')
    const b = active('B')
    a.applyPayment({ id: 'same-id', amount: 100_000, receivedOn: '2026-02-10' })
    b.applyPayment({ id: 'same-id', amount: 200_000, receivedOn: '2026-02-10' })
    expect(a.payments.map((p) => p.amount)).toEqual([100_000])
    expect(b.payments.map((p) => p.amount)).toEqual([200_000])
    expect(() => a.applyPayment({ id: 'same-id', amount: 999, receivedOn: '2026-02-10' })).toThrow(LoanError)
  })

  it('no version / If-Match: two writers working from the same snapshot silently lose an update', () => {
    const loan = active('L-3')
    const snapshot = loan.snapshot()
    const adminA = Loan.restore(snapshot)
    const adminB = Loan.restore(snapshot)
    adminA.applyPayment({ id: 'pay-A', amount: 100_000, receivedOn: '2026-02-10' })
    adminB.applyPayment({ id: 'pay-B', amount: 100_000, receivedOn: '2026-02-10' })
    // Nothing detects the conflict: whichever snapshot is saved last drops the other payment.
    expect(adminB.payments.map((p) => p.id)).toEqual(['pay-B'])
    expect('version' in adminB.snapshot()).toBe(false)
  })
})
