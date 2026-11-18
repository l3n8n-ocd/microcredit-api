/**
 * FE-AA2 · .glb / .gltf in, a staged model out. And the reverse: any Object3D to a binary .glb.
 * Only `Vault3DCanvas.tsx` imports this, so it ships in the lazy Three.js chunk.
 */
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

/** Where public/draco/ is served. DRACOLoader fetches from it only for Draco-compressed meshes. */
export const DRACO_PATH = '/draco/'

/** The longest side of a staged model, in scene units: the procedural terminal is about this big. */
export const STAGE_SIZE = 2.2

export interface GlbPipeline {
  readonly parse: (bytes: ArrayBuffer) => Promise<ParsedModel>
  readonly dispose: () => void
}

export interface ParsedModel {
  readonly object: THREE.Object3D
  readonly draco: boolean
}

export function createGlbPipeline(): GlbPipeline {
  let draco: DRACOLoader | null = null
  const loader = new GLTFLoader()
  // The decoder is created up front but downloads nothing until a Draco mesh is decoded.
  draco = new DRACOLoader()
  draco.setDecoderPath(DRACO_PATH)
  draco.setDecoderConfig({ type: 'wasm' })
  loader.setDRACOLoader(draco)

  return {
    parse: async (bytes) => {
      const gltf = await loader.parseAsync(bytes, '')
      const used = gltf.parser.json.extensionsUsed
      const usesDraco = Array.isArray(used) && used.includes('KHR_draco_mesh_compression')
      return { object: gltf.scene, draco: usesDraco }
    },
    dispose: () => {
      draco?.dispose()
      draco = null
    },
  }
}

/**
 * Centres a model on the stage and scales it so its longest side is STAGE_SIZE, resting on y = 0.
 * Returns a wrapper group, so the model's own transforms stay as authored.
 */
export function fitToStage(object: THREE.Object3D, size = STAGE_SIZE): THREE.Group {
  const wrapper = new THREE.Group()
  wrapper.name = 'staged model'
  wrapper.add(object)
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return wrapper
  const dims = box.getSize(new THREE.Vector3())
  const longest = Math.max(dims.x, dims.y, dims.z)
  const scale = longest > 0 ? size / longest : 1
  const center = box.getCenter(new THREE.Vector3())
  object.position.sub(center)
  object.position.y += dims.y / 2
  wrapper.scale.setScalar(scale)
  return wrapper
}

export function countTriangles(object: THREE.Object3D): number {
  let triangles = 0
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const geometry: unknown = child.geometry
    if (!(geometry instanceof THREE.BufferGeometry)) return
    const count = geometry.index !== null ? geometry.index.count : (geometry.getAttribute('position')?.count ?? 0)
    const instances = child instanceof THREE.InstancedMesh ? child.count : 1
    triangles += Math.floor(count / 3) * instances
  })
  return triangles
}

/** Applies the wireframe / metalness / roughness controls to every standard material in a loaded model. */
export function applyFinish(object: THREE.Object3D, finish: { wireframe: boolean; metalness: number; roughness: number }): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials: unknown[] = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.wireframe = finish.wireframe
        material.metalness = finish.metalness
        material.roughness = finish.roughness
      }
    }
  })
}

/** Exports an object as a binary glTF (.glb). The bytes go through the same loader as a dropped file. */
export async function exportGlb(object: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(object, { binary: true, onlyVisible: true })
  if (!(result instanceof ArrayBuffer)) throw new Error('GLTFExporter returned JSON, not a binary .glb')
  return result
}

/** Frees every geometry, material and texture under `object`. */
export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
      const geometry: unknown = child.geometry
      if (geometry instanceof THREE.BufferGeometry) geometry.dispose()
      const materials: unknown[] = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) {
        if (!(material instanceof THREE.Material)) continue
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose()
        }
        material.dispose()
      }
    }
  })
}
