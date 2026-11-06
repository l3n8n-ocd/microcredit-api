import { useId, useState, type FormEvent } from 'react'
import { parsePesosToCentavos } from '../../../utils/index.ts'

export type DisbursementMethod = 'bank_transfer' | 'e_wallet' | 'cash_pickup'

export interface DisbursementSettings {
  /** Principal in integer centavos. */
  principalCentavos: number
  termMonths: number
  /** Annual interest rate in basis points (e.g. 2400 = 24.00%). */
  annualRateBps: number
  method: DisbursementMethod
  minTrustScore: number
  /** Max debt-to-income ratio in whole percent. */
  maxDtiPercent: number
  requireManualReview: boolean
}

interface FormValues {
  principal: string
  termMonths: string
  annualRate: string
  method: DisbursementMethod
  minTrustScore: string
  maxDtiPercent: string
  requireManualReview: boolean
}

type FormErrors = Partial<Record<keyof FormValues, string>>

const INITIAL_VALUES: FormValues = {
  principal: '',
  termMonths: '6',
  annualRate: '24',
  method: 'e_wallet',
  minTrustScore: '600',
  maxDtiPercent: '40',
  requireManualReview: false,
}

const METHOD_LABELS: Record<DisbursementMethod, string> = {
  bank_transfer: 'Bank transfer',
  e_wallet: 'E-wallet',
  cash_pickup: 'Cash pickup',
}

function parseIntInRange(input: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(input.trim())) return null
  const value = Number(input)
  return value >= min && value <= max ? value : null
}

function parseRateToBps(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!match) return null
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return bps <= 10000 ? bps : null
}

function validate(values: FormValues): { errors: FormErrors; settings: DisbursementSettings | null } {
  const errors: FormErrors = {}

  const principalCentavos = parsePesosToCentavos(values.principal)
  if (principalCentavos === null || principalCentavos <= 0) {
    errors.principal = 'Enter a positive amount with up to 2 decimals.'
  }
  const termMonths = parseIntInRange(values.termMonths, 1, 60)
  if (termMonths === null) errors.termMonths = 'Term must be 1–60 months.'
  const annualRateBps = parseRateToBps(values.annualRate)
  if (annualRateBps === null) errors.annualRate = 'Rate must be 0–100% with up to 2 decimals.'
  const minTrustScore = parseIntInRange(values.minTrustScore, 300, 850)
  if (minTrustScore === null) errors.minTrustScore = 'Score must be 300–850.'
  const maxDtiPercent = parseIntInRange(values.maxDtiPercent, 0, 100)
  if (maxDtiPercent === null) errors.maxDtiPercent = 'DTI must be 0–100%.'

  if (
    principalCentavos === null ||
    principalCentavos <= 0 ||
    termMonths === null ||
    annualRateBps === null ||
    minTrustScore === null ||
    maxDtiPercent === null
  ) {
    return { errors, settings: null }
  }

  return {
    errors,
    settings: {
      principalCentavos,
      termMonths,
      annualRateBps,
      method: values.method,
      minTrustScore,
      maxDtiPercent,
      requireManualReview: values.requireManualReview,
    },
  }
}

interface DisbursementSettingsFormProps {
  onSubmit?: (settings: DisbursementSettings) => void
}

const inputClass =
  'mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-400 focus:outline-none'

export function DisbursementSettingsForm({ onSubmit }: DisbursementSettingsFormProps) {
  const id = useId()
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES)
  const [errors, setErrors] = useState<FormErrors>({})
  const [saved, setSaved] = useState<DisbursementSettings | null>(null)

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = validate(values)
    setErrors(result.errors)
    if (result.settings) {
      setSaved(result.settings)
      onSubmit?.(result.settings)
    } else {
      setSaved(null)
    }
  }

  const textFields: { key: Exclude<keyof FormValues, 'method' | 'requireManualReview'>; label: string; inputMode: 'decimal' | 'numeric' }[] = [
    { key: 'principal', label: 'Principal amount (₱)', inputMode: 'decimal' },
    { key: 'termMonths', label: 'Term (months)', inputMode: 'numeric' },
    { key: 'annualRate', label: 'Annual interest rate (%)', inputMode: 'decimal' },
    { key: 'minTrustScore', label: 'Minimum trust score', inputMode: 'numeric' },
    { key: 'maxDtiPercent', label: 'Max debt-to-income (%)', inputMode: 'numeric' },
  ]

  return (
    <form
      aria-labelledby={`${id}-title`}
      noValidate
      onSubmit={handleSubmit}
      className="mt-8 space-y-4 rounded-lg border border-slate-800 bg-slate-900/50 p-6"
    >
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        Disbursement &amp; underwriting settings
      </h2>

      {textFields.map(({ key, label, inputMode }) => {
        const fieldId = `${id}-${key}`
        const error = errors[key]
        return (
          <div key={key}>
            <label htmlFor={fieldId} className="block text-sm text-slate-300">
              {label}
            </label>
            <input
              id={fieldId}
              type="text"
              inputMode={inputMode}
              value={values[key]}
              onChange={(e) => update(key, e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${fieldId}-error` : undefined}
              className={inputClass}
            />
            {error ? (
              <p id={`${fieldId}-error`} className="mt-1 text-sm text-rose-400">
                {error}
              </p>
            ) : null}
          </div>
        )
      })}

      <div>
        <label htmlFor={`${id}-method`} className="block text-sm text-slate-300">
          Disbursement method
        </label>
        <select
          id={`${id}-method`}
          value={values.method}
          onChange={(e) => update('method', e.target.value as DisbursementMethod)}
          className={inputClass}
        >
          {(Object.keys(METHOD_LABELS) as DisbursementMethod[]).map((method) => (
            <option key={method} value={method}>
              {METHOD_LABELS[method]}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={values.requireManualReview}
          onChange={(e) => update('requireManualReview', e.target.checked)}
        />
        Require manual review before disbursement
      </label>

      <button
        type="submit"
        className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-slate-950 hover:bg-emerald-400"
      >
        Save settings
      </button>

      {saved ? (
        <p role="status" className="text-sm text-emerald-400">
          Settings saved.
        </p>
      ) : null}
    </form>
  )
}
