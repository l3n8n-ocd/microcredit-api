/**
 * FE-AA2 · the Three.js side that needs no GPU: the .glb round trip, auto-centring and scaling,
 * disposal, the 201 / 409 poses, and the file pre-checks. Runs in jsdom with real `three` objects.
 */
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STAGE_SIZE, countTriangles, createGlbPipeline, disposeObject, exportGlb, fitToStage } from '../glbPipeline.ts'
import { IN_FLIGHT_MS, STATE_MOTION_MS, applyTerminalFinish, buildTerminal, poseTerminal, showModule } from '../terminalModel.ts'
import { checkModelFile, formatBytes } from '../vaultConfig.ts'

beforeEach(() => {
  // jsdom has no 2D canvas; the screen and badge textures simply stay blank.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('.glb round trip', () => {
  it('exports a binary glTF that the loader reads back with the same triangle count', async () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial({ color: '#1e293b' }))
    const bytes = await exportGlb(mesh)
    expect(checkModelFile('sample.glb', bytes)).toEqual({ ok: true })

    const pipeline = createGlbPipeline()
    const parsed = await pipeline.parse(bytes)
    expect(parsed.draco).toBe(false)
    expect(countTriangles(parsed.object)).toBe(12)
    pipeline.dispose()
  })

  it('a .glb with a corrupt body is rejected by the loader, not staged', async () => {
    const pipeline = createGlbPipeline()
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]).buffer
    await expect(pipeline.parse(bytes)).rejects.toThrow()
    pipeline.dispose()
  })
})

describe('fitToStage', () => {
  it('scales the longest side to the stage size, centres x / z, and rests the model on y = 0', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 2))
    mesh.position.set(50, -20, 7)
    const staged = fitToStage(mesh)
    staged.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(staged)
    const size = box.getSize(new THREE.Vector3())
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(STAGE_SIZE, 6)
    expect(box.min.y).toBeCloseTo(0, 6)
    const center = box.getCenter(new THREE.Vector3())
    expect(center.x).toBeCloseTo(0, 6)
    expect(center.z).toBeCloseTo(0, 6)
  })
})

describe('disposeObject', () => {
  it('frees every geometry, material and texture under the object', () => {
    const texture = new THREE.Texture()
    const material = new THREE.MeshStandardMaterial({ map: texture })
    const geometry = new THREE.BoxGeometry()
    const group = new THREE.Group()
    group.add(new THREE.Mesh(geometry, material))
    const spies = [vi.spyOn(geometry, 'dispose'), vi.spyOn(material, 'dispose'), vi.spyOn(texture, 'dispose')]
    disposeObject(group)
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('the procedural terminal', () => {
  it('swaps modules and applies the finish to the chassis and wireframe to every part', () => {
    const parts = buildTerminal('#1e293b')
    expect(parts.nfcModule.visible).toBe(true)
    expect(parts.printerModule.visible).toBe(false)
    showModule(parts, 'printer')
    expect(parts.nfcModule.visible).toBe(false)
    expect(parts.printerModule.visible).toBe(true)

    applyTerminalFinish(parts, { chassisColor: '#0284c7', metalness: 0.2, roughness: 0.9, wireframe: true })
    expect(`#${parts.chassisMaterial.color.getHexString()}`).toBe('#0284c7')
    expect(parts.chassisMaterial.metalness).toBe(0.2)
    expect(parts.chassisMaterial.roughness).toBe(0.9)
    expect(parts.detailMaterials.every((m) => m.wireframe)).toBe(true)
    disposeObject(parts.root)
  })

  it('201: amber while in flight, then two ring turns, emerald glow and the badge raised; then still', () => {
    const parts = buildTerminal('#1e293b')
    expect(poseTerminal(parts, 'disbursed', IN_FLIGHT_MS / 2)).toBe(true)
    expect(`#${parts.ring.material.emissive.getHexString()}`).toBe('#f59e0b')

    const settled = IN_FLIGHT_MS + STATE_MOTION_MS.disbursed + 1
    expect(poseTerminal(parts, 'disbursed', settled)).toBe(false)
    expect(parts.ring.rotation.z).toBeCloseTo(Math.PI * 4, 6)
    expect(`#${parts.ring.material.emissive.getHexString()}`).toBe('#10b981')
    expect(parts.badge.visible).toBe(true)
    expect(parts.badge.material.opacity).toBe(1)
    expect(parts.shutter.scale.y).toBeLessThan(0.01)
    disposeObject(parts.root)
  })

  it('409: rose glow, no badge, and the vault shutter stays down', () => {
    const parts = buildTerminal('#1e293b')
    expect(poseTerminal(parts, 'conflict', IN_FLIGHT_MS + STATE_MOTION_MS.conflict + 1)).toBe(false)
    expect(`#${parts.ring.material.emissive.getHexString()}`).toBe('#e11d48')
    expect(parts.badge.visible).toBe(false)
    expect(parts.shutter.scale.y).toBe(1)

    poseTerminal(parts, 'idle', 0)
    expect(parts.shutter.scale.y).toBeLessThan(0.01)
    expect(parts.ring.rotation.z).toBe(0)
    disposeObject(parts.root)
  })
})

describe('checkModelFile and formatBytes', () => {
  it('rejects wrong extensions, empty and oversized files, and bad headers', () => {
    const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46]).buffer
    expect(checkModelFile('a.obj', glb)).toEqual({ ok: false, reason: 'Only .glb or .gltf files load here.' })
    expect(checkModelFile('a.glb', new ArrayBuffer(0))).toEqual({ ok: false, reason: 'The file is empty.' })
    expect(checkModelFile('a.glb', new ArrayBuffer(25 * 1024 * 1024 + 1)).ok).toBe(false)
    expect(checkModelFile('a.glb', new TextEncoder().encode('PK\u0003\u0004').buffer).ok).toBe(false)
    expect(checkModelFile('A.GLB', glb)).toEqual({ ok: true })
    expect(checkModelFile('a.gltf', new TextEncoder().encode('{"asset":{"version":"2.0"}}').buffer)).toEqual({ ok: true })
    expect(checkModelFile('a.gltf', new TextEncoder().encode('{"scenes":[]}').buffer).ok).toBe(false)
    expect(checkModelFile('a.gltf', new TextEncoder().encode('not json').buffer).ok).toBe(false)
  })

  it('formats bytes, KB and MB', () => {
    expect(formatBytes(12)).toBe('12 B')
    expect(formatBytes(189_163)).toBe('184.7 KB')
    expect(formatBytes(3 * 1048576)).toBe('3 MB')
  })
})
