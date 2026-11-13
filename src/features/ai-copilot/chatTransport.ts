/**
 * How the chat talks to the server. The component depends on the
 * `ChatTransport` type, not on `fetch`, so tests pass a fake they can drive
 * token by token and abort on demand (dependency injection).
 */
import { createSseParser, SABOTAGE_HEADER, type ChatStreamEvent, type SabotageMode, type WireMessage } from './chatProtocol.ts'
import type { ChatFailureKind } from './chatTypes.ts'

export interface ChatTransportArgs {
  readonly messages: readonly WireMessage[]
  /** Aborted by the Stop button. The transport must stop reading and reject. */
  readonly signal: AbortSignal
  readonly onEvent: (event: ChatStreamEvent) => void
  /** FE-08: break this one request on purpose. Sent as the `x-sabotage-mode` header. */
  readonly sabotage?: SabotageMode
}

/**
 * A failure the UI can name. `kind` picks the recovery copy; `status` and
 * `retryAfterSeconds` come from the HTTP response when there was one.
 */
export class ChatRequestError extends Error {
  readonly kind: ChatFailureKind
  readonly status: number | null
  readonly retryAfterSeconds: number | null
  constructor(
    message: string,
    details: { readonly kind: ChatFailureKind; readonly status?: number | null; readonly retryAfterSeconds?: number | null },
  ) {
    super(message)
    this.name = 'ChatRequestError'
    this.kind = details.kind
    this.status = details.status ?? null
    this.retryAfterSeconds = details.retryAfterSeconds ?? null
  }
}

/**
 * `Retry-After` in seconds. Only the delta-seconds form is read; an HTTP date or
 * garbage gives null, and the UI then lets the user retry without a countdown.
 */
export function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d{1,5}$/.test(value.trim())) return null
  return Math.min(Number(value.trim()), 3600)
}

/** Resolves when the stream ends. Rejects on a network or HTTP error, or when aborted. */
export type ChatTransport = (args: ChatTransportArgs) => Promise<void>

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') {
      return data.error
    }
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `The copilot request failed (HTTP ${response.status}).`
}

/**
 * Tells the server to stop generating one reply. Fire-and-forget: Stop has
 * already updated the UI, so nothing waits on this and a failure is ignored.
 * `keepalive` lets the request finish even if the page is being closed.
 */
function cancelOnServer(requestId: string): void {
  void fetch(`/api/chat?requestId=${requestId}`, { method: 'DELETE', keepalive: true }).catch(() => {})
}

/**
 * Production transport: POST the history, then read the SSE body chunk by
 * chunk.
 *
 * Stop cancels in two ways, because the first is not reliable on its own:
 *   1. `fetch` gets the abort signal, so the HTTP request itself is torn down.
 *      The server only notices if every proxy on the way passes that on.
 *   2. An explicit `DELETE /api/chat?requestId=…` names this request, and the
 *      server aborts the model call directly.
 */
export const fetchChatTransport: ChatTransport = async ({ messages, signal, onEvent, sabotage }) => {
  const requestId = crypto.randomUUID()
  const onAbort = (): void => cancelOnServer(requestId)
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    await streamChat(requestId, messages, signal, onEvent, sabotage ?? null)
  } finally {
    // A reply that ended on its own has nothing left to cancel.
    signal.removeEventListener('abort', onAbort)
  }
}

async function streamChat(
  requestId: string,
  messages: ChatTransportArgs['messages'],
  signal: AbortSignal,
  onEvent: ChatTransportArgs['onEvent'],
  sabotage: SabotageMode | null,
): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(sabotage === null ? {} : { [SABOTAGE_HEADER]: sabotage }),
      },
      body: JSON.stringify({ messages, requestId }),
      signal,
    })
  } catch (error) {
    // Stop is not a failure. Anything else here means the request never got an answer.
    if (signal.aborted) throw error
    throw new ChatRequestError('The request could not reach the server. Check the connection; nothing was answered.', {
      kind: 'offline',
    })
  }
  if (!response.ok || response.body === null) {
    const message = await readErrorMessage(response)
    if (response.status === 429) {
      throw new ChatRequestError(message, {
        kind: 'rate-limit',
        status: 429,
        retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
      })
    }
    throw new ChatRequestError(message, { kind: 'http', status: response.status })
  }

  const reader = response.body.getReader()
  // `stream: true` keeps a multi-byte character (₱, Σ) intact when it is split across two chunks.
  const decoder = new TextDecoder()
  let malformed = false
  const parser = createSseParser(onEvent, () => {
    malformed = true
  })
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch (error) {
      if (signal.aborted) throw error
      throw new ChatRequestError('The connection dropped while the reply was streaming.', { kind: 'closed' })
    }
    if (chunk.done) break
    parser.push(decoder.decode(chunk.value, { stream: true }))
    if (malformed) {
      // A frame we cannot read may be half a tool call. Stop here rather than guess.
      await reader.cancel().catch(() => {})
      throw new ChatRequestError('A stream frame was not valid JSON (a tool payload was cut off). Reading stopped there.', {
        kind: 'malformed',
      })
    }
  }
}
