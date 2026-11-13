/**
 * Wire protocol for `POST /api/chat`, shared by the route handler and the browser.
 *
 * Isomorphic on purpose: no React, no `server-only`, no env access. The server
 * encodes frames with `encodeSseFrame`, the client decodes them with
 * `createSseParser`, and both sides agree on one `ChatStreamEvent` union. Both
 * engines (a hosted model through the AI SDK, or the local rule engine) emit
 * the same frames, so the UI has one code path.
 *
 * Frame format is Server-Sent Events: `data: <json>\n\n`.
 */

export type WireRole = 'user' | 'assistant'

/** One turn as it travels to the server. The UI's richer `ChatMessage` is flattened to this. */
export interface WireMessage {
  readonly role: WireRole
  readonly content: string
}

export type EngineKind = 'anthropic' | 'google' | 'local'

/** Which engine answered. Shown in the UI so a local reply is never passed off as a model. */
export interface EngineInfo {
  readonly kind: EngineKind
  readonly label: string
}

export type ChatStreamEvent =
  | { readonly type: 'meta'; readonly engine: EngineInfo }
  | { readonly type: 'token'; readonly text: string }
  | { readonly type: 'done'; readonly finishReason: string }
  | { readonly type: 'error'; readonly message: string }

/**
 * Hard caps, enforced on both sides. `/api/chat` is public and unauthenticated,
 * so these bound what one request can cost when a paid key is configured.
 */
export const CHAT_LIMITS = {
  /** Turns sent per request. The client trims older turns; the server rejects more. */
  maxMessages: 24,
  /** Characters in one user message (the textarea enforces the same number). */
  maxUserChars: 2000,
  /** Characters in one assistant turn echoed back as history. */
  maxAssistantChars: 12_000,
} as const

/**
 * FE-08 sabotage drills. One mode breaks one request on purpose, so a reviewer
 * can see every designed failure state without DevTools. Sent as the
 * `x-sabotage-mode` header (or `sabotage` in the body). A drill never calls a
 * hosted model: the server answers from the local rule engine and labels it.
 *
 * `network-drop` never reaches the server. The browser fails it before `fetch`,
 * which is the point: nothing was sent.
 */
export const SABOTAGE_MODES = ['mid-stream-error', 'rate-limit-429', 'malformed-tool-json', 'slow-3s', 'network-drop'] as const
export type SabotageMode = (typeof SABOTAGE_MODES)[number]
export const SABOTAGE_HEADER = 'x-sabotage-mode'

export function isSabotageMode(value: unknown): value is SabotageMode {
  return typeof value === 'string' && (SABOTAGE_MODES as readonly string[]).includes(value)
}

export function encodeSseFrame(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isEngineInfo(value: unknown): value is EngineInfo {
  return (
    isRecord(value) &&
    (value.kind === 'anthropic' || value.kind === 'google' || value.kind === 'local') &&
    typeof value.label === 'string'
  )
}

export function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'meta':
      return isEngineInfo(value.engine)
    case 'token':
      return typeof value.text === 'string'
    case 'done':
      return typeof value.finishReason === 'string'
    case 'error':
      return typeof value.message === 'string'
    default:
      return false
  }
}

/**
 * Incremental SSE decoder. Network chunks do not line up with frames: one chunk
 * can hold three frames, or half of one. `push` buffers until it sees the blank
 * line that ends a frame, then emits every complete event. Malformed frames and
 * `: comment` keep-alives are skipped, never thrown.
 */
export function createSseParser(
  onEvent: (event: ChatStreamEvent) => void,
  /** Called with the raw `data` of a frame that is not valid JSON. The parser still skips it. */
  onMalformed?: (data: string) => void,
): { push: (chunk: string) => void } {
  let buffer = ''
  return {
    push(chunk) {
      buffer += chunk
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data !== '') {
          try {
            const parsed: unknown = JSON.parse(data)
            if (isChatStreamEvent(parsed)) onEvent(parsed)
          } catch {
            // A frame that is not JSON is dropped. The caller decides whether that ends the stream.
            onMalformed?.(data)
          }
        }
        boundary = buffer.indexOf('\n\n')
      }
    },
  }
}

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A request ID is a UUID the browser makes for one chat request. It lets Stop
 * name the reply to cancel (`DELETE /api/chat?requestId=…`). Anything that is
 * not UUID-shaped is treated as absent, never as an error.
 */
export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value)
}

export type ChatRequestParse =
  | { readonly ok: true; readonly messages: readonly WireMessage[]; readonly requestId: string | null }
  | { readonly ok: false; readonly error: string }

/**
 * Validates an untrusted request body (`unknown` in, typed out, CLAUDE.md §5).
 * Rejects anything that is not a non-empty list of `{ role, content }` turns
 * ending in a user turn, within `CHAT_LIMITS`.
 */
export function parseChatRequest(body: unknown): ChatRequestParse {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return { ok: false, error: 'Body must be { "messages": [{ "role", "content" }] }.' }
  }
  const raw: readonly unknown[] = body.messages
  if (raw.length === 0) return { ok: false, error: 'messages must not be empty.' }
  if (raw.length > CHAT_LIMITS.maxMessages) {
    return { ok: false, error: `At most ${CHAT_LIMITS.maxMessages} messages per request.` }
  }

  const messages: WireMessage[] = []
  for (const item of raw) {
    if (!isRecord(item) || (item.role !== 'user' && item.role !== 'assistant') || typeof item.content !== 'string') {
      return { ok: false, error: 'Each message needs role "user" or "assistant" and a string content.' }
    }
    const limit = item.role === 'user' ? CHAT_LIMITS.maxUserChars : CHAT_LIMITS.maxAssistantChars
    if (item.content.trim() === '') return { ok: false, error: 'Message content must not be empty.' }
    if (item.content.length > limit) {
      return { ok: false, error: `A ${item.role} message is over ${limit} characters.` }
    }
    messages.push({ role: item.role, content: item.content })
  }

  if (messages.at(-1)?.role !== 'user') return { ok: false, error: 'The last message must be from the user.' }
  return { ok: true, messages, requestId: isRequestId(body.requestId) ? body.requestId : null }
}
