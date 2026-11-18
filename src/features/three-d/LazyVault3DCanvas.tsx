'use client'

/**
 * FE-AA2 · the only door to `three`. next/dynamic with `ssr: false` puts Vault3DCanvas and Three.js in
 * their own chunk, fetched when this component first renders in the browser. A route that never
 * renders it (/, /underwriting until the inspector card is opened) downloads 0 bytes of Three.js.
 */
import dynamic from 'next/dynamic'
import { markLazyStart } from './lazyMark.ts'
import { ViewportLoading } from './ViewportLoading.tsx'
import type { Vault3DCanvasProps } from './Vault3DCanvas.tsx'

export const LazyVault3DCanvas = dynamic<Vault3DCanvasProps>(
  () => {
    markLazyStart()
    return import('./Vault3DCanvas.tsx').then((m) => m.Vault3DCanvas)
  },
  { ssr: false, loading: ViewportLoading },
)
