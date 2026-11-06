import { sumCentavos, toCentavos, type Centavos } from '../../utils/index.ts'
import type { JournalEntry, JournalLine, JournalTotals, LoanOf, WalletProvider } from './types.ts'

export function journalTotals(lines: readonly JournalLine[]): JournalTotals {
  const debits = sumCentavos(lines.filter((line) => line.side === 'DEBIT').map((line) => line.amount))
  const credits = sumCentavos(lines.filter((line) => line.side === 'CREDIT').map((line) => line.amount))
  return { debits, credits, balanced: debits === credits }
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
  if (!journalTotals(lines).balanced) {
    throw new Error('Invariant violated: Σ debits !== Σ credits')
  }
  return { id: input.id, loanId: input.loan.id, idempotencyKey: input.idempotencyKey, lines }
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
