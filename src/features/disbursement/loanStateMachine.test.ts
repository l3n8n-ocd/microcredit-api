import { describe, expect, it } from 'vitest'
import { toCentavos } from '../../utils/index.ts'
import { LEGAL_TRANSITIONS, transitionLoan } from './loanStateMachine.ts'
import type { LoanEvent, LoanState, LoanStatus } from './types.ts'

const base = { id: 'L-1', borrowerId: 'borrower-1', version: 5 }
const funded = { disbursedAmount: toCentavos(500000), provider: 'gcash', journalEntryId: 'JE-0001' } as const

const LOANS: Readonly<Record<LoanStatus, LoanState>> = {
  APPLIED: { ...base, status: 'APPLIED' },
  UNDER_REVIEW: { ...base, status: 'UNDER_REVIEW' },
  APPROVED: { ...base, status: 'APPROVED' },
  DISBURSED: {
    ...base,
    status: 'DISBURSED',
    disbursedAmount: toCentavos(500000),
    provider: 'gcash',
    journalEntryId: 'JE-0001',
  },
  REJECTED: { ...base, status: 'REJECTED', reason: 'score' },
  CANCELLED: { ...base, status: 'CANCELLED', reason: 'offer expired' },
  REPAYING: { ...base, ...funded, status: 'REPAYING', outstandingPrincipal: toCentavos(400000) },
  SETTLED: { ...base, ...funded, status: 'SETTLED' },
  DELINQUENT: { ...base, ...funded, status: 'DELINQUENT', outstandingPrincipal: toCentavos(400000) },
  DEFAULTED: { ...base, ...funded, status: 'DEFAULTED', outstandingPrincipal: toCentavos(400000) },
}

const EVENTS: readonly LoanEvent[] = [
  { type: 'START_REVIEW' },
  { type: 'APPROVE' },
  { type: 'REJECT', reason: 'score' },
  { type: 'DISBURSE', amount: toCentavos(500000), provider: 'maya', journalEntryId: 'JE-0002' },
  { type: 'CANCEL', reason: 'offer expired' },
  { type: 'POST_REPAYMENT', principal: toCentavos(100000) },
  { type: 'REVERSE_REPAYMENT', principal: toCentavos(100000) },
  { type: 'MARK_DELINQUENT' },
  { type: 'CURE' },
  { type: 'MARK_DEFAULTED' },
]

const PAIRS = (Object.keys(LOANS) as LoanStatus[]).flatMap((status) =>
  EVENTS.map((event) => ({ status, event, legal: LEGAL_TRANSITIONS[status].includes(event.type) })),
)

describe('transitionLoan', () => {
  it('covers all 10 × 10 (state, event) pairs, 12 legal and 88 illegal', () => {
    expect(PAIRS).toHaveLength(100)
    expect(PAIRS.filter((pair) => pair.legal)).toHaveLength(12)
  })

  it.each(PAIRS.filter((pair) => !pair.legal))('rejects $event.type from $status with a typed 409', ({ status, event }) => {
    const result = transitionLoan(LOANS[status], event)
    expect(result).toMatchObject({ ok: false, status: 409, code: 'ILLEGAL_TRANSITION', from: status, event: event.type })
  })

  it.each(PAIRS.filter((pair) => pair.legal))('allows $event.type from $status and bumps the version', ({ status, event }) => {
    const result = transitionLoan(LOANS[status], event)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.loan.version).toBe(6)
  })

  it('moves APPROVED → DISBURSED carrying amount, provider and journal entry', () => {
    const result = transitionLoan(LOANS.APPROVED, {
      type: 'DISBURSE',
      amount: toCentavos(250000),
      provider: 'gcash',
      journalEntryId: 'JE-0009',
    })
    expect(result).toEqual({
      ok: true,
      loan: { ...base, version: 6, status: 'DISBURSED', disbursedAmount: 250000, provider: 'gcash', journalEntryId: 'JE-0009' },
    })
  })

  it('never disburses twice: DISBURSE on a DISBURSED loan is a 409', () => {
    const disburse = EVENTS[3]
    if (disburse === undefined) throw new Error('fixture missing')
    expect(transitionLoan(LOANS.DISBURSED, disburse)).toMatchObject({ ok: false, status: 409 })
  })

  it('is pure: the input loan is not mutated', () => {
    const loan = { ...LOANS.UNDER_REVIEW }
    transitionLoan(loan, { type: 'APPROVE' })
    expect(loan).toEqual(LOANS.UNDER_REVIEW)
  })

  it('posts repayments DISBURSED → REPAYING → SETTLED, settling only at 0 principal owed', () => {
    const first = transitionLoan(LOANS.DISBURSED, { type: 'POST_REPAYMENT', principal: toCentavos(300000) })
    expect(first).toMatchObject({ ok: true, loan: { status: 'REPAYING', outstandingPrincipal: 200000, version: 6 } })
    if (!first.ok) throw new Error('expected ok')
    const last = transitionLoan(first.loan, { type: 'POST_REPAYMENT', principal: toCentavos(200000) })
    expect(last).toMatchObject({ ok: true, loan: { status: 'SETTLED', disbursedAmount: 500000, version: 7 } })
  })

  it('settles DISBURSED in one posting when the repayment covers all principal', () => {
    const result = transitionLoan(LOANS.DISBURSED, { type: 'POST_REPAYMENT', principal: toCentavos(500000) })
    expect(result).toMatchObject({ ok: true, loan: { status: 'SETTLED' } })
  })

  it('rejects overpayment and over-reversal with a typed 422, not a negative balance', () => {
    expect(transitionLoan(LOANS.REPAYING, { type: 'POST_REPAYMENT', principal: toCentavos(400001) })).toMatchObject({
      ok: false,
      status: 422,
      code: 'INVALID_AMOUNT',
    })
    expect(transitionLoan(LOANS.REPAYING, { type: 'REVERSE_REPAYMENT', principal: toCentavos(100001) })).toMatchObject({
      ok: false,
      status: 422,
      code: 'INVALID_AMOUNT',
    })
    expect(transitionLoan(LOANS.REPAYING, { type: 'POST_REPAYMENT', principal: toCentavos(0) })).toMatchObject({
      ok: false,
      status: 422,
    })
  })

  it('reverses a repayment by restoring principal without changing REPAYING ⇄ DELINQUENT', () => {
    expect(transitionLoan(LOANS.DELINQUENT, { type: 'REVERSE_REPAYMENT', principal: toCentavos(50000) })).toMatchObject({
      ok: true,
      loan: { status: 'DELINQUENT', outstandingPrincipal: 450000 },
    })
  })
})
