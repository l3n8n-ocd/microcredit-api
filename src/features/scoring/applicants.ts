import type { AltDataSignals } from './scoreEngine.ts'

export interface ApplicantProfile {
  readonly borrowerId: string
  /** Business name. Demo data only: fictional stores, no real borrowers. */
  readonly name: string
  readonly signals: AltDataSignals
}

/** One profile per borrower in SEED_LOANS (src/features/disbursement/seedLoans.ts). */
export const APPLICANT_PROFILES: readonly ApplicantProfile[] = [
  {
    borrowerId: 'borrower-42',
    name: "Nena's Sari-Sari Store",
    signals: {
      utility: { provider: 'Meralco', monthsOnTime: 12, monthsObserved: 12 },
      supplier: { invoicesPaid: 23, invoicesTotal: 24, avgDaysLate: 1 },
      load: { topUpsPerMonth: 9, monthsActive: 24 },
    },
  },
  {
    borrowerId: 'borrower-17',
    name: "Kuya Ben's Carinderia",
    signals: {
      utility: { provider: 'Meralco', monthsOnTime: 10, monthsObserved: 12 },
      supplier: { invoicesPaid: 14, invoicesTotal: 16, avgDaysLate: 4 },
      load: { topUpsPerMonth: 6, monthsActive: 18 },
    },
  },
  {
    borrowerId: 'borrower-08',
    name: "Liza's Bigasan & Load",
    signals: {
      utility: { provider: 'Water', monthsOnTime: 9, monthsObserved: 12 },
      supplier: { invoicesPaid: 9, invoicesTotal: 12, avgDaysLate: 6 },
      load: { topUpsPerMonth: 5, monthsActive: 10 },
    },
  },
  {
    borrowerId: 'borrower-05',
    name: "Mang Tonyo's Tricycle (TODA)",
    signals: {
      utility: { provider: 'Meralco', monthsOnTime: 5, monthsObserved: 8 },
      supplier: { invoicesPaid: 3, invoicesTotal: 5, avgDaysLate: 12 },
      load: { topUpsPerMonth: 3, monthsActive: 4 },
    },
  },
  {
    borrowerId: 'borrower-31',
    name: "Rosa's Palengke Fish Stall",
    signals: {
      utility: { provider: 'Water', monthsOnTime: 3, monthsObserved: 9 },
      supplier: { invoicesPaid: 2, invoicesTotal: 6, avgDaysLate: 21 },
      load: { topUpsPerMonth: 2, monthsActive: 3 },
    },
  },
]
