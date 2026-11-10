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
 * Production transport: POST the history, then read the SSE body chunk by
 * chunk. `fetch` gets the abort signal, so Stop cancels the HTTP request
 * itself: the reader rejects with `AbortError` and the server sees the
 * disconnect.
 */
export const fetchChatTransport: ChatTransport = async ({ messages, signal, onEvent }) => {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages }),
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
