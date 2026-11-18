'use client'

/**
 * FE-AA2 · the WebGL viewport. Loaded only through `LazyVault3DCanvas` (next/dynamic, ssr: false),
 * so `three` and everything below ship in a chunk that no other route requests.
 *
 * One effect builds the scene and returns one cleanup that frees it: the render loop, observers,
 * listeners, OrbitControls, the Draco decoder, every geometry / material / texture, the PMREM
 * environment, and the WebGL context itself.
 *
 * Phone safety: device pixel ratio clamped to [1, 1.5], `touch-action: none` so one finger orbits
 * and two pinch-zoom without scrolling the page, and the loop stops while the canvas is off-screen
 * or the tab is hidden.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { applyFinish, countTriangles, createGlbPipeline, disposeObject, exportGlb, fitToStage, type GlbPipeline } from './glbPipeline.ts'
import { measureLazyChunks } from './lazyMark.ts'
import { applyTerminalFinish, buildTerminal, poseTerminal, showModule, type TerminalParts } from './terminalModel.ts'
import { DPR_RANGE, type LightingPreset, type ModelFile, type ModelStatus, type Telemetry, type TerminalState, type VaultConfig } from './vaultConfig.ts'

export interface Vault3DCanvasProps {
  readonly config: VaultConfig
  /** A dropped or generated model. `null` shows the procedural terminal. */
  readonly model: ModelFile | null
  /** Bump to export the terminal as a .glb; the bytes come back through `onSample`. */
  readonly sampleRequest: number
  readonly label: string
  readonly onTelemetry?: (telemetry: Telemetry) => void
  readonly onModelStatus?: (status: ModelStatus) => void
  readonly onSample?: (bytes: ArrayBuffer) => void
}

function clampDpr(): number {
  const device = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return Math.min(DPR_RANGE[1], Math.max(DPR_RANGE[0], device))
}

interface Lighting {
  readonly group: THREE.Group
  readonly background: string
  readonly environment: number
  readonly exposure: number
}

function buildLighting(preset: LightingPreset): Lighting {
  const group = new THREE.Group()
  const dir = (color: string, intensity: number, x: number, y: number, z: number): void => {
    const light = new THREE.DirectionalLight(color, intensity)
    light.position.set(x, y, z)
    group.add(light)
  }
  switch (preset) {
    case 'fintech-studio':
      group.add(new THREE.HemisphereLight('#ffffff', '#cbd5e1', 0.9))
      dir('#ffffff', 2.2, 3, 5, 4)
      dir('#e2e8f0', 0.7, -4, 2, 2)
      return { group, background: '#f8fafc', environment: 0.9, exposure: 1 }
    case 'cyber-vault':
      group.add(new THREE.HemisphereLight('#1e293b', '#020617', 0.35))
      dir('#cbd5e1', 0.8, 2, 4, 4)
      dir('#10b981', 2.6, -3, 2, -3)
      dir('#38bdf8', 2, 3, 1.5, -2)
      return { group, background: '#0f172a', environment: 0.35, exposure: 1.1 }
    case 'warm-daylight':
      group.add(new THREE.HemisphereLight('#fef3c7', '#78350f', 0.7))
      dir('#fde68a', 2.8, -5, 4, 2)
      dir('#ffffff', 0.4, 3, 2, 4)
      return { group, background: '#fffbeb', environment: 0.8, exposure: 1 }
  }
}

function groundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx !== null) {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
    g.addColorStop(0, 'rgba(15, 23, 42, 0.42)')
    g.addColorStop(1, 'rgba(15, 23, 42, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
  }
  return new THREE.CanvasTexture(canvas)
}

interface Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly tilt: THREE.Group
  readonly terminal: TerminalParts
  readonly pipeline: GlbPipeline
  lighting: Lighting
  custom: THREE.Group | null
  controls: OrbitControls
  state: TerminalState
  stateNonce: number
  enteredAt: number
}

export function Vault3DCanvas({ config, model, sampleRequest, label, onTelemetry, onModelStatus, onSample }: Vault3DCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Stage | null>(null)
  const configRef = useRef(config)
  const labelRef = useRef(label)
  const callbacks = useRef({ onTelemetry, onModelStatus, onSample })

  useEffect(() => {
    configRef.current = config
    labelRef.current = label
    callbacks.current = { onTelemetry, onModelStatus, onSample }
  })

  // Build once, free everything on unmount.
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const mountedAt = performance.now()
    const initial = configRef.current

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(clampDpr())
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    const canvas = renderer.domElement
    canvas.style.touchAction = 'none'
    canvas.className = 'block size-full rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', labelRef.current)
    canvas.tabIndex = 0
    host.appendChild(canvas)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const envTarget = pmrem.fromScene(room, 0.04)
    room.dispose()
    scene.environment = envTarget.texture

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50)
    camera.position.set(3.2, 2.5, 4.3)
    const controls = new OrbitControls(camera, canvas)
    controls.target.set(0.2, 1.05, 0)
    controls.enableDamping = true
    controls.minDistance = 2.4
    controls.maxDistance = 9
    controls.maxPolarAngle = Math.PI * 0.48
    // Arrow keys pan once the canvas has focus; the configurator covers everything else by keyboard.
    controls.listenToKeyEvents(canvas)
    controls.update()

    const tilt = new THREE.Group()
    scene.add(tilt)
    const terminal = buildTerminal(initial.chassisColor)
    tilt.add(terminal.root)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 3.6),
      new THREE.MeshBasicMaterial({ map: groundTexture(), transparent: true, depthWrite: false }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = 0.002
    scene.add(ground)

    const lighting = buildLighting(initial.lighting)
    scene.add(lighting.group)
    scene.background = new THREE.Color(lighting.background)
    scene.environmentIntensity = lighting.environment
    renderer.toneMappingExposure = lighting.exposure

    const stage: Stage = {
      renderer,
      scene,
      tilt,
      terminal,
      pipeline: createGlbPipeline(),
      lighting,
      custom: null,
      controls,
      state: 'idle',
      stateNonce: initial.stateNonce,
      enteredAt: 0,
    }
    stageRef.current = stage

    // Size to the host box. The canvas fills it through CSS; the drawing buffer follows the clamped DPR.
    const resize = (): void => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setPixelRatio(clampDpr())
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)

    // Pointer tilt: a small lean toward the pointer, eased every frame.
    const tiltTarget = { x: 0, y: 0 }
    const onPointerMove = (event: PointerEvent): void => {
      if (!configRef.current.pointerTilt || event.buttons !== 0) return
      const rect = host.getBoundingClientRect()
      tiltTarget.y = ((event.clientX - rect.left) / rect.width - 0.5) * 0.35
      tiltTarget.x = ((event.clientY - rect.top) / rect.height - 0.5) * 0.18
    }
    const onPointerLeave = (): void => {
      tiltTarget.x = 0
      tiltTarget.y = 0
    }
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerleave', onPointerLeave)

    // Telemetry, sampled every 500 ms.
    const meter: {
      frames: number
      windowStart: number
      renderTotal: number
      firstFrameMs: number | null
      lazy: { readonly bytes: number; readonly decodedBytes: number; readonly count: number } | null
    } = { frames: 0, windowStart: performance.now(), renderTotal: 0, firstFrameMs: null, lazy: null }

    const frame = (time: number): void => {
      controls.autoRotate = configRef.current.autoRotateSpeed > 0
      controls.autoRotateSpeed = configRef.current.autoRotateSpeed
      controls.update()
      const tx = configRef.current.pointerTilt ? tiltTarget.x : 0
      const ty = configRef.current.pointerTilt ? tiltTarget.y : 0
      tilt.rotation.x += (tx - tilt.rotation.x) * 0.08
      tilt.rotation.y += (ty - tilt.rotation.y) * 0.08
      if (stage.custom === null) poseTerminal(terminal, stage.state, time - stage.enteredAt)

      const t0 = performance.now()
      renderer.render(scene, camera)
      const t1 = performance.now()
      meter.renderTotal += t1 - t0
      meter.frames += 1

      if (meter.firstFrameMs === null) {
        meter.firstFrameMs = t1 - mountedAt
        meter.lazy = measureLazyChunks()
      }
      const elapsed = t1 - meter.windowStart
      if (elapsed >= 500) {
        const { frames, renderTotal, firstFrameMs, lazy } = meter
        callbacks.current.onTelemetry?.({
          fps: Math.round((frames * 1000) / elapsed),
          frameMs: elapsed / frames,
          renderMs: renderTotal / frames,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          dpr: renderer.getPixelRatio(),
          deviceDpr: window.devicePixelRatio || 1,
          firstFrameMs: Math.round(firstFrameMs),
          lazyChunkBytes: lazy?.bytes ?? null,
          lazyChunkDecodedBytes: lazy?.decodedBytes ?? null,
          lazyChunkCount: lazy?.count ?? 0,
        })
        meter.frames = 0
        meter.renderTotal = 0
        meter.windowStart = t1
      }
    }

    // Run only while the canvas is on screen and the tab is visible.
    const view = { onScreen: true }
    const sync = (): void => {
      const run = view.onScreen && document.visibilityState === 'visible'
      renderer.setAnimationLoop(run ? frame : null)
      if (run) {
        meter.frames = 0
        meter.renderTotal = 0
        meter.windowStart = performance.now()
      }
    }
    const intersection = new IntersectionObserver((entries) => {
      view.onScreen = entries.some((entry) => entry.isIntersecting)
      sync()
    })
    intersection.observe(host)
    document.addEventListener('visibilitychange', sync)
    sync()

    return () => {
      renderer.setAnimationLoop(null)
      intersection.disconnect()
      resizeObserver.disconnect()
      document.removeEventListener('visibilitychange', sync)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerleave', onPointerLeave)
      controls.dispose()
      stage.pipeline.dispose()
      disposeObject(scene)
      stage.lighting.group.traverse((child) => {
        if (child instanceof THREE.Light) child.dispose()
      })
      envTarget.dispose()
      pmrem.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      stageRef.current = null
    }
    // Built once. `label` only seeds the first aria-label; the effect below keeps it current.
  }, [])

  useEffect(() => {
    stageRef.current?.renderer.domElement.setAttribute('aria-label', label)
  }, [label])

  // Finish, module, lighting and state: applied to the live scene, no rebuild.
  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    applyTerminalFinish(stage.terminal, config)
    if (stage.custom !== null) applyFinish(stage.custom, config)
    showModule(stage.terminal, config.module)
  }, [config])

  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    stage.scene.remove(stage.lighting.group)
    stage.lighting.group.traverse((child) => {
      if (child instanceof THREE.Light) child.dispose()
    })
    const lighting = buildLighting(config.lighting)
    stage.lighting = lighting
    stage.scene.add(lighting.group)
    stage.scene.background = new THREE.Color(lighting.background)
    stage.scene.environmentIntensity = lighting.environment
    stage.renderer.toneMappingExposure = lighting.exposure
  }, [config.lighting])

  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    if (stage.state === config.terminalState && stage.stateNonce === config.stateNonce) return
    stage.state = config.terminalState
    stage.stateNonce = config.stateNonce
    stage.enteredAt = performance.now()
    stage.terminal.screen.draw(config.terminalState)
  }, [config.terminalState, config.stateNonce])

  // A dropped / generated model replaces the terminal; `null` brings the terminal back.
  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    const guard = { cancelled: false }
    const clearCustom = (): void => {
      if (stage.custom === null) return
      stage.tilt.remove(stage.custom)
      disposeObject(stage.custom)
      stage.custom = null
    }
    if (model === null) {
      clearCustom()
      stage.terminal.root.visible = true
      callbacks.current.onModelStatus?.({ kind: 'procedural' })
      return
    }
    callbacks.current.onModelStatus?.({ kind: 'loading', name: model.name })
    stage.pipeline.parse(model.bytes).then(
      (parsed) => {
        if (guard.cancelled || stageRef.current !== stage) {
          disposeObject(parsed.object)
          return
        }
        clearCustom()
        const staged = fitToStage(parsed.object)
        applyFinish(staged, configRef.current)
        stage.custom = staged
        stage.tilt.add(staged)
        stage.terminal.root.visible = false
        callbacks.current.onModelStatus?.({
          kind: 'loaded',
          name: model.name,
          bytes: model.bytes.byteLength,
          triangles: countTriangles(staged),
          draco: parsed.draco,
        })
      },
      (error: unknown) => {
        if (guard.cancelled) return
        const reason = error instanceof Error ? error.message : 'unknown error'
        callbacks.current.onModelStatus?.({
          kind: 'error',
          name: model.name,
          message: `GLTFLoader could not read it (${reason}). A .gltf must embed its buffers and textures; a .glb always does.`,
        })
      },
    )
    return () => {
      guard.cancelled = true
    }
  }, [model])

  // Export a fresh terminal (current paint and module, idle pose) as a binary .glb.
  useEffect(() => {
    if (sampleRequest === 0) return
    const stage = stageRef.current
    if (stage === null) return
    const current = configRef.current
    const sample = buildTerminal(current.chassisColor)
    sample.chassisMaterial.metalness = current.metalness
    sample.chassisMaterial.roughness = current.roughness
    showModule(sample, current.module)
    poseTerminal(sample, 'idle', 0)
    const guard = { cancelled: false }
    exportGlb(sample.root).then(
      (bytes) => {
        disposeObject(sample.root)
        if (!guard.cancelled) callbacks.current.onSample?.(bytes)
      },
      (error: unknown) => {
        disposeObject(sample.root)
        if (guard.cancelled) return
        callbacks.current.onModelStatus?.({
          kind: 'error',
          name: 'microcredit-pos-sample.glb',
          message: `GLTFExporter failed (${error instanceof Error ? error.message : 'unknown error'}).`,
        })
      },
    )
    return () => {
      guard.cancelled = true
    }
  }, [sampleRequest])

  return <div ref={hostRef} className="size-full" />
}
