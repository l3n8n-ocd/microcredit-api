/**
 * FE-10 · the tool card's chunk, loaded once. The card brings the Zod output schemas
 * (src/lib/ai/tools.ts) and the ledger proposal code; most visits to /underwriting never see a tool
 * call, so they are kept out of the page's first JavaScript.
 *
 * `cachedToolCard()` is non-null once the chunk has arrived, so the chat can render the card in the
 * same frame instead of suspending once (which `React.lazy` does even for a preloaded module).
 */
type CardModule = typeof import('./ToolInvocationCard.tsx')

let loaded: CardModule | null = null
let pending: Promise<CardModule> | null = null

export function loadToolCard(): Promise<CardModule> {
  pending ??= import('./ToolInvocationCard.tsx').then((module) => {
    loaded = module
    return module
  })
  return pending
}

export function cachedToolCard(): CardModule | null {
  return loaded
}

/** Fetch the chunk when the browser is idle after the chat mounts (at most 3 s later). Returns a cancel. */
export function preloadToolCard(): () => void {
  if (typeof window === 'undefined') return () => {}
  if ('requestIdleCallback' in window) {
    const handle = window.requestIdleCallback(() => void loadToolCard(), { timeout: 3000 })
    return () => window.cancelIdleCallback(handle)
  }
  const timer = setTimeout(() => void loadToolCard(), 1500)
  return () => clearTimeout(timer)
}
