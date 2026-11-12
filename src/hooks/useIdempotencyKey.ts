import { useCallback, useState, useSyncExternalStore } from 'react'

/**
 * Shown in place of a key until the page is running in the browser. Not a
 * UUID, so the server would reject it with `400` if it were ever sent; the
 * forms also refuse to send while the key is pending.
 */
export const PENDING_IDEMPOTENCY_KEY = 'pending'

function subscribeToNothing(): () => void {
  return () => {}
}

/**
 * One `Idempotency-Key` per user intent (CLAUDE.md §8), created in the browser only.
 *
 * Why not `useState(createKey)`: a `'use client'` component still renders once
 * on the server to produce the page's HTML, then again in the browser to
 * hydrate it. A random key made during render differs between those two runs,
 * so the HTML and the hydrated page disagree and React reports a hydration
 * error (#418). The static HTML for `/` also carried the same key for every
 * visitor until the browser replaced it.
 *
 * How: `useSyncExternalStore` reports `false` on the server and during
 * hydration, then `true`. Both of the first two renders show
 * `PENDING_IDEMPOTENCY_KEY`, so they match. On the next render in the browser
 * the real key is created, before the browser paints. Outside hydration (a
 * plain client render, as in tests) the key is created at mount, as before.
 *
 * Returns the key and `renew()`, which starts a new intent with a new key.
 */
export function useIdempotencyKey(createKey: () => string): readonly [key: string, renew: () => void] {
  const inBrowser = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  )
  const [key, setKey] = useState(() => (inBrowser ? createKey() : PENDING_IDEMPOTENCY_KEY))

  // Hydration just finished: replace the placeholder. Setting state during
  // render is React's pattern for adjusting state to a changed input; React
  // discards this render and runs it again with the new key before painting.
  if (inBrowser && key === PENDING_IDEMPOTENCY_KEY) setKey(createKey())

  const renew = useCallback(() => setKey(createKey()), [createKey])
  return [key, renew] as const
}
