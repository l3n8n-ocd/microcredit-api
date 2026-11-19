// @vitest-environment node
/**
 * FE-11 · production hygiene on the two public, streaming route handlers, driven through the real
 * `POST` functions (no mocks of the guard or the limiter):
 *   - `maxDuration` is 30 s on both, and every inner time budget fits under it;
 *   - body size (413), JSON (400), message count and length caps (400), each as `{ error, code }`;
 *   - the per-client rate limit answers 429 + `Retry-After` before the body is even read;
 *   - the client trims long histories so a real conversation never trips its own 413.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_LIMITS, type WireMessage } from '../../../features/ai-copilot/chatProtocol.ts'
import { toWireHistory } from '../../../features/ai-copilot/chatReducer.ts'
import type { ChatMessage } from '../../../features/ai-copilot/chatTypes.ts'
import { DEFAULT_REQUEST_LIMIT, chatRateLimiter, chatRequestLimiter, createRateLimiter, requestRateLimitRule } from '../../../lib/ai/rate-limit.ts'
import { MODEL_CONFIG } from '../../../lib/ai/underwriting-model.ts'
import { MAX_JSON_BODY_BYTES, readJsonBody } from '../../../lib/http/request-guard.ts'
import { AGENT_LIMITS, MAX_REQUEST_CHARS } from '../../../lib/sentinel-scout/protocol.ts'
import * as agentRoute from '../agent/route.ts'
import * as chatRoute from '../chat/route.ts'

// `server-only` throws outside a React Server Component bundle (same as chatRoute.test.ts).
vi.mock('server-only', () => ({}))

let nextIp = 1
/** A fresh client address per test, so one test's requests never count against another's. */
function freshIp(): string {
  nextIp += 1
  return `198.51.100.${nextIp}`
}

function post(url: string, body: string | ReadableStream<Uint8Array>, ip: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': ip, ...headers },
    body,
    // Required by undici for a streamed request body.
    ...(typeof body === 'string' ? {} : { duplex: 'half' }),
  } as RequestInit)
}

const chat = (body: unknown, ip: string): Promise<Response> =>
  chatRoute.POST(post('http://localhost/api/chat', typeof body === 'string' ? body : JSON.stringify(body), ip))
const agent = (body: unknown, ip: string): Promise<Response> =>
  agentRoute.POST(post('http://localhost/api/agent', typeof body === 'string' ? body : JSON.stringify(body), ip))

const ask = (content: string): { messages: WireMessage[] } => ({ messages: [{ role: 'user', content }] })

/** A refusal is exactly `{ error, code }` (plus `retryAfterSeconds` on a 429): a fixed sentence, no stack. */
async function refusal(response: Response): Promise<{ error: string; code: string; retryAfterSeconds?: number }> {
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = (await response.json()) as { error: string; code: string; retryAfterSeconds?: number }
  expect(Object.keys(body).sort()).toEqual(response.status === 429 ? ['code', 'error', 'retryAfterSeconds'] : ['code', 'error'])
  expect(body.error).not.toMatch(/\n\s+at |Error:|node_modules|\.ts:\d+/)
  return body
}

/** A JSON body of exactly `bytes` bytes. */
function bodyOfSize(bytes: number): string {
  const shell = JSON.stringify(ask(''))
  return JSON.stringify(ask('x'.repeat(bytes - shell.length)))
}

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '')
  chatRequestLimiter.reset()
  chatRateLimiter.reset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('maxDuration: an explicit 30 s ceiling, with every inner budget under it', () => {
  it('exports maxDuration = 30 and the Node runtime on both streaming handlers', () => {
    expect(chatRoute.maxDuration).toBe(30)
    expect(agentRoute.maxDuration).toBe(30)
    expect(chatRoute.runtime).toBe('nodejs')
    expect(agentRoute.runtime).toBe('nodejs')
  })

  it('gives up on a hosted model before the host would cut the stream', () => {
    const ceilingMs = chatRoute.maxDuration * 1000
    expect(MODEL_CONFIG.modelTimeout.totalMs).toBeLessThan(ceilingMs)
    expect(MODEL_CONFIG.modelTimeout.firstChunkMs).toBeLessThan(MODEL_CONFIG.modelTimeout.totalMs)
    expect(MODEL_CONFIG.modelFirstResponseMs).toBeLessThan(MODEL_CONFIG.modelTimeout.totalMs)
  })

  it('gives the agent model planner and its fetches budgets under the ceiling', () => {
    const ceilingMs = agentRoute.maxDuration * 1000
    expect(AGENT_LIMITS.modelTimeoutMs).toBeLessThan(ceilingMs)
    expect(AGENT_LIMITS.fetchTimeoutMs).toBeLessThan(AGENT_LIMITS.modelTimeoutMs)
  })
})

describe('POST /api/chat input caps', () => {
  it('refuses a body one byte over 32 KB with 413 BODY_TOO_LARGE', async () => {
    const response = await chat(bodyOfSize(MAX_JSON_BODY_BYTES + 1), freshIp())
    expect(response.status).toBe(413)
    expect(await refusal(response)).toEqual({ error: 'Request body is over 32 KB.', code: 'BODY_TOO_LARGE' })
  })

  it('refuses on a declared Content-Length over 32 KB without reading the body at all', async () => {
    const request = post('http://localhost/api/chat', JSON.stringify(ask('hi')), freshIp(), { 'content-length': String(MAX_JSON_BODY_BYTES + 1) })
    const response = await chatRoute.POST(request)
    expect(response.status).toBe(413)
    expect((await refusal(response)).code).toBe('BODY_TOO_LARGE')
    expect(request.bodyUsed).toBe(false)
  })

  it('refuses a streamed body with no Content-Length once it passes 32 KB, without reading the rest', async () => {
    // 512 KB in 8 KB chunks, no Content-Length. Finite, so a missing cap fails the assertions below
    // (the whole body would be read, then refused as 400 INVALID_JSON) instead of hanging the run.
    let pulled = 0
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(8 * 1024).fill(0x20))
        if (pulled === 64) controller.close()
      },
    })
    const response = await chatRoute.POST(post('http://localhost/api/chat', oversized, freshIp()))
    expect(response.status).toBe(413)
    expect((await refusal(response)).code).toBe('BODY_TOO_LARGE')
    // 32 KB is four 8 KB chunks; the fifth crosses the cap and the read stops there.
    expect(pulled).toBeLessThanOrEqual(6)
  })

  it('accepts a body of exactly 32 KB as far as the size check goes', async () => {
    const result = await readJsonBody(new Request('http://localhost', { method: 'POST', body: bodyOfSize(MAX_JSON_BODY_BYTES) }), MAX_JSON_BODY_BYTES)
    expect(result.ok).toBe(true)
  })

  it.each([
    ['a body that is not JSON', 'not json', 'INVALID_JSON'],
    ['more than 24 messages', { messages: Array.from({ length: 25 }, () => ({ role: 'user', content: 'hi' })) }, 'INVALID_REQUEST'],
    ['a user message over 2,000 characters', ask('x'.repeat(CHAT_LIMITS.maxUserChars + 1)), 'INVALID_REQUEST'],
    [
      'an echoed assistant turn over 4,000 characters',
      { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'x'.repeat(4_001) }, { role: 'user', content: 'and?' }] },
      'INVALID_REQUEST',
    ],
  ])('refuses %s with 400 and a code, and opens no stream', async (_label, body, code) => {
    const response = await chat(body, freshIp())
    expect(response.status).toBe(400)
    expect((await refusal(response)).code).toBe(code)
  })

  it('names the exact cap in the message', async () => {
    const response = await chat({ messages: Array.from({ length: 25 }, () => ({ role: 'user', content: 'hi' })) }, freshIp())
    expect((await refusal(response)).error).toBe('At most 24 messages per request.')
  })

  it('streams a request at every cap at once: 24 messages, a 2,000-character question, 4,000-character replies', async () => {
    const messages: WireMessage[] = Array.from({ length: 24 }, (_, index) =>
      index % 2 === 0 ? { role: 'user', content: 'u'.repeat(400) } : { role: 'assistant', content: 'a'.repeat(1_500) },
    )
    messages[22] = { role: 'user', content: 'q'.repeat(CHAT_LIMITS.maxUserChars) }
    messages[21] = { role: 'assistant', content: 'a'.repeat(CHAT_LIMITS.maxAssistantChars) }
    messages.pop()
    messages.push({ role: 'user', content: 'Walk me through the 10 loan states.' })
    expect(new TextEncoder().encode(JSON.stringify({ messages })).byteLength).toBeLessThanOrEqual(MAX_JSON_BODY_BYTES)
    const response = await chat({ messages }, freshIp())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    await response.body?.cancel()
  })
})

describe('the client keeps a long conversation under the cap', () => {
  const turn = (index: number, role: ChatMessage['role'], text: string): ChatMessage => ({
    id: `m${index}`,
    role,
    parts: [{ type: 'text', text }],
    createdAt: '2026-11-19T00:00:00.000Z',
    outcome: 'complete',
  })

  it('drops the oldest turns until the history fits, keeps the newest question, starts on a user turn', async () => {
    // 30 turns of long replies: about 70 KB before trimming.
    const long = Array.from({ length: 30 }, (_, index) =>
      turn(index, index % 2 === 0 ? 'user' : 'assistant', index % 2 === 0 ? `question ${index} ${'q'.repeat(1_200)}` : 'r'.repeat(9_000)),
    )
    long.push(turn(30, 'user', 'And the last one?'))
    const history = toWireHistory(long)
    const bytes = new TextEncoder().encode(JSON.stringify({ messages: history })).byteLength
    expect(bytes).toBeLessThanOrEqual(CHAT_LIMITS.maxBodyBytes - CHAT_LIMITS.historyHeadroomBytes)
    expect(history[0]?.role).toBe('user')
    expect(history.at(-1)).toEqual({ role: 'user', content: 'And the last one?' })
    expect(history.every((message) => message.role === 'user' || message.content.length <= CHAT_LIMITS.maxAssistantChars)).toBe(true)

    // And the server takes it.
    const response = await chat({ messages: history }, freshIp())
    expect(response.status).toBe(200)
    await response.body?.cancel()
  })
})

describe('per-client rate limit: 20 requests per 60 s, then 429 + Retry-After', () => {
  it('lets 20 requests through, refuses the 21st with a structured 429, and leaves other clients alone', async () => {
    const ip = freshIp()
    // Any request counts, valid or not: these 20 are cheap 400s.
    for (let request = 1; request <= DEFAULT_REQUEST_LIMIT.limit; request += 1) {
      expect((await chat({ messages: [] }, ip)).status).toBe(400)
    }

    const limited = await chat(ask('Walk me through the 10 loan states.'), ip)
    expect(limited.status).toBe(429)
    const retryAfter = Number(limited.headers.get('retry-after'))
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
    expect(await refusal(limited)).toEqual({
      error: expect.stringMatching(/^Too many requests from this network\. Try again in \d+ seconds?\.$/),
      code: 'RATE_LIMITED',
      retryAfterSeconds: retryAfter,
    })

    const other = await chat(ask('Walk me through the 10 loan states.'), freshIp())
    expect(other.status).toBe(200)
    await other.body?.cancel()
  })

  it('refuses an over-limit client before reading its body: a 1 MB body still gets 429, not 413', async () => {
    const ip = freshIp()
    for (let request = 1; request <= DEFAULT_REQUEST_LIMIT.limit; request += 1) await chat('{}', ip)
    const response = await chat(bodyOfSize(1024 * 1024), ip)
    expect(response.status).toBe(429)
  })

  it('opens a slot again once the oldest request leaves the 60 s window (sliding window)', () => {
    let now = 0
    const limiter = createRateLimiter([DEFAULT_REQUEST_LIMIT], { now: () => now })
    for (let request = 1; request <= 20; request += 1) {
      expect(limiter.check('client').ok).toBe(true)
      now += 1_000
    }
    expect(limiter.check('client')).toEqual({ ok: false, retryAfterSeconds: 40 })
    now = 60_000
    expect(limiter.check('client').ok).toBe(true)
    expect(limiter.check('client').ok).toBe(false)
  })

  it('reads CHAT_RATE_LIMIT_MAX / CHAT_RATE_LIMIT_WINDOW_MS, and falls back to 20 / 60 s on bad values', () => {
    expect(requestRateLimitRule({})).toEqual({ limit: 20, windowMs: 60_000 })
    expect(requestRateLimitRule({ CHAT_RATE_LIMIT_MAX: '5', CHAT_RATE_LIMIT_WINDOW_MS: '10000' })).toEqual({ limit: 5, windowMs: 10_000 })
    for (const bad of ['', 'abc', '0', '-3', '1.5', '1e3', '99999999']) {
      expect(requestRateLimitRule({ CHAT_RATE_LIMIT_MAX: bad, CHAT_RATE_LIMIT_WINDOW_MS: bad })).toEqual({ limit: 20, windowMs: 60_000 })
    }
  })

  it('reports the rule (never a client address) on GET /api/chat', async () => {
    const ip = freshIp()
    await chat({ messages: [] }, ip)
    const status = (await chatRoute.GET().json()) as Record<string, unknown>
    expect(status.requestLimit).toEqual({ rule: { limit: 20, windowMs: 60_000 }, appliesTo: 'every POST', trackedClients: 1 })
    expect(JSON.stringify(status)).not.toContain(ip)
  })
})

describe('POST /api/agent caps and rate limit', () => {
  it('refuses a body over 4 KB with 413', async () => {
    const response = await agent(JSON.stringify({ request: 'x'.repeat(AGENT_LIMITS.maxBodyBytes) }), freshIp())
    expect(response.status).toBe(413)
    expect((await refusal(response)).code).toBe('BODY_TOO_LARGE')
  })

  it('refuses a request over 600 characters and a non-JSON body with 400', async () => {
    const tooLong = await agent({ request: 'x'.repeat(MAX_REQUEST_CHARS + 1) }, freshIp())
    expect(tooLong.status).toBe(400)
    expect((await refusal(tooLong)).code).toBe('INVALID_REQUEST')
    const notJson = await agent('not json', freshIp())
    expect(notJson.status).toBe(400)
    expect((await refusal(notJson)).code).toBe('INVALID_JSON')
  })

  it('allows 6 runs a minute per client, then 429 + Retry-After, before any run starts', async () => {
    const ip = freshIp()
    for (let request = 1; request <= 6; request += 1) expect((await agent('{}', ip)).status).toBe(400)
    const limited = await agent({ request: 'Is next affected by a known advisory?' }, ip)
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await refusal(limited)).code).toBe('RATE_LIMITED')
  })
})
