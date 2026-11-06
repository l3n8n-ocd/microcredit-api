/**
 * Pure trust-score engine (no React, no I/O). Same input, same output.
 *
 * Three alternative-data signals, 1000 points in total:
 *   utility   350  Meralco / water bill paid on time, by month
 *   supplier  350  supplier invoices paid, minus a lateness penalty
 *   load      300  telco / GCash load top-ups per month and months active
 * Points are integers: every division is floored.
 */
import { toCentavos, type Centavos } from '../../utils/index.ts'
import type { RepaymentSplit } from '../disbursement/index.ts'

export interface AltDataSignals {
  readonly utility: { readonly provider: 'Meralco' | 'Water'; readonly monthsOnTime: number; readonly monthsObserved: number }
  readonly supplier: { readonly invoicesPaid: number; readonly invoicesTotal: number; readonly avgDaysLate: number }
  readonly load: { readonly topUpsPerMonth: number; readonly monthsActive: number }
}

export type ReasonCode =
  | 'UTIL_LATE_PAYMENTS'
  | 'SUPPLIER_PAYS_LATE'
  | 'SUPPLIER_THIN_HISTORY'
  | 'LOAD_IRREGULAR'
  | 'LOAD_SHORT_HISTORY'

/** Plain-language text for each adverse reason code, shown next to the code. */
export const REASON_TEXT: Readonly<Record<ReasonCode, string>> = {
  UTIL_LATE_PAYMENTS: 'Fewer than 80% of utility bills paid on time',
  SUPPLIER_PAYS_LATE: 'Supplier invoices paid more than 7 days late on average',
  SUPPLIER_THIN_HISTORY: 'Fewer than 6 supplier invoices on record',
  LOAD_IRREGULAR: 'Fewer than 4 load top-ups a month',
  LOAD_SHORT_HISTORY: 'Load top-up history shorter than 6 months',
}

export type FactorId = 'utility' | 'supplier' | 'load'

export interface ScoreFactor {
  readonly id: FactorId
  readonly label: string
  readonly points: number
  readonly maxPoints: number
}

export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'DECLINE'

export interface TrustScore {
  /** 0–1000, the sum of `factors[].points`. */
  readonly score: number
  readonly band: RiskBand
  readonly factors: readonly ScoreFactor[]
  readonly reasonCodes: readonly ReasonCode[]
  /** 0 means "do not offer". Always within the Disburse bounds (₱500 – ₱50,000, ₱100 steps). */
  readonly recommendedLimit: Centavos
}

export const MAX_SCORE = 1000

/** `numerator / denominator` scaled to `max` points, floored; 0 when there is no history. */
function scaled(max: number, numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.floor((max * Math.min(numerator, denominator)) / denominator)
}

export function scoreFactors(signals: AltDataSignals): readonly ScoreFactor[] {
  const { utility, supplier, load } = signals
  const latePenalty = Math.min(Math.max(supplier.avgDaysLate, 0) * 5, 100)
  return [
    {
      id: 'utility',
      label: `Utility bill consistency (${utility.provider})`,
      points: scaled(350, utility.monthsOnTime, utility.monthsObserved),
      maxPoints: 350,
    },
    {
      id: 'supplier',
      label: 'Supplier invoice history',
      points: Math.max(0, scaled(350, supplier.invoicesPaid, supplier.invoicesTotal) - latePenalty),
      maxPoints: 350,
    },
    {
      id: 'load',
      label: 'Telco / GCash load top-up cadence',
      points: scaled(200, load.topUpsPerMonth, 8) + scaled(100, load.monthsActive, 12),
      maxPoints: 300,
    },
  ]
}

export function reasonCodes(signals: AltDataSignals): readonly ReasonCode[] {
  const { utility, supplier, load } = signals
  const codes: ReasonCode[] = []
  // On-time share below 80%, compared in integers: onTime / observed < 4 / 5.
  if (utility.monthsObserved <= 0 || utility.monthsOnTime * 5 < utility.monthsObserved * 4) codes.push('UTIL_LATE_PAYMENTS')
  if (supplier.avgDaysLate > 7) codes.push('SUPPLIER_PAYS_LATE')
  if (supplier.invoicesTotal < 6) codes.push('SUPPLIER_THIN_HISTORY')
  if (load.topUpsPerMonth < 4) codes.push('LOAD_IRREGULAR')
  if (load.monthsActive < 6) codes.push('LOAD_SHORT_HISTORY')
  return codes
}

export function riskBand(score: number): RiskBand {
  if (score >= 700) return 'LOW'
  if (score >= 550) return 'MEDIUM'
  if (score >= 400) return 'HIGH'
  return 'DECLINE'
}

/** Score → offer, in centavos. A table, not a formula, so every limit is a valid Disburse amount. */
const LIMIT_TABLE: readonly { readonly minScore: number; readonly limit: Centavos }[] = [
  { minScore: 800, limit: toCentavos(5_000_000) }, // ₱50,000.00
  { minScore: 700, limit: toCentavos(2_500_000) }, // ₱25,000.00
  { minScore: 550, limit: toCentavos(1_000_000) }, // ₱10,000.00
  { minScore: 400, limit: toCentavos(500_000) }, //  ₱5,000.00
]

export function recommendLimit(score: number): Centavos {
  return LIMIT_TABLE.find((row) => score >= row.minScore)?.limit ?? toCentavos(0)
}

export function scoreApplicant(signals: AltDataSignals): TrustScore {
  const factors = scoreFactors(signals)
  const score = factors.reduce((total, factor) => total + factor.points, 0)
  return {
    score,
    band: riskBand(score),
    factors,
    reasonCodes: reasonCodes(signals),
    recommendedLimit: recommendLimit(score),
  }
}

/** Flat add-on interest: 5.00% of principal, in basis points (1 bp = 0.01%). */
export const INTEREST_RATE_BPS = 500
const BPS_PER_UNIT = 10_000

/** 500 → "5.00%", using string operations only (no decimal division). */
export function formatBps(bps: number): string {
  const digits = String(bps).padStart(3, '0')
  return `${digits.slice(0, -2)}.${digits.slice(-2)}%`
}

/**
 * Splits a repayment `total` into principal and interest with remainder allocation.
 *
 * A payment of P × (1 + r) covers principal P plus interest P × r, so the interest
 * share of any payment is total × r / (1 + r). That share is computed in BigInt
 * and floored (the borrower is never over-charged a fraction of a centavo), and
 * principal takes the remainder. So `principal + interest === total`, always,
 * with no rounding of two halves independently.
 *
 * Example (README): ₱1,050.00 = 105000 → interest 5000, principal 100000.
 */
export function splitRepayment(total: Centavos, rateBps: number = INTEREST_RATE_BPS): RepaymentSplit {
  if (total <= 0) throw new RangeError('Repayment total must be positive')
  if (!Number.isSafeInteger(rateBps) || rateBps < 0) throw new RangeError('Rate must be whole basis points ≥ 0')
  const interest = (BigInt(total) * BigInt(rateBps)) / BigInt(BPS_PER_UNIT + rateBps)
  const interestCentavos = toCentavos(Number(interest))
  return { principal: toCentavos(total - interestCentavos), interest: interestCentavos }
}

/** Largest payment whose principal part still fits in `outstanding`: the payoff amount. */
export function payoffAmount(outstanding: Centavos, rateBps: number = INTEREST_RATE_BPS): Centavos {
  const total = (BigInt(outstanding) * BigInt(BPS_PER_UNIT + rateBps)) / BigInt(BPS_PER_UNIT)
  return toCentavos(Number(total))
}
