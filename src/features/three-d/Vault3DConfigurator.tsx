'use client'

/**
 * FE-AA2 · the /3d-lab configurator: a keyboard-first control panel (the flex path instead of Leva),
 * a drag-and-drop .glb / .gltf viewport, and the FE-10 Performance Lens bar.
 *
 * Three.js never enters this file's chunk: the viewport arrives through `LazyVault3DCanvas`
 * (next/dynamic, ssr: false). When the viewer asks for reduced motion, flips the low-power switch,
 * or the browser has no WebGL, the static SVG blueprint renders instead and WebGL is never mounted.
 */
import Link from 'next/link'
import { Suspense, useEffect, useId, useState, useSyncExternalStore, type ComponentType, type DragEvent } from 'react'
import { usePrefersReducedMotion } from '../../components/ui/SmartActionButton.tsx'
import { LazyVault3DCanvas } from './LazyVault3DCanvas.tsx'
import { StaticBlueprint } from './StaticBlueprint.tsx'
import type { Vault3DCanvasProps } from './Vault3DCanvas.tsx'
import {
  CHASSIS_SWATCHES,
  DEFAULT_CONFIG,
  HARDWARE_MODULES,
  LIGHTING_PRESETS,
  checkModelFile,
  describeState,
  formatBytes,
  formatDecimal,
  type ModelFile,
  type ModelStatus,
  type Telemetry,
  type TerminalState,
  type VaultConfig,
} from './vaultConfig.ts'

export interface Vault3DConfiguratorProps {
  /** The WebGL viewport. Tests pass a stand-in; the app uses the lazy Three.js canvas. */
  readonly Viewport?: ComponentType<Vault3DCanvasProps>
  /** Overrides WebGL detection (tests, or a host that already knows). */
  readonly webgl?: boolean
  /** Overrides the OS `prefers-reduced-motion` reading. */
  readonly reducedMotion?: boolean
}

let webglCache: boolean | null = null
function detectWebGL(): boolean {
  if (webglCache === null) {
    try {
      const canvas = document.createElement('canvas')
      webglCache = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null
    } catch {
      webglCache = false
    }
  }
  return webglCache
}
const noSubscribe = (): (() => void) => () => {}

/** `null` on the server and during hydration: unknown, so neither the canvas nor the fallback flashes. */
function useWebGL(override: boolean | undefined): boolean | null {
  return useSyncExternalStore<boolean | null>(noSubscribe, override === undefined ? detectWebGL : () => override, () => override ?? null)
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const RANGE = `w-full accent-emerald-700 ${FOCUS}`
const BOX = 'size-4 shrink-0 accent-emerald-700'
const BUTTON = `inline-flex min-h-11 items-center justify-center rounded-md border px-3 text-sm font-semibold transition-colors ${FOCUS} disabled:cursor-not-allowed disabled:opacity-50`

function statusLine(status: ModelStatus): string {
  switch (status.kind) {
    case 'procedural':
      return 'Showing the procedural POS terminal (built in the browser, no model download).'
    case 'loading':
      return `Loading ${status.name}…`
    case 'loaded':
      return `Loaded ${status.name}: ${formatBytes(status.bytes)}, ${status.triangles.toLocaleString('en-PH')} triangles${status.draco ? ', Draco-compressed' : ''}. Centred and scaled to the stage.`
    case 'error':
      return `${status.name}: ${status.message}`
  }
}

export function Vault3DConfigurator({ Viewport = LazyVault3DCanvas, webgl: webglOverride, reducedMotion: reducedOverride }: Vault3DConfiguratorProps) {
  const id = useId()
  const [config, setConfig] = useState<VaultConfig>(DEFAULT_CONFIG)
  const [lowPower, setLowPower] = useState(false)
  const [model, setModel] = useState<ModelFile | null>(null)
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ kind: 'procedural' })
  const [fileError, setFileError] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [sampleRequest, setSampleRequest] = useState(0)
  const [sample, setSample] = useState<{ url: string; bytes: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [nextModelId, setNextModelId] = useState(1)

  const osReduced = usePrefersReducedMotion()
  const reduced = reducedOverride ?? osReduced
  const webgl = useWebGL(webglOverride)
  const forced = reduced || webgl === false
  const isStatic = lowPower || forced
  const staticReason =
    webgl === false
      ? 'Shown because this browser has no WebGL.'
      : reduced
        ? 'Shown because the system asks for reduced motion.'
        : lowPower
          ? 'Shown because the low-power switch is on.'
          : undefined

  // Free the sample's object URL when it is replaced or the lab unmounts.
  useEffect(
    () => () => {
      if (sample !== null) URL.revokeObjectURL(sample.url)
    },
    [sample],
  )

  const update = (patch: Partial<VaultConfig>): void => setConfig((current) => ({ ...current, ...patch }))
  const simulate = (terminalState: TerminalState): void =>
    setConfig((current) => ({ ...current, terminalState, stateNonce: current.stateNonce + 1 }))

  const stageFile = async (file: File): Promise<void> => {
    const bytes = await file.arrayBuffer()
    const check = checkModelFile(file.name, bytes)
    if (!check.ok) {
      setFileError(`${file.name}: ${check.reason}`)
      return
    }
    setFileError(null)
    setModel({ id: nextModelId, name: file.name, bytes })
    setNextModelId((n) => n + 1)
  }

  const onDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file !== undefined) void stageFile(file)
  }

  const onSample = (bytes: ArrayBuffer): void => {
    setSample({ url: URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' })), bytes: bytes.byteLength })
    setFileError(null)
    setModel({ id: nextModelId, name: 'microcredit-pos-sample.glb', bytes })
    setNextModelId((n) => n + 1)
  }

  const fieldIds = (name: string) => ({ input: `${id}-${name}`, hint: `${id}-${name}-hint` })
  const metal = fieldIds('metalness')
  const rough = fieldIds('roughness')
  const wire = fieldIds('wireframe')
  const custom = fieldIds('custom-colour')
  const rotate = fieldIds('auto-rotate')
  const tilt = fieldIds('pointer-tilt')
  const lowPowerIds = fieldIds('low-power')
  const file = fieldIds('model-file')

  const swatchMatch = CHASSIS_SWATCHES.find((s) => s.hex === config.chassisColor.toLowerCase())
  const canvasLabel = `3D MicroCredit POS terminal. ${describeState(config.terminalState)}. Drag to orbit, pinch or scroll to zoom, arrow keys to pan.`

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        {/* FE-10 Performance Lens */}
        <section aria-labelledby={`${id}-lens`} className="rounded-lg border border-slate-200 bg-white p-3">
          <h2 id={`${id}-lens`} className="text-sm font-semibold">
            FE-10 Performance Lens
          </h2>
          {isStatic ? (
            <p className="mt-1 font-mono text-xs text-slate-700">
              WebGL not mounted · 0 KB of Three.js requested · 0 frames rendered
            </p>
          ) : (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs sm:grid-cols-4">
              <div>
                <dt className="text-slate-600">FPS</dt>
                <dd>{telemetry === null ? '…' : telemetry.fps}</dd>
              </div>
              <div>
                <dt className="text-slate-600">Frame / render</dt>
                <dd>{telemetry === null ? '…' : `${formatDecimal(telemetry.frameMs, 1)} ms / ${formatDecimal(telemetry.renderMs, 2)} ms`}</dd>
              </div>
              <div>
                <dt className="text-slate-600">Draw calls · triangles</dt>
                <dd>{telemetry === null ? '…' : `${telemetry.drawCalls} · ${telemetry.triangles.toLocaleString('en-PH')}`}</dd>
              </div>
              <div>
                <dt className="text-slate-600">DPR (clamp 1–1.5)</dt>
                <dd>{telemetry === null ? '…' : `${telemetry.dpr}x of ${telemetry.deviceDpr}x`}</dd>
              </div>
              <div>
                <dt className="text-slate-600">First frame</dt>
                <dd>{telemetry?.firstFrameMs === null || telemetry === null ? '…' : `${telemetry.firstFrameMs} ms after mount`}</dd>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-slate-600">Lazy chunk (Three.js + viewport)</dt>
                <dd>
                  {telemetry === null || telemetry.lazyChunkBytes === null
                    ? '…'
                    : `${formatBytes(telemetry.lazyChunkBytes)} compressed (${formatBytes(telemetry.lazyChunkDecodedBytes ?? 0)} of JavaScript) in ${telemetry.lazyChunkCount} file${telemetry.lazyChunkCount === 1 ? '' : 's'}, fetched after the page rendered`}
                </dd>
              </div>
            </dl>
          )}
        </section>

        {/* Viewport: the lazy canvas, or the static blueprint. */}
        <section
          aria-label="3D viewport"
          onDragOver={(event) => {
            if (isStatic) return
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={isStatic ? undefined : onDrop}
          className={`relative overflow-hidden rounded-lg border bg-white ${dragging ? 'border-accent border-2' : 'border-slate-200'}`}
        >
          {isStatic ? (
            <div className="p-3">
              <StaticBlueprint
                chassisColor={config.chassisColor}
                module={config.module}
                terminalState={config.terminalState}
                {...(staticReason === undefined ? {} : { reason: staticReason })}
              />
              <p className="mt-2 text-xs text-slate-600">{staticReason} No WebGL context is created and no Three.js is downloaded.</p>
            </div>
          ) : webgl === null ? (
            <div role="status" className="flex aspect-[4/3] items-center justify-center text-sm text-slate-600">
              Checking for WebGL…
            </div>
          ) : (
            <div className="aspect-[4/3] min-h-72 w-full">
              <Suspense fallback={null}>
                <Viewport
                  config={config}
                  model={model}
                  sampleRequest={sampleRequest}
                  label={canvasLabel}
                  onTelemetry={setTelemetry}
                  onModelStatus={setModelStatus}
                  onSample={onSample}
                />
              </Suspense>
              <p className="pointer-events-none absolute right-2 bottom-2 rounded bg-white/90 px-2 py-0.5 text-xs text-slate-700">
                {dragging ? 'Release to load the model' : 'Drop a .glb or .gltf here'}
              </p>
            </div>
          )}
        </section>

        <p aria-live="polite" className="text-sm text-slate-700">
          {describeState(config.terminalState)}. {statusLine(modelStatus)}
        </p>
      </div>

      <div className="min-w-0 space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Capstone state</legend>
          <p id={`${id}-state-hint`} className="text-sm text-slate-600">
            The same two outcomes the Disburse sandbox returns: a <code className="font-mono">201</code> payout and a{' '}
            <code className="font-mono">409</code> stale <code className="font-mono">If-Match</code>.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-describedby={`${id}-state-hint`} onClick={() => simulate('disbursed')} className={`${BUTTON} border-emerald-700 bg-emerald-50 text-ink hover:bg-emerald-100`}>
              Simulate 201 Disbursed
            </button>
            <button type="button" aria-describedby={`${id}-state-hint`} onClick={() => simulate('conflict')} className={`${BUTTON} border-rose-700 bg-rose-50 text-ink hover:bg-rose-100`}>
              Simulate 409 Conflict
            </button>
            <button type="button" onClick={() => simulate('idle')} className={`${BUTTON} border-slate-400 bg-white text-ink hover:bg-slate-100`}>
              Reset to idle
            </button>
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Chassis colour</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {CHASSIS_SWATCHES.map((swatch) => {
              const swatchId = `${id}-swatch-${swatch.id}`
              return (
                <div key={swatch.id} className="flex items-center gap-2 text-sm">
                  <input
                    id={swatchId}
                    type="radio"
                    name={`${id}-swatch`}
                    checked={swatchMatch?.id === swatch.id}
                    onChange={() => update({ chassisColor: swatch.hex })}
                    aria-invalid="false"
                    aria-describedby={`${id}-swatch-hint`}
                    className={BOX}
                  />
                  <span aria-hidden="true" className="size-4 shrink-0 rounded border border-slate-400" style={{ backgroundColor: swatch.hex }} />
                  <label htmlFor={swatchId}>
                    {swatch.label} <span className="font-mono text-xs text-slate-600">{swatch.hex.toUpperCase()}</span>
                  </label>
                </div>
              )
            })}
          </div>
          <p id={`${id}-swatch-hint`} className="text-xs text-slate-600">
            Paint for the metal chassis. It changes the material, not what the terminal is saying.
          </p>
          <div className="flex items-center gap-2 text-sm">
            <input
              id={custom.input}
              type="color"
              value={config.chassisColor}
              onChange={(event) => update({ chassisColor: event.target.value })}
              aria-invalid="false"
              aria-describedby={custom.hint}
              className={`h-9 w-12 rounded border border-slate-400 ${FOCUS}`}
            />
            <label htmlFor={custom.input}>Custom chassis colour</label>
            <span id={custom.hint} className="font-mono text-xs text-slate-600">
              {config.chassisColor.toUpperCase()}
            </span>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Finish</legend>
          <div>
            <div className="flex justify-between text-sm">
              <label htmlFor={metal.input}>Metalness</label>
              <output htmlFor={metal.input} className="font-mono">
                {formatDecimal(config.metalness, 2)}
              </output>
            </div>
            <input id={metal.input} type="range" min={0} max={1} step={0.05} value={config.metalness} onChange={(event) => update({ metalness: Number(event.target.value) })} aria-invalid="false" aria-describedby={metal.hint} className={RANGE} />
            <p id={metal.hint} className="text-xs text-slate-600">
              0 is painted plastic, 1 is bare metal that mirrors the studio.
            </p>
          </div>
          <div>
            <div className="flex justify-between text-sm">
              <label htmlFor={rough.input}>Roughness</label>
              <output htmlFor={rough.input} className="font-mono">
                {formatDecimal(config.roughness, 2)}
              </output>
            </div>
            <input id={rough.input} type="range" min={0} max={1} step={0.05} value={config.roughness} onChange={(event) => update({ roughness: Number(event.target.value) })} aria-invalid="false" aria-describedby={rough.hint} className={RANGE} />
            <p id={rough.hint} className="text-xs text-slate-600">
              0 is polished, 1 is brushed and matte.
            </p>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <input id={wire.input} type="checkbox" checked={config.wireframe} onChange={(event) => update({ wireframe: event.target.checked })} aria-invalid="false" aria-describedby={wire.hint} className={`mt-0.5 ${BOX}`} />
            <span>
              <label htmlFor={wire.input}>Wireframe</label>
              <span id={wire.hint} className="block text-xs text-slate-600">
                Shows the triangles the GPU draws.
              </span>
            </span>
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Hardware module</legend>
          {HARDWARE_MODULES.map((m) => (
            <div key={m.id} className="flex items-start gap-2 text-sm">
              <input id={`${id}-module-${m.id}`} type="radio" name={`${id}-module`} checked={config.module === m.id} onChange={() => update({ module: m.id })} aria-invalid="false" aria-describedby={`${id}-module-${m.id}-hint`} className={`mt-0.5 ${BOX}`} />
              <span>
                <label htmlFor={`${id}-module-${m.id}`}>{m.label}</label>
                <span id={`${id}-module-${m.id}-hint`} className="block text-xs text-slate-600">
                  {m.hint}
                </span>
              </span>
            </div>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Lighting preset</legend>
          {LIGHTING_PRESETS.map((preset) => (
            <div key={preset.id} className="flex items-start gap-2 text-sm">
              <input id={`${id}-light-${preset.id}`} type="radio" name={`${id}-light`} checked={config.lighting === preset.id} onChange={() => update({ lighting: preset.id })} aria-invalid="false" aria-describedby={`${id}-light-${preset.id}-hint`} className={`mt-0.5 ${BOX}`} />
              <span>
                <label htmlFor={`${id}-light-${preset.id}`}>{preset.label}</label>
                <span id={`${id}-light-${preset.id}-hint`} className="block text-xs text-slate-600">
                  {preset.hint}
                </span>
              </span>
            </div>
          ))}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Motion</legend>
          <div>
            <div className="flex justify-between text-sm">
              <label htmlFor={rotate.input}>Auto-rotate speed</label>
              <output htmlFor={rotate.input} className="font-mono">
                {config.autoRotateSpeed === 0 ? 'off' : formatDecimal(config.autoRotateSpeed, 1)}
              </output>
            </div>
            <input id={rotate.input} type="range" min={0} max={6} step={0.5} value={config.autoRotateSpeed} onChange={(event) => update({ autoRotateSpeed: Number(event.target.value) })} aria-invalid="false" aria-describedby={rotate.hint} className={RANGE} />
            <p id={rotate.hint} className="text-xs text-slate-600">
              Off by default, so nothing loops until you ask. At 2.0 one turn takes 30 seconds.
            </p>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <input id={tilt.input} type="checkbox" checked={config.pointerTilt} onChange={(event) => update({ pointerTilt: event.target.checked })} aria-invalid="false" aria-describedby={tilt.hint} className={`mt-0.5 ${BOX}`} />
            <span>
              <label htmlFor={tilt.input}>Pointer tilt</label>
              <span id={tilt.hint} className="block text-xs text-slate-600">
                The terminal leans a little toward the pointer when you are not dragging.
              </span>
            </span>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <input
              id={lowPowerIds.input}
              type="checkbox"
              checked={isStatic}
              disabled={forced}
              onChange={(event) => setLowPower(event.target.checked)}
              aria-invalid="false"
              aria-describedby={lowPowerIds.hint}
              className={`mt-0.5 ${BOX}`}
            />
            <span>
              <label htmlFor={lowPowerIds.input}>Static blueprint (reduced motion / low power)</label>
              <span id={lowPowerIds.hint} className="block text-xs text-slate-600">
                {forced
                  ? `${staticReason ?? ''} The switch is locked on.`
                  : 'Swaps the WebGL canvas for a still SVG blueprint and frees the GPU.'}
              </span>
            </span>
          </div>
        </fieldset>

        <fieldset className="space-y-2" disabled={isStatic}>
          <legend className="text-sm font-semibold">Your own model</legend>
          <div className="text-sm">
            <label htmlFor={file.input} className="block">
              Load a .glb or .gltf file
            </label>
            <input
              id={file.input}
              type="file"
              accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
              onChange={(event) => {
                const picked = event.target.files?.[0]
                if (picked !== undefined) void stageFile(picked)
                event.target.value = ''
              }}
              aria-invalid={fileError === null ? 'false' : 'true'}
              aria-describedby={fileError === null ? file.hint : `${file.hint} ${file.input}-error`}
              className={`mt-1 block w-full text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:border-slate-400 file:bg-white file:px-3 file:font-semibold ${FOCUS}`}
            />
            <p id={file.hint} className="mt-1 text-xs text-slate-600">
              Or drop one on the viewport. Up to 25 MB; Draco-compressed meshes decode with a self-hosted decoder. The
              model is centred and scaled to fit.
            </p>
            {fileError !== null && (
              <p id={`${file.input}-error`} role="alert" className="mt-1 text-sm font-medium text-rose-700">
                {fileError}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setSampleRequest((n) => n + 1)} className={`${BUTTON} border-amber-600 bg-amber-50 text-ink hover:bg-amber-100`}>
              Generate &amp; load sample .glb
            </button>
            {model !== null && (
              <button type="button" onClick={() => setModel(null)} className={`${BUTTON} border-slate-400 bg-white text-ink hover:bg-slate-100`}>
                Back to the POS terminal
              </button>
            )}
          </div>
          {sample !== null && (
            <p className="text-sm">
              <a href={sample.url} download="microcredit-pos-sample.glb" className={`font-semibold text-ink underline underline-offset-2 ${FOCUS}`}>
                Download the sample .glb ({formatBytes(sample.bytes)})
              </a>{' '}
              <span className="text-slate-600">and drop it back in to test the loader with a real file.</span>
            </p>
          )}
        </fieldset>

        <p className="text-xs text-slate-600">
          The terminal is built from primitives at run time, so the scene loads no model or texture files. See the{' '}
          <Link href="/" className="font-semibold text-ink underline underline-offset-2">
            Disburse sandbox
          </Link>{' '}
          for the real <code className="font-mono">Idempotency-Key</code> / <code className="font-mono">If-Match</code> flow.
        </p>
      </div>
    </div>
  )
}
