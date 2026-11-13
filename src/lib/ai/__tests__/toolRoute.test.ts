// @vitest-environment node
/**
 * FE-07: tool calls through the real `POST /api/chat` handler.
 *
 * Every path must emit the same lifecycle, in order, for one `toolCallId`:
 *   tool-input-start → tool-input-delta+ → tool-input-available → tool-output-available | tool-output-error
 * Paths: the local engine, the `tool-error` drill, a direct sanitized retry,
 * and a hosted model (a mock `LanguageModelV4` driving the real AI SDK `streamText`).
 */
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../../../app/api/chat/route.ts'
import { createSseParser, type ChatStreamEvent } from '../../../features/ai-copilot/chatProtocol.ts'
import type { ChatEngine } from '../underwriting-model.ts'
import { ledgerOutputSchema, proposalOutputSchema, trustScoreOutputSchema } from '../tools.ts'

vi.mock('server-only', () => ({}))

const injected = vi.hoisted(() => ({ engine: null as unknown }))

vi.mock('../underwriting-model.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../underwriting-model.ts')>()
  return {
    ...actual,
    MODEL_CONFIG: { ...actual.MODEL_CONFIG, localTokenDelayMs: 0, localFirstTokenDelayMs: 0, localToolDeltaMs: 0, localToolExecuteMs: 0 },
    resolveChatEngine: () => (injected.engine as ChatEngine | null) ?? actual.resolveChatEngine(),
  }
})

afterEach(() => {
  injected.engine = null
  vi.unstubAllEnvs()
})

function post(body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

async function events(response: Response): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = []
  createSseParser((event) => out.push(event)).push(await response.text())
  return out
}

const ask = (content: string) => ({ messages: [{ role: 'user', content }] })

/** The provider-level stream part type, read off the mock (as chatRoute.test.ts does). */
type StreamResult = Awaited<ReturnType<MockLanguageModelV4['doStream']>>
type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never

/** The lifecycle of the (single) tool call in a reply, as a compact list of frame types. */
function lifecycle(all: readonly ChatStreamEvent[]): string[] {
  const types = all.filter((event) => event.type.startsWith('tool-')).map((event) => event.type)
  return types.filter((type, index) => type !== 'tool-input-delta' || types[index - 1] !== 'tool-input-delta')
}

function noKeys(): void {
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '')
}

describe('POST /api/chat — local engine tool calls', () => {
  it('trust score: streams the 4-frame lifecycle, then a summary, and the output matches its schema', async () => {
    noKeys()
    const all = await events(
      await post(ask("Run the trust score tool for Nena's Sari-Sari Store: 92% of utility bills on time, 18 supplier invoices, 5 GCash load top-ups a week, requesting ₱15,000.00.")),
    )
    expect(lifecycle(all)).toEqual(['tool-input-start', 'tool-input-delta', 'tool-input-available', 'tool-output-available'])
    const ids = new Set(all.flatMap((event) => ('toolCallId' in event ? [event.toolCallId] : [])))
    expect(ids.size).toBe(1)
    // The deltas join into exactly the input that was then declared available.
    const joined = all.map((event) => (event.type === 'tool-input-delta' ? event.delta : '')).join('')
    const available = all.find((event) => event.type === 'tool-input-available')
    expect(available?.type === 'tool-input-available' && JSON.parse(joined)).toEqual(available?.type === 'tool-input-available' ? available.input : null)
    expect(available?.type === 'tool-input-available' ? available.input : null).toMatchObject({
      monthlyUtilityOnTimeRatio: 92,
      supplierInvoiceCount: 18,
      gcashLoadWeeklyCadence: 5,
      requestedCentavos: 1_500_000,
    })
    const output = all.find((event) => event.type === 'tool-output-available')
    const parsed = trustScoreOutputSchema.parse(output?.type === 'tool-output-available' ? output.output : null)
    expect(parsed).toMatchObject({ score: 798, riskTier: 'LOW_RISK', requested: { centavos: 1_500_000, decision: 'WITHIN_LIMIT' } })
    expect(all.at(-1)).toEqual({ type: 'done', finishReason: 'stop' })
    expect(all.filter((event) => event.type === 'token').map((event) => (event.type === 'token' ? event.text : '')).join('')).toContain('798 / 1000')
  })

  it('ledger audit: 201 CREATED, then the same key REPLAYED, one entry, Σ debits === Σ credits', async () => {
    noKeys()
    const all = await events(await post(ask('Run the ledger audit tool on L-1042: ₱5,000.00 to GCash at version 3.')))
    const output = all.find((event) => event.type === 'tool-output-available')
    const parsed = ledgerOutputSchema.parse(output?.type === 'tool-output-available' ? output.output : null)
    expect(parsed).toMatchObject({
      firstAttempt: { status: 201, kind: 'CREATED' },
      retrySameKey: { status: 201, kind: 'REPLAYED' },
      ledgerEntriesPosted: 1,
      debitsCentavos: 500_000,
      creditsCentavos: 500_000,
      balanced: true,
      idempotencyStatus: 'NEW_INTENT_POSTED_ONCE',
    })
  })

  it('proposal: AWAITING_CONFIRMATION with If-Match and a UUID v4 key, and nothing posted', async () => {
    noKeys()
    const all = await events(await post(ask('Propose disbursing ₱5,000.00 on L-1042 to GCash at version 3 for my confirmation.')))
    const output = all.find((event) => event.type === 'tool-output-available')
    const parsed = proposalOutputSchema.parse(output?.type === 'tool-output-available' ? output.output : null)
    expect(parsed).toMatchObject({ status: 'AWAITING_CONFIRMATION', ifMatch: '"3"', fromState: 'APPROVED', toState: 'DISBURSED' })
    expect(parsed.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('tool-error drill: input-available, then output-error ERR_TOOL_SCHEMA_BOUNDS naming the field', async () => {
    const all = await events(await post(ask('anything'), { 'x-sabotage-mode': 'tool-error' }))
    expect(lifecycle(all)).toEqual(['tool-input-start', 'tool-input-delta', 'tool-input-available', 'tool-output-error'])
    const error = all.find((event) => event.type === 'tool-output-error')
    expect(error).toMatchObject({ errorCode: 'ERR_TOOL_SCHEMA_BOUNDS', errorText: expect.stringContaining('requestedCentavos') })
    expect(all[0]).toEqual({ type: 'meta', engine: { kind: 'local', label: 'local rule engine (sabotage drill: tool-error)' } })
  })

  it('direct retry: runs exactly the named tool with the sanitized input, no model', async () => {
    const input = {
      borrowerName: "Nena's Sari-Sari Store",
      businessType: 'sari-sari',
      monthlyUtilityOnTimeRatio: 92,
      supplierInvoiceCount: 18,
      gcashLoadWeeklyCadence: 5,
    }
    const all = await events(await post({ ...ask('Retry evaluateBorrowerTrustScore with sanitized inputs'), toolCall: { toolName: 'evaluateBorrowerTrustScore', input } }))
    expect(all[0]).toEqual({ type: 'meta', engine: { kind: 'local', label: 'local tool runner (retry with sanitized inputs)' } })
    const output = all.find((event) => event.type === 'tool-output-available')
    expect(trustScoreOutputSchema.parse(output?.type === 'tool-output-available' ? output.output : null).requested).toBeNull()
    expect((await post({ ...ask('x'), toolCall: { toolName: 'dropTables', input: {} } })).status).toBe(400)
  })
})

describe('POST /api/chat — hosted model tool calls (mock model, real streamText)', () => {
  it('maps the AI SDK tool parts to the same 4-frame lifecycle, then streams the model summary', async () => {
    const input = JSON.stringify({
      borrowerName: "Liza's Bigasan & Load",
      businessType: 'market-vendor',
      monthlyUtilityOnTimeRatio: 70,
      supplierInvoiceCount: 4,
      gcashLoadWeeklyCadence: 2,
    })
    let step = 0
    const usage = {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
    }
    const model = new MockLanguageModelV4({
      doStream: async () => {
        step += 1
        const chunks: StreamPart[] =
          step === 1
            ? [
                { type: 'tool-input-start' as const, id: 'call_1', toolName: 'evaluateBorrowerTrustScore' },
                { type: 'tool-input-delta' as const, id: 'call_1', delta: input.slice(0, 40) },
                { type: 'tool-input-delta' as const, id: 'call_1', delta: input.slice(40) },
                { type: 'tool-input-end' as const, id: 'call_1' },
                { type: 'tool-call' as const, toolCallId: 'call_1', toolName: 'evaluateBorrowerTrustScore', input },
                { type: 'finish' as const, finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' }, usage },
              ]
            : [
                { type: 'text-start' as const, id: 't1' },
                { type: 'text-delta' as const, id: 't1', delta: 'Liza is HIGH_RISK.' },
                { type: 'text-end' as const, id: 't1' },
                { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'end_turn' }, usage },
              ]
        return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) }
      },
    })
    injected.engine = { kind: 'anthropic', label: 'mock-model', model }

    const all = await events(await post(ask("Score Liza's Bigasan & Load.")))
    expect(lifecycle(all)).toEqual(['tool-input-start', 'tool-input-delta', 'tool-input-available', 'tool-output-available'])
    expect(all.find((event) => event.type === 'tool-input-start')).toMatchObject({ toolCallId: 'call_1', rationale: expect.stringContaining("Model's choice") })
    const output = all.find((event) => event.type === 'tool-output-available')
    expect(trustScoreOutputSchema.parse(output?.type === 'tool-output-available' ? output.output : null)).toMatchObject({
      riskTier: 'HIGH_RISK',
      requested: null,
    })
    expect(all.filter((event) => event.type === 'token')).toEqual([{ type: 'token', text: 'Liza is HIGH_RISK.' }])
    expect(all.at(-1)).toEqual({ type: 'done', finishReason: 'stop' })
    expect(step).toBe(2)
  })

  it('a model call with out-of-bounds input becomes output-error ERR_TOOL_SCHEMA_BOUNDS', async () => {
    const input = JSON.stringify({
      borrowerName: 'Nena',
      businessType: 'sari-sari',
      monthlyUtilityOnTimeRatio: 140,
      supplierInvoiceCount: 4,
      gcashLoadWeeklyCadence: 2,
    })
    let step = 0
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    }
    injected.engine = {
      kind: 'anthropic',
      label: 'mock-model',
      model: new MockLanguageModelV4({
        doStream: async () => {
          step += 1
          const chunks: StreamPart[] =
            step === 1
              ? [
                  { type: 'tool-call' as const, toolCallId: 'call_9', toolName: 'evaluateBorrowerTrustScore', input },
                  { type: 'finish' as const, finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' }, usage },
                ]
              : [
                  { type: 'text-start' as const, id: 't' },
                  { type: 'text-delta' as const, id: 't', delta: 'The tool rejected the input.' },
                  { type: 'text-end' as const, id: 't' },
                  { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'end_turn' }, usage },
                ]
          return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) }
        },
      }),
    }
    const all = await events(await post(ask('Score Nena.')))
    expect(lifecycle(all).slice(0, 1)).toEqual(['tool-input-start'])
    expect(lifecycle(all).at(-1)).toBe('tool-output-error')
    expect(all.find((event) => event.type === 'tool-output-error')).toEqual({
      type: 'tool-output-error',
      toolCallId: 'call_9',
      errorCode: 'ERR_TOOL_SCHEMA_BOUNDS',
      errorText: 'monthlyUtilityOnTimeRatio: Too big: expected number to be <=100',
    })
  })
})
