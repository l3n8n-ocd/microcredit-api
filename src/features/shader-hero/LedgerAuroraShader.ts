/**
 * FE-AA3 · Ledger Aurora: the fullscreen shader behind the /shader-hero headline.
 *
 * What it draws: dark slate ribbons that drift like ink in water, a faint emerald and sky glow where
 * the ribbons fold, and the thin ruled lines of a ledger sheet that bend with the flow. The cursor
 * pulls the flow a little toward itself. Everything stays dark on purpose: the brightest pixel the
 * shader can output is capped (Block 5), so white text over the scrim stays above 7:1.
 *
 * WebGL 1 / GLSL ES 1.00, so it runs on older phones too. No textures and no network: every pixel
 * comes from the maths below. Colours are Tailwind shades from the families CLAUDE.md §12 allows:
 * slate-950 #020617, slate-900 #0F172A, slate-800 #1E293B, sky-600 #0284C7, sky-400 #38BDF8,
 * emerald-600 #059669, emerald-500 #10B981.
 */

/**
 * Vertex shader. It draws one triangle bigger than the screen. The GPU clips it to the viewport, so
 * every pixel on screen runs the fragment shader exactly once. That is cheaper than two triangles,
 * which share a diagonal that gets shaded twice.
 */
export const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;

void main() {
  // a_position is already in clip space (-1..1); this shader only passes it through.
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

export const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

uniform float u_time;       // seconds since the hero started, paused while hidden
uniform vec2  u_resolution; // drawing-buffer size in device pixels (already DPR-capped)
uniform vec2  u_mouse;      // pointer position, 0..1 on both axes, eased in JavaScript

// ── Palette: Tailwind shades, as 0..1 RGB ──────────────────────────────────────────────────────────
const vec3 SLATE_950   = vec3(0.008, 0.024, 0.090); // #020617, the page's darkest ink
const vec3 SLATE_900   = vec3(0.059, 0.090, 0.165); // #0F172A, deep ledger slate
const vec3 SLATE_800   = vec3(0.118, 0.161, 0.231); // #1E293B, main brand slate
const vec3 SKY_600     = vec3(0.008, 0.518, 0.780); // #0284C7, cloud cobalt
const vec3 SKY_400     = vec3(0.220, 0.741, 0.973); // #38BDF8, the ruled ledger lines
const vec3 EMERALD_600 = vec3(0.020, 0.588, 0.412); // #059669, verification emerald
const vec3 EMERALD_500 = vec3(0.063, 0.725, 0.506); // #10B981, its brighter edge

// ── Block 2 helpers: smooth value noise and fractional Brownian motion (fBm) ─────────────────────────

// A cheap, repeatable "random" number for a grid cell: the same cell always gets the same value,
// so the picture never flickers between frames.
float hash(vec2 cell) {
  cell = fract(cell * vec2(123.34, 456.21));
  cell += dot(cell, cell + 45.32);
  return fract(cell.x * cell.y);
}

// Value noise: give each grid corner a random height, then blend the four corners with a smooth
// S-curve, so there are no hard edges between cells.
float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 ease = local * local * (3.0 - 2.0 * local);
  float bottom = mix(hash(cell), hash(cell + vec2(1.0, 0.0)), ease.x);
  float top = mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), ease.x);
  return mix(bottom, top, ease.y);
}

// fBm: add four layers of noise, each twice as detailed and half as strong as the last. Each layer is
// also rotated, so the layers don't line up into a visible grid. The result looks like smoke or silk.
float fbm(vec2 p) {
  float total = 0.0;
  float strength = 0.5;
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8); // about 37 degrees
  for (int layer = 0; layer < 4; layer++) {
    total += strength * valueNoise(p);
    p = turn * p * 2.02 + vec2(1.7, 9.2);
    strength *= 0.5;
  }
  return total;
}

void main() {
  // ── Block 1: coordinates. Where is this pixel, independent of screen shape? ─────────────────────
  // uv runs 0..1 across the screen (used for the vertical fade).
  vec2 uv = gl_FragCoord.xy / u_resolution;
  // p is centred on the screen and scaled by its height, so a circle stays a circle on a wide
  // monitor and on a tall phone. The short axis runs -0.5..0.5.
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float t = u_time;

  // ── Block 3: the cursor gently bends the flow ───────────────────────────────────────────────────
  // Put the pointer in the same centred space as p.
  vec2 mouse = (u_mouse - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 toMouse = mouse - p;
  // pull is 1 right under the cursor and fades smoothly to 0 about a third of the screen away.
  float pull = exp(-dot(toMouse, toMouse) * 6.0);
  // Move this pixel's lookup point up to 8% of the way toward the cursor, so the ribbons lean in.
  p += toMouse * pull * 0.08;
  // A slight whole-scene tilt with the pointer, like looking at a sheet from a new angle.
  p += (u_mouse - 0.5) * 0.06;

  // ── Block 2: the flow field ──────────────────────────────────────────────────────────────────────
  // Domain warping: noise decides where to read more noise. q is a slowly drifting offset.
  vec2 q = vec2(fbm(p * 1.6 + vec2(0.0, t * 0.05)), fbm(p * 1.6 + vec2(5.2, 1.3) - t * 0.04));
  // The ribbons: noise read through that offset, so it swirls instead of sliding.
  float ribbons = fbm(p * 2.2 + q * 1.4 + vec2(0.0, t * 0.03));
  // The ledger sheet: about 18 thin horizontal rules across the screen, bent by the same flow.
  float ruleY = fract((p.y + (q.x - 0.5) * 0.18) * 18.0);
  float rule = 1.0 - smoothstep(0.0, 0.06, abs(ruleY - 0.5));

  // ── Block 4: colour and grain ────────────────────────────────────────────────────────────────────
  // Base: slate-950 at the bottom fading to slate-900 at the top, with slate-800 where ribbons gather.
  vec3 color = mix(SLATE_950, SLATE_900, uv.y);
  color = mix(color, SLATE_800, smoothstep(0.35, 0.70, ribbons) * 0.60);
  // Cloud cobalt in the thicker folds, verification emerald only where the folds overlap the most.
  color = mix(color, SKY_600, smoothstep(0.50, 0.80, ribbons) * 0.22);
  float overlap = smoothstep(0.55, 0.85, ribbons * q.x * 1.7);
  color = mix(color, mix(EMERALD_600, EMERALD_500, q.y), overlap * 0.30);
  // The ruled lines, faint: a ledger you notice on the second look.
  color += SKY_400 * rule * 0.035;
  // Film grain: a tiny per-pixel flicker (±1%) that breaks up colour banding on 8-bit screens.
  float grain = hash(gl_FragCoord.xy + fract(t * 7.0) * 113.0) - 0.5;
  color += grain * 0.02;

  // ── Block 5: vignette and the contrast cap ───────────────────────────────────────────────────────
  // Darken toward the edges, so the eye stays on the centred text.
  float vignette = smoothstep(1.15, 0.20, length(p * vec2(0.85, 1.25)));
  color *= mix(0.55, 1.0, vignette);
  // Never brighter than 0.36 in any channel: the guarantee that keeps text readable over the scrim.
  color = min(color, vec3(0.36));
  gl_FragColor = vec4(color, 1.0);
}
`

/** The highest value any channel can reach (Block 5). The contrast test in e2e relies on it. */
export const MAX_CHANNEL = 0.36

/** Device pixel ratio cap: a 3x phone renders (1.5 / 3)² = a quarter of its native pixels. */
export const MAX_DPR = 1.5

export function clampDpr(devicePixelRatio: number | undefined): number {
  const dpr = devicePixelRatio === undefined || !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0 ? 1 : devicePixelRatio
  return Math.min(dpr, MAX_DPR)
}

export type ShaderSetup =
  | { readonly ok: true; readonly renderer: ShaderRenderer }
  | { readonly ok: false; readonly reason: string }

export interface ShaderRenderer {
  /** Resize the drawing buffer to the canvas's CSS size × the capped DPR. Returns the buffer size. */
  resize: (cssWidth: number, cssHeight: number, devicePixelRatio: number) => readonly [number, number]
  /** Draw one frame. `mouse` is 0..1 on both axes, origin bottom-left (GL convention). */
  render: (timeSeconds: number, mouse: readonly [number, number]) => void
  /** Free the program, buffer and context. */
  dispose: () => void
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | string {
  const shader = gl.createShader(type)
  if (shader === null) return 'createShader returned null'
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    const log = gl.getShaderInfoLog(shader) ?? 'no log'
    gl.deleteShader(shader)
    return `${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader did not compile: ${log.trim()}`
  }
  return shader
}

/**
 * Sets up WebGL on `canvas` and returns a renderer, or the reason it could not: no WebGL, a compile
 * error (with the driver's log), or a link error. The caller shows the static fallback on failure.
 */
export function createLedgerAuroraRenderer(canvas: HTMLCanvasElement): ShaderSetup {
  let gl: WebGLRenderingContext | null = null
  try {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false })
  } catch {
    gl = null
  }
  if (gl === null) return { ok: false, reason: 'WebGL is not available in this browser.' }
  const ctx = gl

  const vertex = compile(ctx, ctx.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
  if (typeof vertex === 'string') return { ok: false, reason: vertex }
  const fragment = compile(ctx, ctx.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)
  if (typeof fragment === 'string') {
    ctx.deleteShader(vertex)
    return { ok: false, reason: fragment }
  }
  const program = ctx.createProgram()
  if (program === null) return { ok: false, reason: 'createProgram returned null' }
  ctx.attachShader(program, vertex)
  ctx.attachShader(program, fragment)
  ctx.linkProgram(program)
  // The program keeps what it needs; the separate shader objects can go.
  ctx.deleteShader(vertex)
  ctx.deleteShader(fragment)
  if (ctx.getProgramParameter(program, ctx.LINK_STATUS) !== true) {
    const log = ctx.getProgramInfoLog(program) ?? 'no log'
    ctx.deleteProgram(program)
    return { ok: false, reason: `program did not link: ${log.trim()}` }
  }

  // One triangle that covers the whole screen: (-1,-1), (3,-1), (-1,3).
  const buffer = ctx.createBuffer()
  ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer)
  ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW)
  ctx.useProgram(program)
  const position = ctx.getAttribLocation(program, 'a_position')
  ctx.enableVertexAttribArray(position)
  ctx.vertexAttribPointer(position, 2, ctx.FLOAT, false, 0, 0)

  const uTime = ctx.getUniformLocation(program, 'u_time')
  const uResolution = ctx.getUniformLocation(program, 'u_resolution')
  const uMouse = ctx.getUniformLocation(program, 'u_mouse')

  return {
    ok: true,
    renderer: {
      resize: (cssWidth, cssHeight, devicePixelRatio) => {
        const dpr = clampDpr(devicePixelRatio)
        const width = Math.max(1, Math.round(cssWidth * dpr))
        const height = Math.max(1, Math.round(cssHeight * dpr))
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
        ctx.viewport(0, 0, width, height)
        ctx.uniform2f(uResolution, width, height)
        return [width, height] as const
      },
      render: (timeSeconds, mouse) => {
        ctx.uniform1f(uTime, timeSeconds)
        ctx.uniform2f(uMouse, mouse[0], mouse[1])
        ctx.drawArrays(ctx.TRIANGLES, 0, 3)
      },
      dispose: () => {
        ctx.deleteBuffer(buffer)
        ctx.deleteProgram(program)
        ctx.getExtension('WEBGL_lose_context')?.loseContext()
      },
    },
  }
}

/**
 * The static fallback: the same palette as one still CSS gradient. Used when reduced motion is on,
 * when the low-power toggle is pressed, or when WebGL fails. No canvas, no animation loop.
 */
export const STATIC_FALLBACK_BACKGROUND = [
  'radial-gradient(60% 50% at 30% 35%, rgba(5, 150, 105, 0.16), transparent 70%)',
  'radial-gradient(55% 45% at 72% 60%, rgba(2, 132, 199, 0.14), transparent 70%)',
  'linear-gradient(180deg, #0f172a 0%, #020617 100%)',
].join(', ')

/** The reduced-motion / performance one-liner, shown on /shader-hero and quoted in the docs. */
export const FALLBACK_ONE_LINER =
  'With reduced motion on or no WebGL, the hero shows a still gradient in the same colours and never starts the loop; otherwise it renders at no more than 1.5x pixel ratio and pauses whenever the tab is hidden or the hero is off-screen.'
