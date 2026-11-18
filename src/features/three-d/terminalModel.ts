/**
 * FE-AA2 · the MicroCredit Smart POS & Biometric Ledger Terminal, built from primitives at run time.
 * No model file, no texture download: the default scene costs zero network requests after the
 * lazy JavaScript chunk.
 *
 * Only `Vault3DCanvas.tsx` imports this, so it lives in the lazy chunk with `three`.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { STATE_COLORS, type HardwareModule, type TerminalState } from './vaultConfig.ts'

export interface TerminalParts {
  readonly root: THREE.Group
  /** Everything painted by the chassis colour / metalness / roughness / wireframe controls. */
  readonly chassisMaterial: THREE.MeshStandardMaterial
  /** Materials that only follow the wireframe toggle. */
  readonly detailMaterials: readonly THREE.MeshStandardMaterial[]
  readonly nfcModule: THREE.Group
  readonly printerModule: THREE.Group
  readonly ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>
  readonly core: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshStandardMaterial>
  readonly nodes: readonly THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshStandardMaterial>[]
  readonly badge: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  readonly shutter: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
  readonly screen: ScreenTexture
  readonly badgeTexture: THREE.CanvasTexture
}

interface ScreenTexture {
  readonly texture: THREE.CanvasTexture
  draw: (state: TerminalState) => void
}

/** The page's JetBrains Mono, as next/font named it, or the browser's monospace. */
function monoFamily(): string {
  if (typeof document === 'undefined') return 'monospace'
  const family = getComputedStyle(document.body).getPropertyValue('--font-jetbrains').trim()
  return family === '' ? 'monospace' : `${family}, monospace`
}

function makeScreen(): ScreenTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 336
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  const shown = { state: 'idle' as TerminalState }
  const draw = (state: TerminalState): void => {
    shown.state = state
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const mono = monoFamily()
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#94a3b8'
    ctx.font = `500 22px ${mono}`
    ctx.fillText('MICROCREDIT POS · L-1042', 28, 46)
    const [line1, line2, line3, color] =
      state === 'disbursed'
        ? ['201 Created', 'Disbursed ₱5,000.00', 'Σ debits === Σ credits', STATE_COLORS.disbursed]
        : state === 'conflict'
          ? ['409 Conflict', 'If-Match "3" is stale', 'No ledger entry written', STATE_COLORS.conflict]
          : ['Disburse ₱5,000.00', 'Idempotency-Key 7f3c…', 'If-Match "3"', '#f8fafc']
    // Shrink each line until it fits the 456 px between the margins.
    const fit = (text: string, weight: number, size: number, y: number, fill: string): void => {
      let px = size
      ctx.font = `${weight} ${px}px ${mono}`
      while (px > 12 && ctx.measureText(text).width > canvas.width - 56) {
        px -= 2
        ctx.font = `${weight} ${px}px ${mono}`
      }
      ctx.fillStyle = fill
      ctx.fillText(text, 28, y)
    }
    fit(line1, 500, 46, 140, color)
    fit(line2, 400, 28, 210, '#e2e8f0')
    fit(line3, 400, 28, 266, '#94a3b8')
    texture.needsUpdate = true
  }
  draw('idle')
  // Canvas text uses whatever font is ready; redraw once JetBrains Mono has loaded.
  if ('fonts' in document) void document.fonts.ready.then(() => draw(shown.state))
  return { texture, draw }
}

function makeBadgeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 160
  const ctx = canvas.getContext('2d')
  if (ctx !== null) {
    const mono = monoFamily()
    ctx.fillStyle = 'rgba(15, 23, 42, 0.86)'
    ctx.beginPath()
    ctx.roundRect(4, 4, 504, 152, 28)
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = STATE_COLORS.disbursed
    ctx.stroke()
    ctx.fillStyle = STATE_COLORS.disbursed
    ctx.font = `500 50px ${mono}`
    ctx.fillText('✓ 201', 36, 76)
    ctx.fillStyle = '#f8fafc'
    ctx.font = `400 30px ${mono}`
    ctx.fillText('Disbursed ₱5,000.00', 36, 126)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** A hexagonal security core with a round hole, extruded and bevelled: the "centavo core". */
function coreGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    const x = Math.cos(a) * 0.17
    const y = Math.sin(a) * 0.17
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const hole = new THREE.Path()
  hole.absarc(0, 0, 0.07, 0, Math.PI * 2, true)
  shape.holes.push(hole)
  return new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 })
}

export function buildTerminal(chassisColor: string): TerminalParts {
  const root = new THREE.Group()
  root.name = 'MicroCredit POS terminal'

  const chassisMaterial = new THREE.MeshStandardMaterial({ color: chassisColor, metalness: 0.75, roughness: 0.3 })
  const trim = new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.4, roughness: 0.55 })
  const keyMaterial = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.1, roughness: 0.6 })
  const paper = new THREE.MeshStandardMaterial({ color: '#f8fafc', metalness: 0, roughness: 0.9 })

  // Base plate and the tilted body.
  const base = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.16, 1.05, 3, 0.05), chassisMaterial)
  base.position.y = 0.08
  root.add(base)

  const body = new THREE.Group()
  body.position.set(0, 0.86, -0.22)
  body.rotation.x = -0.22
  root.add(body)
  body.add(new THREE.Mesh(new RoundedBoxGeometry(1.22, 1.46, 0.2, 3, 0.06), chassisMaterial))

  const screen = makeScreen()
  const screenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.98, 0.64),
    new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }),
  )
  screenMesh.position.set(0, 0.3, 0.101)
  body.add(screenMesh)

  // Keypad: 12 keys, one InstancedMesh, one draw call.
  const keys = new THREE.InstancedMesh(new RoundedBoxGeometry(0.22, 0.1, 0.04, 2, 0.015), keyMaterial, 12)
  const m = new THREE.Matrix4()
  for (let i = 0; i < 12; i += 1) {
    m.makeTranslation(-0.3 + (i % 3) * 0.3, -0.13 - Math.floor(i / 3) * 0.135, 0.11)
    keys.setMatrixAt(i, m)
  }
  body.add(keys)

  // The vault shutter: drops over the screen on 409. Anchored at its top edge, so scaling y lowers it.
  const shutterGeometry = new THREE.BoxGeometry(1.02, 0.68, 0.03)
  shutterGeometry.translate(0, -0.34, 0)
  const shutter = new THREE.Mesh(
    shutterGeometry,
    new THREE.MeshStandardMaterial({ color: '#475569', metalness: 0.9, roughness: 0.35, emissive: STATE_COLORS.conflict, emissiveIntensity: 0 }),
  )
  shutter.position.set(0, 0.64, 0.125)
  shutter.scale.y = 0.001
  body.add(shutter)

  // NFC contactless shield + security ring, on the base in front of the body.
  const nfcModule = new THREE.Group()
  nfcModule.position.set(0.32, 0.17, 0.27)
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.29, 0.03, 48), trim)
  nfcModule.add(shield)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.022, 16, 64),
    new THREE.MeshStandardMaterial({ color: STATE_COLORS.idle, emissive: STATE_COLORS.idle, emissiveIntensity: 0.25, metalness: 0.3, roughness: 0.4 }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.04
  nfcModule.add(ring)
  root.add(nfcModule)

  // Dual-screen receipt printer: a box on the body's top, a paper tongue and a customer screen.
  const printerModule = new THREE.Group()
  printerModule.position.set(0, 0.74, 0.02)
  body.add(printerModule)
  printerModule.add(new THREE.Mesh(new RoundedBoxGeometry(0.96, 0.22, 0.34, 3, 0.04), trim))
  const receipt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.004), paper)
  receipt.position.set(0, 0.2, 0.02)
  receipt.rotation.x = -0.25
  printerModule.add(receipt)
  const customerScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.16),
    new THREE.MeshStandardMaterial({ color: '#0f172a', emissive: '#0ea5e9', emissiveIntensity: 0.35 }),
  )
  customerScreen.position.set(0, 0, 0.172)
  printerModule.add(customerScreen)
  printerModule.visible = false

  // The centavo security core on the base, front left.
  const core = new THREE.Mesh(
    coreGeometry(),
    new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.95, roughness: 0.2, emissive: STATE_COLORS.idle, emissiveIntensity: 0.1 }),
  )
  core.rotation.x = -Math.PI / 2
  core.position.set(-0.4, 0.17, 0.27)
  root.add(core)

  // Three ledger verification nodes above the terminal: debit, credit, balance.
  const nodes = [-0.42, 0, 0.42].map((x) => {
    const node = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.075, 1),
      new THREE.MeshStandardMaterial({ color: '#e2e8f0', emissive: STATE_COLORS.idle, emissiveIntensity: 0.2, metalness: 0.2, roughness: 0.35, flatShading: true }),
    )
    node.position.set(x, 2.12, -0.32)
    root.add(node)
    return node
  })
  const links = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(nodes.map((n) => n.position.clone())),
    new THREE.LineBasicMaterial({ color: '#94a3b8' }),
  )
  root.add(links)

  // The confirmation holo-badge: hidden until a 201.
  const badgeTexture = makeBadgeTexture()
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.96, 0.3),
    new THREE.MeshBasicMaterial({ map: badgeTexture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  )
  // Floats beside the terminal, turned toward the default camera, so it never covers the screen.
  badge.position.set(1.08, 1.1, 0.15)
  badge.rotation.y = -0.45
  badge.visible = false
  root.add(badge)

  return {
    root,
    chassisMaterial,
    detailMaterials: [trim, keyMaterial, paper, shutter.material, ring.material, core.material, ...nodes.map((n) => n.material)],
    nfcModule,
    printerModule,
    ring,
    core,
    nodes,
    badge,
    shutter,
    screen,
    badgeTexture,
  }
}

/** Paint and finish: colour, metalness and roughness on the chassis; wireframe on every part. */
export function applyTerminalFinish(
  parts: TerminalParts,
  finish: { readonly chassisColor: string; readonly metalness: number; readonly roughness: number; readonly wireframe: boolean },
): void {
  parts.chassisMaterial.color.set(finish.chassisColor)
  parts.chassisMaterial.metalness = finish.metalness
  parts.chassisMaterial.roughness = finish.roughness
  parts.chassisMaterial.wireframe = finish.wireframe
  for (const material of parts.detailMaterials) material.wireframe = finish.wireframe
}

export function showModule(parts: TerminalParts, module: HardwareModule): void {
  parts.nfcModule.visible = module === 'nfc'
  parts.printerModule.visible = module === 'printer'
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t))

/** How long each state's motion runs, in ms. After that the pose holds still. */
export const STATE_MOTION_MS = { disbursed: 1400, conflict: 900 } as const
/** The simulated request is "in flight" (amber) for this long before the 201 or 409 lands. */
export const IN_FLIGHT_MS = 350

const tmp = new THREE.Color()

/**
 * Poses the terminal for `state`, `elapsed` ms after it was entered. Pure in its inputs: the render
 * loop calls it every frame, and it settles into a still pose once the motion time has passed.
 * Returns true while something is still moving, so the loop knows the frame must be redrawn.
 */
export function poseTerminal(parts: TerminalParts, state: TerminalState, elapsed: number): boolean {
  const ringMat = parts.ring.material
  const setGlow = (color: string, intensity: number): void => {
    tmp.set(color)
    ringMat.color.copy(tmp)
    ringMat.emissive.copy(tmp)
    ringMat.emissiveIntensity = intensity
    parts.core.material.emissive.copy(tmp)
    parts.core.material.emissiveIntensity = intensity * 0.4
  }
  const nodeGlow = (color: string, litUpTo: number): void => {
    parts.nodes.forEach((node, i) => {
      node.material.emissive.set(i < litUpTo ? color : STATE_COLORS.idle)
      node.material.emissiveIntensity = i < litUpTo ? 0.9 : 0.2
    })
  }

  if (state === 'idle') {
    setGlow(STATE_COLORS.idle, 0.25)
    nodeGlow(STATE_COLORS.idle, 0)
    parts.ring.rotation.z = 0
    parts.badge.visible = false
    parts.shutter.scale.y = 0.001
    parts.shutter.material.emissiveIntensity = 0
    return false
  }

  if (elapsed < IN_FLIGHT_MS) {
    setGlow(STATE_COLORS.inFlight, 0.6 + 0.4 * Math.sin((elapsed / IN_FLIGHT_MS) * Math.PI))
    nodeGlow(STATE_COLORS.inFlight, 0)
    parts.badge.visible = false
    parts.shutter.scale.y = 0.001
    return true
  }
  const t = elapsed - IN_FLIGHT_MS

  if (state === 'disbursed') {
    const p = clamp01(t / STATE_MOTION_MS.disbursed)
    setGlow(STATE_COLORS.disbursed, 1.2 - 0.5 * p)
    // Two full turns, easing to a stop.
    parts.ring.rotation.z = easeOut(p) * Math.PI * 4
    nodeGlow(STATE_COLORS.disbursed, Math.min(3, Math.floor(p * 4) + 1))
    const rise = easeOut(clamp01(t / 700))
    parts.badge.visible = true
    parts.badge.position.y = 1.1 + rise * 0.45
    parts.badge.material.opacity = rise
    parts.shutter.scale.y = 0.001
    return p < 1
  }

  // conflict: three rose pulses, then the shutter stays down.
  const p = clamp01(t / STATE_MOTION_MS.conflict)
  const pulse = 0.5 + 0.5 * Math.cos(p * Math.PI * 6)
  setGlow(STATE_COLORS.conflict, p < 1 ? 0.4 + 1.1 * pulse : 0.8)
  nodeGlow(STATE_COLORS.conflict, 3)
  parts.ring.rotation.z = 0
  parts.badge.visible = false
  const drop = easeOut(clamp01(t / 450))
  parts.shutter.scale.y = Math.max(0.001, drop)
  parts.shutter.material.emissiveIntensity = 0.35 * drop
  return p < 1
}
