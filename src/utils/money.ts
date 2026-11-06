/**
 * Money primitives (CLAUDE.md §4).
 *
 * Every monetary value is an integer number of centavos (₱1.00 = 100) carried
 * in the branded `Centavos` type. Pesos only exist as strings: user input is
 * parsed string → centavos, and display output is formatted centavos → string.
 * No function in this file multiplies or divides a decimal `number`.
 */

declare const centavosBrand: unique symbol

/** Integer centavos. Construct only through `toCentavos` or `parsePesosToCentavos`. */
export type Centavos = number & { readonly [centavosBrand]: 'Centavos' }

/** Largest whole-peso part we accept: 13 digits keeps `whole * 100 + 99` a safe integer. */
const MAX_WHOLE_PESO_DIGITS = 13

export function isCentavos(value: unknown): value is Centavos {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** Brands an integer. Throws on fractions, NaN, Infinity, or unsafe integers. */
export function toCentavos(value: number): Centavos {
  if (!isCentavos(value)) {
    throw new RangeError(`Centavos must be a safe integer, received ${String(value)}`)
  }
  return value
}

/** Sums centavo amounts; throws if the total leaves the safe-integer range. */
export function sumCentavos(values: readonly Centavos[]): Centavos {
  let total = 0
  for (const value of values) {
    total += value
  }
  return toCentavos(total)
}

export type PesoParseError = 'EMPTY' | 'FORMAT' | 'PRECISION' | 'TOO_LARGE'

export type PesoParseResult =
  | { readonly ok: true; readonly value: Centavos }
  | { readonly ok: false; readonly error: PesoParseError }

/** Whole pesos: plain digits, or digits grouped by thousands with commas. */
const WHOLE_PESOS = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/

/**
 * Parses a user-typed peso amount ("5,000", "5000.50") into integer centavos
 * using only string and integer operations, so "19.99" is exactly 1999
 * (whereas 19.99 * 100 === 1998.9999999999998 in IEEE-754).
 *
 * Rejects: empty input, signs, exponents ("1e3"), hex, misplaced commas,
 * more than two decimals ("10.005"), and amounts beyond 13 whole-peso digits.
 */
export function parsePesosToCentavos(input: string): PesoParseResult {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, error: 'EMPTY' }

  const [wholePart = '', fractionPart, ...rest] = trimmed.split('.')
  if (rest.length > 0 || !WHOLE_PESOS.test(wholePart)) {
    return { ok: false, error: 'FORMAT' }
  }
  if (fractionPart !== undefined && !/^\d+$/.test(fractionPart)) {
    return { ok: false, error: 'FORMAT' }
  }
  if (fractionPart !== undefined && fractionPart.length > 2) {
    return { ok: false, error: 'PRECISION' }
  }

  const wholeDigits = wholePart.replaceAll(',', '').replace(/^0+(?=\d)/, '')
  if (wholeDigits.length > MAX_WHOLE_PESO_DIGITS) {
    return { ok: false, error: 'TOO_LARGE' }
  }

  // Concatenate digits instead of multiplying: "19" + "99" → 1999 centavos.
  const centavoDigits = wholeDigits + (fractionPart ?? '').padEnd(2, '0')
  return { ok: true, value: toCentavos(Number.parseInt(centavoDigits, 10)) }
}

const phpFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Formats centavos as Philippine pesos ("₱5,000.00"). The amount is handed to
 * Intl as an exact decimal string, never as `centavos / 100`.
 */
export function formatPHP(centavos: Centavos): string {
  const sign = centavos < 0 ? '-' : ''
  const digits = String(Math.abs(centavos)).padStart(3, '0')
  const decimal = `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`
  return phpFormatter.format(decimal as Intl.StringNumericLiteral)
}
