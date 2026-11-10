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
 * Rate limit: requests that would reach a hosted (paid) model pass an in-memory
 * per-client limiter first and get `429` + `Retry-After` when over it. The
 * local engine costs nothing and is not limited. See src/lib/ai/rate-limit.ts
 * for what an in-memory limit does and does not guarantee.
 *
 * Cancellation: when the browser aborts its fetch (the Stop button), Next
 * aborts `req.signal` and/or cancels the response stream. Both feed one
 * AbortController, which stops the model call or the local token loop. No
 * `done` frame is sent after an abort: the client already knows it stopped.
 *
 * What the model says is configured in src/lib/ai/underwriting-model.ts.
 */
import { APICallError, RetryError, streamText } from 'ai'
import {
  encodeSseFrame,
  parseChatRequest,
  type ChatStreamEvent,
  type WireMessage,
} from '../../../features/ai-copilot/chatProtocol.ts'
import { streamLocalReply } from '../../../lib/ai/local-engine.ts'
import { chatRateLimiter, clientKey, describeWait } from '../../../lib/ai/rate-limit.ts'
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

/** How one hosted-model request ended, as seen by the server. */
type ModelOutcome = 'done' | 'aborted' | 'error' | 'fallback'

/**
 * One structured log line per hosted-model request: counts and timing only.
 * No prompt, no reply text, no IP, no key (CLAUDE.md §8).
 *
 * This is how server-side cancellation is measured on a real host. Press Stop
 * one second into a long reply, then read the line: `outcome: "aborted"` with a
 * small `deltas` means the disconnect reached this function and the provider
 * call was cancelled. `outcome: "done"` with a full-length `deltas` means the
 * host never told us the client left, and the whole reply was generated.
 */
function logModelRequest(entry: {
  readonly outcome: ModelOutcome
  readonly engine: string
  readonly deltas: number
  readonly outputTokens: number | null
  readonly ms: number
  /** HTTP status the provider answered with, when the request failed. */
  readonly status: number | null
}): void {
  console.info(JSON.stringify({ event: 'chat.model', ...entry }))
}

/** The model went silent past `MODEL_CONFIG.modelTimeout`, or finished without writing anything. */
class ModelSilentError extends Error {
  readonly reason: 'model call timed out' | 'model returned no text'
  constructor(reason: 'model call timed out' | 'model returned no text') {
    super(reason)
    this.name = 'ModelSilentError'
    this.reason = reason
  }
}

/**
 * The HTTP status a provider answered with, or null when there was no HTTP
 * answer (DNS, timeout, a non-HTTP error). The status is the one part of a
 * provider error that is safe to show: 401/403 = key rejected, 404 = model ID
 * not found, 429 = quota. The provider's message is never read, because it can
 * echo request details.
 */
function providerStatus(error: unknown): number | null {
  if (APICallError.isInstance(error)) return error.statusCode ?? null
  // Retries exhausted: the SDK wraps the last failure.
  if (RetryError.isInstance(error)) return providerStatus(error.lastError)
  return null
}

/**
 * Streams a hosted model and returns the output token count the provider
 * reported (null if it reported none). `sent.count` is updated as deltas go
 * out, so the caller can tell "failed before the first token" (safe to fall
 * back) from "failed halfway" (must report an error) even when this throws.
 */
async function streamFromModel(
  engine: HostedEngine,
  messages: readonly WireMessage[],
  signal: AbortSignal,
  send: Send,
  sent: { count: number },
): Promise<number | null> {
  const result = streamText({
    model: engine.model,
    instructions: buildSystemPrompt(),
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    maxOutputTokens: MODEL_CONFIG.maxOutputTokens,
    // Stop → fetch abort → this signal → the provider request is cancelled, so no more tokens are billed.
    abortSignal: signal,
    // Fail fast. The SDK's retry waits as long as the provider's `Retry-After`
    // says (up to a minute), which is longer than a person waits on a chat. One
    // failed attempt falls back to the local engine straight away instead.
    maxRetries: 0,
    timeout: MODEL_CONFIG.modelTimeout,
    // Errors are handled below from the stream's `error` part. Without this the SDK also dumps them to the console.
    onError: () => {},
    // FE-07: `tools: { score_applicant, check_transition }` and `stopWhen` go here.
  })

  let finishReason = 'stop'
  let outputTokens: number | null = null
  for await (const part of result.stream) {
    if (part.type === 'text-delta') {
      sent.count += 1
      send({ type: 'token', text: part.text })
    } else if (part.type === 'finish') {
      finishReason = part.finishReason
      outputTokens = part.totalUsage.outputTokens ?? null
    } else if (part.type === 'error') {
      throw part.error
    } else if (part.type === 'abort' && !signal.aborted) {
      // Aborted, but not by the client: the SDK's own timeout fired.
      throw new ModelSilentError('model call timed out')
    }
  }
  if (signal.aborted) return outputTokens
  // A "successful" reply with no text would leave an empty bubble. Treat it as a failure.
  if (sent.count === 0) throw new ModelSilentError('model returned no text')
  send({ type: 'done', finishReason })
  return outputTokens
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

  // 3. Rate-limit anything that would spend money. Checked before the stream
  //    opens, so an over-limit client gets a plain 429, not a half-open stream.
  if (engine.kind !== 'local') {
    const verdict = chatRateLimiter.check(clientKey(req.headers))
    if (!verdict.ok) {
      return Response.json(
        { error: `Too many requests from this network. Try again in ${describeWait(verdict.retryAfterSeconds)}.` },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
      )
    }
  }

  // 4. One abort signal for "the client went away", whichever way the platform reports it.
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
        const startedAt = Date.now()
        const log = (outcome: ModelOutcome, outputTokens: number | null, status: number | null = null): void =>
          logModelRequest({
            outcome,
            engine: engine.label,
            deltas: sent.count,
            outputTokens,
            ms: Date.now() - startedAt,
            status,
          })

        try {
          const outputTokens = await streamFromModel(engine, messages, abort.signal, send, sent)
          log(abort.signal.aborted ? 'aborted' : 'done', outputTokens)
        } catch (error) {
          if (abort.signal.aborted) {
            log('aborted', null)
            return
          }
          // Log the error class and HTTP status only. Never the prompt, the reply, the
          // provider's message or the key (CLAUDE.md §8).
          const status = providerStatus(error)
          console.error(
            '[api/chat] model stream failed:',
            error instanceof Error ? error.name : 'unknown error',
            status === null ? 'no HTTP status' : `HTTP ${status}`,
          )
          if (sent.count > 0) {
            log('error', null, status)
            send({ type: 'error', message: 'The model stopped responding part-way through. The partial reply is kept.' })
            return
          }
          // Nothing reached the user yet (bad key, rate limit, provider outage):
          // answer from the local engine and say so, instead of showing a dead chat.
          // The label carries the status, so "wrong key" and "wrong model ID" can be
          // told apart from the browser without access to the server logs.
          log('fallback', null, status)
          const reason =
            error instanceof ModelSilentError
              ? error.reason
              : error instanceof Error && error.name === 'TimeoutError'
                ? 'model call timed out'
                : status === null
                  ? 'model call failed'
                  : `model call failed: HTTP ${status}`
          send({ type: 'meta', engine: { kind: 'local', label: `local rule engine (${reason})` } })
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
