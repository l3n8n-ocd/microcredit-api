/**
 * FE-AA2 · when the lazy Three.js import started. `LazyVault3DCanvas` stamps it in the dynamic
 * loader; the canvas reads it to sum the script chunks fetched for that import (the HUD's
 * "Lazy chunk" figure). No `three` import here.
 */
let startedAt: number | null = null

export function markLazyStart(): void {
  if (startedAt === null && typeof performance !== 'undefined') startedAt = performance.now()
}

export function lazyStartedAt(): number | null {
  return startedAt
}

/**
 * All of an `import()`'s chunks are requested in the same tick, so they start within a millisecond or
 * two of each other. A script that starts later is something else, such as Next.js prefetching a
 * linked route (measured: 32 ms later on a phone-sized page).
 */
const SAME_TICK_MS = 5

/** Script chunks under /_next/static/ that the lazy import requested. */
export function measureLazyChunks(): { readonly bytes: number; readonly decodedBytes: number; readonly count: number } | null {
  if (startedAt === null || typeof performance === 'undefined') return null
  const from = startedAt
  const scripts = performance
    .getEntriesByType('resource')
    .filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming)
    .filter((entry) => entry.initiatorType === 'script' && entry.name.includes('/_next/static/') && entry.startTime >= from)
    .sort((a, b) => a.startTime - b.startTime)
  const first = scripts[0]
  if (first === undefined) return null
  let bytes = 0
  let decodedBytes = 0
  let count = 0
  for (const entry of scripts) {
    if (entry.startTime > first.startTime + SAME_TICK_MS) break
    // encodedBodySize: compressed bytes on the wire; decodedBodySize: the JavaScript the browser parses.
    bytes += entry.encodedBodySize > 0 ? entry.encodedBodySize : entry.transferSize
    decodedBytes += entry.decodedBodySize
    count += 1
  }
  return { bytes, decodedBytes, count }
}
