/**
 * Conversation persistence in `localStorage`. The stored JSON is untrusted
 * input (another tab, an old version, a user editing DevTools), so it is read
 * as `unknown` and rebuilt field by field. Anything that does not fit is dropped.
 *
 * The data stays in the visitor's own browser. Nothing here is sent anywhere.
 */
import type { EngineInfo } from './chatProtocol.ts'
import type { ChatMessage, MessageOutcome } from './chatTypes.ts'

/** Versioned key: a breaking change to the stored shape bumps `_v1` instead of migrating. */
export const STORAGE_KEY = 'microcredit_ai_copilot_v1'

/** Keeps the entry far below the ~5 MB `localStorage` quota. */
const MAX_STORED_MESSAGES = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readEngine(value: unknown): EngineInfo | null {
  if (!isRecord(value) || typeof value.label !== 'string') return null
  const { kind } = value
  return kind === 'anthropic' || kind === 'google' || kind === 'local' ? { kind, label: value.label } : null
}

function readOutcome(value: unknown): MessageOutcome | null {
  // A stored `pending` means the tab closed mid-stream: the reply did stop.
  if (value === 'pending' || value === 'stopped') return 'stopped'
  return value === 'complete' || value === 'error' ? value : null
}

function readMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null
  const { id, role, parts, createdAt, finishReason } = value
  const outcome = readOutcome(value.outcome)
  if (typeof id !== 'string' || typeof createdAt !== 'string' || outcome === null) return null
  if ((role !== 'user' && role !== 'assistant') || !Array.isArray(parts)) return null

  const text = (parts as readonly unknown[])
    .map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('')
  const engine = readEngine(value.engine)
  return {
    id,
    role,
    parts: [{ type: 'text', text }],
    createdAt,
    outcome,
    ...(engine === null ? {} : { engine }),
    ...(typeof finishReason === 'string' ? { finishReason } : {}),
  }
}

export function loadConversation(): readonly ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as readonly unknown[]).map(readMessage).filter((message) => message !== null)
  } catch {
    // Storage blocked (private mode) or corrupt JSON: start with an empty conversation.
    return []
  }
}

export function saveConversation(messages: readonly ChatMessage[]): void {
  try {
    if (messages.length === 0) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)))
  } catch {
    // Quota exceeded or storage blocked: the chat still works, it just will not survive a reload.
  }
}

export function clearConversation(): void {
  saveConversation([])
}
