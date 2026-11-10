// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createGoogle } from '@ai-sdk/google'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../../../app/api/chat/route.ts'
import { createSseParser, type ChatStreamEvent } from '../../../features/ai-copilot/chatProtocol.ts'
import { chatRateLimiter } from '../rate-limit.ts'
import type { ChatEngine } from '../underwriting-model.ts'

/**
 * The other route tests use the SDK's mock model, which skips HTTP entirely.
 * This one runs the REAL `@ai-sdk/google` provider against a local server that
 * speaks Gemini's `streamGenerateContent?alt=sse` wire format. It checks the
 * part a mock cannot: what request we send, and that a real streamed HTTP
 * response comes out of `/api/chat` as tokens. No network, no real key.
 */
vi.mock('server-only', () => ({}))

const injected = vi.hoisted(() => ({ engine: null as unknown }))

vi.mock('../underwriting-model.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../underwriting-model.ts')>()
  return {
    ...actual,
    // A short first-response watchdog and an instant local engine, so the stall case
    // finishes in under a second. The SDK's own timeouts stay long on purpose: they
    // must not be what rescues a provider that never starts answering.
    MODEL_CONFIG: {
      ...actual.MODEL_CONFIG,
      modelTimeout: { firstChunkMs: 30_000, chunkMs: 30_000, totalMs: 30_000 },
      modelFirstResponseMs: 300,
      localTokenDelayMs: 0,
      localFirstTokenDelayMs: 0,
    },
    resolveChatEngine: () => injected.engine as ChatEngine,
  }
})

interface SeenRequest {
  readonly url: string
  readonly apiKeyHeader: string | undefined
  readonly body: Record<string, unknown>
}

let server: Server
let baseURL = ''
const seen: SeenRequest[] = []
/** What the fake Gemini does with the next request. */
let behaviour: 'stream' | 'stall' = 'stream'

const sseChunk = (payload: unknown): string => `data: ${JSON.stringify(payload)}\r\n\r\n`
const textChunk = (text: string): string =>
  sseChunk({ candidates: [{ content: { role: 'model', parts: [{ text }] }, index: 0 }] })

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      seen.push({
        url: request.url ?? '',
        apiKeyHeader: request.headers['x-goog-api-key']?.toString(),
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      })
      // "stall": accept the request and never answer, which is what the live alias did.
      if (behaviour === 'stall') return
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(textChunk('No. `REJECTED` '))
      setTimeout(() => {
        response.write(textChunk('is terminal.'))
        response.end(
          sseChunk({
            candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP', index: 0 }],
            usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 7, totalTokenCount: 907 },
          }),
        )
      }, 30)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1beta`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  seen.length = 0
  behaviour = 'stream'
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  injected.engine = {
    kind: 'google',
    label: 'gemini-test-model',
    model: createGoogle({ apiKey: 'unit-test-value-not-a-key', baseURL })('gemini-test-model'),
    reasoning: 'low',
  }
})

afterEach(() => {
  chatRateLimiter.reset()
  vi.restoreAllMocks()
})

async function ask(content: string): Promise<ChatStreamEvent[]> {
  const response = await POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content }] }),
    }),
  )
  const events: ChatStreamEvent[] = []
  createSseParser((event) => events.push(event)).push(await response.text())
  return events
}

describe('POST /api/chat with the real @ai-sdk/google provider over HTTP', () => {
  it('streams a Gemini SSE response through to tokens and done', async () => {
    const events = await ask('Can a REJECTED loan be DISBURSED?')
    expect(events).toEqual([
      { type: 'meta', engine: { kind: 'google', label: 'gemini-test-model' } },
      { type: 'token', text: 'No. `REJECTED` ' },
      { type: 'token', text: 'is terminal.' },
      { type: 'done', finishReason: 'stop' },
    ])
  })

  it('sends the key in a header, the system prompt as systemInstruction, and the output cap', async () => {
    await ask('Can a REJECTED loan be DISBURSED?')
    expect(seen).toHaveLength(1)
    const request = seen[0]
    expect(request?.url).toBe('/v1beta/models/gemini-test-model:streamGenerateContent?alt=sse')
    // The key travels in a header, never in the URL (URLs end up in logs).
    expect(request?.apiKeyHeader).toBe('unit-test-value-not-a-key')
    expect(request?.url).not.toContain('unit-test-value-not-a-key')
    expect(JSON.stringify(request?.body.systemInstruction)).toContain('Underwriting & Ledger Risk Copilot')
    expect(JSON.stringify(request?.body.contents)).toContain('Can a REJECTED loan be DISBURSED?')
    expect(request?.body.generationConfig).toMatchObject({ maxOutputTokens: 4096 })
  })

  it('falls back after the first-response watchdog when the provider accepts the request and never answers', async () => {
    behaviour = 'stall'
    const startedAt = Date.now()
    const events = await ask('Can a REJECTED loan be DISBURSED?')
    // Far below the 30 s SDK timeouts configured above: the watchdog did this.
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(seen).toHaveLength(1) // one attempt, no retry
    expect(events.filter((event) => event.type === 'meta').at(-1)).toEqual({
      type: 'meta',
      engine: { kind: 'local', label: 'local rule engine (model call timed out: no response)' },
    })
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' })
  })
})
