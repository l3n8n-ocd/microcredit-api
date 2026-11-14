/**
 * FE-AA1 · /motion-lab workbench. Every control is labelled and reports
 * aria-invalid (CLAUDE.md §11 rule 1), and each one drives the buttons.
 * Queries are by role, label and text only (FE-09).
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MotionLab } from '../MotionLab.tsx'
import { simulate } from '../simulate.ts'

const DISBURSE = 'Disburse ₱5,000.00'

function telemetryRow(name: string): readonly string[] {
  const table = screen.getByRole('table', { name: /Live state and click counts/ })
  const row = within(table)
    .getAllByRole('row')
    .find((r) => within(r).queryByRole('rowheader', { name }) !== null)
  if (row === undefined) throw new Error(`no telemetry row for ${name}`)
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '')
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('MotionLab controls (§11 rule 1)', () => {
  it('every control is found by its label and reports aria-invalid="false" and a hint', () => {
    render(<MotionLab />)
    const labels = [
      'Force Success',
      'Force Error',
      'Realistic async',
      'live',
      'idle',
      'loading',
      'success',
      'error',
      'disabled',
      /Simulate prefers-reduced-motion: reduce/,
      'Disabled',
    ]
    for (const label of labels) {
      const control = screen.getByLabelText(label, { exact: typeof label === 'string' })
      expect(control.getAttribute('aria-invalid')).toBe('false')
      const hintId = control.getAttribute('aria-describedby')
      expect(hintId).not.toBeNull()
      expect(document.getElementById(hintId ?? '')?.textContent).not.toBe('')
    }
  })

  it('says the outcomes are simulated and no ledger entry is written', () => {
    render(<MotionLab />)
    expect(screen.getByText(/No request leaves this page and no ledger entry is/)).toBeTruthy()
  })
})

describe('MotionLab workbench', () => {
  it('Force Success: the Disburse button runs to "201 Disbursed · ₱5,000.00" and back', async () => {
    render(<MotionLab />)
    fireEvent.click(screen.getByRole('button', { name: DISBURSE }))
    expect(screen.getByRole('button', { name: 'Locking Idempotency-Key...' })).toBeTruthy()
    expect(telemetryRow('Disburse')[0]).toBe('loading')
    await advance(900)
    expect(screen.getByRole('button', { name: '201 Disbursed · ₱5,000.00' })).toBeTruthy()
    await advance(1400)
    expect(screen.getByRole('button', { name: DISBURSE })).toBeTruthy()
    expect(screen.getByRole('list', { name: /Disburse transitions/ }).textContent).toContain('success → idle')
  })

  it('Force Error: both buttons show their retry labels', async () => {
    render(<MotionLab />)
    fireEvent.click(screen.getByLabelText('Force Error'))
    fireEvent.click(screen.getByRole('button', { name: DISBURSE }))
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }))
    expect(screen.getByRole('button', { name: 'Streaming Evaluation...' })).toBeTruthy()
    await advance(900)
    expect(screen.getByRole('button', { name: '409 Conflict · Retry Payout' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stream Dropped · Retry' })).toBeTruthy()
    expect(screen.getAllByText(/^shake 320ms/)).toHaveLength(2)
  })

  it('Fire 10 Rapid Clicks: 1 accepted, 9 ignored, one run', async () => {
    render(<MotionLab />)
    fireEvent.click(screen.getByRole('button', { name: 'Fire 10 Rapid Clicks' }))
    const [state, accepted, ignored] = telemetryRow('Disburse')
    expect(state).toBe('loading')
    expect(accepted).toBe('1')
    expect(ignored).toBe('9')
    await advance(900)
    expect(screen.getByRole('button', { name: '201 Disbursed · ₱5,000.00' })).toBeTruthy()
  })

  it('the scrubber pins both buttons, cancels the run in flight, and Live releases them to idle', async () => {
    render(<MotionLab />)
    fireEvent.click(screen.getByRole('button', { name: DISBURSE }))
    fireEvent.click(screen.getByLabelText('error', { exact: true }))
    expect(screen.getByRole('button', { name: '409 Conflict · Retry Payout' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stream Dropped · Retry' })).toBeTruthy()

    // The cancelled run's timer is gone: nothing lands after its 900 ms.
    await advance(900)
    expect(screen.getByRole('button', { name: '409 Conflict · Retry Payout' })).toBeTruthy()

    fireEvent.click(screen.getByLabelText('live', { exact: true }))
    expect(screen.getByRole('button', { name: DISBURSE })).toBeTruthy()
    expect(telemetryRow('Disburse')[0]).toBe('idle')
  })

  it('Disabled locks both buttons; the burst then starts nothing', () => {
    render(<MotionLab />)
    fireEvent.click(screen.getByLabelText('Disabled'))
    const disburse = screen.getByRole('button', { name: DISBURSE }) as HTMLButtonElement
    expect(disburse.disabled).toBe(true)
    expect(disburse.getAttribute('aria-disabled')).toBe('true')
    expect((screen.getByRole('button', { name: 'Send Prompt' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Fire 10 Rapid Clicks' }))
    expect(telemetryRow('Disburse')[1]).toBe('0')
  })

  it('Simulate reduced motion switches both buttons to the 120 ms fade', () => {
    render(<MotionLab />)
    fireEvent.click(screen.getByLabelText(/Simulate prefers-reduced-motion: reduce/))
    expect(screen.getByRole('button', { name: DISBURSE }).style.getPropertyValue('--smart-shake-name')).toBe('none')
    expect(screen.getAllByText('120ms opacity crossfade (reduced motion)')).toHaveLength(2)
    expect(screen.getByText('on (simulated)')).toBeTruthy()
  })

  it('Realistic async fails when the draw is under 0.2 and waits 600–1100 ms', async () => {
    const draws = [0, 0.1]
    render(<MotionLab random={{ next: () => draws.shift() ?? 0.9 }} />)
    fireEvent.click(screen.getByLabelText('Realistic async'))
    fireEvent.click(screen.getByRole('button', { name: DISBURSE }))
    await advance(599)
    expect(screen.getByRole('button', { name: 'Locking Idempotency-Key...' })).toBeTruthy()
    await advance(1)
    expect(screen.getByRole('button', { name: '409 Conflict · Retry Payout' })).toBeTruthy()
  })
})

describe('simulate', () => {
  it('rejects and clears its timer when aborted', async () => {
    const controller = new AbortController()
    const outcome = simulate('success', controller.signal)
    controller.abort()
    await expect(outcome).rejects.toThrow('aborted')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('realistic mode: delay is 600 + draw × 500 ms, and a draw of 0.2 or more succeeds', async () => {
    const draws = [1, 0.2]
    const outcome = simulate('realistic', new AbortController().signal, { next: () => draws.shift() ?? 0 })
    vi.advanceTimersByTime(1100)
    await expect(outcome).resolves.toBeUndefined()
  })
})
