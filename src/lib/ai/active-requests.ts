/**
 * Registry of chat requests that are streaming right now, so a client can
 * cancel one by ID (`DELETE /api/chat?requestId=…`).
 *
 * Why an explicit cancel exists next to "the connection closed". A server only
 * learns that a client went away if every hop in between passes the disconnect
 * on. Measured on the live host, a request dropped by the client was still
 * generated to the end: nothing told the function. An explicit cancel does not
 * depend on that. Stop sends one small request that names the reply, and the
 * server aborts that reply's AbortController itself.
 *
 * The ID is a random UUID made by the browser for one request. Knowing it is
 * the only way to cancel, and the only thing cancelling can do is stop that
 * one reply early.
 *
 * Like the rate limiter, this map lives in one server instance. A cancel that
 * lands on a different instance finds nothing and reports `cancelled: false`;
 * the connection-close path is still there as the fallback.
 */

export interface ActiveRequests {
  readonly register: (requestId: string, controller: AbortController) => void
  readonly release: (requestId: string) => void
  /** Aborts the request if this instance is running it. Returns whether it was. */
  readonly cancel: (requestId: string) => boolean
  readonly size: () => number
}

export function createActiveRequests(): ActiveRequests {
  const running = new Map<string, AbortController>()
  return {
    register(requestId, controller) {
      running.set(requestId, controller)
    },
    release(requestId) {
      running.delete(requestId)
    },
    cancel(requestId) {
      const controller = running.get(requestId)
      if (controller === undefined) return false
      running.delete(requestId)
      controller.abort()
      return true
    },
    size() {
      return running.size
    },
  }
}

/** One registry per server instance. */
export const activeRequests = createActiveRequests()
