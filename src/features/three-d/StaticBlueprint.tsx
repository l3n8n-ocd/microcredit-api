/**
 * FE-AA2 · the static fallback: an isometric SVG blueprint of the terminal. Shown when the viewer asks
 * for reduced motion, flips the low-power switch, or the browser has no WebGL. It follows the same
 * config as the 3D view (paint, module, 201 / 409 state), never moves, and loads no Three.js.
 */
import { useId } from 'react'
import { CHASSIS_SWATCHES, HARDWARE_MODULES, describeState, type HardwareModule, type TerminalState } from './vaultConfig.ts'

export interface StaticBlueprintProps {
  readonly chassisColor: string
  readonly module: HardwareModule
  readonly terminalState: TerminalState
  /** Why the blueprint is showing, appended to the accessible description. */
  readonly reason?: string
  readonly compact?: boolean
}

const C = Math.cos(Math.PI / 6)
const S = 0.5

/** Isometric projection: x right-back, z left-back, y up. */
function isoXY(x: number, y: number, z: number): readonly [number, number] {
  return [Math.round((x - z) * C * 10) / 10, Math.round(((x + z) * S - y) * 10) / 10]
}

function iso(x: number, y: number, z: number): string {
  const [px, py] = isoXY(x, y, z)
  return `${px},${py}`
}

function pts(points: readonly (readonly [number, number, number])[]): string {
  return points.map(([x, y, z]) => iso(x, y, z)).join(' ')
}

/** The three faces a viewer sees of an axis-aligned box: top, front (z = z1), right (x = x1). */
function Box({ from, to, fill }: { from: readonly [number, number, number]; to: readonly [number, number, number]; fill: string }) {
  const [x0, y0, z0] = from
  const [x1, y1, z1] = to
  const top = pts([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]])
  const front = pts([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]])
  const right = pts([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]])
  return (
    <g className="stroke-slate-500" strokeWidth={0.8} strokeLinejoin="round">
      <polygon points={top} fill={fill} />
      <polygon points={top} className="fill-white" fillOpacity={0.18} />
      <polygon points={front} fill={fill} />
      <polygon points={front} className="fill-slate-900" fillOpacity={0.18} />
      <polygon points={right} fill={fill} />
      <polygon points={right} className="fill-slate-900" fillOpacity={0.36} />
    </g>
  )
}

function Callout({ at, to, text, anchor = 'start' }: { at: readonly [number, number]; to: readonly [number, number]; text: string; anchor?: 'start' | 'end' }) {
  const [ax, ay] = at
  return (
    <g>
      <line x1={ax} y1={ay} x2={to[0]} y2={to[1]} className="stroke-slate-400" strokeWidth={0.8} strokeDasharray="3 2" />
      <text x={to[0] + (anchor === 'start' ? 4 : -4)} y={to[1] + 3.5} textAnchor={anchor} className="fill-slate-700 font-mono" fontSize={9.5}>
        {text}
      </text>
    </g>
  )
}

export function StaticBlueprint({ chassisColor, module, terminalState, reason, compact = false }: StaticBlueprintProps) {
  const id = useId()
  const paint = CHASSIS_SWATCHES.find((s) => s.hex === chassisColor.toLowerCase())?.label ?? `Custom ${chassisColor}`
  const moduleLabel = HARDWARE_MODULES.find((m) => m.id === module)?.label ?? module
  const ringClass =
    terminalState === 'disbursed' ? 'stroke-emerald-500' : terminalState === 'conflict' ? 'stroke-rose-600' : 'stroke-slate-400'
  const nodeClass =
    terminalState === 'disbursed' ? 'fill-emerald-500' : terminalState === 'conflict' ? 'fill-rose-600' : 'fill-slate-300'

  // Screen on the body's front face (z = -20).
  const screen = pts([[-48, 92, -20], [48, 92, -20], [48, 150, -20], [-48, 150, -20]])
  // Iso circle on the base top: an ellipse, squashed by the projection.
  const [rx, ry] = isoXY(30, 16, 26)
  const [cx, cy] = isoXY(-40, 16, 26)
  const [sx, sy] = isoXY(0, 121, -20)
  // Text laid on the screen's plane: x runs along the face's isometric x axis, y stays vertical.
  const onScreen = `matrix(${C} ${S} 0 1 ${sx} ${sy + 3})`
  const hex = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2
    return iso(-40 + Math.cos(a) * 14, 16, 26 + Math.sin(a) * 14)
  }).join(' ')
  const nodes = [-45, 0, 45].map((x) => isoXY(x, 210, -30))

  return (
    <svg
      viewBox="-290 -285 580 365"
      role="img"
      aria-labelledby={`${id}-title ${id}-desc`}
      className={`w-full ${compact ? 'max-h-56' : 'max-h-[28rem]'}`}
    >
      <title id={`${id}-title`}>Isometric blueprint of the MicroCredit POS terminal</title>
      <desc id={`${id}-desc`}>
        {`${paint} chassis, ${moduleLabel}. ${describeState(terminalState)}.${reason === undefined ? '' : ` ${reason}`}`}
      </desc>

      {/* Blueprint grid under the terminal. */}
      <g className="stroke-slate-200" strokeWidth={0.6}>
        {[-90, -60, -30, 0, 30, 60, 90].map((v) => (
          <g key={v}>
            <line x1={(v - -90) * C} y1={(v + -90) * S} x2={(v - 90) * C} y2={(v + 90) * S} />
            <line x1={(-90 - v) * C} y1={(-90 + v) * S} x2={(90 - v) * C} y2={(90 + v) * S} />
          </g>
        ))}
      </g>

      <Box from={[-75, 0, -52]} to={[75, 16, 52]} fill={chassisColor} />
      <Box from={[-60, 16, -42]} to={[60, 160, -20]} fill={chassisColor} />
      <polygon points={screen} className="fill-slate-900 stroke-slate-500" strokeWidth={0.8} />
      {terminalState === 'conflict' ? (
        <g>
          <polygon points={screen} className="fill-rose-700" fillOpacity={0.85} />
          <text transform={onScreen} textAnchor="middle" className="fill-white font-mono" fontSize={10}>
            409 · LOCKED
          </text>
        </g>
      ) : (
        <text transform={onScreen} textAnchor="middle" className="fill-slate-100 font-mono" fontSize={8}>
          {terminalState === 'disbursed' ? '201 · ₱5,000.00' : 'Disburse ₱5,000.00'}
        </text>
      )}

      {module === 'nfc' ? (
        <g>
          <ellipse cx={rx} cy={ry} rx={30} ry={17} className="fill-slate-600 stroke-slate-500" strokeWidth={0.8} />
          <ellipse cx={rx} cy={ry} rx={24} ry={13.5} fill="none" className={ringClass} strokeWidth={3.5} />
          <Callout at={[rx + 24, ry]} to={[112, 40]} text="NFC ring" />
        </g>
      ) : (
        <g>
          <Box from={[-48, 160, -44]} to={[48, 182, -12]} fill="#334155" />
          <polygon points={pts([[-25, 182, -30], [25, 182, -30], [25, 205, -36], [-25, 205, -36]])} className="fill-white stroke-slate-400" strokeWidth={0.8} />
          <Callout at={isoXY(48, 175, -12)} to={[112, -150]} text="Printer + 2nd screen" />
        </g>
      )}

      <polygon points={hex} className="fill-slate-300 stroke-slate-500" strokeWidth={0.8} />
      <ellipse cx={cx} cy={cy} rx={6} ry={3.5} className="fill-slate-500" />
      <Callout at={[cx - 14, cy]} to={[-150, 40]} text="Security core" anchor="end" />

      <polyline points={nodes.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" className="stroke-slate-400" strokeWidth={1} />
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={6.5} className={`${nodeClass} stroke-slate-500`} strokeWidth={0.8} />
      ))}
      <Callout at={[(nodes[0]?.[0] ?? 0) - 7, nodes[0]?.[1] ?? 0]} to={[-150, -230]} text="Ledger nodes" anchor="end" />

      {terminalState === 'disbursed' && (
        <g>
          <rect x={-58} y={-268} width={116} height={24} rx={6} className="fill-slate-900 stroke-emerald-500" strokeWidth={1.5} />
          <text x={0} y={-252} textAnchor="middle" className="fill-emerald-300 font-mono" fontSize={10}>
            ✓ 201 Disbursed ₱5,000.00
          </text>
        </g>
      )}
      <Callout at={isoXY(60, 120, -20)} to={[112, -80]} text={`Chassis: ${paint}`} />
    </svg>
  )
}
