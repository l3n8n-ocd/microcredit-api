// Public API of the scoring feature: alt-data underwriting workbench, repayment panel, pure score engine.
export { APPLICANT_PROFILES, type ApplicantProfile } from './applicants.ts'
export { describeCommand, type Announcement } from './announcement.ts'
export { RepaymentPanel, type RepaymentPanelProps } from './RepaymentPanel.tsx'
export {
  formatBps,
  INTEREST_RATE_BPS,
  MAX_SCORE,
  payoffAmount,
  REASON_TEXT,
  recommendLimit,
  scoreApplicant,
  splitRepayment,
  type AltDataSignals,
  type ReasonCode,
  type RiskBand,
  type TrustScore,
} from './scoreEngine.ts'
export { UnderwritingWorkbench, type UnderwritingWorkbenchProps } from './UnderwritingWorkbench.tsx'
export { filterQueue, QUEUE_FILTERS, useUnderwritingQueue, type QueueFilter, type QueueRow } from './useUnderwritingQueue.ts'
