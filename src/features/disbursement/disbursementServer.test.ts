import { describe, expect, it } from 'vitest'
import { toCentavos } from '../../utils/index.ts'
import { createDisbursementServer, formatIfMatch } from './disbursementServer.ts'
import { accountBalance, buildDisbursementJournal, journalTotals } from './ledger.ts'
import { SEED_LOANS } from './seedLoans.ts'
import type { DisbursementRequest } from './types.ts'

const KEY_A = '11111111-1111-4111-8111-111111111111'
const KEY_B = '22222222-2222-4222-8222-222222222222'

function request(overrides: { key?: string; ifMatch?: string; loanId?: string; amount?: number } = {}): DisbursementRequest {
  return {
    headers: { 'Idempotency-Key': overrides.key ?? KEY_A, 'If-Match': overrides.ifMatch ?? formatIfMatch(3) },
    body: {
      loanId: overrides.loanId ?? 'L-1042',
      provider: 'gcash',
      recipientMobile: '09171234567',
      amount: toCentavos(overrides.amount ?? 500000),
      referenceNote: '',
    },
  }
}

describe('buildDisbursementJournal', () => {
  it('debits loans_receivable and credits wallet_clearing for the same centavos', () => {
    const entry = buildDisbursementJournal({
      id: 'JE-1',
      loan: { id: 'L-1042', borrowerId: 'borrower-42', version: 3, status: 'APPROVED' },
      amount: toCentavos(500000),
      provider: 'maya',
      idempotencyKey: KEY_A,
    })
    expect(entry.lines).toEqual([
      { account: 'loans_receivable:borrower-42', side: 'DEBIT', amount: 500000 },
      { account: 'wallet_clearing:maya', side: 'CREDIT', amount: 500000 },
    ])
    expect(journalTotals(entry.lines)).toEqual({ debits: 500000, credits: 500000, balanced: true })
  })

  it('detects an unbalanced set of lines', () => {
    expect(
      journalTotals([
        { account: 'wallet_clearing:gcash', side: 'DEBIT', amount: toCentavos(100) },
        { account: 'loans_receivable:x', side: 'CREDIT', amount: toCentavos(99) },
      ]).balanced,
    ).toBe(false)
  })
})

describe('createDisbursementServer', () => {
  it('posts one balanced entry and moves the loan to DISBURSED at version + 1', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    const response = await server.disburse(request())

    expect(response).toMatchObject({ kind: 'CREATED', status: 201, loan: { status: 'DISBURSED', version: 4 } })
    expect(server.getLedger()).toHaveLength(1)
    expect(accountBalance(server.getLedger(), 'loans_receivable:borrower-42')).toBe(500000)
  })

  it('replays a concurrent duplicate (same key) without a second ledger entry', async () => {
    const server = createDisbursementServer(SEED_LOANS, { latencyMs: 5 })
    const [first, second] = await Promise.all([server.disburse(request()), server.disburse(request())])

    expect(first?.kind).toBe('CREATED')
    expect(second?.kind).toBe('REPLAYED')
    if (first?.kind === 'CREATED' && second?.kind === 'REPLAYED') {
      expect(second.journalEntry.id).toBe(first.journalEntry.id)
    }
    expect(server.getLedger()).toHaveLength(1)
    expect(accountBalance(server.getLedger(), 'loans_receivable:borrower-42')).toBe(500000)
  })

  it('replays a late retry even though its If-Match is now stale', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    await server.disburse(request())
    expect((await server.disburse(request())).kind).toBe('REPLAYED')
  })

  it('rejects a second admin (new key, stale If-Match) with 409 VERSION_MISMATCH', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    await server.disburse(request())
    const response = await server.disburse(request({ key: KEY_B }))

    expect(response).toMatchObject({ kind: 'CONFLICT', status: 409, code: 'VERSION_MISMATCH', currentVersion: 4 })
    expect(server.getLedger()).toHaveLength(1)
  })

  it('rejects a fresh request on an already DISBURSED loan with 409 ILLEGAL_TRANSITION', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    await server.disburse(request())
    const response = await server.disburse(request({ key: KEY_B, ifMatch: formatIfMatch(4) }))

    expect(response).toMatchObject({ kind: 'CONFLICT', status: 409, code: 'ILLEGAL_TRANSITION' })
    expect(server.getLedger()).toHaveLength(1)
  })

  it('rejects reuse of a key with a different payload (422)', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    await server.disburse(request())
    const response = await server.disburse(request({ amount: 600000 }))

    expect(response).toMatchObject({ kind: 'UNPROCESSABLE', code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(server.getLedger()).toHaveLength(1)
  })

  it.each([
    ['a loan that is not APPROVED', request({ loanId: 'L-1044', ifMatch: formatIfMatch(2) }), 'CONFLICT'],
    ['an unknown loan', request({ loanId: 'L-9999' }), 'NOT_FOUND'],
    ['a non-UUID key', request({ key: 'retry-1' }), 'BAD_REQUEST'],
    ['an unquoted If-Match', request({ ifMatch: '3' }), 'BAD_REQUEST'],
    ['an amount off the ₱100 step', request({ amount: 500050 }), 'UNPROCESSABLE'],
    ['an amount above ₱50,000', request({ amount: 5000100 }), 'UNPROCESSABLE'],
  ])('posts nothing for %s', async (_label, bad, kind) => {
    const server = createDisbursementServer(SEED_LOANS)
    expect((await server.disburse(bad)).kind).toBe(kind)
    expect(server.getLedger()).toHaveLength(0)
  })
})
