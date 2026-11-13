/**
 * Client-side chat types. Types and one pure helper only, so both the server
 * page (`src/app/underwriting/page.tsx`) and the `'use client'` chat can import it.
 */
import type { EngineInfo, SabotageMode } from './chatProtocol.ts'

/**
 * The whole chat is in exactly one of these. Send and Stop are derived from it,
 * never from a pair of booleans that could disagree.
 *
 *   idle ──send──▶ submitted ──first token──▶ streaming ──done──▶ idle
 *                      │                          │
 *                      └────────── stop ──────────┴──▶ stopped ──send──▶ submitted
 *                      └────────── fail ──────────┴──▶ error   ──send──▶ submitted
 */
export type ChatStatus = 'idle' | 'submitted' | 'streaming' | 'stopped' | 'error'

/**
 * FE-08: why a reply failed. Each kind has its own recovery copy and code.
 *   offline     nothing was sent (no connection, or the network-drop drill)
 *   rate-limit  HTTP 429; `Retry-After` drives a countdown
 *   malformed   a stream frame was not valid JSON (a cut-off tool payload)
 *   mid-stream  the server sent an error frame after some text arrived
 *   closed      the connection ended before a `done` frame
 *   empty       `done` arrived with no text
 *   server      the server sent an error frame before any text
 *   http        any other non-2xx response
 */
export type ChatFailureKind = 'offline' | 'rate-limit' | 'malformed' | 'mid-stream' | 'closed' | 'empty' | 'server' | 'http'

/** A message is a list of typed parts: text, and (FE-07) tool calls, in the order they streamed. */
export interface TextPart {
  readonly type: 'text'
  readonly text: string
}

/**
 * FE-07: the four states of one tool call, in order. See the state machine at
 * the top of ToolInvocationCard.tsx.
 */
export const TOOL_STATES = ['input-streaming', 'input-available', 'output-available', 'output-error'] as const
export type ToolState = (typeof TOOL_STATES)[number]

/** What the officer did with a `proposeDisbursementExecution` proposal. Recorded in the message, so it survives a reload. */
export type ToolDecision =
  | { readonly kind: 'cancelled'; readonly at: string }
  | {
      readonly kind: 'executed'
      readonly at: string
      /** HTTP status and response kind from the disbursement server: `201 CREATED`, `409 CONFLICT`… */
      readonly status: number
      readonly outcome: string
      readonly message: string
      readonly loanStatus: string | null
      readonly loanVersion: number | null
      readonly debitsCentavos: number | null
      readonly creditsCentavos: number | null
      /** Disbursement entries for this loan in the ledger after the request: 1 means paid once. */
      readonly entriesForLoan: number
      /** Times the officer re-sent the same request to test the replay, and what came back last. */
      readonly replays: number
      readonly lastReplay: string | null
    }

export interface ToolPart {
  readonly type: 'tool'
  readonly toolCallId: string
  readonly toolName: string
  readonly state: ToolState
  /** Why this tool: from the local planner, or the tool's purpose when a model chose it. */
  readonly rationale: string
  /** The input JSON as it streamed in, possibly incomplete. */
  readonly inputText: string
  /** `unknown` until the card validates it against the tool's schema. */
  readonly input: unknown
  readonly output: unknown
  readonly errorCode: string | null
  readonly errorText: string | null
  /** When each state was reached (epoch ms), for the inspector's timing. */
  readonly timeline: readonly { readonly state: ToolState; readonly at: number }[]
  readonly decision: ToolDecision | null
}

export type ChatMessagePart = TextPart | ToolPart

/** How one message ended. `pending` is the live assistant bubble: thinking, then streaming. */
export type MessageOutcome = 'pending' | 'complete' | 'stopped' | 'error'

export interface ChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly parts: readonly ChatMessagePart[]
  /** ISO 8601, set when the message is created. */
  readonly createdAt: string
  readonly outcome: MessageOutcome
  /** Which engine wrote an assistant message (from the stream's `meta` frame). */
  readonly engine?: EngineInfo
  /** Present when a reply ended for a reason other than a normal stop, e.g. `length`. */
  readonly finishReason?: string
}

/** A one-click chip. `label` is the short chip text, `prompt` is what gets sent. */
export interface StarterPrompt {
  readonly id: string
  readonly label: string
  readonly prompt: string
  /** FE-07: a chip that is itself a drill (e.g. `tool-error`) sends with that sabotage header. */
  readonly drill?: SabotageMode
}

/** The message's text, tool parts skipped. */
export function messageText(message: ChatMessage): string {
  return message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')
}

export function toolPartsOf(message: ChatMessage): readonly ToolPart[] {
  return message.parts.filter((part): part is ToolPart => part.type === 'tool')
}
