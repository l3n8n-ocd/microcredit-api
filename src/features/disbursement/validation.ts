import { formatPHP, parsePesosToCentavos, toCentavos, type Centavos } from '../../utils/index.ts'
import type { LoanOf, LoanState, WalletProvider } from './types.ts'

/** Disbursement bounds: ₱500.00 – ₱50,000.00 in ₱100.00 steps (all in centavos). */
export const MIN_DISBURSEMENT = toCentavos(50_000)
export const MAX_DISBURSEMENT = toCentavos(5_000_000)
export const DISBURSEMENT_STEP = toCentavos(10_000)
/** Daily cap bounds: ₱500.00 – ₱200,000.00. */
export const MIN_DAILY_CAP = toCentavos(50_000)
export const MAX_DAILY_CAP = toCentavos(20_000_000)
export const MAX_NOTE_LENGTH = 140

/** PH mobile: 11 digits starting with 09, e.g. 09171234567. */
export const PH_MOBILE_PATTERN = /^09\d{9}$/

export const WALLET_PROVIDERS: readonly { readonly value: WalletProvider; readonly label: string }[] = [
  { value: 'gcash', label: 'GCash' },
  { value: 'maya', label: 'Maya' },
]

export function isWalletProvider(value: string): value is WalletProvider {
  return WALLET_PROVIDERS.some((provider) => provider.value === value)
}

// oxlint-disable-next-line no-control-regex -- the point is to reject control characters
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export function isDisbursableAmount(amount: Centavos): boolean {
  return (
    amount >= MIN_DISBURSEMENT && amount <= MAX_DISBURSEMENT && amount % DISBURSEMENT_STEP === 0
  )
}

export function isValidReferenceNote(note: string): boolean {
  return note.length <= MAX_NOTE_LENGTH && !CONTROL_CHARACTERS.test(note)
}

export type FieldName = 'loanId' | 'provider' | 'recipientMobile' | 'amount' | 'dailyCap' | 'referenceNote'

/** Raw form state: every field is the exact string the operator typed or picked. */
export type FormValues = Readonly<Record<FieldName, string>>

export type FieldErrors = Partial<Record<FieldName, string>>

export interface ValidDisbursement {
  readonly loan: LoanOf<'APPROVED'>
  readonly provider: WalletProvider
  readonly recipientMobile: string
  readonly amount: Centavos
  readonly referenceNote: string
}

export type ValidationResult =
  | { readonly ok: true; readonly value: ValidDisbursement }
  | { readonly ok: false; readonly errors: FieldErrors }

const PARSE_MESSAGES = {
  EMPTY: 'Enter an amount in pesos.',
  FORMAT: 'Use digits with an optional decimal point, e.g. 5000 or 5,000.00.',
  PRECISION: 'Amounts can have at most 2 decimal places (centavos).',
} as const

function parseBoundedAmount(
  input: string,
  min: Centavos,
  max: Centavos,
): { readonly value: Centavos } | { readonly error: string } {
  const parsed = parsePesosToCentavos(input)
  const outOfRange = `Enter an amount from ${formatPHP(min)} to ${formatPHP(max)}.`
  if (!parsed.ok) {
    return { error: parsed.error === 'TOO_LARGE' ? outOfRange : PARSE_MESSAGES[parsed.error] }
  }
  if (parsed.value < min || parsed.value > max) return { error: outOfRange }
  return { value: parsed.value }
}

export function findApprovedLoan(loans: readonly LoanState[], loanId: string): LoanOf<'APPROVED'> | null {
  const loan = loans.find((candidate) => candidate.id === loanId)
  return loan?.status === 'APPROVED' ? loan : null
}

/** Validates the raw form. Money is parsed string → centavos here and nowhere else. */
export function validateDisbursement(values: FormValues, loans: readonly LoanState[]): ValidationResult {
  const errors: FieldErrors = {}

  const loan = findApprovedLoan(loans, values.loanId)
  if (loan === null) errors.loanId = 'Select an APPROVED loan to disburse.'

  const provider = isWalletProvider(values.provider) ? values.provider : null
  if (provider === null) errors.provider = 'Choose GCash or Maya.'

  const recipientMobile = values.recipientMobile.trim()
  if (!PH_MOBILE_PATTERN.test(recipientMobile)) {
    errors.recipientMobile = 'Enter an 11-digit mobile number that starts with 09, e.g. 09171234567.'
  }

  const cap = parseBoundedAmount(values.dailyCap, MIN_DAILY_CAP, MAX_DAILY_CAP)
  if ('error' in cap) errors.dailyCap = cap.error

  const amount = parseBoundedAmount(values.amount, MIN_DISBURSEMENT, MAX_DISBURSEMENT)
  if ('error' in amount) {
    errors.amount = amount.error
  } else if (amount.value % DISBURSEMENT_STEP !== 0) {
    errors.amount = `Amount must be in ${formatPHP(DISBURSEMENT_STEP)} steps, e.g. ₱5,000.00 or ₱5,100.00.`
  } else if ('value' in cap && amount.value > cap.value) {
    errors.amount = `Amount exceeds the daily disbursement cap of ${formatPHP(cap.value)}.`
  }

  const referenceNote = values.referenceNote.trim()
  if (!isValidReferenceNote(referenceNote)) {
    errors.referenceNote = `Keep the note to ${MAX_NOTE_LENGTH} characters or fewer, without line breaks.`
  }

  if (loan === null || provider === null || !('value' in amount) || Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, value: { loan, provider, recipientMobile, amount: amount.value, referenceNote } }
}
