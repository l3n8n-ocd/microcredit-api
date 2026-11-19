'use client'

/**
 * FE-AA3 · the fullscreen shader hero. The Ledger Aurora shader (LedgerAuroraShader.ts) fills the
 * section; the headline, proof line, CTAs and a live uniform readout sit on a dark scrim over it.
 *
 * Responsible by default:
 * - DPR capped at 1.5 (`clampDpr`), so a 3x phone shades a quarter of its native pixels.
 * - The loop runs only while the tab is visible (`visibilitychange`) and the hero is on screen
 *   (`IntersectionObserver`). `u_time` stops while paused, so the picture resumes where it left off.
 * - `prefers-reduced-motion: reduce`, the on-page toggle, or a WebGL failure: a still CSS gradient
 *   in the same palette. No WebGL context is created and no animation loop runs.
 */
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../../components/ui/SmartActionButton.tsx'
import {
  FALLBACK_ONE_LINER,
  STATIC_FALLBACK_BACKGROUND,
  clampDpr,
  createLedgerAuroraRenderer,
  type ShaderSetup,
} from './LedgerAuroraShader.ts'

export type HeroState = 'starting' | 'running' | 'paused' | 'static-reduced-motion' | 'static-no-webgl'

export interface FullscreenShaderHeroProps {
  /** Overrides the OS `prefers-reduced-motion` reading (tests). */
  readonly reducedMotion?: boolean
  /** Replaces WebGL setup (tests). The default compiles the Ledger Aurora shader on the canvas. */
  readonly createRenderer?: (canvas: HTMLCanvasElement) => ShaderSetup
}

interface Readout {
  readonly time: number
  readonly resolution: readonly [number, number]
  readonly mouse: readonly [number, number]
  readonly dpr: number
}

const REPO = 'https://github.com/l3n8n-ocd/microcredit-api/blob/main'
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300'
/** A frame gap longer than this (a hidden tab, a debugger pause) counts as this much time, not more. */
const MAX_FRAME_SECONDS = 0.1
/** How quickly the shader's mouse catches up with the pointer: about 63% of the way every 1/6 s. */
const MOUSE_EASE_PER_SECOND = 6
const READOUT_EVERY_MS = 250

const fmt = (n: number, digits: number): string => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

function stateLabel(state: HeroState): string {
  switch (state) {
    case 'starting':
      return 'starting'
    case 'running':
      return 'running'
    case 'paused':
      return 'paused (tab hidden or hero off-screen)'
    case 'static-reduced-motion':
      return 'static-reduced-motion'
    case 'static-no-webgl':
      return 'static-no-webgl'
  }
}

export function FullscreenShaderHero({ reducedMotion: reducedOverride, createRenderer = createLedgerAuroraRenderer }: FullscreenShaderHeroProps) {
  const id = useId()
  const heroRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const osReduced = usePrefersReducedMotion()
  const reduced = reducedOverride ?? osReduced
  const [staticToggle, setStaticToggle] = useState(false)
  const [webglError, setWebglError] = useState<string | null>(null)
  const [running, setRunning] = useState<boolean | null>(null)
  const [readout, setReadout] = useState<Readout>({ time: 0, resolution: [0, 0], mouse: [0.5, 0.5], dpr: 1 })

  const staticMode = reduced || staticToggle || webglError !== null
  const state: HeroState =
    webglError !== null ? 'static-no-webgl' : reduced || staticToggle ? 'static-reduced-motion' : running === null ? 'starting' : running ? 'running' : 'paused'

  useEffect(() => {
    if (staticMode) return
    const canvas = canvasRef.current
    const hero = heroRef.current
    if (canvas === null || hero === null) return

    const setup = createRenderer(canvas)
    if (!setup.ok) {
      // Report on the next frame: React state is not set synchronously inside an effect.
      const frame = requestAnimationFrame(() => setWebglError(setup.reason))
      return () => cancelAnimationFrame(frame)
    }
    const { renderer } = setup

    const sim = {
      elapsed: 0,
      last: 0,
      raf: 0,
      lastReadout: -Infinity,
      visible: document.visibilityState !== 'hidden',
      onScreen: true,
      target: [0.5, 0.5] as [number, number],
      mouse: [0.5, 0.5] as [number, number],
      resolution: [0, 0] as readonly [number, number],
    }

    const resize = (): void => {
      sim.resolution = renderer.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio)
    }

    const frame = (now: number): void => {
      const dt = sim.last === 0 ? 0 : Math.min((now - sim.last) / 1000, MAX_FRAME_SECONDS)
      sim.last = now
      sim.elapsed += dt
      const ease = 1 - Math.exp(-dt * MOUSE_EASE_PER_SECOND)
      sim.mouse[0] += (sim.target[0] - sim.mouse[0]) * ease
      sim.mouse[1] += (sim.target[1] - sim.mouse[1]) * ease
      renderer.render(sim.elapsed, sim.mouse)
      if (now - sim.lastReadout >= READOUT_EVERY_MS) {
        sim.lastReadout = now
        setReadout({ time: sim.elapsed, resolution: sim.resolution, mouse: [sim.mouse[0], sim.mouse[1]], dpr: clampDpr(window.devicePixelRatio) })
      }
      sim.raf = requestAnimationFrame(frame)
    }

    // Run only while the tab is visible and the hero is on screen.
    const sync = (): void => {
      const shouldRun = sim.visible && sim.onScreen
      if (shouldRun && sim.raf === 0) {
        sim.last = 0
        sim.raf = requestAnimationFrame(frame)
      } else if (!shouldRun && sim.raf !== 0) {
        cancelAnimationFrame(sim.raf)
        sim.raf = 0
      }
      setRunning(shouldRun)
    }

    const onVisibility = (): void => {
      sim.visible = document.visibilityState !== 'hidden'
      sync()
    }
    const onPointerMove = (event: PointerEvent): void => {
      const rect = hero.getBoundingClientRect()
      // GL's origin is bottom-left, so flip y.
      sim.target = [(event.clientX - rect.left) / rect.width, 1 - (event.clientY - rect.top) / rect.height]
    }
    const onPointerLeave = (): void => {
      sim.target = [0.5, 0.5]
    }

    resize()
    document.addEventListener('visibilitychange', onVisibility)
    hero.addEventListener('pointermove', onPointerMove)
    hero.addEventListener('pointerleave', onPointerLeave)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    resizeObserver?.observe(canvas)
    const intersection =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            sim.onScreen = entries.some((entry) => entry.isIntersecting)
            sync()
          })
    intersection?.observe(hero)
    sync()

    return () => {
      if (sim.raf !== 0) cancelAnimationFrame(sim.raf)
      document.removeEventListener('visibilitychange', onVisibility)
      hero.removeEventListener('pointermove', onPointerMove)
      hero.removeEventListener('pointerleave', onPointerLeave)
      resizeObserver?.disconnect()
      intersection?.disconnect()
      renderer.dispose()
    }
  }, [staticMode, createRenderer])

  return (
    <section
      ref={heroRef}
      aria-labelledby={`${id}-title`}
      className="relative isolate flex min-h-[85vh] items-center overflow-hidden bg-slate-950 px-4 py-14 sm:px-8"
    >
      {staticMode ? (
        <div aria-hidden="true" className="absolute inset-0 -z-10" style={{ background: STATIC_FALLBACK_BACKGROUND }} />
      ) : (
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 -z-10 size-full" />
      )}

      {/* The scrim: 65% slate-950 under every word, so text never sits on the raw shader. */}
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-950/65 p-6 text-white shadow-2xl backdrop-blur-[2px] sm:p-10">
        <p className="font-mono text-xs font-medium tracking-widest text-emerald-300 uppercase">FE-AA3 · Ledger Aurora shader</p>
        <h1 id={`${id}-title`} className="mt-3 text-3xl leading-tight font-bold tracking-tight sm:text-5xl">
          Loan disbursement flows that cannot pay a borrower twice.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-slate-200 sm:text-lg">
          Every payout carries an <code className="font-mono text-white">Idempotency-Key</code> and every admin action an{' '}
          <code className="font-mono text-white">If-Match</code> version, so a retry or a second admin gets rejected instead of paying twice.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/"
            className={`inline-flex min-h-11 items-center rounded-md bg-emerald-400 px-5 font-semibold text-slate-950 transition-colors hover:bg-emerald-300 ${FOCUS}`}
          >
            Double-click Disburse in the live demo
          </Link>
          <a
            href={`${REPO}/docs/FE-AA3_SIGNATURE_SHADER.md`}
            className={`inline-flex min-h-11 items-center rounded-md border border-slate-400 px-5 font-semibold text-white transition-colors hover:bg-white/10 ${FOCUS}`}
          >
            Read the shader walkthrough
          </a>
        </div>

        <dl aria-label="Live shader uniforms" className="mt-7 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-white/10 bg-slate-950/70 px-4 py-3 font-mono text-xs text-slate-300 sm:grid-cols-5">
          <div>
            <dt className="text-slate-400">u_time</dt>
            <dd className="text-white">{staticMode ? 'not running' : `${fmt(readout.time, 1)} s`}</dd>
          </div>
          <div>
            <dt className="text-slate-400">u_resolution</dt>
            <dd className="text-white">{staticMode ? '—' : `${readout.resolution[0]}×${readout.resolution[1]}`}</dd>
          </div>
          <div>
            <dt className="text-slate-400">u_mouse</dt>
            <dd className="text-white">{staticMode ? '—' : `${fmt(readout.mouse[0], 2)}, ${fmt(readout.mouse[1], 2)}`}</dd>
          </div>
          <div>
            <dt className="text-slate-400">DPR (cap 1.5)</dt>
            <dd className="text-white">{staticMode ? '—' : `${fmt(readout.dpr, 2)}x`}</dd>
          </div>
          <div>
            <dt className="text-slate-400">state</dt>
            <dd className="text-white">{state}</dd>
          </div>
        </dl>
        <p role="status" aria-live="polite" className="sr-only">
          Shader {stateLabel(state)}.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={staticMode ? 'true' : 'false'}
            disabled={reduced || webglError !== null}
            onClick={() => setStaticToggle((on) => !on)}
            aria-describedby={`${id}-fallback`}
            className={`inline-flex min-h-11 items-center rounded-md border border-amber-300 px-4 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`}
          >
            Static reduced-motion fallback: {staticMode ? 'on' : 'off'}
          </button>
          {reduced && <span className="text-xs text-slate-300">Your system asks for reduced motion, so the fallback stays on.</span>}
          {webglError !== null && <span className="text-xs text-slate-300">WebGL did not start ({webglError}).</span>}
        </div>
        <p id={`${id}-fallback`} className="mt-3 max-w-2xl text-sm text-slate-200">
          {FALLBACK_ONE_LINER}
        </p>
      </div>
    </section>
  )
}
