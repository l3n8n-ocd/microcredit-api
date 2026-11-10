/**
 * In-memory rate limiter for `POST /api/chat`.
 *
 * Algorithm: a sliding-window log. Each client key keeps the timestamps of its
 * allowed requests. A request is allowed only if every rule still has room
 * inside its window, measured back from "now". Unlike a fixed-window counter,
 * this cannot be doubled by sending one burst just before a window resets and
 * another just after.
 *
 * WHAT THIS IS NOT. The log lives in the memory of one server instance. On
 * Vercel each function instance has its own copy and a cold start empties it,
 * so the real ceiling is "limit × number of warm instances". It slows down a
 * script hammering the endpoint; it is not a spend guarantee. The guarantee is
 * the monthly spend limit on the provider account. A shared store (Redis)
 * would make the limit exact: see docs/FE-06_STREAMING_CHAT.md §6.
 */

export interface RateLimitRule {
  readonly limit: number
  readonly windowMs: number
}

export type RateLimitResult = { readonly ok: true } | { readonly ok: false; readonly retryAfterSeconds: number }

export interface RateLimiter {
  /** Counts the request if it is allowed. A rejected request is not counted. */
  readonly check: (key: string) => RateLimitResult
  readonly reset: () => void
  /** Number of client keys currently tracked. */
  readonly size: () => number
}

export interface RateLimiterOptions {
  /** Clock, injectable so tests can move time without waiting. */
  readonly now?: () => number
  /** Upper bound on tracked clients, so the map cannot grow without limit. */
  readonly maxKeys?: number
}

export function createRateLimiter(rules: readonly RateLimitRule[], options: RateLimiterOptions = {}): RateLimiter {
  const now = options.now ?? Date.now
  const maxKeys = options.maxKeys ?? 5_000
  const longestWindow = Math.max(...rules.map((rule) => rule.windowMs))
  /** Insertion order is "least recently allowed first", which is the eviction order. */
  const hits = new Map<string, number[]>()

  return {
    check(key) {
      const at = now()
      const log = (hits.get(key) ?? []).filter((hit) => at - hit < longestWindow)

      let retryAfterMs = 0
      for (const rule of rules) {
        const inWindow = log.filter((hit) => at - hit < rule.windowMs)
        const oldest = inWindow[0]
        // Full window: a slot frees up when its oldest hit ages out.
        if (inWindow.length >= rule.limit && oldest !== undefined) {
          retryAfterMs = Math.max(retryAfterMs, oldest + rule.windowMs - at)
        }
      }
      if (retryAfterMs > 0) {
        hits.set(key, log)
        return { ok: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }
      }

      log.push(at)
      hits.delete(key)
      hits.set(key, log)
      for (const stale of hits.keys()) {
        if (hits.size <= maxKeys) break
        hits.delete(stale)
      }
      return { ok: true }
    },
    reset() {
      hits.clear()
    },
    size() {
      return hits.size
    },
  }
}

/** Per client: 10 hosted-model replies a minute, 100 a day. */
export const CHAT_RATE_LIMIT: readonly RateLimitRule[] = [
  { limit: 10, windowMs: 60_000 },
  { limit: 100, windowMs: 24 * 60 * 60_000 },
]

/** One limiter per server instance, shared by every request that instance handles. */
export const chatRateLimiter = createRateLimiter(CHAT_RATE_LIMIT)

/**
 * The key a client is limited by: its IP as reported by the hosting proxy.
 * `x-real-ip` and the first hop of `x-forwarded-for` are set by the platform
 * in front of the function. With neither header, every such client shares one
 * bucket, which errs on the strict side. The value is held in memory only and
 * is never logged.
 */
export function clientKey(headers: Headers): string {
  const realIp = headers.get('x-real-ip')?.trim() ?? ''
  if (realIp !== '') return realIp
  const firstHop = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  return firstHop === '' ? 'unknown' : firstHop
}

/** 42 → "42 seconds", 600 → "about 10 minutes", 80000 → "about 22 hours". */
export function describeWait(seconds: number): string {
  if (seconds < 90) return `${seconds} second${seconds === 1 ? '' : 's'}`
  if (seconds < 90 * 60) return `about ${Math.ceil(seconds / 60)} minutes`
  return `about ${Math.ceil(seconds / 3600)} hours`
}
