/**
 * In-memory counters for `/api/chat`, read back through `GET /api/chat`.
 *
 * Why this exists: the per-request `chat.model` log line is only visible to
 * whoever can open the host's log viewer, and it expires. These counters make
 * the same facts checkable from outside with one GET: did the server see the
 * client disconnect, and did the rate limiter refuse anything?
 *
 * What is stored: counts, durations and a random instance ID. Never a prompt,
 * a reply, an IP address or a key. Like the rate limiter, this lives in one
 * server instance's memory, so `instance` is included: two readings can only
 * be compared when they carry the same ID.
 */

export type ModelOutcome = 'done' | 'aborted' | 'error' | 'fallback'

export interface LastModelRequest {
  readonly outcome: ModelOutcome
  /** Text deltas relayed to the client before the request ended. */
  readonly deltas: number
  readonly outputTokens: number | null
  /** Server-side duration of the model call. */
  readonly ms: number
  /** Provider HTTP status on failure, otherwise null. */
  readonly status: number | null
  /** ISO 8601 time the request ended. */
  readonly at: string
}

export interface ChatStatsSnapshot {
  /** Random ID chosen when this server instance loaded the module. */
  readonly instance: string
  readonly instanceStartedAt: string
  readonly outcomes: Readonly<Record<ModelOutcome, number>>
  /** Requests the rate limiter refused with 429 before any model call. */
  readonly rateLimited: number
  /** Explicit cancels (`DELETE /api/chat`): how many arrived, and how many found their request on this instance. */
  readonly cancels: { readonly received: number; readonly matched: number }
  readonly last: LastModelRequest | null
}

export interface ChatStats {
  readonly recordOutcome: (entry: Omit<LastModelRequest, 'at'>) => void
  readonly recordRateLimited: () => void
  readonly recordCancel: (matched: boolean) => void
  readonly snapshot: () => ChatStatsSnapshot
  readonly reset: () => void
}

export function createChatStats(now: () => Date = () => new Date()): ChatStats {
  const instance = crypto.randomUUID().slice(0, 8)
  const instanceStartedAt = now().toISOString()
  let outcomes: Record<ModelOutcome, number> = { done: 0, aborted: 0, error: 0, fallback: 0 }
  let rateLimited = 0
  let cancels = { received: 0, matched: 0 }
  let last: LastModelRequest | null = null

  return {
    recordCancel(matched) {
      cancels = { received: cancels.received + 1, matched: cancels.matched + (matched ? 1 : 0) }
    },
    recordOutcome(entry) {
      outcomes = { ...outcomes, [entry.outcome]: outcomes[entry.outcome] + 1 }
      last = { ...entry, at: now().toISOString() }
    },
    recordRateLimited() {
      rateLimited += 1
    },
    snapshot() {
      return { instance, instanceStartedAt, outcomes: { ...outcomes }, rateLimited, cancels, last }
    },
    reset() {
      outcomes = { done: 0, aborted: 0, error: 0, fallback: 0 }
      rateLimited = 0
      cancels = { received: 0, matched: 0 }
      last = null
    },
  }
}

/** One set of counters per server instance. */
export const chatStats = createChatStats()
