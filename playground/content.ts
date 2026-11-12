/**
 * Demo copy shared by the hand-built examples and their shadcn/ui twins, so
 * the two sides of `/playground` differ only in the component underneath.
 * Amounts are integer centavos, formatted at the display boundary (CLAUDE.md §4).
 */
import { formatPHP, toCentavos } from '../src/utils/money.ts'

const REQUESTED = toCentavos(6_000_000)
const DAILY_CAP = toCentavos(5_000_000)

export const OVERRIDE_DEMO = {
  loanId: 'L-1042',
  title: 'Approve daily-cap override',
  description: `Loan L-1042 asks for ${formatPHP(REQUESTED)} against a ${formatPHP(DAILY_CAP)} daily cap. Approving records your reason. It does not send a payout: that still needs its own Idempotency-Key and a current If-Match.`,
  /** Shown after approval. Says plainly that nothing was disbursed. */
  approved: 'Override recorded for L-1042. Demo only: no payout was sent.',
  minReasonLength: 10,
} as const
