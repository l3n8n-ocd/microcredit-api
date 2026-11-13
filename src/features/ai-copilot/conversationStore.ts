/**
 * Conversation persistence in `localStorage`. The stored JSON is untrusted
 * input (another tab, an old version, a user editing DevTools), so it is read
 * as `unknown` and rebuilt field by field. Anything that does not fit is dropped.
 *
 * The data stays in the visitor's own browser. Nothing here is sent anywhere.
 */
import type { EngineInfo } from './chatProtocol.ts'
import { TOOL_STATES, type ChatMessage, type ChatMessagePart, type MessageOutcome, type ToolDecision, type ToolPart, type ToolState } from './chatTypes.ts'

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

function readToolState(value: unknown): ToolState | null {
  return TOOL_STATES.find((state) => state === value) ?? null
}

const nullableString = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const nullableNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

function readDecision(value: unknown): ToolDecision | null {
  if (!isRecord(value) || typeof value.at !== 'string') return null
  if (value.kind === 'cancelled') return { kind: 'cancelled', at: value.at }
  if (value.kind !== 'executed' || typeof value.status !== 'number' || typeof value.outcome !== 'string') return null
  return {
    kind: 'executed',
    at: value.at,
    status: value.status,
    outcome: value.outcome,
    message: typeof value.message === 'string' ? value.message : '',
    loanStatus: nullableString(value.loanStatus),
    loanVersion: nullableNumber(value.loanVersion),
    debitsCentavos: nullableNumber(value.debitsCentavos),
    creditsCentavos: nullableNumber(value.creditsCentavos),
    entriesForLoan: nullableNumber(value.entriesForLoan) ?? 0,
    replays: nullableNumber(value.replays) ?? 0,
    lastReplay: nullableString(value.lastReplay),
  }
}

/** A stored tool call. `input` and `output` stay `unknown`: the card validates them against the tool's Zod schemas. */
function readToolPart(value: Record<string, unknown>): ToolPart | null {
  const state = readToolState(value.state)
  if (typeof value.toolCallId !== 'string' || typeof value.toolName !== 'string' || state === null) return null
  const timeline = Array.isArray(value.timeline)
    ? (value.timeline as readonly unknown[]).flatMap((step) => {
        if (!isRecord(step) || typeof step.at !== 'number') return []
        const stepState = readToolState(step.state)
        return stepState === null ? [] : [{ state: stepState, at: step.at }]
      })
    : []
  return {
    type: 'tool',
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    state,
    rationale: typeof value.rationale === 'string' ? value.rationale : '',
    inputText: typeof value.inputText === 'string' ? value.inputText : '',
    input: value.input ?? null,
    output: value.output ?? null,
    errorCode: nullableString(value.errorCode),
    errorText: nullableString(value.errorText),
    timeline,
    decision: readDecision(value.decision),
  }
}

function readParts(parts: readonly unknown[]): readonly ChatMessagePart[] {
  const out: ChatMessagePart[] = []
  for (const part of parts) {
    if (!isRecord(part)) continue
    if (part.type === 'text' && typeof part.text === 'string') {
      const last = out.at(-1)
      if (last?.type === 'text') out[out.length - 1] = { type: 'text', text: last.text + part.text }
      else out.push({ type: 'text', text: part.text })
    } else if (part.type === 'tool') {
      const tool = readToolPart(part)
      if (tool !== null) out.push(tool)
    }
  }
  return out.length === 0 ? [{ type: 'text', text: '' }] : out
}

function readMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null
  const { id, role, parts, createdAt, finishReason } = value
  const outcome = readOutcome(value.outcome)
  if (typeof id !== 'string' || typeof createdAt !== 'string' || outcome === null) return null
  if ((role !== 'user' && role !== 'assistant') || !Array.isArray(parts)) return null

  const engine = readEngine(value.engine)
  return {
    id,
    role,
    // Users only ever write text; an assistant reply keeps its tool cards, in order.
    parts: role === 'user' ? [{ type: 'text', text: readParts(parts as readonly unknown[]).map((part) => (part.type === 'text' ? part.text : '')).join('') }] : readParts(parts as readonly unknown[]),
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
