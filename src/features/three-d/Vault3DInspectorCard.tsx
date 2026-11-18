'use client'

/**
 * FE-AA2 · the capstone's quick-launch card on `/`. It starts as the static SVG blueprint with working
 * 201 / 409 buttons. Three.js downloads only after "Load the 3D inspector" is pressed, so `/` itself
 * ships 0 KB of it (checked in e2e/three-d-lab.spec.ts).
 */
import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'
import { usePrefersReducedMotion } from '../../components/ui/SmartActionButton.tsx'
import { LazyVault3DCanvas } from './LazyVault3DCanvas.tsx'
import { StaticBlueprint } from './StaticBlueprint.tsx'
import { DEFAULT_CONFIG, describeState, type TerminalState, type VaultConfig } from './vaultConfig.ts'

const noSubscribe = (): (() => void) => () => {}
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null
  } catch {
    return false
  }
}
let cached: boolean | null = null
const webglSnapshot = (): boolean => {
  cached ??= hasWebGL()
  return cached
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const BUTTON = `inline-flex min-h-11 items-center justify-center rounded-md border px-3 text-sm font-semibold transition-colors ${FOCUS}`

export function Vault3DInspectorCard() {
  const [config, setConfig] = useState<VaultConfig>(DEFAULT_CONFIG)
  const [loaded, setLoaded] = useState(false)
  const reduced = usePrefersReducedMotion()
  // Only consulted when the button is pressed, so the server and first client render agree.
  const webgl = useSyncExternalStore(noSubscribe, webglSnapshot, () => true)
  const canLoad = !reduced && webgl

  const simulate = (terminalState: TerminalState): void =>
    setConfig((current) => ({ ...current, terminalState, stateNonce: current.stateNonce + 1 }))

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
      <div className="min-w-0 rounded-md border border-slate-200 bg-canvas">
        {loaded ? (
          <div className="aspect-[4/3] w-full">
            <LazyVault3DCanvas
              config={config}
              model={null}
              sampleRequest={0}
              label={`3D MicroCredit POS terminal. ${describeState(config.terminalState)}. Drag to orbit.`}
            />
          </div>
        ) : (
          <div className="p-2">
            <StaticBlueprint chassisColor={config.chassisColor} module={config.module} terminalState={config.terminalState} compact />
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <p className="text-sm text-slate-700">
          The terminal acts out the two outcomes the sandbox above returns: a <code className="font-mono">201</code> payout spins
          the emerald ring, a <code className="font-mono">409</code> stale <code className="font-mono">If-Match</code> locks the
          shutter.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => simulate('disbursed')} className={`${BUTTON} border-emerald-700 bg-emerald-50 text-ink hover:bg-emerald-100`}>
            Simulate 201 Disbursed
          </button>
          <button type="button" onClick={() => simulate('conflict')} className={`${BUTTON} border-rose-700 bg-rose-50 text-ink hover:bg-rose-100`}>
            Simulate 409 Conflict
          </button>
        </div>
        <p aria-live="polite" className="text-sm text-slate-700">
          {describeState(config.terminalState)}.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {!loaded && canLoad && (
            <button type="button" onClick={() => setLoaded(true)} className={`${BUTTON} border-main bg-white text-ink hover:bg-slate-100`}>
              Load the 3D inspector
            </button>
          )}
          <Link href="/3d-lab" className={`text-sm font-semibold text-ink underline underline-offset-2 ${FOCUS}`}>
            Open the full 3D lab →
          </Link>
        </div>
        {!canLoad && (
          <p className="text-xs text-slate-600">
            {reduced ? 'Your system asks for reduced motion, so this stays a still blueprint.' : 'This browser has no WebGL, so this stays a still blueprint.'}
          </p>
        )}
      </div>
    </div>
  )
}
