/**
 * How the chat talks to the server. The component depends on the
 * `ChatTransport` type, not on `fetch`, so tests pass a fake they can drive
 * token by token and abort on demand (dependency injection).
 */
import { createSseParser, type ChatStreamEvent, type WireMessage } from './chatProtocol.ts'

export interface ChatTransportArgs {
  readonly messages: readonly WireMessage[]
  /** Aborted by the Stop button. The transport must stop reading and reject. */
  readonly signal: AbortSignal
  readonly onEvent: (event: ChatStreamEvent) => void
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
export const fetchChatTransport: ChatTransport = async ({ messages, signal, onEvent }) => {
  const requestId = crypto.randomUUID()
  const onAbort = (): void => cancelOnServer(requestId)
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    await streamChat(requestId, messages, signal, onEvent)
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
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages, requestId }),
    signal,
  })
  if (!response.ok || response.body === null) throw new Error(await readErrorMessage(response))

  const reader = response.body.getReader()
  // `stream: true` keeps a multi-byte character (₱, Σ) intact when it is split across two chunks.
  const decoder = new TextDecoder()
  const parser = createSseParser(onEvent)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parser.push(decoder.decode(value, { stream: true }))
  }
}
