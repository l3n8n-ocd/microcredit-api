'use client'

/**
 * FE-AA1 · SmartActionButton: one button, four live states, one motion language.
 *
 *            click                 action resolves              1400 ms hold
 *   idle ───────────▶ loading ─────────────────────▶ success ──────────────────▶ idle
 *     ▲                  │
 *     │                  │ action rejects
 *     │   click (retry)  ▼
 *     └──────────── error ◀─────
 *
 * Plus two inputs that override the machine: `disabled` (nothing reacts), and
 * `forcedState` (the lab's scrubber: show one state, cancel anything in flight).
 * Hover/focus and press are CSS states of whichever state is showing.
 *
 * Motion rules (src/app/globals.css, CLAUDE.md §12 rule 4 exception):
 *   - Every layer (four labels, three surfaces) shares one grid cell, so the
 *     button is as wide as its widest label in every state: nothing reflows.
 *   - Only `transform` and `opacity` animate. The surface colour changes by
 *     crossfading stacked surfaces, not by animating `background-color`.
 *   - Reduced motion (OS setting or `reducedMotion`) zeroes every shift, scale
 *     and shake and keeps a 120 ms fade: colour, icon and text still change.
 *
 * Interruptible: a click while loading or confirming is ignored (and reported),
 * decided from a ref so ten clicks in one frame start one run. Every run gets a
 * new `runId` and an AbortController. A result from a stale run is dropped, and
 * every timer is cleared on a new run, a forced state, or unmount.
 */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type Ref } from 'react'

export type SmartState = 'idle' | 'loading' | 'success' | 'error'
export const SMART_STATES: readonly SmartState[] = ['idle', 'loading', 'success', 'error']

export interface SmartLabels {
  readonly idle: string
  readonly loading: string
  readonly success: string
  /** Shown on error. It names the recovery: pressing again retries. */
  readonly error: string
}

export interface SmartActionButtonProps {
  readonly labels: SmartLabels
  /** The work. Resolve for success, reject for error. Abort when the signal fires. */
  readonly action: (signal: AbortSignal) => Promise<void>
  readonly disabled?: boolean
  /** Simulate `prefers-reduced-motion: reduce` regardless of the OS setting. */
  readonly reducedMotion?: boolean
  /** Lab scrubber: pin a state. `null` hands control back to the machine. */
  readonly forcedState?: SmartState | null
  readonly onStateChange?: (state: SmartState) => void
  /** A click that arrived while a run was already in flight or confirming. */
  readonly onIgnoredClick?: () => void
  readonly onAcceptedClick?: () => void
  readonly icon?: ReactNode
  /** How long `success` holds before returning to `idle`. */
  readonly successHoldMs?: number
  readonly buttonRef?: Ref<HTMLButtonElement>
}

/** Motion values the component writes inline: the single place reduced motion is decided. */
export interface SmartMotion {
  readonly '--smart-lift': string
  readonly '--smart-press': string
  readonly '--smart-shift': string
  readonly '--smart-swap': string
  readonly '--smart-confirm': string
  readonly '--smart-shake-name': string
}

export function smartMotion(reduced: boolean): SmartMotion {
  return reduced
    ? {
        '--smart-lift': '0px',
        '--smart-press': '1',
        '--smart-shift': '0px',
        '--smart-swap': 'var(--motion-reduced)',
        '--smart-confirm': 'var(--motion-reduced)',
        '--smart-shake-name': 'none',
      }
    : {
        '--smart-lift': '1px',
        '--smart-press': '0.97',
        '--smart-shift': '10px',
        '--smart-swap': 'var(--motion-swap)',
        '--smart-confirm': 'var(--motion-confirm)',
        '--smart-shake-name': 'smart-shake',
      }
}

/** The token in charge while a state shows, for the lab's inspector and the docs. */
export function activeToken(state: SmartState, reduced: boolean): string {
  if (reduced) return '120ms opacity crossfade (reduced motion)'
  switch (state) {
    case 'idle':
      return 'press 100ms cubic-bezier(0.22, 1, 0.36, 1)'
    case 'loading':
      return 'swap 220ms cubic-bezier(0.16, 1, 0.3, 1)'
    case 'success':
      return 'confirm 240ms cubic-bezier(0.34, 1.56, 0.64, 1), hold 1400ms'
    case 'error':
      return 'shake 320ms cubic-bezier(0.36, 0.07, 0.19, 0.97)'
  }
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReduced(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(REDUCED_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function osPrefersReduced(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_QUERY).matches
}

/** True under the OS setting. False on the server (the CSS media query covers first paint). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, osPrefersReduced, () => false)
}

function Spinner() {
  // The copilot's thinking dots: the one sanctioned looping animation (CLAUDE.md §12 rule 4), static under reduced motion.
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      <span className="copilot-dot" />
      <span className="copilot-dot" />
      <span className="copilot-dot" />
    </span>
  )
}

function Check() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="none">
      <path className="smart-check" d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Cross() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'

export function SmartActionButton({
  labels,
  action,
  disabled = false,
  reducedMotion = false,
  forcedState = null,
  onStateChange,
  onIgnoredClick,
  onAcceptedClick,
  icon,
  successHoldMs = 1400,
  buttonRef,
}: SmartActionButtonProps) {
  const statusId = useId()
  const [machineState, setMachineState] = useState<SmartState>('idle')
  /** The state as of the last transition, readable synchronously by the click guard. */
  const stateRef = useRef<SmartState>('idle')
  const runIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const osReduced = usePrefersReducedMotion()
  const reduced = reducedMotion || osReduced

  const state: SmartState = forcedState ?? machineState

  const clearHold = (): void => {
    if (holdRef.current !== null) clearTimeout(holdRef.current)
    holdRef.current = null
  }

  // The shown state and the one before it, so the outgoing label slides up while the new one rises.
  // Derived during render (React's "store the previous value" pattern), so forced states get it too.
  const [shown, setShown] = useState<SmartState>(state)
  const [previous, setPrevious] = useState<SmartState | null>(null)
  if (shown !== state) {
    setPrevious(shown)
    setShown(state)
  }

  // Held in a ref so a parent's inline callback never changes `go` and never re-runs the effect below.
  const onStateChangeRef = useRef(onStateChange)
  useEffect(() => {
    onStateChangeRef.current = onStateChange
  })

  const go = useCallback((next: SmartState): void => {
    if (stateRef.current === next) return
    stateRef.current = next
    setMachineState(next)
    onStateChangeRef.current?.(next)
  }, [])

  // Releasing a pin always lands on idle, whatever the pin showed (derived during render, like `previous`).
  const [pin, setPin] = useState<SmartState | null>(forcedState)
  if (pin !== forcedState) {
    setPin(forcedState)
    if (forcedState === null) setMachineState('idle')
  }

  // Pinning a state, or releasing the pin, cancels whatever was in flight: no stale result or timer can land.
  const pinnedRef = useRef(false)
  useEffect(() => {
    runIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    clearHold()
    stateRef.current = forcedState ?? 'idle'
    // A released pin lands on idle; tell the parent, since `go` did not run.
    if (forcedState === null && pinnedRef.current) onStateChangeRef.current?.('idle')
    pinnedRef.current = forcedState !== null
  }, [forcedState])

  // Unmount: abort the run and clear the hold timer.
  useEffect(
    () => () => {
      runIdRef.current += 1
      abortRef.current?.abort()
      clearHold()
    },
    [],
  )

  const run = (): void => {
    if (disabled || forcedState !== null) return
    // Decided from the ref: a second click in the same frame sees `loading` and is ignored.
    if (stateRef.current === 'loading' || stateRef.current === 'success') {
      onIgnoredClick?.()
      return
    }
    onAcceptedClick?.()
    clearHold()
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    runIdRef.current += 1
    const runId = runIdRef.current
    go('loading')
    action(controller.signal).then(
      () => {
        if (runId !== runIdRef.current || controller.signal.aborted) return
        go('success')
        holdRef.current = setTimeout(() => {
          holdRef.current = null
          if (runId === runIdRef.current) go('idle')
        }, successHoldMs)
      },
      () => {
        if (runId !== runIdRef.current || controller.signal.aborted) return
        go('error')
      },
    )
  }

  const layerState = (layer: SmartState): 'active' | 'leaving' | 'waiting' =>
    layer === state ? 'active' : layer === previous ? 'leaving' : 'waiting'

  const label = labels[state]
  const style = smartMotion(reduced) as CSSProperties

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={run}
        disabled={disabled}
        aria-disabled={disabled ? 'true' : 'false'}
        aria-busy={state === 'loading' ? 'true' : 'false'}
        aria-describedby={statusId}
        data-state={state}
        style={style}
        className={`smart-btn relative min-h-11 overflow-hidden rounded-md text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
      >
        {/* Surfaces: crossfaded by opacity. Error is rose (§12: rose marks a bounce). Success is emerald under ink text (4.74:1). */}
        <span aria-hidden="true" className="smart-surface bg-main" data-on={state === 'idle' || state === 'loading' ? 'true' : 'false'} />
        <span aria-hidden="true" className="smart-surface bg-accent" data-on={state === 'success' ? 'true' : 'false'} />
        <span aria-hidden="true" className="smart-surface bg-rose-700" data-on={state === 'error' ? 'true' : 'false'} />

        {SMART_STATES.map((layer) => (
          <span
            key={layer}
            aria-hidden={layer === state ? undefined : 'true'}
            data-layer={layer}
            data-layer-state={layerState(layer)}
            className={`smart-layer flex items-center justify-center gap-2 px-4 whitespace-nowrap ${layer === 'success' ? 'text-ink' : 'text-white'}`}
          >
            {layer === 'idle' && icon}
            {layer === 'loading' && <Spinner />}
            {layer === 'success' && <Check />}
            {layer === 'error' && <Cross />}
            {labels[layer]}
          </span>
        ))}
      </button>
      {/* Announces each state once; the button's own name changes are not announced reliably. */}
      <span id={statusId} role="status" aria-live="polite" className="sr-only">
        {state === 'idle' ? '' : label}
      </span>
    </>
  )
}
