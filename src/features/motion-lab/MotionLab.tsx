'use client'

/**
 * FE-AA1 · /motion-lab workbench. Two SmartActionButtons driven by one set of
 * controls, plus a live inspector that reads the machine's state, the token in
 * charge, the click counts and the computed transition properties of every layer.
 *
 * Outcomes are simulated by the mode radios. Nothing here sends a request or
 * writes a ledger entry.
 */
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { activeToken, SmartActionButton, usePrefersReducedMotion, type SmartLabels, type SmartState } from '../../components/ui/SmartActionButton.tsx'
import { formatPHP, toCentavos } from '../../utils/money.ts'
import { MATH_RANDOM, simulate, type LabMode, type LabRandom, type ScrubValue } from './simulate.ts'

const AMOUNT = formatPHP(toCentavos(500_000))

const DISBURSE_LABELS: SmartLabels = {
  idle: `Disburse ${AMOUNT}`,
  loading: 'Locking Idempotency-Key...',
  success: `201 Disbursed · ${AMOUNT}`,
  error: '409 Conflict · Retry Payout',
}

const UNDERWRITER_LABELS: SmartLabels = {
  idle: 'Send Prompt',
  loading: 'Streaming Evaluation...',
  success: 'Trust Score Verified',
  error: 'Stream Dropped · Retry',
}

const MODES: readonly { value: LabMode; label: string; hint: string }[] = [
  { value: 'success', label: 'Force Success', hint: '100% success after 900 ms.' },
  { value: 'error', label: 'Force Error', hint: '100% error after 900 ms: shake, then the retry label.' },
  { value: 'realistic', label: 'Realistic async', hint: 'A random 600–1100 ms delay; 1 in 5 runs fails.' },
]

const SCRUB: readonly ScrubValue[] = ['live', 'idle', 'loading', 'success', 'error', 'disabled']

interface Telemetry {
  readonly state: SmartState
  readonly accepted: number
  readonly ignored: number
  readonly seq: number
  readonly log: readonly { readonly seq: number; readonly text: string }[]
}

const START: Telemetry = { state: 'idle', accepted: 0, ignored: 0, seq: 0, log: [] }

type ButtonKey = 'disburse' | 'underwriter'

interface Compositor {
  readonly measured: number
  readonly compositorOnly: number
  readonly offenders: readonly string[]
}

const COMPOSITOR_PROPS = new Set(['transform', 'opacity', 'stroke-dashoffset'])

/** Reads the computed transition list of every layer: anything but transform / opacity is an offender. */
function auditLayers(root: HTMLElement): Compositor {
  const layers = root.querySelectorAll<HTMLElement>('.smart-btn, .smart-surface, .smart-layer, .smart-check')
  let measured = 0
  let compositorOnly = 0
  const offenders = new Set<string>()
  layers.forEach((layer) => {
    const props = getComputedStyle(layer)
      .transitionProperty.split(',')
      .map((p) => p.trim())
      .filter((p) => p !== '' && p !== 'none')
    if (props.length === 0) return
    measured += 1
    const bad = props.filter((p) => !COMPOSITOR_PROPS.has(p))
    if (bad.length === 0) compositorOnly += 1
    for (const p of bad) offenders.add(p)
  })
  return { measured, compositorOnly, offenders: [...offenders] }
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export interface MotionLabProps {
  readonly random?: LabRandom
}

export function MotionLab({ random = MATH_RANDOM }: MotionLabProps) {
  const id = useId()
  const [mode, setMode] = useState<LabMode>('success')
  const [scrub, setScrub] = useState<ScrubValue>('live')
  const [simulateReduced, setSimulateReduced] = useState(false)
  const [disabledToggle, setDisabledToggle] = useState(false)
  const [telemetry, setTelemetry] = useState<Record<ButtonKey, Telemetry>>({ disburse: START, underwriter: START })
  const [compositor, setCompositor] = useState<Compositor | null>(null)
  const disburseRef = useRef<HTMLButtonElement>(null)
  const benchRef = useRef<HTMLDivElement>(null)
  const osReduced = usePrefersReducedMotion()
  const reduced = simulateReduced || osReduced

  const forcedState: SmartState | null = scrub === 'live' || scrub === 'disabled' ? null : scrub
  const disabled = disabledToggle || scrub === 'disabled'

  // Re-read the computed styles after each change, on the next frame (once the new styles apply).
  const disburseState = telemetry.disburse.state
  const underwriterState = telemetry.underwriter.state
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (benchRef.current !== null) setCompositor(auditLayers(benchRef.current))
    })
    return () => cancelAnimationFrame(frame)
  }, [reduced, disabled, forcedState, disburseState, underwriterState])

  const update = (key: ButtonKey, change: (t: Telemetry) => Telemetry): void =>
    setTelemetry((all) => ({ ...all, [key]: change(all[key]) }))

  const handlers = (key: ButtonKey) => ({
    onStateChange: (next: SmartState) =>
      update(key, (t) =>
        t.state === next
          ? t
          : { ...t, state: next, seq: t.seq + 1, log: [{ seq: t.seq + 1, text: `${t.state} → ${next}` }, ...t.log].slice(0, 6) },
      ),
    onAcceptedClick: () => update(key, (t) => ({ ...t, accepted: t.accepted + 1 })),
    onIgnoredClick: () => update(key, (t) => ({ ...t, ignored: t.ignored + 1 })),
  })

  const fireBurst = (): void => {
    const button = disburseRef.current
    if (button === null) return
    // Ten native clicks in one task: no React render can land between them.
    for (let i = 0; i < 10; i += 1) button.click()
  }

  const shown = (key: ButtonKey): SmartState => forcedState ?? telemetry[key].state

  const fieldClass = 'size-4 accent-emerald-700'

  return (
    <div className="space-y-6">
      <p className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-slate-800">
        <strong>Simulated.</strong> The mode you pick decides each outcome. No request leaves this page and no ledger entry is
        written. The real <code className="font-mono">Idempotency-Key</code> / <code className="font-mono">If-Match</code>{' '}
        flow is on the{' '}
        <Link className="font-semibold text-ink underline underline-offset-2" href="/">
          Disburse page
        </Link>
        .
      </p>

      <section aria-labelledby={`${id}-bench`} className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
        <h2 id={`${id}-bench`} className="text-lg font-semibold">
          Workbench
        </h2>
        <div ref={benchRef} className="mt-4 grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">Disburse {AMOUNT}</h3>
            <SmartActionButton
              labels={DISBURSE_LABELS}
              action={(signal) => simulate(mode, signal, random)}
              disabled={disabled}
              reducedMotion={simulateReduced}
              forcedState={forcedState}
              buttonRef={disburseRef}
              {...handlers('disburse')}
            />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">Send to AI Underwriter</h3>
            <SmartActionButton
              labels={UNDERWRITER_LABELS}
              action={(signal) => simulate(mode, signal, random)}
              disabled={disabled}
              reducedMotion={simulateReduced}
              forcedState={forcedState}
              {...handlers('underwriter')}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby={`${id}-controls`} className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
        <h2 id={`${id}-controls`} className="text-lg font-semibold">
          Controls
        </h2>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Outcome mode</legend>
            {MODES.map((m) => (
              <div key={m.value} className="flex items-start gap-2 text-sm">
                <input
                  id={`${id}-mode-${m.value}`}
                  type="radio"
                  name={`${id}-mode`}
                  value={m.value}
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                  aria-invalid="false"
                  aria-describedby={`${id}-mode-${m.value}-hint`}
                  className={`mt-0.5 ${fieldClass}`}
                />
                <span>
                  <label htmlFor={`${id}-mode-${m.value}`} className="font-medium">
                    {m.label}
                  </label>
                  <span id={`${id}-mode-${m.value}-hint`} className="block text-slate-600">
                    {m.hint}
                  </span>
                </span>
              </div>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">State scrubber</legend>
            <p id={`${id}-scrub-hint`} className="text-sm text-slate-600">
              Pin both buttons to one state. Pinning cancels any run in flight; Live hands control back.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {SCRUB.map((value) => (
                <div key={value} className="flex items-center gap-2">
                  <input
                    id={`${id}-scrub-${value}`}
                    type="radio"
                    name={`${id}-scrub`}
                    value={value}
                    checked={scrub === value}
                    onChange={() => setScrub(value)}
                    aria-invalid="false"
                    aria-describedby={`${id}-scrub-hint`}
                    className={fieldClass}
                  />
                  <label htmlFor={`${id}-scrub-${value}`} className="font-mono">
                    {value}
                  </label>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <input
                id={`${id}-reduced`}
                type="checkbox"
                checked={simulateReduced}
                onChange={(e) => setSimulateReduced(e.target.checked)}
                aria-invalid="false"
                aria-describedby={`${id}-reduced-hint`}
                className={`mt-0.5 ${fieldClass}`}
              />
              <span>
                <label htmlFor={`${id}-reduced`} className="font-medium">
                  Simulate <code className="font-mono">prefers-reduced-motion: reduce</code>
                </label>
                <span id={`${id}-reduced-hint`} className="block text-slate-600">
                  No lift, press, slide, spring or shake. Colour, icon and text still change, with a 120 ms fade.
                  {osReduced ? ' Your system already asks for reduced motion, so it is on either way.' : ''}
                </span>
              </span>
            </div>
            <div className="flex items-start gap-2">
              <input
                id={`${id}-disabled`}
                type="checkbox"
                checked={disabledToggle}
                onChange={(e) => setDisabledToggle(e.target.checked)}
                aria-invalid="false"
                aria-describedby={`${id}-disabled-hint`}
                className={`mt-0.5 ${fieldClass}`}
              />
              <span>
                <label htmlFor={`${id}-disabled`} className="font-medium">
                  Disabled
                </label>
                <span id={`${id}-disabled-hint`} className="block text-slate-600">
                  Sets <code className="font-mono">disabled</code> and <code className="font-mono">aria-disabled</code>: no
                  hover, press or click.
                </span>
              </span>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <button
              type="button"
              onClick={fireBurst}
              aria-describedby={`${id}-burst-hint`}
              className={`smart-press rounded-md border border-amber-500 bg-amber-50 px-4 py-2 font-semibold text-slate-900 hover:bg-amber-100 ${FOCUS}`}
            >
              Fire 10 Rapid Clicks
            </button>
            <p id={`${id}-burst-hint`} className="text-slate-600">
              Ten clicks on the Disburse button in one task. One run starts; the other nine are ignored and counted below.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby={`${id}-inspector`} className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
        <h2 id={`${id}-inspector`} className="text-lg font-semibold">
          State machine &amp; telemetry
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Live state and click counts for each button</caption>
            <thead className="text-slate-600">
              <tr>
                <th scope="col" className="py-1 pr-2 sm:pr-3 font-semibold">
                  Button
                </th>
                <th scope="col" className="py-1 pr-2 sm:pr-3 font-semibold">
                  State
                </th>
                <th scope="col" className="py-1 pr-2 sm:pr-3 font-semibold">
                  Accepted
                </th>
                <th scope="col" className="py-1 font-semibold">
                  Ignored
                </th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {(['disburse', 'underwriter'] as const).map((key) => (
                <tr key={key} className="border-t border-slate-200">
                  <th scope="row" className="py-2 pr-2 sm:pr-3 font-sans text-sm font-semibold">
                    {key === 'disburse' ? 'Disburse' : 'AI Underwriter'}
                  </th>
                  <td className="py-2 pr-2 sm:pr-3">{disabled ? `${shown(key)} (disabled)` : shown(key)}</td>
                  <td className="py-2 pr-2 sm:pr-3">{telemetry[key].accepted}</td>
                  <td className="py-2">{telemetry[key].ignored}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="font-semibold">Disburse token</dt>
          <dd className="font-mono text-xs">{activeToken(shown('disburse'), reduced)}</dd>
          <dt className="font-semibold">AI Underwriter token</dt>
          <dd className="font-mono text-xs">{activeToken(shown('underwriter'), reduced)}</dd>
          <dt className="font-semibold">Compositor layers</dt>
          <dd aria-live="polite" className="font-mono text-xs">
            {compositor === null || compositor.measured === 0
              ? 'not measured yet'
              : `${compositor.compositorOnly}/${compositor.measured} layers transition transform / opacity only${
                  compositor.offenders.length > 0 ? ` · offenders: ${compositor.offenders.join(', ')}` : ''
                }`}
          </dd>
          <dt className="font-semibold">Reduced motion</dt>
          <dd className="font-mono text-xs">
            {reduced ? `on (${simulateReduced ? 'simulated' : 'system setting'})` : 'off'}
          </dd>
          <dt className="font-semibold">Disburse transitions</dt>
          <dd className="font-mono text-xs">
            {telemetry.disburse.log.length === 0 ? (
              'none yet'
            ) : (
              <ol aria-label="Disburse transitions, newest first" className="space-y-0.5">
                {telemetry.disburse.log.map((entry) => (
                  <li key={entry.seq}>{entry.text}</li>
                ))}
              </ol>
            )}
          </dd>
        </dl>
      </section>
    </div>
  )
}
