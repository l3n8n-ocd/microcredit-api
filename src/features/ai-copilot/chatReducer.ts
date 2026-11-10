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
import { CHAT_LIMITS, type EngineInfo, type WireMessage } from './chatProtocol.ts'
import { messageText, type ChatMessage, type ChatStatus } from './chatTypes.ts'

export interface ChatState {
  readonly status: ChatStatus
  readonly messages: readonly ChatMessage[]
  readonly activeId: string | null
  readonly error: string | null
}

export type ChatAction =
  | { readonly type: 'SUBMIT'; readonly user: ChatMessage; readonly assistant: ChatMessage }
  | { readonly type: 'META'; readonly id: string; readonly engine: EngineInfo }
  | { readonly type: 'TOKEN'; readonly id: string; readonly text: string }
  | { readonly type: 'DONE'; readonly id: string; readonly finishReason: string }
  | { readonly type: 'FAIL'; readonly id: string; readonly message: string }
  | { readonly type: 'STOP' }
  | { readonly type: 'CLEAR' }

export function createInitialState(messages: readonly ChatMessage[]): ChatState {
  return { status: 'idle', messages, activeId: null, error: null }
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
      }

    case 'CLEAR':
      return createInitialState([])

    case 'STOP':
      // submitted | streaming → stopped. Whatever text arrived stays in the message.
      if (!isBusy(state.status)) return state
      return {
        ...state,
        status: 'stopped',
        messages: updateActive(state, (message) => ({ ...message, outcome: 'stopped' })),
        activeId: null,
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
        messages: updateActive(state, (message) => ({
          ...message,
          parts: [{ type: 'text', text: messageText(message) + action.text }],
        })),
      }

    case 'DONE': {
      const active = state.messages.find((message) => message.id === state.activeId)
      if (active === undefined || messageText(active) === '') {
        return {
          ...state,
          status: 'error',
          messages: updateActive(state, (message) => ({ ...message, outcome: 'error' })),
          activeId: null,
          error: 'The copilot returned an empty reply. Send the message again.',
        }
      }
      return {
        ...state,
        status: 'idle',
        messages: updateActive(state, (message) =>
          action.finishReason === 'stop'
            ? { ...message, outcome: 'complete' }
            : { ...message, outcome: 'complete', finishReason: action.finishReason },
        ),
        activeId: null,
      }
    }

    case 'FAIL':
      return {
        ...state,
        status: 'error',
        messages: updateActive(state, (message) => ({ ...message, outcome: 'error' })),
        activeId: null,
        error: action.message,
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
