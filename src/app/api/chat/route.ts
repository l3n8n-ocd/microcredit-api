/**
 * POST /api/chat — streaming endpoint for the Underwriting & Ledger Risk Copilot.
 *
 * Request:  { "messages": [{ "role": "user" | "assistant", "content": string }] }
 * Response: Server-Sent Events, one JSON frame per `data:` line
 *           (`meta` → `token` × N → `done`, or `error`). See chatProtocol.ts.
 *
 * Two engines, one wire format:
 *   - a hosted model through the AI SDK's `streamText`, when ANTHROPIC_API_KEY
 *     or GOOGLE_GENERATIVE_AI_API_KEY is set (server-side only);
 *   - the local rule engine otherwise, streamed one token every ~22 ms.
 * The first frame always names the engine, so the UI can label the reply honestly.
 *
 * Cancellation: when the browser aborts its fetch (the Stop button), Next
 * aborts `req.signal` and/or cancels the response stream. Both feed one
 * AbortController, which stops the model call or the local token loop. No
 * `done` frame is sent after an abort: the client already knows it stopped.
 *
 * What the model says is configured in src/lib/ai/underwriting-model.ts.
 */
import { streamText } from 'ai'
import {
  encodeSseFrame,
  parseChatRequest,
  type ChatStreamEvent,
  type WireMessage,
} from '../../../features/ai-copilot/chatProtocol.ts'
import { streamLocalReply } from '../../../lib/ai/local-engine.ts'
import {
  MODEL_CONFIG,
  buildSystemPrompt,
  describeEngine,
  resolveChatEngine,
  type ChatEngine,
} from '../../../lib/ai/underwriting-model.ts'

/** Node runtime: the AI SDK providers and `crypto.randomUUID` in the local engine both run there. */
export const runtime = 'nodejs'
/** Vercel function ceiling in seconds. A reply is capped by `maxOutputTokens` well before this. */
export const maxDuration = 60

type Send = (event: ChatStreamEvent) => void
type HostedEngine = Exclude<ChatEngine, { kind: 'local' }>

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  // `no-transform` stops proxies from gzip-buffering the stream into one burst.
  'Cache-Control': 'no-cache, no-transform',
  // Same idea for nginx-style reverse proxies.
  'X-Accel-Buffering': 'no',
} as const

async function streamFromLocalEngine(messages: readonly WireMessage[], signal: AbortSignal, send: Send): Promise<void> {
  const tokens = streamLocalReply(messages, {
    signal,
    tokenDelayMs: MODEL_CONFIG.localTokenDelayMs,
    firstTokenDelayMs: MODEL_CONFIG.localFirstTokenDelayMs,
  })
  for await (const text of tokens) send({ type: 'token', text })
  if (!signal.aborted) send({ type: 'done', finishReason: 'stop' })
}

/**
 * Streams a hosted model. Returns how many text deltas were sent before it
 * ended or threw, so the caller can tell "failed before the first token"
 * (safe to fall back) from "failed halfway" (must report an error).
 */
async function streamFromModel(
  engine: HostedEngine,
  messages: readonly WireMessage[],
  signal: AbortSignal,
  send: Send,
  sent: { count: number },
): Promise<void> {
  const result = streamText({
    model: engine.model,
    instructions: buildSystemPrompt(),
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    maxOutputTokens: MODEL_CONFIG.maxOutputTokens,
    // Stop → fetch abort → this signal → the provider request is cancelled, so no more tokens are billed.
    abortSignal: signal,
    maxRetries: 1,
    // Errors are handled below from the stream's `error` part. Without this the SDK also dumps them to the console.
    onError: () => {},
    // FE-07: `tools: { score_applicant, check_transition }` and `stopWhen` go here.
  })

  let finishReason = 'stop'
  for await (const part of result.stream) {
    if (part.type === 'text-delta') {
      sent.count += 1
      send({ type: 'token', text: part.text })
    } else if (part.type === 'finish') {
      finishReason = part.finishReason
    } else if (part.type === 'error') {
      throw part.error
    }
  }
  if (!signal.aborted) send({ type: 'done', finishReason })
}

export async function POST(req: Request): Promise<Response> {
  // 1. Validate. The body is `unknown` until `parseChatRequest` has checked every field.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 })
  }
  const parsed = parseChatRequest(body)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
  const { messages } = parsed

  // 2. Pick the engine. Keys are read here, on the server, per request.
  const engine = resolveChatEngine()

  // 3. One abort signal for "the client went away", whichever way the platform reports it.
  const abort = new AbortController()
  const onRequestAbort = (): void => abort.abort()
  if (req.signal.aborted) abort.abort()
  else req.signal.addEventListener('abort', onRequestAbort, { once: true })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Send = (event) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(encodeSseFrame(event)))
      }

      try {
        send({ type: 'meta', engine: describeEngine(engine) })

        if (engine.kind === 'local') {
          await streamFromLocalEngine(messages, abort.signal, send)
          return
        }

        const sent = { count: 0 }
        try {
          await streamFromModel(engine, messages, abort.signal, send, sent)
        } catch (error) {
          if (abort.signal.aborted) return
          // Log the error class only. Never the prompt, the reply or the key (CLAUDE.md §8).
          console.error('[api/chat] model stream failed:', error instanceof Error ? error.name : 'unknown error')
          if (sent.count > 0) {
            send({ type: 'error', message: 'The model stopped responding part-way through. The partial reply is kept.' })
            return
          }
          // Nothing reached the user yet (bad key, rate limit, provider outage):
          // answer from the local engine and say so, instead of showing a dead chat.
          send({ type: 'meta', engine: { kind: 'local', label: 'local rule engine (model call failed)' } })
          await streamFromLocalEngine(messages, abort.signal, send)
        }
      } catch {
        if (!abort.signal.aborted) send({ type: 'error', message: 'The copilot could not produce a reply.' })
      } finally {
        req.signal.removeEventListener('abort', onRequestAbort)
        try {
          controller.close()
        } catch {
          // Already closed by `cancel` below.
        }
      }
    },
    cancel() {
      abort.abort()
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
