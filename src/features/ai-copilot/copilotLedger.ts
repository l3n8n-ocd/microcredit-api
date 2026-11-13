/**
 * FE-07: where an approved copilot proposal actually pays out.
 *
 * `proposeDisbursementExecution` only proposes. When the officer presses
 * **Approve & Execute Payout**, the browser sends the proposal to this
 * in-memory disbursement server (the same `disbursementServer.ts` the Disburse
 * demo uses) with the proposal's `Idempotency-Key` and `If-Match`. One server
 * per page load, shared by every card, so a second proposal for a loan that
 * was just paid meets the real `409 ILLEGAL_TRANSITION`.
 *
 * It is not the Disburse form's server: a payout here does not show up there.
 */
import type { ProposalOutput } from '../../lib/ai/tools.ts'
import { toCentavos } from '../../utils/money.ts'
import { createDisbursementServer, type DisbursementServer } from '../disbursement/disbursementServer.ts'
import { journalTotals } from '../disbursement/ledger.ts'
import { SAMPLE_PAYOUT, SEED_LOANS } from '../disbursement/seedLoans.ts'
import type { DisbursementResponse } from '../disbursement/types.ts'
import type { ToolDecision } from './chatTypes.ts'

/** Long enough to see the button lock, short enough not to annoy. */
const LATENCY_MS = 400

let server: DisbursementServer | null = null

export function copilotServer(): DisbursementServer {
  server ??= createDisbursementServer(SEED_LOANS, { latencyMs: LATENCY_MS })
  return server
}

/** Tests start each case from the seed ledger. */
export function resetCopilotServer(latencyMs = LATENCY_MS): void {
  server = createDisbursementServer(SEED_LOANS, { latencyMs })
}

function send(proposal: ProposalOutput): Promise<DisbursementResponse> {
  return copilotServer().disburse({
    headers: { 'Idempotency-Key': proposal.idempotencyKey, 'If-Match': proposal.ifMatch },
    body: {
      loanId: proposal.loanId,
      provider: proposal.walletProvider === 'GCash' ? 'gcash' : 'maya',
      recipientMobile: SAMPLE_PAYOUT.recipientMobile,
      amount: toCentavos(proposal.amountCentavos),
      referenceNote: 'Copilot-proposed payout',
    },
  })
}

function describe(response: DisbursementResponse): string {
  switch (response.kind) {
    case 'CREATED':
      return 'Paid once. The loan moved APPROVED → DISBURSED and one balanced journal entry was posted.'
    case 'REPLAYED':
      return 'Same Idempotency-Key: the original receipt came back. Nothing new was posted.'
    default:
      return response.message
  }
}

function ledgerFacts(loanId: string) {
  const live = copilotServer()
  const entries = live.getLedger().filter((entry) => entry.loanId === loanId && entry.kind === 'DISBURSEMENT')
  const totals = entries.length === 0 ? null : journalTotals(entries.flatMap((entry) => entry.lines))
  const loan = live.listLoans().find((candidate) => candidate.id === loanId)
  return {
    loanStatus: loan?.status ?? null,
    loanVersion: loan?.version ?? null,
    debitsCentavos: totals?.debits ?? null,
    creditsCentavos: totals?.credits ?? null,
    entriesForLoan: entries.length,
  }
}

/** Approve & Execute Payout: one request, then what the ledger says about this loan. */
export async function executeProposal(proposal: ProposalOutput): Promise<ToolDecision> {
  const response = await send(proposal)
  return {
    kind: 'executed',
    at: new Date().toISOString(),
    status: response.status,
    outcome: response.kind,
    message: describe(response),
    ...ledgerFacts(proposal.loanId),
    replays: 0,
    lastReplay: null,
  }
}

/** Sends the exact same request again, as a network retry would. Returns the updated decision. */
export async function replayProposal(proposal: ProposalOutput, decision: Extract<ToolDecision, { kind: 'executed' }>): Promise<ToolDecision> {
  const response = await send(proposal)
  return {
    ...decision,
    ...ledgerFacts(proposal.loanId),
    replays: decision.replays + 1,
    lastReplay: `${response.status} ${response.kind}`,
  }
}
