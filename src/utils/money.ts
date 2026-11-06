/** Parses a decimal peso string ("1,250.50") into integer centavos without float math. */
export function parsePesosToCentavos(input: string): number | null {
  const cleaned = input.replace(/,/g, '').trim()
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned)
  if (!match) return null
  const whole = Number(match[1])
  const fraction = Number((match[2] ?? '').padEnd(2, '0'))
  return whole * 100 + fraction
}
