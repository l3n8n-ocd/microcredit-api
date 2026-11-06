import { describe, expect, it } from 'vitest'
import { formatPHP, parsePesosToCentavos, sumCentavos, toCentavos } from './money.ts'
import { isUuidV4 } from './idempotency.ts'

describe('parsePesosToCentavos', () => {
  it.each([
    ['500', 50000],
    ['500.00', 50000],
    ['5,000.5', 500050],
    ['50,000.00', 5000000],
    ['0.10', 10],
    ['007.5', 750],
  ])('parses %s to %i centavos', (input, expected) => {
    expect(parsePesosToCentavos(input)).toEqual({ ok: true, value: expected })
  })

  it('is exact where float multiplication drifts', () => {
    expect(19.99 * 100).not.toBe(1999)
    expect(1.15 * 100).not.toBe(115)
    expect(parsePesosToCentavos('19.99')).toEqual({ ok: true, value: 1999 })
    expect(parsePesosToCentavos('1.15')).toEqual({ ok: true, value: 115 })
  })

  it.each([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['-500', 'FORMAT'],
    ['+500', 'FORMAT'],
    ['1e3', 'FORMAT'],
    ['0x1F4', 'FORMAT'],
    ['5,00', 'FORMAT'],
    ['1.2.3', 'FORMAT'],
    ['500.', 'FORMAT'],
    ['abc', 'FORMAT'],
    ['10.005', 'PRECISION'],
    ['5000.999', 'PRECISION'],
    ['90071992547409.93', 'TOO_LARGE'],
  ])('rejects %j as %s', (input, error) => {
    expect(parsePesosToCentavos(input)).toEqual({ ok: false, error })
  })
})

describe('formatPHP', () => {
  it.each([
    [0, '₱0.00'],
    [5, '₱0.05'],
    [1999, '₱19.99'],
    [500000, '₱5,000.00'],
    [5000000, '₱50,000.00'],
    [-10050, '-₱100.50'],
  ])('formats %i centavos as %s', (centavos, expected) => {
    expect(formatPHP(toCentavos(centavos))).toBe(expected)
  })
})

describe('toCentavos / sumCentavos', () => {
  it('rejects fractional and unsafe values', () => {
    expect(() => toCentavos(19.99)).toThrow(RangeError)
    expect(() => toCentavos(Number.NaN)).toThrow(RangeError)
    expect(() => toCentavos(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError)
  })

  it('throws instead of silently overflowing a total', () => {
    expect(sumCentavos([toCentavos(100), toCentavos(250)])).toBe(350)
    expect(() => sumCentavos([toCentavos(Number.MAX_SAFE_INTEGER), toCentavos(1)])).toThrow(RangeError)
  })
})

describe('isUuidV4', () => {
  it('accepts v4 and rejects other shapes', () => {
    expect(isUuidV4(crypto.randomUUID())).toBe(true)
    expect(isUuidV4('00000000-0000-1000-8000-000000000000')).toBe(false)
    expect(isUuidV4('not-a-key')).toBe(false)
  })
})
