/**
 * FE-AA1 · the simulated network behind /motion-lab. Pure, so tests can pin it.
 */
import type { SmartState } from '../../components/ui/SmartActionButton.tsx'

export type LabMode = 'success' | 'error' | 'realistic'
export type ScrubValue = 'live' | SmartState | 'disabled'

export interface LabRandom {
  /** Returns a number in [0, 1). Injected so tests can pin the realistic mode. */
  readonly next: () => number
}

export const MATH_RANDOM: LabRandom = { next: () => Math.random() }

/** The simulated network. Rejects early, and clears its timer, when the button aborts the run. */
export function simulate(mode: LabMode, signal: AbortSignal, random: LabRandom = MATH_RANDOM): Promise<void> {
  const delay = mode === 'realistic' ? 600 + Math.round(random.next() * 500) : 900
  const fails = mode === 'error' || (mode === 'realistic' && random.next() < 0.2)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => (fails ? reject(new Error('simulated failure')) : resolve()), delay)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    })
  })
}
