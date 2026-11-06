import { describe, expect, it } from 'vitest'
import { toCentavos } from '../../utils/index.ts'
import { createDisbursementServer, formatIfMatch } from './disbursementServer.ts'
import { buildRepaymentJournal, buildReversalJournal, journalTotals } from './ledger.ts'
import { SEED_LOANS } from './seedLoans.ts'
import type { DisbursementServer, LoanCommand, LoanCommandRequest, LoanOf } from './index.ts'

const KEYS = Array.from({ length: 20 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
function key(index: number): string {
  const value = KEYS[index]
  if (value === undefined) throw new Error('fixture missing')
  return value
}

const split = (principal: number, interest: number) => ({ principal: toCentavos(principal), interest: toCentavos(interest) })

function command(body: LoanCommand, version: number, keyIndex: number): LoanCommandRequest {
  return { headers: { 'Idempotency-Key': key(keyIndex), 'If-Match': formatIfMatch(version) }, body }
}

/** L-1042 (APPROVED v3) disbursed ₱5,000.00 to GCash: DISBURSED v4, ledger [JE-0001]. */
async function disbursedServer(): Promise<DisbursementServer> {
  const server = createDisbursementServer(SEED_LOANS)
  const response = await server.disburse({
    headers: { 'Idempotency-Key': key(19), 'If-Match': '"3"' },
    body: {
      loanId: 'L-1042',
      provider: 'gcash',
      recipientMobile: '09171234567',
      amount: toCentavos(500_000),
      referenceNote: 'restock',
    },
  })
  if (response.kind !== 'CREATED') throw new Error(`setup failed: ${response.kind}`)
  return server
}

const DISBURSED: LoanOf<'DISBURSED'> = {
  id: 'L-1',
  borrowerId: 'borrower-1',
  version: 4,
  status: 'DISBURSED',
  disbursedAmount: toCentavos(500_000),
  provider: 'gcash',
  journalEntryId: 'JE-0001',
}

describe('buildRepaymentJournal', () => {
  it('posts DEBIT wallet_clearing = CREDIT loans_receivable + CREDIT interest_income', () => {
    const entry = buildRepaymentJournal({ id: 'JE-0002', loan: DISBURSED, split: split(100_000, 5_000), idempotencyKey: key(0) })
    expect(entry.kind).toBe('REPAYMENT')
    expect(entry.lines).toEqual([
      { account: 'wallet_clearing:gcash', side: 'DEBIT', amount: 105_000 },
      { account: 'loans_receivable:borrower-1', side: 'CREDIT', amount: 100_000 },
      { account: 'interest_income', side: 'CREDIT', amount: 5_000 },
    ])
    expect(journalTotals(entry.lines)).toEqual({ debits: 105_000, credits: 105_000, balanced: true })
  })

  it('omits the interest line when interest is 0, and rejects a non-positive principal', () => {
    const entry = buildRepaymentJournal({ id: 'JE-0002', loan: DISBURSED, split: split(20, 0), idempotencyKey: key(0) })
    expect(entry.lines).toHaveLength(2)
    expect(() => buildRepaymentJournal({ id: 'JE-0003', loan: DISBURSED, split: split(0, 5), idempotencyKey: key(1) })).toThrow(
      RangeError,
    )
  })
})

describe('buildReversalJournal (compensating-reversal guard)', () => {
  const repayment = buildRepaymentJournal({ id: 'JE-0002', loan: DISBURSED, split: split(100_000, 5_000), idempotencyKey: key(0) })
  const disbursement = {
    id: 'JE-0001',
    kind: 'DISBURSEMENT',
    loanId: 'L-1',
    idempotencyKey: key(1),
    lines: [],
  } as const

  it('mirrors every line, names the original, and returns the principal to restore', () => {
    const result = buildReversalJournal({ id: 'JE-0003', ledger: [disbursement, repayment], reversesEntryId: 'JE-0002', idempotencyKey: key(2) })
    if (!result.ok) throw new Error(result.message)
    expect(result.entry).toMatchObject({ kind: 'REVERSAL', reversesEntryId: 'JE-0002', loanId: 'L-1' })
    expect(result.entry.lines.map((line) => line.side)).toEqual(['CREDIT', 'DEBIT', 'DEBIT'])
    expect(journalTotals([...repayment.lines, ...result.entry.lines])).toMatchObject({ debits: 210_000, credits: 210_000 })
    expect(result.principal).toBe(100_000)
  })

  it('refuses a second reversal of the same repayment', () => {
    const first = buildReversalJournal({ id: 'JE-0003', ledger: [repayment], reversesEntryId: 'JE-0002', idempotencyKey: key(2) })
    if (!first.ok) throw new Error(first.message)
    const second = buildReversalJournal({
      id: 'JE-0004',
      ledger: [repayment, first.entry],
      reversesEntryId: 'JE-0002',
      idempotencyKey: key(3),
    })
    expect(second).toMatchObject({ ok: false, code: 'ALREADY_REVERSED' })
  })

  it('refuses to reverse a disbursement or a reversal, and an unknown ID', () => {
    const first = buildReversalJournal({ id: 'JE-0003', ledger: [repayment], reversesEntryId: 'JE-0002', idempotencyKey: key(2) })
    if (!first.ok) throw new Error(first.message)
    const ledger = [disbursement, repayment, first.entry]
    expect(buildReversalJournal({ id: 'X', ledger, reversesEntryId: 'JE-0001', idempotencyKey: key(4) })).toMatchObject({
      ok: false,
      code: 'NOT_REVERSIBLE',
    })
    expect(buildReversalJournal({ id: 'X', ledger, reversesEntryId: 'JE-0003', idempotencyKey: key(4) })).toMatchObject({
      ok: false,
      code: 'NOT_REVERSIBLE',
    })
    expect(buildReversalJournal({ id: 'X', ledger, reversesEntryId: 'JE-9999', idempotencyKey: key(4) })).toMatchObject({
      ok: false,
      code: 'ENTRY_NOT_FOUND',
    })
  })
})

describe('server.command: review decisions with Idempotency-Key + If-Match', () => {
  it('moves L-1045 APPLIED → UNDER_REVIEW → APPROVED and posts no journal entry', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    expect(await server.command(command({ type: 'START_REVIEW', loanId: 'L-1045' }, 1, 0))).toMatchObject({
      kind: 'APPLIED',
      loan: { status: 'UNDER_REVIEW', version: 2 },
      journalEntry: null,
    })
    expect(await server.command(command({ type: 'APPROVE', loanId: 'L-1045' }, 2, 1))).toMatchObject({
      kind: 'APPLIED',
      loan: { status: 'APPROVED', version: 3 },
    })
    expect(server.getLedger()).toHaveLength(0)
  })

  it('rejects with the reason codes, and refuses an empty reason list', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    expect(await server.command(command({ type: 'REJECT', loanId: 'L-1044', reasonCodes: [] }, 2, 0))).toMatchObject({
      kind: 'UNPROCESSABLE',
      code: 'INVALID_BODY',
    })
    expect(
      await server.command(command({ type: 'REJECT', loanId: 'L-1044', reasonCodes: ['LOAD_IRREGULAR', 'UTIL_LATE_PAYMENTS'] }, 2, 1)),
    ).toMatchObject({ kind: 'APPLIED', loan: { status: 'REJECTED', reason: 'LOAD_IRREGULAR, UTIL_LATE_PAYMENTS' } })
  })

  it('returns a typed 409 for an illegal transition (APPROVE on an APPLIED loan)', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    expect(await server.command(command({ type: 'APPROVE', loanId: 'L-1045' }, 1, 0))).toMatchObject({
      kind: 'CONFLICT',
      status: 409,
      code: 'ILLEGAL_TRANSITION',
    })
  })
})

describe('server.command: repayments never post twice', () => {
  it('posts one balanced repayment: DISBURSED v4 → REPAYING v5 owing the remainder', async () => {
    const server = await disbursedServer()
    const response = await server.command(command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(100_000, 5_000) }, 4, 0))
    expect(response).toMatchObject({ kind: 'APPLIED', loan: { status: 'REPAYING', version: 5, outstandingPrincipal: 400_000 } })
    const ledger = server.getLedger()
    expect(ledger).toHaveLength(2)
    expect(journalTotals(ledger.flatMap((entry) => entry.lines))).toMatchObject({ balanced: true })
  })

  it('leaves exactly one ledger entry for two concurrent requests with the same key', async () => {
    const server = await disbursedServer()
    const request = command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(100_000, 5_000) }, 4, 0)
    const [first, second] = await Promise.all([server.command(request), server.command(request)])
    expect(first?.kind).toBe('APPLIED')
    expect(second?.kind).toBe('REPLAYED')
    expect(server.getLedger().filter((entry) => entry.kind === 'REPAYMENT')).toHaveLength(1)
  })

  it('replays a retry before checking If-Match, though the version has moved on', async () => {
    const server = await disbursedServer()
    const request = command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(100_000, 5_000) }, 4, 0)
    await server.command(request)
    // The loan is now v5, but the retry still carries If-Match "4": it must replay, not 409.
    expect(await server.command(request)).toMatchObject({ kind: 'REPLAYED' })
  })

  it('returns 409 VERSION_MISMATCH with no entry for a new key carrying a stale If-Match', async () => {
    const server = await disbursedServer()
    await server.command(command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(100_000, 5_000) }, 4, 0))
    const stale = await server.command(command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(100_000, 5_000) }, 4, 1))
    expect(stale).toMatchObject({ kind: 'CONFLICT', status: 409, code: 'VERSION_MISMATCH', currentVersion: 5 })
    expect(server.getLedger().filter((entry) => entry.kind === 'REPAYMENT')).toHaveLength(1)
  })

  it('refuses a key reused with a different split (422) and an overpayment (422), posting nothing', async () => {
    const server = await disbursedServer()
    await server.command(command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(100_000, 5_000) }, 4, 0))
    expect(await server.command(command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(1_000, 50) }, 4, 0))).toMatchObject({
      kind: 'UNPROCESSABLE',
      code: 'IDEMPOTENCY_KEY_REUSED',
    })
    expect(await server.command(command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(400_001, 0) }, 5, 1))).toMatchObject({
      kind: 'UNPROCESSABLE',
      code: 'INVALID_AMOUNT',
    })
    expect(server.getLedger()).toHaveLength(2)
  })

  it('settles at 0 principal owed: REPAYING → SETTLED', async () => {
    const server = await disbursedServer()
    await server.command(command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(100_000, 5_000) }, 4, 0))
    expect(await server.command(command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(400_000, 20_000) }, 5, 1))).toMatchObject({
      kind: 'APPLIED',
      loan: { status: 'SETTLED', version: 6 },
    })
  })
})

describe('server.command: compensating reversals', () => {
  it('reverses a repayment once, restores the principal, and keeps the ledger balanced', async () => {
    const server = await disbursedServer()
    await server.command(command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(100_000, 5_000) }, 4, 0))
    const reversal = await server.command(command({ type: 'REVERSE_REPAYMENT', loanId: 'L-1042', reversesEntryId: 'JE-0002' }, 5, 1))
    expect(reversal).toMatchObject({
      kind: 'APPLIED',
      loan: { status: 'REPAYING', version: 6, outstandingPrincipal: 500_000 },
      journalEntry: { id: 'JE-0003', kind: 'REVERSAL', reversesEntryId: 'JE-0002' },
    })
    const again = await server.command(command({ type: 'REVERSE_REPAYMENT', loanId: 'L-1042', reversesEntryId: 'JE-0002' }, 6, 2))
    expect(again).toMatchObject({ kind: 'UNPROCESSABLE', code: 'ALREADY_REVERSED' })
    expect(server.getLedger()).toHaveLength(3)
    expect(journalTotals(server.getLedger().flatMap((entry) => entry.lines))).toMatchObject({ balanced: true })
  })

  it('refuses to reverse the disbursement or another loan’s repayment', async () => {
    const server = await disbursedServer()
    await server.command(command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(100_000, 5_000) }, 4, 0))
    expect(await server.command(command({ type: 'REVERSE_REPAYMENT', loanId: 'L-1042', reversesEntryId: 'JE-0001' }, 5, 1))).toMatchObject({
      kind: 'UNPROCESSABLE',
      code: 'NOT_REVERSIBLE',
    })
    expect(await server.command(command({ type: 'REVERSE_REPAYMENT', loanId: 'L-1043', reversesEntryId: 'JE-0002' }, 1, 2))).toMatchObject({
      kind: 'UNPROCESSABLE',
      code: 'NOT_REVERSIBLE',
    })
  })

  it('refuses to reverse a repayment once the loan is SETTLED (terminal)', async () => {
    const server = await disbursedServer()
    await server.command(command({ type: 'POST_REPAYMENT', loanId: 'L-1042', split: split(500_000, 25_000) }, 4, 0))
    expect(await server.command(command({ type: 'REVERSE_REPAYMENT', loanId: 'L-1042', reversesEntryId: 'JE-0002' }, 5, 1))).toMatchObject({
      kind: 'CONFLICT',
      code: 'ILLEGAL_TRANSITION',
    })
    expect(server.getLedger()).toHaveLength(2)
  })
})
