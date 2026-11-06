import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App.tsx'

afterEach(() => {
  cleanup()
})

/**
 * WCAG 2.1 SC 1.4.11: a form control's outline needs 3:1 against what is next to it.
 * Measured in Chromium on this app's backgrounds, border-slate-500 (renders #62748E)
 * gives 3.74–4.23:1 for all 10 controls; border-slate-600 is below 3:1 and fails.
 * docs/PORTFOLIO_DESIGN_SYSTEM.md Rule 2, token `field`.
 */
describe('form control borders (WCAG 1.4.11)', () => {
  it('outlines every input, select and textarea with border-slate-500, or rose-400 when invalid', () => {
    const { container } = render(<App />)
    const controls = [...container.querySelectorAll('input, select, textarea')].filter(
      // Native radios have no border class; the filter radios are visually hidden behind their labels.
      (control) => control.getAttribute('type') !== 'radio',
    )
    expect(controls.length).toBeGreaterThanOrEqual(9)
    for (const control of controls) {
      const classes = control.className.split(/\s+/)
      expect(classes, control.id).not.toContain('border-slate-600')
      expect(classes.some((name) => name === 'border-slate-500' || name === 'border-rose-400'), control.id).toBe(true)
    }
  })
})
