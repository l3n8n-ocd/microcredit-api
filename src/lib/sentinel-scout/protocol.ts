/**
 * What /api/agent sends to the browser: one AgentEvent per line (NDJSON).
 * Isomorphic: no Node imports, so the client component can use the guard.
 */
import type { AgentEvent } from './engine.ts'

export const MAX_REQUEST_CHARS = 600

const EVENT_TYPES = ['start', 'turn', 'tool_call', 'tool_result', 'guardrail', 'final', 'halt'] as const

export function isAgentEvent(value: unknown): value is AgentEvent {
  if (typeof value !== 'object' || value === null || !('type' in value) || !('at' in value)) return false
  return (EVENT_TYPES as readonly unknown[]).includes(value.type) && typeof value.at === 'string'
}

export type AgentRequestParse =
  | { readonly ok: true; readonly request: string; readonly planner: 'rules' | 'model' }
  | { readonly ok: false; readonly error: string }

export function parseAgentRequest(body: unknown): AgentRequestParse {
  if (typeof body !== 'object' || body === null || !('request' in body) || typeof body.request !== 'string') {
    return { ok: false, error: 'Body must be { "request": string, "planner"?: "rules" | "model" }.' }
  }
  const request = body.request.trim()
  if (request === '') return { ok: false, error: 'request must not be empty.' }
  if (request.length > MAX_REQUEST_CHARS) return { ok: false, error: `request is over ${MAX_REQUEST_CHARS} characters.` }
  const planner = 'planner' in body && body.planner === 'model' ? 'model' : 'rules'
  return { ok: true, request, planner }
}
