# FE-AA2 · Your First 3D Experience on the Web: POS & Ledger Vault Inspector

- **Live:** https://microcredit-api-beta.vercel.app/3d-lab, plus the inspector card at the bottom of
  https://microcredit-api-beta.vercel.app/
- **Code:** [`src/features/three-d/`](../src/features/three-d/):
  - [`Vault3DCanvas.tsx`](../src/features/three-d/Vault3DCanvas.tsx), the WebGL viewport;
  - [`Vault3DConfigurator.tsx`](../src/features/three-d/Vault3DConfigurator.tsx), the control panel;
  - [`LazyVault3DCanvas.tsx`](../src/features/three-d/LazyVault3DCanvas.tsx), the only door to `three`.
- **Tests:**
  - [`Vault3DConfigurator.test.tsx`](../src/features/three-d/__tests__/Vault3DConfigurator.test.tsx) (10);
  - [`threeDPipeline.test.ts`](../src/features/three-d/__tests__/threeDPipeline.test.ts) (9);
  - [`e2e/three-d-lab.spec.ts`](../e2e/three-d-lab.spec.ts) (6 browser checks).

**How it ties to the One Claim.** The terminal acts out the two outcomes the Disburse sandbox returns:
- **Simulate 201 Disbursed** spins the security ring emerald and raises a `201 · ₱5,000.00` badge.
- **Simulate 409 Conflict** pulses the ring rose and drops a vault shutter over a screen that reads
  `If-Match "3" is stale`.

It is coursework, like `/motion-lab`. It proves nothing about duplicate payouts on its own; the `/`
sandbox does that. It sits below the fold on `/`, under the Disburse demo.

---

## 1 · What we built

| Requirement | Where | What it does |
| --- | --- | --- |
| A real 3D WebGL scene | `Vault3DCanvas.tsx`, `terminalModel.ts` | A POS terminal built from primitives at run time: rounded metal chassis, keypad (one instanced mesh), NFC shield and ring, an extruded hexagonal "centavo" security core, three ledger nodes (debit, credit, balance), a holo-badge and a vault shutter. The screen and badge are canvas textures. PBR lighting from a PMREM-filtered `RoomEnvironment`. |
| `.glb` / `.gltf` loading | `glbPipeline.ts` | Drop a file on the viewport, or use the file input. `GLTFLoader` + `DRACOLoader` parse it. `Box3` centres it and scales its longest side to 2.2 units, resting on the floor. The 25 MB limit and the `glTF` header are checked before parsing. |
| 1-click sample `.glb` | `exportGlb()` | `GLTFExporter` exports a fresh terminal (current paint and module) as a binary `.glb`, then loads it back through the same loader. It also offers the file as a download, so the drop path can be tested with a real file. |
| Custom configurator (the flex path, not Leva) | `Vault3DConfigurator.tsx` | Labelled native inputs, each with `aria-invalid` and a hint (CLAUDE.md §11 rule 1): <br>• 5 chassis swatches plus a colour picker <br>• metalness and roughness sliders <br>• a wireframe switch <br>• the NFC or printer module <br>• 3 lighting presets <br>• an auto-rotate speed slider <br>• a pointer-tilt switch <br>• the 201 / 409 / idle triggers |
| Direct 3D interaction | `Vault3DCanvas.tsx` | `OrbitControls`: one finger orbits, two fingers pinch-zoom; arrow keys pan once the canvas has focus. Pointer tilt leans the model toward the pointer. |
| Static fallback | `StaticBlueprint.tsx` | An isometric SVG blueprint that follows the same paint, module and 201 / 409 state. Shown for `prefers-reduced-motion: reduce`, the on-page low-power switch, or no WebGL. WebGL is never created in those cases. |
| FE-10 Performance Lens | the HUD above the viewport | FPS, frame time and render CPU time, draw calls and triangles, DPR applied vs. device, ms to first frame, and the lazy chunk's compressed and decoded size. |
| Capstone integration | `/3d-lab`, nav link, `Vault3DInspectorCard.tsx` on `/` | The card starts as the blueprint with working 201 / 409 buttons. It fetches Three.js only when "Load the 3D inspector" is pressed. |

**Why plain `three`, not `@react-three/fiber` / drei.** Both would run on React 19. I chose one imperative
`useEffect` for three reasons:
- it adds no peer-dependency chain;
- the chunk holds only `three` and the four example modules used (OrbitControls, GLTFLoader, DRACOLoader,
  GLTFExporter);
- every `dispose()` sits in one cleanup that a test can check.

The cost: no declarative scene graph. Each config change is applied by a small effect instead.

---

## 2 · The FE-10 Performance Lens note

All numbers are from `npm run build` + `next start` on the build container, with Playwright Chromium
headless. They are not from a phone or a real GPU (see TODO below).

| What | How it was built | Measured |
| --- | --- | --- |
| Three.js stays off `/` and `/underwriting` | `LazyVault3DCanvas` is `next/dynamic(() => import('./Vault3DCanvas.tsx'), { ssr: false })`. Nothing else imports `three`; `vaultConfig.ts` and the blueprint are three-free. | `e2e/three-d-lab.spec.ts` reads every script response: 0 contain `WebGLRenderer` on `/underwriting` or on `/`. On `/` exactly 1 arrives after "Load the 3D inspector" is pressed. |
| One lazy chunk | The dynamic import resolves to one chunk: `three`, the loaders, the exporter and the terminal. | 1 file, 180.4 KB compressed (gzip from `next start`), 715.4 KB of JavaScript (732,474 bytes). |
| The chunk never blocks the page | It is requested after hydration. | 5 cold loads of `/3d-lab`: `load` event at 102–136 ms; chunk requested at 133–186 ms, done by 170–240 ms; first frame 244–319 ms after the canvas mounts. All on localhost, so no network latency. |
| 0 network bytes for the model | The terminal is built from primitives; its only textures are drawn on canvases. | No model, texture or HDR request. The 245 KB Draco decoder in `public/draco/` is fetched only for a Draco-compressed file. |
| DPR clamp `[1, 1.5]` | `renderer.setPixelRatio(min(1.5, max(1, devicePixelRatio)))`, re-checked on every resize. | e2e: a 390×844 context at `deviceScaleFactor: 3` renders a drawing buffer 1.5× its CSS size, and the HUD reads `1.5x of 3x`. A 3x phone draws 2.25 pixels per CSS pixel instead of 9. |
| Phone-safe input | `touch-action: none` on the canvas; `OrbitControls` defaults (one finger rotates, two dolly/pan). | e2e checks the computed `touch-action`. 375 px and 1280 px: 0 px horizontal overflow (`e2e/fold.mjs`). |
| Scene cost | 1 instanced mesh for 12 keys; no shadows. A ground "shadow" is one textured plane. | 13 draw calls, 7,632 triangles (NFC module). Render CPU 0.23–0.42 ms per frame. |
| Nothing runs off-screen | `setAnimationLoop` stops when an `IntersectionObserver` reports the canvas off-screen, or the tab is hidden. | Code path; not timed. |
| Disposal | One cleanup frees all of this: <br>• the loop, both observers and all listeners <br>• `OrbitControls` and the Draco worker <br>• every geometry, material and texture <br>• the lights and the PMREM target <br>• `renderer.dispose()` and `forceContextLoss()` | e2e: after the switch to the blueprint, the canvas's `WebGL2RenderingContext.isContextLost()` is `true`. Vitest: `disposeObject` calls `dispose()` on a geometry, material and texture. Mutation check: dropping the texture dispose fails that test. |
| Reduced motion / low power | `usePrefersReducedMotion()` (shared with FE-AA1), the low-power switch, or `getContext('webgl2' / 'webgl') === null` → SVG blueprint. | e2e with `emulateMedia({ reducedMotion: 'reduce' })`: blueprint shown, 0 canvases, 0 scripts containing `WebGLRenderer`. |

**Frame rate: TODO, not measured.** Headless Chromium here renders WebGL through SwiftShader, a CPU
emulation of the GPU. It shows 38–45 FPS with a 22–26 ms frame interval, even though the scene's own
CPU work is under 0.5 ms a frame. That number says nothing about a laptop or a phone. To fill it in:
1. open `/3d-lab` on a desktop browser and on a mid-range Android phone;
2. leave it running for 10 seconds;
3. copy the HUD's FPS and "Frame / render" values here, with the device names.

**Live network numbers: TODO.** The sizes above are `next start` gzip. Vercel serves Brotli, so the
live chunk will be smaller. Measure it in the live HUD after deploy.

**Draco: TODO.** The decoder is wired and served (`/draco/draco_decoder.wasm` answers 200, 192,420
bytes), but no test drops a Draco-compressed `.glb` yet.

---

## 3 · What we'd add with more time

- **Bloom on the NFC ring.** `UnrealBloomPass` on the emerald ring only, through a selective-bloom
  layer, so the 201 glow reads at a glance. It costs an extra render target and two blur passes, so it
  would be off under the low-power switch.
- **KTX2 texture streaming.** Basis Universal (`KTX2Loader`) for dropped models that carry textures,
  for smaller GPU memory on phones. The procedural terminal has no image textures, so it gains nothing.
- **WebXR AR preview.** "View on your counter": WebXR `immersive-ar` on Android Chrome, plus an
  exported USDZ for iOS Quick Look, so a sari-sari store owner can see the terminal at real size.

---

## 4 · Where this departs from the brief, and why

| Brief | Shipped | Why |
| --- | --- | --- |
| `@react-three/fiber` / drei, or plain Three.js | Plain `three` 0.187.0 | See §1: no peer chain, one disposal path. |
| Motion over 150 ms (auto-rotate, ring spin, pulses) | A scoped exception for the `/3d-lab` canvas, in CLAUDE.md §12 rule 4 and `PORTFOLIO_DESIGN_SYSTEM.md` | §12 caps motion at 150 ms and allows one looping animation. Auto-rotate defaults to 0, so nothing loops until a viewer asks; the state motions run once (≤ 1.75 s) and hold. Reduced motion gets the still SVG. |
| A "crimson" 409, an "emerald/amber" ring | 409 is rose `#e11d48`. The ring is slate at idle, amber only for the 350 ms "request in flight", emerald on 201. | §12 rule 2: rose is the bounce colour, amber is Simulate / replay, green only next to a pass. |
| Chassis swatches `0284C7`, `D97706` | Kept | They are Tailwind `sky-600` and `amber-600`, families §12 allows. On the model they are paint, not UI signals, and each is named in text. |
| 60 FPS desktop / smooth mobile | Not claimed | Not measured on real hardware (§2 TODO). |
| Embed in `/portfolio` too | `/` only | `/portfolio` follows the 4-section content map in `docs/THE_THROUGH_LINE.md`; a coursework 3D card is not one of them. |
| `.gltf` drag-and-drop | Self-contained `.gltf` only | A dropped `.gltf` arrives without its `.bin` and textures. The loader explains this and suggests a `.glb`. |
| Reduced motion with a toggle | The switch is locked on under `prefers-reduced-motion` | The system setting wins; the viewer still sees the blueprint follow every control. |

---

## 5 · Checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 (`public/draco/**` is ignored: vendored, minified decoder) |
| `npm test` | 516/516 across 29 files (19 new) |
| `npm run build` | exit 0; `/3d-lab` prerendered as static |
| `npm run test:e2e` | 12/12 (6 new in `e2e/three-d-lab.spec.ts`) |
| `npm run test:e2e:fold` | 67/67 (`/3d-lab` added at 375 px and 1280 px) |
| `npm run agent:eval` | 6/6 |
| CLAUDE.md §11 money grep, §12 colour grep, FE-09 test-id grep | print nothing |

The §11 grep caught a real problem before commit:
- `toFixed()` on the slider read-outs, and a `* 100) / 100` rounding in the telemetry, matched the
  money grep.
- SentinelScout's `audit_centavos_and_idempotency` tool uses that grep, so 3 agent tests failed with
  `INVARIANT_FAIL`.
- Display numbers now go through `formatDecimal()` (`Intl.NumberFormat`).

Mutation checks, each reverted:
- Removing `texture.dispose()` fails the disposal test.
- Raising the DPR clamp to 3 fails the "3x screen renders at 1.5x" browser check.
