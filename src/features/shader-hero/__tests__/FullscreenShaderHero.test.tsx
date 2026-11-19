/**
 * FE-AA3 · the fullscreen shader hero. jsdom has no WebGL, so a fake renderer stands in for the Ledger
 * Aurora shader and records every `render(time, mouse)` call. `requestAnimationFrame` is a manual queue,
 * so each test decides exactly when a frame runs. Queries are by role, label and text only (FE-09).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FullscreenShaderHero } from '../FullscreenShaderHero.tsx'
import {
  FALLBACK_ONE_LINER,
  FRAGMENT_SHADER_SOURCE,
  MAX_CHANNEL,
  MAX_DPR,
  clampDpr,
  createLedgerAuroraRenderer,
  type ShaderRenderer,
  type ShaderSetup,
} from '../LedgerAuroraShader.ts'

// ── A manual animation-frame queue ─────────────────────────────────────────────────────────────────
const queue = new Map<number, FrameRequestCallback>()
let nextId = 1
let clock = 0

/** Runs every queued frame once, `stepMs` after the last one. */
function frame(stepMs = 16): void {
  clock += stepMs
  const due = [...queue.values()]
  queue.clear()
  act(() => {
    for (const callback of due) callback(clock)
  })
}

function frames(count: number, stepMs = 16): void {
  for (let i = 0; i < count; i += 1) frame(stepMs)
}

// ── A fake renderer ────────────────────────────────────────────────────────────────────────────────
interface FakeRenderer {
  readonly renderer: ShaderRenderer
  readonly render: ReturnType<typeof vi.fn<(time: number, mouse: readonly [number, number]) => void>>
  readonly dispose: ReturnType<typeof vi.fn<() => void>>
  readonly create: ReturnType<typeof vi.fn<(canvas: HTMLCanvasElement) => ShaderSetup>>
}

function fakeRenderer(): FakeRenderer {
  const renderFn = vi.fn<(time: number, mouse: readonly [number, number]) => void>()
  const dispose = vi.fn<() => void>()
  const renderer: ShaderRenderer = {
    resize: (cssWidth, cssHeight, dpr) => {
      const scale = clampDpr(dpr)
      return [Math.round(cssWidth * scale), Math.round(cssHeight * scale)]
    },
    render: renderFn,
    dispose,
  }
  const create = vi.fn<(canvas: HTMLCanvasElement) => ShaderSetup>(() => ({ ok: true, renderer }))
  return { renderer, render: renderFn, dispose, create }
}

/** The value shown next to a term in the "Live shader uniforms" readout. */
function readout(term: string): string {
  const dt = screen.getByText(term, { selector: 'dt' })
  return dt.nextElementSibling?.textContent ?? ''
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  queue.clear()
  nextId = 1
  clock = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId
    nextId += 1
    queue.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue.delete(id)
  })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FullscreenShaderHero', () => {
  it('renders the headline, proof line, CTAs and the uniform readout over the hero', () => {
    const fake = fakeRenderer()
    render(<FullscreenShaderHero reducedMotion={false} createRenderer={fake.create} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Loan disbursement flows that cannot pay a borrower twice.' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Loan disbursement flows that cannot pay a borrower twice.' })).toBeTruthy()
    expect(screen.getByText('Idempotency-Key')).toBeTruthy()
    expect(screen.getByText('If-Match')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Double-click Disburse in the live demo' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'Read the shader walkthrough' }).getAttribute('href')).toMatch(/docs\/FE-AA3_SIGNATURE_SHADER\.md$/)
    for (const term of ['u_time', 'u_resolution', 'u_mouse', 'DPR (cap 1.5)', 'state']) expect(screen.getByText(term, { selector: 'dt' })).toBeTruthy()

    expect(fake.create).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toBe('Shader running.')
    frames(20, 50)
    expect(fake.render).toHaveBeenCalledTimes(20)
    expect(readout('state')).toBe('running')
    expect(readout('u_time')).toMatch(/^\d+\.\d s$/)
    expect(readout('u_time')).not.toBe('0.0 s')
  })

  it('switches to the static gradient when the fallback toggle is pressed, and shows the one-liner', () => {
    const fake = fakeRenderer()
    render(<FullscreenShaderHero reducedMotion={false} createRenderer={fake.create} />)
    frames(5)
    const callsBefore = fake.render.mock.calls.length

    const toggle = screen.getByRole('button', { name: 'Static reduced-motion fallback: off' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)

    const on = screen.getByRole('button', { name: 'Static reduced-motion fallback: on' })
    expect(on.getAttribute('aria-pressed')).toBe('true')
    expect(on.getAttribute('aria-describedby')).toBe(screen.getByText(FALLBACK_ONE_LINER).id)
    expect(screen.getByRole('status').textContent).toBe('Shader static-reduced-motion.')
    expect(readout('state')).toBe('static-reduced-motion')
    expect(readout('u_time')).toBe('not running')
    // The WebGL context is released and the loop is gone: no queued frame, no further render call.
    expect(fake.dispose).toHaveBeenCalledTimes(1)
    expect(queue.size).toBe(0)
    frames(5)
    expect(fake.render).toHaveBeenCalledTimes(callsBefore)

    // And back: a fresh renderer, running again.
    fireEvent.click(on)
    expect(fake.create).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status').textContent).toBe('Shader running.')
  })

  it('never creates a WebGL context when the system asks for reduced motion', () => {
    const fake = fakeRenderer()
    render(<FullscreenShaderHero reducedMotion createRenderer={fake.create} />)

    expect(fake.create).not.toHaveBeenCalled()
    expect(queue.size).toBe(0)
    const toggle = screen.getByRole('button', { name: 'Static reduced-motion fallback: on' })
    expect(toggle.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Your system asks for reduced motion, so the fallback stays on.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Shader static-reduced-motion.')
    expect(screen.getByText(FALLBACK_ONE_LINER)).toBeTruthy()
  })

  it('pauses on visibilitychange (hidden): no frames, u_time frozen; resumes where it left off', () => {
    const fake = fakeRenderer()
    render(<FullscreenShaderHero reducedMotion={false} createRenderer={fake.create} />)
    frames(10, 100)
    expect(fake.render).toHaveBeenCalledTimes(10)

    setVisibility('hidden')
    expect(screen.getByRole('status').textContent).toBe('Shader paused (tab hidden or hero off-screen).')
    expect(readout('state')).toBe('paused')
    expect(queue.size).toBe(0)
    const pausedAt = fake.render.mock.lastCall?.[0] ?? Number.NaN
    frames(10, 100)
    expect(fake.render).toHaveBeenCalledTimes(10)

    // A minute later the tab comes back: time continues from the paused value, not from the wall clock.
    clock += 60_000
    setVisibility('visible')
    expect(screen.getByRole('status').textContent).toBe('Shader running.')
    frame(16)
    expect(fake.render).toHaveBeenCalledTimes(11)
    expect(fake.render.mock.lastCall?.[0]).toBe(pausedAt)
    frame(100)
    expect(fake.render.mock.lastCall?.[0]).toBeCloseTo(pausedAt + 0.1, 6)
  })

  it('falls back to the static gradient when WebGL does not start', () => {
    const create = vi.fn<(canvas: HTMLCanvasElement) => ShaderSetup>(() => ({ ok: false, reason: 'WebGL is not available' }))
    render(<FullscreenShaderHero reducedMotion={false} createRenderer={create} />)
    frame()

    expect(create).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toBe('Shader static-no-webgl.')
    expect(screen.getByText('WebGL did not start (WebGL is not available).')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Static reduced-motion fallback: on' }).hasAttribute('disabled')).toBe(true)
  })

  it('removes its listeners and disposes the renderer on unmount', () => {
    const fake = fakeRenderer()
    const { unmount } = render(<FullscreenShaderHero reducedMotion={false} createRenderer={fake.create} />)
    frames(3)
    unmount()
    expect(fake.dispose).toHaveBeenCalledTimes(1)
    expect(queue.size).toBe(0)
    setVisibility('hidden')
    setVisibility('visible')
    expect(queue.size).toBe(0)
  })
})

describe('LedgerAuroraShader', () => {
  it('caps the device pixel ratio at 1.5 and treats bad readings as 1', () => {
    expect(MAX_DPR).toBe(1.5)
    expect(clampDpr(1)).toBe(1)
    expect(clampDpr(1.25)).toBe(1.25)
    expect(clampDpr(2)).toBe(1.5)
    expect(clampDpr(3)).toBe(1.5)
    expect(clampDpr(undefined)).toBe(1)
    expect(clampDpr(0)).toBe(1)
    expect(clampDpr(Number.NaN)).toBe(1)
    expect(clampDpr(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('declares the three uniforms, the five commented blocks and the contrast cap', () => {
    expect(FRAGMENT_SHADER_SOURCE).toMatch(/uniform float\s+u_time;/)
    expect(FRAGMENT_SHADER_SOURCE).toMatch(/uniform vec2\s+u_resolution;/)
    expect(FRAGMENT_SHADER_SOURCE).toMatch(/uniform vec2\s+u_mouse;/)
    for (const block of [1, 2, 3, 4, 5]) expect(FRAGMENT_SHADER_SOURCE).toContain(`Block ${block}:`)
    expect(FRAGMENT_SHADER_SOURCE).toContain(`min(color, vec3(${MAX_CHANNEL}))`)
    expect(FRAGMENT_SHADER_SOURCE).toContain('gl_FragColor')
  })

  it('reports a failure instead of throwing when the canvas has no WebGL context', () => {
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'getContext', { value: () => null })
    const setup = createLedgerAuroraRenderer(canvas)
    expect(setup.ok).toBe(false)
  })
})
