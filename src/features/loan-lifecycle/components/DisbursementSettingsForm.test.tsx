import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parsePesosToCentavos } from '../../../utils/index.ts'
import { DisbursementSettingsForm } from './DisbursementSettingsForm.tsx'

afterEach(() => {
  cleanup()
})

describe('parsePesosToCentavos', () => {
  it('converts peso strings to integer centavos', () => {
    expect(parsePesosToCentavos('1,250.5')).toBe(125050)
    expect(parsePesosToCentavos('0.10')).toBe(10)
    expect(parsePesosToCentavos('100')).toBe(10000)
  })

  it('rejects invalid input', () => {
    expect(parsePesosToCentavos('')).toBeNull()
    expect(parsePesosToCentavos('1.234')).toBeNull()
    expect(parsePesosToCentavos('-5')).toBeNull()
    expect(parsePesosToCentavos('abc')).toBeNull()
  })
})

describe('DisbursementSettingsForm', () => {
  it('shows a validation error when principal is missing', () => {
    const onSubmit = vi.fn()
    render(<DisbursementSettingsForm onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(screen.getByText('Enter a positive amount with up to 2 decimals.')).toBeDefined()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits parsed settings with money in centavos', () => {
    const onSubmit = vi.fn()
    render(<DisbursementSettingsForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText('Principal amount (₱)'), {
      target: { value: '5,000.25' },
    })
    fireEvent.change(screen.getByLabelText('Disbursement method'), {
      target: { value: 'bank_transfer' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(onSubmit).toHaveBeenCalledWith({
      principalCentavos: 500025,
      termMonths: 6,
      annualRateBps: 2400,
      method: 'bank_transfer',
      minTrustScore: 600,
      maxDtiPercent: 40,
      requireManualReview: false,
    })
    expect(screen.getByRole('status').textContent).toBe('Settings saved.')
  })
})
