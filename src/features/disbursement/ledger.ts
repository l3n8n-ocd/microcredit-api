import { sumCentavos, toCentavos, type Centavos } from '../../utils/index.ts'
import type { JournalEntry, JournalLine, JournalTotals, LoanOf, RepaymentSplit, WalletProvider } from './types.ts'

export function journalTotals(lines: readonly JournalLine[]): JournalTotals {
  const debits = sumCentavos(lines.filter((line) => line.side === 'DEBIT').map((line) => line.amount))
  const credits = sumCentavos(lines.filter((line) => line.side === 'CREDIT').map((line) => line.amount))
  return { debits, credits, balanced: debits === credits }
}

function assertBalanced(lines: readonly JournalLine[]): void {
  if (!journalTotals(lines).balanced) {
    throw new Error('Invariant violated: Σ debits !== Σ credits')
  }
}

export interface DisbursementJournalInput {
  readonly id: string
  readonly loan: LoanOf<'APPROVED'>
  readonly amount: Centavos
  readonly provider: WalletProvider
  readonly idempotencyKey: string
}

/**
 * Builds the balanced entry for a payout:
 *   DEBIT  loans_receivable:<borrower>   (the borrower now owes us)
 *   CREDIT wallet_clearing:<provider>    (cash leaves via GCash/Maya)
 * Throws if the entry would not balance or the amount is not positive.
 */
export function buildDisbursementJournal(input: DisbursementJournalInput): JournalEntry {
  if (input.amount <= 0) {
    throw new RangeError('Disbursement amount must be positive')
  }
  const lines: readonly JournalLine[] = [
    { account: `loans_receivable:${input.loan.borrowerId}`, side: 'DEBIT', amount: input.amount },
    { account: `wallet_clearing:${input.provider}`, side: 'CREDIT', amount: input.amount },
  ]
  assertBalanced(lines)
  return { id: input.id, kind: 'DISBURSEMENT', loanId: input.loan.id, idempotencyKey: input.idempotencyKey, lines }
}

export interface RepaymentJournalInput {
  readonly id: string
  readonly loan: LoanOf<'DISBURSED' | 'REPAYING'>
  readonly split: RepaymentSplit
  readonly idempotencyKey: string
}

/**
 * Builds the balanced entry for a repayment received through the loan's wallet:
 *   DEBIT  wallet_clearing:<provider>    principal + interest (cash comes in)
 *   CREDIT loans_receivable:<borrower>   principal            (the debt shrinks)
 *   CREDIT interest_income               interest             (only when > 0)
 * The debit is the sum of the credits, so Σ debits === Σ credits by construction.
 */
export function buildRepaymentJournal(input: RepaymentJournalInput): JournalEntry {
  const { principal, interest } = input.split
  if (principal <= 0 || interest < 0) {
    throw new RangeError('Repayment principal must be positive and interest must not be negative')
  }
  const lines: readonly JournalLine[] = [
    { account: `wallet_clearing:${input.loan.provider}`, side: 'DEBIT', amount: sumCentavos([principal, interest]) },
    { account: `loans_receivable:${input.loan.borrowerId}`, side: 'CREDIT', amount: principal },
    ...(interest > 0 ? [{ account: 'interest_income', side: 'CREDIT', amount: interest } as const] : []),
  ]
  assertBalanced(lines)
  return { id: input.id, kind: 'REPAYMENT', loanId: input.loan.id, idempotencyKey: input.idempotencyKey, lines }
}

export interface ReversalJournalInput {
  readonly id: string
  readonly ledger: readonly JournalEntry[]
  readonly reversesEntryId: string
  readonly idempotencyKey: string
}

export type ReversalResult =
  | {
      readonly ok: true
      readonly entry: JournalEntry
      /** Principal the reversed repayment had paid down, now owed again. */
      readonly principal: Centavos
    }
  | {
      readonly ok: false
      readonly code: 'ENTRY_NOT_FOUND' | 'NOT_REVERSIBLE' | 'ALREADY_REVERSED'
      readonly message: string
    }

/** True when some REVERSAL entry already names `entryId`. */
export function isReversed(ledger: readonly JournalEntry[], entryId: string): boolean {
  return ledger.some((entry) => entry.kind === 'REVERSAL' && entry.reversesEntryId === entryId)
}

/**
 * Compensating-reversal guard. Only a REPAYMENT can be reversed, and only once:
 * reversing a disbursement would need APPROVED again (illegal), and reversing a
 * reversal, or the same repayment twice, would post money that never moved.
 */
export function buildReversalJournal(input: ReversalJournalInput): ReversalResult {
  const original = input.ledger.find((entry) => entry.id === input.reversesEntryId)
  if (original === undefined) {
    return { ok: false, code: 'ENTRY_NOT_FOUND', message: `No journal entry ${input.reversesEntryId}.` }
  }
  if (original.kind !== 'REPAYMENT') {
    return { ok: false, code: 'NOT_REVERSIBLE', message: `${original.id} is a ${original.kind}; only repayments can be reversed.` }
  }
  if (isReversed(input.ledger, original.id)) {
    return { ok: false, code: 'ALREADY_REVERSED', message: `${original.id} has already been reversed.` }
  }
  const lines: readonly JournalLine[] = original.lines.map((line) => ({
    ...line,
    side: line.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
  }))
  assertBalanced(lines)
  const principal = sumCentavos(
    original.lines
      .filter((line) => line.side === 'CREDIT' && line.account.startsWith('loans_receivable:'))
      .map((line) => line.amount),
  )
  return {
    ok: true,
    principal,
    entry: {
      id: input.id,
      kind: 'REVERSAL',
      reversesEntryId: original.id,
      loanId: original.loanId,
      idempotencyKey: input.idempotencyKey,
      lines,
    },
  }
}

/** Net debit balance of one account across the ledger (debits − credits), in centavos. */
export function accountBalance(ledger: readonly JournalEntry[], account: string): Centavos {
  let balance = 0
  for (const entry of ledger) {
    for (const line of entry.lines) {
      if (line.account === account) balance += line.side === 'DEBIT' ? line.amount : -line.amount
    }
  }
  return toCentavos(balance)
}
