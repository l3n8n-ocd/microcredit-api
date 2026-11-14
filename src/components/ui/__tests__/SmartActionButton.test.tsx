/**
 * FE-AA1 · SmartActionButton. The state machine, spam safety, disabled,
 * keyboard and reduced motion. Queries are by role and name only (FE-09).
 *
 * jsdom does not apply stylesheets, so motion is checked at the one place the
 * component decides it: the inline custom properties it writes on the button
 * (`--smart-shift`, `--smart-shake-name`, ...), which the CSS in
 * src/app/globals.css reads. The real pixels are checked in e2e/motion-lab.spec.ts.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SmartActionButton, type SmartLabels } from '../SmartActionButton.tsx'

const LABELS: SmartLabels = {
  idle: 'Disburse ₱5,000.00',
  loading: 'Locking Idempotency-Key...',
  success: '201 Disbursed · ₱5,000.00',
  error: '409 Conflict · Retry Payout',
}

interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: () => void
}

function deferred(): Deferred {
  let resolve: () => void = () => {}
  let reject: () => void = () => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res()
    reject = () => rej(new Error('refused'))
  })
  return { promise, resolve, reject }
}

/** The button by its current visible label. Hidden layers are aria-hidden, so the name is the live label. */
function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

function status(): string {
  return screen.getByRole('status').textContent ?? ''
}

async function settle(run: () => void): Promise<void> {
  await act(async () => {
    run()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SmartActionButton state machine', () => {
  it('Force Success: idle → loading → success, holds 1400 ms, then returns to idle', async () => {
    const run = deferred()
    const states: string[] = []
    render(<SmartActionButton labels={LABELS} action={() => run.promise} onStateChange={(s) => states.push(s)} />)

    const idle = button(LABELS.idle)
    expect(idle.getAttribute('aria-busy')).toBe('false')
    fireEvent.click(idle)

    const loading = button(LABELS.loading)
    expect(loading.getAttribute('aria-busy')).toBe('true')
    expect(status()).toBe(LABELS.loading)

    await settle(() => run.resolve())
    expect(button(LABELS.success).getAttribute('aria-busy')).toBe('false')
    expect(status()).toBe(LABELS.success)

    act(() => vi.advanceTimersByTime(1399))
    expect(button(LABELS.success)).toBeTruthy()
    act(() => vi.advanceTimersByTime(1))
    expect(button(LABELS.idle)).toBeTruthy()
    expect(states).toEqual(['loading', 'success', 'idle'])
  })

  it('Force Error: idle → loading → error with the retry label; pressing it retries and recovers', async () => {
    let attempt = 0
    const runs = [deferred(), deferred()]
    render(<SmartActionButton labels={LABELS} action={() => runs[attempt++]?.promise ?? Promise.resolve()} />)

    fireEvent.click(button(LABELS.idle))
    await settle(() => runs[0]?.reject())
    const retry = button(LABELS.error)
    expect(status()).toBe(LABELS.error)

    fireEvent.click(retry)
    expect(button(LABELS.loading)).toBeTruthy()
    await settle(() => runs[1]?.resolve())
    expect(button(LABELS.success)).toBeTruthy()
    expect(attempt).toBe(2)
  })

  it('5 rapid clicks while loading start the handler once and report 4 ignored clicks', async () => {
    const run = deferred()
    const action = vi.fn(() => run.promise)
    const onIgnoredClick = vi.fn()
    render(<SmartActionButton labels={LABELS} action={action} onIgnoredClick={onIgnoredClick} />)

    const target = button(LABELS.idle)
    for (let i = 0; i < 5; i += 1) fireEvent.click(target)
    expect(action).toHaveBeenCalledTimes(1)
    expect(onIgnoredClick).toHaveBeenCalledTimes(4)

    // Clicks during the success hold are ignored too: no second payout from an impatient finger.
    await settle(() => run.resolve())
    fireEvent.click(button(LABELS.success))
    expect(action).toHaveBeenCalledTimes(1)
    expect(onIgnoredClick).toHaveBeenCalledTimes(5)
  })

  it('10 native clicks in one task (the lab burst) start one run', () => {
    const action = vi.fn(() => new Promise<void>(() => {}))
    render(<SmartActionButton labels={LABELS} action={action} />)
    const target = button(LABELS.idle)
    act(() => {
      for (let i = 0; i < 10; i += 1) target.click()
    })
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('pinning a state mid-run aborts the run; its late result never lands and no timer is left', async () => {
    const run = deferred()
    let signal: AbortSignal | null = null
    const states: string[] = []
    const { rerender } = render(
      <SmartActionButton
        labels={LABELS}
        action={(s) => {
          signal = s
          return run.promise
        }}
        onStateChange={(s) => states.push(s)}
      />,
    )
    fireEvent.click(button(LABELS.idle))

    rerender(<SmartActionButton labels={LABELS} action={() => run.promise} forcedState="error" onStateChange={(s) => states.push(s)} />)
    expect((signal as AbortSignal | null)?.aborted).toBe(true)
    expect(button(LABELS.error)).toBeTruthy()

    // The stale run resolves late: it must not flip the button to success.
    await settle(() => run.resolve())
    expect(button(LABELS.error)).toBeTruthy()

    rerender(<SmartActionButton labels={LABELS} action={() => run.promise} forcedState={null} onStateChange={(s) => states.push(s)} />)
    expect(button(LABELS.idle)).toBeTruthy()
    expect(vi.getTimerCount()).toBe(0)
    expect(states).toEqual(['loading', 'idle'])
  })

  it('unmounting during the success hold clears the timer', async () => {
    const run = deferred()
    const { unmount } = render(<SmartActionButton labels={LABELS} action={() => run.promise} />)
    fireEvent.click(button(LABELS.idle))
    await settle(() => run.resolve())
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('SmartActionButton disabled', () => {
  it('sets disabled and aria-disabled, and a click does nothing', () => {
    const action = vi.fn(() => Promise.resolve())
    render(<SmartActionButton labels={LABELS} action={action} disabled />)
    const target = button(LABELS.idle) as HTMLButtonElement
    expect(target.disabled).toBe(true)
    expect(target.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(target)
    expect(action).not.toHaveBeenCalled()
    expect(target.getAttribute('aria-busy')).toBe('false')
  })

  it('reports aria-disabled="false" when enabled (never omitted)', () => {
    render(<SmartActionButton labels={LABELS} action={() => Promise.resolve()} />)
    expect(button(LABELS.idle).getAttribute('aria-disabled')).toBe('false')
  })
})

describe('SmartActionButton keyboard and reduced motion', () => {
  it('is a native button: Tab focuses it, Enter and Space activate it', async () => {
    const runs = [deferred(), deferred()]
    let attempt = 0
    const action = vi.fn(() => runs[attempt++]?.promise ?? Promise.resolve())
    render(<SmartActionButton labels={LABELS} action={action} />)
    const target = button(LABELS.idle) as HTMLButtonElement

    // A native <button type="button">: focusable, in the tab order, and the browser maps Enter / Space to click.
    expect(target.tagName).toBe('BUTTON')
    expect(target.type).toBe('button')
    expect(target.tabIndex).toBe(0)
    target.focus()
    expect(document.activeElement).toBe(target)

    // jsdom does not synthesise the click a browser sends for Enter / Space, so send the click it would.
    fireEvent.keyDown(target, { key: 'Enter' })
    fireEvent.click(target)
    expect(action).toHaveBeenCalledTimes(1)
    await settle(() => runs[0]?.reject())

    fireEvent.keyUp(button(LABELS.error), { key: ' ' })
    fireEvent.click(button(LABELS.error))
    expect(action).toHaveBeenCalledTimes(2)
    expect(document.activeElement).toBe(target)
  })

  it('draws a focus-visible ring in the accent colour, not the browser default', () => {
    render(<SmartActionButton labels={LABELS} action={() => Promise.resolve()} />)
    const classes = button(LABELS.idle).className.split(' ')
    expect(classes).toContain('focus-visible:ring-accent')
    expect(classes).toContain('focus-visible:ring-2')
  })

  it('full motion: 10 px label shift, 0.97 press, the shake keyframes', () => {
    render(<SmartActionButton labels={LABELS} action={() => Promise.resolve()} />)
    const style = button(LABELS.idle).style
    expect(style.getPropertyValue('--smart-shift')).toBe('10px')
    expect(style.getPropertyValue('--smart-press')).toBe('0.97')
    expect(style.getPropertyValue('--smart-lift')).toBe('1px')
    expect(style.getPropertyValue('--smart-shake-name')).toBe('smart-shake')
  })

  it('simulated reduced motion: no shake, shift, lift or press, and the feedback still changes', async () => {
    const run = deferred()
    render(<SmartActionButton labels={LABELS} action={() => run.promise} reducedMotion />)
    fireEvent.click(button(LABELS.idle))
    await settle(() => run.reject())

    const errored = button(LABELS.error)
    const style = errored.style
    expect(style.getPropertyValue('--smart-shake-name')).toBe('none')
    expect(style.getPropertyValue('--smart-shift')).toBe('0px')
    expect(style.getPropertyValue('--smart-lift')).toBe('0px')
    expect(style.getPropertyValue('--smart-press')).toBe('1')
    expect(style.getPropertyValue('--smart-swap')).toBe('var(--motion-reduced)')
    // Text and live-region feedback are kept.
    expect(status()).toBe(LABELS.error)
  })

  it('the OS setting (matchMedia) turns reduced motion on with no prop', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    render(<SmartActionButton labels={LABELS} action={() => Promise.resolve()} />)
    expect(button(LABELS.idle).style.getPropertyValue('--smart-shake-name')).toBe('none')
  })
})
