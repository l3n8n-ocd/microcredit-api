import { describe, expect, it } from 'vitest'
import { toCentavos } from '../../utils/index.ts'
import { LEGAL_TRANSITIONS, transitionLoan } from './loanStateMachine.ts'
import type { LoanEvent, LoanState, LoanStatus } from './types.ts'

const base = { id: 'L-1', borrowerId: 'borrower-1', version: 5 }

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
}

const EVENTS: readonly LoanEvent[] = [
  { type: 'START_REVIEW' },
  { type: 'APPROVE' },
  { type: 'REJECT', reason: 'score' },
  { type: 'DISBURSE', amount: toCentavos(500000), provider: 'maya', journalEntryId: 'JE-0002' },
]

const PAIRS = (Object.keys(LOANS) as LoanStatus[]).flatMap((status) =>
  EVENTS.map((event) => ({ status, event, legal: LEGAL_TRANSITIONS[status].includes(event.type) })),
)

describe('transitionLoan', () => {
  it('covers all 5 × 4 (state, event) pairs, 4 legal and 16 illegal', () => {
    expect(PAIRS).toHaveLength(20)
    expect(PAIRS.filter((pair) => pair.legal)).toHaveLength(4)
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
})
