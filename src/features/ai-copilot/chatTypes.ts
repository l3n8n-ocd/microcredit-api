/**
 * Client-side chat types. Types and one pure helper only, so both the server
 * page (`src/app/underwriting/page.tsx`) and the `'use client'` chat can import it.
 */
import type { EngineInfo } from './chatProtocol.ts'

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

/** A message is a list of typed parts. FE-06 has text only; FE-07 adds tool-call and tool-result parts here. */
export interface TextPart {
  readonly type: 'text'
  readonly text: string
}
export type ChatMessagePart = TextPart

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
}

export function messageText(message: ChatMessage): string {
  return message.parts.map((part) => part.text).join('')
}
