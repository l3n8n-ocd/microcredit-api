/**
 * The chat state machine (Mentor Tip 2). Pure: no fetch, no timers, no DOM.
 *
 * Every transition is one action through this reducer, so "can I send?" and
 * "is Stop showing?" are read off `status`, not off flags that can disagree.
 *
 * `activeId` is the assistant message being written right now. Stream events
 * carry the ID of the run that produced them, and an event whose ID is not
 * `activeId` is dropped. That is what makes "Stop, then send again" safe: a
 * token from the aborted request that lands late cannot leak into the new reply.
 */
import { CHAT_LIMITS, type EngineInfo, type ToolStreamEvent, type WireMessage } from './chatProtocol.ts'
import {
  messageText,
  toolPartsOf,
  type ChatFailureKind,
  type ChatMessage,
  type ChatMessagePart,
  type ChatStatus,
  type ToolDecision,
  type ToolPart,
  type ToolState,
} from './chatTypes.ts'

/**
 * FE-08: the failed turn, in enough detail to retry it. Retry re-sends the user
 * turn `userId` and writes the new reply into the slot of `assistantId`, so the
 * rest of the conversation is never touched.
 */
export interface ChatFailure {
  readonly kind: ChatFailureKind
  readonly message: string
  /** The user turn whose reply failed: what Retry sends again. */
  readonly userId: string
  /** The failed reply. Its partial text stays on screen until Retry replaces it. */
  readonly assistantId: string
  /** True when some reply text arrived before the failure. */
  readonly partial: boolean
  readonly status: number | null
  readonly retryAfterSeconds: number | null
  /** True from the Retry click until the retried reply's first token (or its own failure). */
  readonly retrying: boolean
}

export interface ChatState {
  readonly status: ChatStatus
  readonly messages: readonly ChatMessage[]
  readonly activeId: string | null
  readonly error: string | null
  readonly failure: ChatFailure | null
}

export type ChatAction =
  | { readonly type: 'SUBMIT'; readonly user: ChatMessage; readonly assistant: ChatMessage }
  | { readonly type: 'META'; readonly id: string; readonly engine: EngineInfo }
  | { readonly type: 'TOKEN'; readonly id: string; readonly text: string }
  | { readonly type: 'DONE'; readonly id: string; readonly finishReason: string }
  | {
      readonly type: 'FAIL'
      readonly id: string
      readonly message: string
      /** When absent: `mid-stream` if text had arrived, else `server`. */
      readonly kind?: ChatFailureKind
      readonly status?: number | null
      readonly retryAfterSeconds?: number | null
    }
  | { readonly type: 'RETRY'; readonly assistant: ChatMessage }
  /** FE-07: one tool lifecycle frame for the live reply. `at` is the arrival time (epoch ms), passed in to keep this pure. */
  | { readonly type: 'TOOL'; readonly id: string; readonly event: ToolStreamEvent; readonly at: number }
  /** FE-07: the officer approved or cancelled a proposal. Allowed at any time, on any message. */
  | { readonly type: 'TOOL_DECISION'; readonly messageId: string; readonly toolCallId: string; readonly decision: ToolDecision }
  | { readonly type: 'STOP' }
  | { readonly type: 'CLEAR' }

export function createInitialState(messages: readonly ChatMessage[]): ChatState {
  return { status: 'idle', messages, activeId: null, error: null, failure: null }
}

/** The user turn just before `assistantId`: the prompt that reply was answering. */
function promptBefore(messages: readonly ChatMessage[], assistantId: string): ChatMessage | undefined {
  const index = messages.findIndex((message) => message.id === assistantId)
  return messages.slice(0, Math.max(index, 0)).findLast((message) => message.role === 'user')
}

/** True when a reply has anything on screen: text or a tool card. */
function hasContent(message: ChatMessage | undefined): boolean {
  return message !== undefined && (messageText(message) !== '' || toolPartsOf(message).length > 0)
}

function appendText(parts: readonly ChatMessagePart[], text: string): readonly ChatMessagePart[] {
  const last = parts.at(-1)
  // Text after a tool card starts a new text part, so the order on screen matches the stream.
  return last?.type === 'text' ? [...parts.slice(0, -1), { type: 'text', text: last.text + text }] : [...parts, { type: 'text', text }]
}

function reached(part: ToolPart, state: ToolState, at: number): Pick<ToolPart, 'state' | 'timeline'> {
  return { state, timeline: [...part.timeline, { state, at }] }
}

/** Applies one tool frame to the message's parts. A frame for an unknown call starts one, so no frame is lost. */
function applyToolEvent(parts: readonly ChatMessagePart[], event: ToolStreamEvent, at: number): readonly ChatMessagePart[] {
  const index = parts.findIndex((part) => part.type === 'tool' && part.toolCallId === event.toolCallId)
  const existing = index === -1 ? undefined : parts[index]
  const current: ToolPart =
    existing?.type === 'tool'
      ? existing
      : {
          type: 'tool',
          toolCallId: event.toolCallId,
          toolName: 'toolName' in event ? event.toolName : 'unknown',
          state: 'input-streaming',
          rationale: event.type === 'tool-input-start' ? event.rationale : '',
          inputText: '',
          input: null,
          output: null,
          errorCode: null,
          errorText: null,
          timeline: [{ state: 'input-streaming', at }],
          decision: null,
        }
  let next: ToolPart
  switch (event.type) {
    case 'tool-input-start':
      next = current
      break
    case 'tool-input-delta':
      next = { ...current, inputText: current.inputText + event.delta }
      break
    case 'tool-input-available':
      next = { ...current, ...reached(current, 'input-available', at), toolName: event.toolName, input: event.input }
      break
    case 'tool-output-available':
      next = { ...current, ...reached(current, 'output-available', at), output: event.output }
      break
    case 'tool-output-error':
      next = { ...current, ...reached(current, 'output-error', at), errorCode: event.errorCode, errorText: event.errorText }
      break
  }
  return index === -1 ? [...parts, next] : parts.map((part, position) => (position === index ? next : part))
}

function failWith(
  state: ChatState,
  details: { readonly kind: ChatFailureKind; readonly message: string; readonly status: number | null; readonly retryAfterSeconds: number | null },
): ChatState {
  const assistantId = state.activeId
  const active = state.messages.find((message) => message.id === assistantId)
  const user = assistantId === null ? undefined : promptBefore(state.messages, assistantId)
  return {
    ...state,
    status: 'error',
    messages: updateActive(state, (message) => ({ ...message, outcome: 'error' })),
    activeId: null,
    error: details.message,
    failure:
      assistantId === null || user === undefined
        ? null
        : {
            ...details,
            userId: user.id,
            assistantId,
            partial: hasContent(active),
            retrying: false,
          },
  }
}

/** A request is in flight: waiting for the first token, or receiving tokens. */
export function isBusy(status: ChatStatus): boolean {
  return status === 'submitted' || status === 'streaming'
}

function updateActive(state: ChatState, update: (message: ChatMessage) => ChatMessage): readonly ChatMessage[] {
  return state.messages.map((message) => (message.id === state.activeId ? update(message) : message))
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SUBMIT':
      // idle | stopped | error → submitted. A second send while busy is ignored.
      if (isBusy(state.status)) return state
      return {
        status: 'submitted',
        messages: [...state.messages, action.user, action.assistant],
        activeId: action.assistant.id,
        error: null,
        failure: null,
      }

    case 'RETRY': {
      // error → submitted, once. A second Retry while the first is in flight is ignored.
      const failure = state.failure
      if (state.status !== 'error' || failure === null || failure.retrying) return state
      return {
        status: 'submitted',
        messages: state.messages.map((message) => (message.id === failure.assistantId ? action.assistant : message)),
        activeId: action.assistant.id,
        error: null,
        failure: { ...failure, assistantId: action.assistant.id, retrying: true },
      }
    }

    case 'CLEAR':
      return createInitialState([])

    case 'TOOL_DECISION':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id !== action.messageId
            ? message
            : {
                ...message,
                parts: message.parts.map((part) =>
                  part.type === 'tool' && part.toolCallId === action.toolCallId ? { ...part, decision: action.decision } : part,
                ),
              },
        ),
      }

    case 'STOP':
      // submitted | streaming → stopped. Whatever text arrived stays in the message.
      if (!isBusy(state.status)) return state
      return {
        ...state,
        status: 'stopped',
        messages: updateActive(state, (message) => ({ ...message, outcome: 'stopped' })),
        activeId: null,
        failure: null,
      }

    default:
      break
  }

  // The remaining actions come from a stream. Drop them unless they belong to the live run.
  if (!isBusy(state.status) || action.id !== state.activeId) return state

  switch (action.type) {
    case 'META':
      return { ...state, messages: updateActive(state, (message) => ({ ...message, engine: action.engine })) }

    case 'TOKEN':
      // submitted → streaming on the first token; streaming stays streaming.
      return {
        ...state,
        status: 'streaming',
        // A retried reply that streams has recovered: the failure banner goes.
        failure: null,
        messages: updateActive(state, (message) => ({ ...message, parts: appendText(message.parts, action.text) })),
      }

    case 'TOOL':
      // Like a token: the reply is streaming, and a retried reply that streams has recovered.
      return {
        ...state,
        status: 'streaming',
        failure: null,
        messages: updateActive(state, (message) => ({ ...message, parts: applyToolEvent(message.parts, action.event, action.at) })),
      }

    case 'DONE': {
      const active = state.messages.find((message) => message.id === state.activeId)
      if (!hasContent(active)) {
        return failWith(state, {
          kind: 'empty',
          message: 'The copilot returned an empty reply. Send the message again.',
          status: null,
          retryAfterSeconds: null,
        })
      }
      return {
        ...state,
        status: 'idle',
        failure: null,
        messages: updateActive(state, (message) =>
          action.finishReason === 'stop'
            ? { ...message, outcome: 'complete' }
            : { ...message, outcome: 'complete', finishReason: action.finishReason },
        ),
        activeId: null,
      }
    }

    case 'FAIL': {
      const active = state.messages.find((message) => message.id === state.activeId)
      const partial = hasContent(active)
      return failWith(state, {
        kind: action.kind ?? (partial ? 'mid-stream' : 'server'),
        message: action.message,
        status: action.status ?? null,
        retryAfterSeconds: action.retryAfterSeconds ?? null,
      })
    }
  }
}

/**
 * Flattens the UI conversation to what the server accepts: text only, no empty
 * turns (a reply stopped before its first token has nothing to send), the most
 * recent `maxMessages`, and a user turn first.
 */
export function toWireHistory(messages: readonly ChatMessage[]): readonly WireMessage[] {
  const turns = messages
    .map((message) => ({ role: message.role, content: messageText(message).trim() }))
    .filter((turn) => turn.content !== '')
    .map((turn) =>
      turn.role === 'assistant' ? { ...turn, content: turn.content.slice(0, CHAT_LIMITS.maxAssistantChars) } : turn,
    )
    .slice(-CHAT_LIMITS.maxMessages)
  const firstUser = turns.findIndex((turn) => turn.role === 'user')
  return firstUser === -1 ? [] : turns.slice(firstUser)
}
