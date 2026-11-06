import { describe, expect, it } from 'vitest'
import { toCentavos } from '../../utils/index.ts'
import { APPLICANT_PROFILES } from './applicants.ts'
import {
  formatBps,
  MAX_SCORE,
  payoffAmount,
  recommendLimit,
  riskBand,
  scoreApplicant,
  splitRepayment,
  type AltDataSignals,
} from './scoreEngine.ts'

const PERFECT: AltDataSignals = {
  utility: { provider: 'Meralco', monthsOnTime: 12, monthsObserved: 12 },
  supplier: { invoicesPaid: 24, invoicesTotal: 24, avgDaysLate: 0 },
  load: { topUpsPerMonth: 8, monthsActive: 12 },
}

const NO_HISTORY: AltDataSignals = {
  utility: { provider: 'Water', monthsOnTime: 0, monthsObserved: 0 },
  supplier: { invoicesPaid: 0, invoicesTotal: 0, avgDaysLate: 0 },
  load: { topUpsPerMonth: 0, monthsActive: 0 },
}

describe('scoreApplicant', () => {
  it('scores perfect signals 1000 / LOW with no reason codes and the top limit', () => {
    expect(scoreApplicant(PERFECT)).toMatchObject({
      score: MAX_SCORE,
      band: 'LOW',
      reasonCodes: [],
      recommendedLimit: 5_000_000,
    })
  })

  it('scores no history 0 / DECLINE with every reason code and no offer (no division by zero)', () => {
    expect(scoreApplicant(NO_HISTORY)).toMatchObject({
      score: 0,
      band: 'DECLINE',
      reasonCodes: ['UTIL_LATE_PAYMENTS', 'SUPPLIER_THIN_HISTORY', 'LOAD_IRREGULAR', 'LOAD_SHORT_HISTORY'],
      recommendedLimit: 0,
    })
  })

  it.each(APPLICANT_PROFILES)('keeps $name in 0–1000 with integer factors that sum to the score', ({ signals }) => {
    const result = scoreApplicant(signals)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(MAX_SCORE)
    expect(result.factors.reduce((sum, factor) => sum + factor.points, 0)).toBe(result.score)
    for (const factor of result.factors) {
      expect(Number.isInteger(factor.points)).toBe(true)
      expect(factor.points).toBeLessThanOrEqual(factor.maxPoints)
    }
  })

  it('caps over-reported history instead of scoring above the factor maximum', () => {
    const inflated = { ...PERFECT, utility: { provider: 'Meralco', monthsOnTime: 20, monthsObserved: 12 } } as const
    expect(scoreApplicant(inflated).score).toBe(MAX_SCORE)
  })

  it('flags late supplier payment above 7 days', () => {
    const late = { ...PERFECT, supplier: { invoicesPaid: 24, invoicesTotal: 24, avgDaysLate: 8 } }
    expect(scoreApplicant(late).reasonCodes).toEqual(['SUPPLIER_PAYS_LATE'])
  })
})

describe('recommendLimit and riskBand', () => {
  it.each([
    [1000, 5_000_000, 'LOW'],
    [800, 5_000_000, 'LOW'],
    [799, 2_500_000, 'LOW'],
    [700, 2_500_000, 'LOW'],
    [699, 1_000_000, 'MEDIUM'],
    [550, 1_000_000, 'MEDIUM'],
    [549, 500_000, 'HIGH'],
    [400, 500_000, 'HIGH'],
    [399, 0, 'DECLINE'],
    [0, 0, 'DECLINE'],
  ] as const)('score %i → limit %i centavos, band %s', (score, limit, band) => {
    expect(recommendLimit(score)).toBe(limit)
    expect(riskBand(score)).toBe(band)
  })

  it('only offers amounts the Disburse form accepts (₱500 – ₱50,000 in ₱100 steps)', () => {
    for (let score = 400; score <= MAX_SCORE; score += 1) {
      const limit = recommendLimit(score)
      expect(limit).toBeGreaterThanOrEqual(50_000)
      expect(limit).toBeLessThanOrEqual(5_000_000)
      expect(limit % 10_000).toBe(0)
    }
  })
})

describe('splitRepayment (remainder allocation)', () => {
  it('splits the README example ₱1,050.00 into ₱1,000.00 principal + ₱50.00 interest', () => {
    expect(splitRepayment(toCentavos(105_000))).toEqual({ principal: 100_000, interest: 5_000 })
  })

  it('keeps the centavo a naive float split drops: ₱1,000.00 → 95239 + 4761', () => {
    // floor(100000 / 1.05) + floor(100000 × 0.05 / 1.05) = 95238 + 4761 = 99999: one centavo lost.
    expect(splitRepayment(toCentavos(100_000))).toEqual({ principal: 95_239, interest: 4_761 })
  })

  it('satisfies principal + interest === total for every total from 1 to 100,000 centavos', () => {
    let failures = 0
    for (let total = 1; total <= 100_000; total += 1) {
      const { principal, interest } = splitRepayment(toCentavos(total))
      if (principal + interest !== total || interest < 0 || principal <= 0) failures += 1
    }
    expect(failures).toBe(0)
  })

  it('stays exact at Number.MAX_SAFE_INTEGER, where total × rate would lose precision as a float', () => {
    const total = toCentavos(Number.MAX_SAFE_INTEGER)
    const { principal, interest } = splitRepayment(total)
    expect(BigInt(principal) + BigInt(interest)).toBe(BigInt(total))
  })

  it('floors interest, never rounding it up against the borrower', () => {
    expect(splitRepayment(toCentavos(20))).toEqual({ principal: 20, interest: 0 })
    expect(splitRepayment(toCentavos(21))).toEqual({ principal: 20, interest: 1 })
  })

  it('rejects a zero or negative total and a fractional rate', () => {
    expect(() => splitRepayment(toCentavos(0))).toThrow(RangeError)
    expect(() => splitRepayment(toCentavos(-1))).toThrow(RangeError)
    expect(() => splitRepayment(toCentavos(100), 2.5)).toThrow(RangeError)
  })

  it('payoffAmount settles exactly: its principal part equals what is owed, for 1 to 100,000 centavos', () => {
    let failures = 0
    for (let owed = 1; owed <= 100_000; owed += 1) {
      if (splitRepayment(payoffAmount(toCentavos(owed))).principal !== owed) failures += 1
    }
    expect(failures).toBe(0)
  })

  it('formats basis points without decimal division', () => {
    expect(formatBps(500)).toBe('5.00%')
    expect(formatBps(25)).toBe('0.25%')
    expect(formatBps(1250)).toBe('12.50%')
  })
})
