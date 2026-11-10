import { describe, expect, it } from 'vitest'
import { readSecret } from './env.ts'

describe('readSecret', () => {
  it('returns null for a missing, empty or whitespace-only value', () => {
    expect(readSecret(undefined)).toBeNull()
    expect(readSecret('')).toBeNull()
    expect(readSecret('   ')).toBeNull()
  })

  it('returns null for every placeholder in .env.example', () => {
    expect(readSecret('sk-ant-placeholder-do-not-commit-real-key')).toBeNull()
    expect(readSecret('placeholder-do-not-commit-real-key')).toBeNull()
    expect(readSecret('whsec_placeholder_only')).toBeNull()
    expect(readSecret('PLACEHOLDER')).toBeNull()
  })

  it('returns a real value, trimmed', () => {
    expect(readSecret('  unit-test-value-not-a-key\n')).toBe('unit-test-value-not-a-key')
  })
})
