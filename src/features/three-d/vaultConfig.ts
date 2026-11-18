/**
 * FE-AA2 · the 3D lab's state, shared by the configurator, the static SVG blueprint and the lazy
 * WebGL canvas. Imports nothing from `three`, so the configurator and `/`'s inspector card can use it
 * without pulling Three.js into their chunks.
 */

/**
 * Chassis paints. Each one is a Tailwind shade from a family CLAUDE.md §12 already allows (slate,
 * emerald, sky, amber). Here they are material paint on a 3D model, not UI signals. The UI around
 * them names each one in text.
 */
export const CHASSIS_SWATCHES = [
  { id: 'slate', label: 'Deep Ledger Slate', hex: '#1e293b' },
  { id: 'emerald', label: 'Verification Emerald', hex: '#059669' },
  { id: 'cobalt', label: 'Cloud Cobalt', hex: '#0284c7' },
  { id: 'amber', label: 'Amber Gold', hex: '#d97706' },
  { id: 'obsidian', label: 'Obsidian Titanium', hex: '#0f172a' },
] as const

export type HardwareModule = 'nfc' | 'printer'
export type LightingPreset = 'fintech-studio' | 'cyber-vault' | 'warm-daylight'
/** The capstone state the terminal acts out. `idle` until a Simulate button is pressed. */
export type TerminalState = 'idle' | 'disbursed' | 'conflict'

export const HARDWARE_MODULES: readonly { id: HardwareModule; label: string; hint: string }[] = [
  { id: 'nfc', label: 'NFC contactless shield + security ring', hint: 'Tap-to-pay reader with the verification ring.' },
  { id: 'printer', label: 'Dual-screen receipt printer module', hint: 'Customer-facing screen and a thermal receipt slot.' },
]

export const LIGHTING_PRESETS: readonly { id: LightingPreset; label: string; hint: string }[] = [
  { id: 'fintech-studio', label: 'Fintech Studio', hint: 'Near-white backdrop, soft key light.' },
  { id: 'cyber-vault', label: 'Cyber Vault Dark', hint: 'Near-black backdrop, emerald and sky rim lights.' },
  { id: 'warm-daylight', label: 'Warm Daylight', hint: 'Warm sun from the side, like a store counter.' },
]

/** Rose for the 409 bounce, emerald for the 201, amber while the simulated request is in flight (§12 rule 2). */
export const STATE_COLORS = {
  idle: '#94a3b8',
  inFlight: '#f59e0b',
  disbursed: '#10b981',
  conflict: '#e11d48',
} as const

export interface VaultConfig {
  readonly chassisColor: string
  readonly metalness: number
  readonly roughness: number
  readonly wireframe: boolean
  readonly module: HardwareModule
  readonly lighting: LightingPreset
  /** OrbitControls.autoRotateSpeed: 0 means no auto-rotation, so nothing loops until asked. */
  readonly autoRotateSpeed: number
  readonly pointerTilt: boolean
  readonly terminalState: TerminalState
  /** Bumped on every Simulate press, so pressing 201 twice replays the animation. */
  readonly stateNonce: number
}

export const DEFAULT_CONFIG: VaultConfig = {
  chassisColor: CHASSIS_SWATCHES[0].hex,
  metalness: 0.75,
  roughness: 0.3,
  wireframe: false,
  module: 'nfc',
  lighting: 'fintech-studio',
  autoRotateSpeed: 0,
  pointerTilt: true,
  terminalState: 'idle',
  stateNonce: 0,
}

/** One-line description of the terminal's state, for the live region and the SVG's accessible name. */
export function describeState(state: TerminalState): string {
  switch (state) {
    case 'idle':
      return 'Idle: ready to disburse ₱5,000.00'
    case 'disbursed':
      return '201 Disbursed: the security ring spins emerald and the confirmation badge rises'
    case 'conflict':
      return '409 Conflict: the ring pulses rose and the vault shutter locks'
  }
}

/** What the WebGL canvas reports back about itself, read by the FE-10 Performance Lens bar. */
export interface Telemetry {
  readonly fps: number
  /** Average time between frames. 16.7 ms is 60 FPS. */
  readonly frameMs: number
  /** Average CPU time inside renderer.render(): the part of the 16.7 ms budget the scene uses. */
  readonly renderMs: number
  readonly drawCalls: number
  readonly triangles: number
  readonly dpr: number
  readonly deviceDpr: number
  /** Milliseconds from the canvas mounting to its first rendered frame. */
  readonly firstFrameMs: number | null
  /** Bytes of JavaScript that arrived after the lab mounted: the lazy Three.js chunk(s). */
  readonly lazyChunkBytes: number | null
  /** The same chunk(s) after decompression: the JavaScript the browser parses. */
  readonly lazyChunkDecodedBytes: number | null
  readonly lazyChunkCount: number
}

/** What a loaded model is, for the status line and the HUD. */
export type ModelStatus =
  | { readonly kind: 'procedural' }
  | { readonly kind: 'loading'; readonly name: string }
  | { readonly kind: 'loaded'; readonly name: string; readonly bytes: number; readonly triangles: number; readonly draco: boolean }
  | { readonly kind: 'error'; readonly name: string; readonly message: string }

/** A model file handed to the canvas: from a drop, the file input, or the sample generator. */
export interface ModelFile {
  readonly id: number
  readonly name: string
  readonly bytes: ArrayBuffer
}

/** Device pixel ratio clamp. A 3x phone draws 1.5² = 2.25 pixels per CSS pixel instead of 9: a quarter of the work. */
export const DPR_RANGE = [1, 1.5] as const

export const MAX_MODEL_BYTES = 25 * 1024 * 1024

export type ModelCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * Cheap checks before the bytes reach GLTFLoader: the extension, the size, and the header.
 * A `.glb` starts with the ASCII magic `glTF`; a `.gltf` is JSON with an `asset` object.
 */
export function checkModelFile(name: string, bytes: ArrayBuffer): ModelCheck {
  const lower = name.toLowerCase()
  if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) {
    return { ok: false, reason: 'Only .glb or .gltf files load here.' }
  }
  if (bytes.byteLength === 0) return { ok: false, reason: 'The file is empty.' }
  if (bytes.byteLength > MAX_MODEL_BYTES) {
    return { ok: false, reason: `The file is ${Math.ceil(bytes.byteLength / 1048576)} MB; the limit is 25 MB.` }
  }
  if (lower.endsWith('.glb')) {
    const magic = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength)))
    if (magic !== 'glTF') return { ok: false, reason: 'This .glb has no glTF header. Is it really a binary glTF?' }
    return { ok: true }
  }
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (typeof json !== 'object' || json === null || !('asset' in json)) {
      return { ok: false, reason: 'This .gltf has no "asset" object.' }
    }
  } catch {
    return { ok: false, reason: 'This .gltf is not valid JSON.' }
  }
  return { ok: true }
}

/** A fixed number of decimals for display (sliders, timings). Not for money: that is formatPHP. */
export function formatDecimal(value: number, digits: number): string {
  return new Intl.NumberFormat('en-PH', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(Math.round((bytes / 1024) * 10) / 10).toString()} KB`
  return `${(Math.round((bytes / 1048576) * 10) / 10).toString()} MB`
}
