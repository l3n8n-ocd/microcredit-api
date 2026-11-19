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
 * FE-11 production hygiene, in the order a request meets it:
 *   1. every POST passes a per-client limit (default 20 per 60 s, `CHAT_RATE_LIMIT_MAX` /
 *      `CHAT_RATE_LIMIT_WINDOW_MS`) before its body is read: `429` + `Retry-After`;
 *   2. the body is read with a 32 KB cap (`413`) and must be JSON (`400`);
 *   3. at most 24 messages, 2,000 characters per user turn and 4,000 per echoed assistant turn (`400`);
 *   4. requests that would reach a hosted (paid) model pass a second, stricter limiter (10 a minute,
 *      100 a day): `429` + `Retry-After`.
 * Every refusal is `{ error, code }` JSON with a fixed message: no exception text, no stack.
 * See src/lib/ai/rate-limit.ts for what an in-memory limit does and does not guarantee.
 *
 * Cancellation, two ways. (1) Explicit: Stop sends `DELETE /api/chat?requestId=…`
 * and the handler below aborts that request's controller. (2) Implicit: when
 * the browser aborts its fetch (the Stop button), Next
 * aborts `req.signal` and/or cancels the response stream. Both feed one
 * AbortController, which stops the model call or the local token loop. No
 * `done` frame is sent after an abort: the client already knows it stopped.
 *
 * What the model says is configured in src/lib/ai/underwriting-model.ts.
 *
 * FE-08 drills: `x-sabotage-mode: mid-stream-error | rate-limit-429 |
 * malformed-tool-json | slow-3s` (or `"sabotage"` in the body) breaks this one
 * request on purpose. See src/lib/ai/sabotage.ts.
 */
import { APICallError, RetryError, stepCountIs, streamText } from 'ai'
import {
  CHAT_LIMITS,
  encodeSseFrame,
  isRequestId,
  isSabotageMode,
  parseChatRequest,
  SABOTAGE_HEADER,
  SABOTAGE_MODES,
  type ChatStreamEvent,
  type WireMessage,
} from '../../../features/ai-copilot/chatProtocol.ts'
import { activeRequests } from '../../../lib/ai/active-requests.ts'
import { sabotageResponse } from '../../../lib/ai/sabotage.ts'
import { planLocalTool, streamLocalToolCall, type ToolTiming } from '../../../lib/ai/tool-runner.ts'
import { isToolName, TOOL_META, toolErrorCode, toolErrorText } from '../../../lib/ai/tools.ts'
import { chatStats, type ModelOutcome } from '../../../lib/ai/chat-stats.ts'
import { streamLocalReply } from '../../../lib/ai/local-engine.ts'
import { CHAT_RATE_LIMIT, CHAT_REQUEST_LIMIT, chatRateLimiter, chatRequestLimiter, clientKey, describeWait } from '../../../lib/ai/rate-limit.ts'
import { apiError, readJsonBody } from '../../../lib/http/request-guard.ts'
import {
  MAX_MODEL_STEPS,
  MODEL_CONFIG,
  fallbackPacing,
  type LocalPacing,
  UNDERWRITING_TOOLS,
  buildSystemPrompt,
  describeEngine,
  resolveChatEngine,
  type ChatEngine,
} from '../../../lib/ai/underwriting-model.ts'

/** Node runtime: the AI SDK providers and `crypto.randomUUID` in the local engine both run there. */
export const runtime = 'nodejs'
/**
 * FE-11: the Vercel function ceiling, in seconds. The hosted-model call gives up at 27 s
 * (`MODEL_CONFIG.modelTimeout.totalMs`) and the local engine answers in a few seconds, so a reply
 * ends on its own terms (a `done`, a labelled fallback or an `error` frame) before the host cuts it.
 */
export const maxDuration = 30

type Send = (event: ChatStreamEvent) => void
type HostedEngine = Exclude<ChatEngine, { kind: 'local' }>

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  // `no-transform` stops proxies from gzip-buffering the stream into one burst.
  'Cache-Control': 'no-cache, no-transform',
  // Same idea for nginx-style reverse proxies.
  'X-Accel-Buffering': 'no',
} as const

/** FE-07: the local tool runner's pacing, from MODEL_CONFIG so tests can speed it up. */
function toolTiming(pacing: LocalPacing = fallbackPacing(0, MODEL_CONFIG)): ToolTiming {
  return { deltaMs: pacing.toolDeltaMs, executeMs: pacing.toolExecuteMs, tokenMs: pacing.tokenDelayMs }
}

/** `pacing` defaults to the normal pace; FE-11 passes no pacing for a late hand-over (see `fallbackPacing`). */
async function streamFromLocalEngine(messages: readonly WireMessage[], signal: AbortSignal, send: Send, pacing: LocalPacing = fallbackPacing(0, MODEL_CONFIG)): Promise<void> {
  // FE-07: a request that names a tool gets a real tool call (validate → execute → card), then a summary.
  const plan = planLocalTool(messages)
  if (plan !== null) {
    await streamLocalToolCall(plan, signal, send, toolTiming(pacing))
    if (!signal.aborted) send({ type: 'done', finishReason: 'stop' })
    return
  }
  const tokens = streamLocalReply(messages, {
    signal,
    tokenDelayMs: pacing.tokenDelayMs,
    firstTokenDelayMs: pacing.firstTokenDelayMs,
  })
  for await (const text of tokens) send({ type: 'token', text })
  if (!signal.aborted) send({ type: 'done', finishReason: 'stop' })
}

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
  /** How many stream parts of each type arrived, e.g. `{"reasoning-delta":40,"text-delta":0}`. Type names only. */
  readonly parts: Readonly<Record<string, number>>
  readonly deltas: number
  readonly outputTokens: number | null
  readonly ms: number
  /** HTTP status the provider answered with, when the request failed. */
  readonly status: number | null
}): void {
  console.info(JSON.stringify({ event: 'chat.model', ...entry }))
  // The same facts, minus the part counts, kept in memory for `GET /api/chat`.
  chatStats.recordOutcome({
    outcome: entry.outcome,
    deltas: entry.deltas,
    outputTokens: entry.outputTokens,
    ms: entry.ms,
    status: entry.status,
  })
}

/** What a hosted model has produced so far in one request. */
interface StreamProgress {
  /** Text deltas relayed to the client. */
  deltas: number
  /** Count of every stream part by type. */
  readonly parts: Record<string, number>
  /** Set when the provider produced nothing within `modelFirstResponseMs`. */
  stalled: boolean
  /** FE-07: tool lifecycle frames relayed to the client. A reply can be a tool call and no text. */
  toolEvents: number
}

/** Stream part families that only a provider response can produce (the SDK emits `start` etc. itself). */
const PROVIDER_OUTPUT = /^(text|reasoning|tool|source|file|finish|error)/

/** Says what the model was doing when it ran out of time, from the parts it did send. */
function describeTimeout(progress: StreamProgress): string {
  const types = Object.keys(progress.parts)
  if (types.some((type) => type.startsWith('reasoning'))) return 'model call timed out while thinking'
  // Only these part families carry model output. The SDK also emits bookkeeping
  // parts of its own (`start`, `start-step`, `abort`), which prove nothing arrived.
  const producedOutput = types.some((type) => PROVIDER_OUTPUT.test(type))
  return producedOutput ? 'model call timed out: no text' : 'model call timed out: no response'
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
 * reported (null if it reported none). `progress` is updated as parts arrive,
 * so the caller can tell "failed before the first token" (safe to fall back)
 * from "failed halfway" (must report an error) even when this throws, and can
 * say what the model was doing when it timed out.
 */
async function streamFromModel(
  engine: HostedEngine,
  messages: readonly WireMessage[],
  signal: AbortSignal,
  send: Send,
  progress: StreamProgress,
): Promise<number | null> {
  // Watchdog for the provider's first sign of life. It has its own controller,
  // so "the provider stalled" and "the client pressed Stop" stay distinguishable.
  const watchdog = new AbortController()
  const firstResponseTimer = setTimeout(() => {
    progress.stalled = true
    watchdog.abort()
  }, MODEL_CONFIG.modelFirstResponseMs)

  try {
    const callSignal = AbortSignal.any([signal, watchdog.signal])
    return await relayModelStream(engine, messages, signal, callSignal, send, progress, () => clearTimeout(firstResponseTimer))
  } finally {
    clearTimeout(firstResponseTimer)
  }
}

/**
 * `signal` is the client's (Stop, tab closed). `callSignal` is what the provider
 * request listens to: the client's signal or the watchdog, whichever fires first.
 */
async function relayModelStream(
  engine: HostedEngine,
  messages: readonly WireMessage[],
  signal: AbortSignal,
  callSignal: AbortSignal,
  send: Send,
  progress: StreamProgress,
  onFirstResponse: () => void,
): Promise<number | null> {
  const result = streamText({
    model: engine.model,
    instructions: buildSystemPrompt(),
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    maxOutputTokens: MODEL_CONFIG.maxOutputTokens,
    // Stop → fetch abort → this signal → the provider request is cancelled, so no more tokens are billed.
    abortSignal: callSignal,
    // Fail fast. The SDK's retry waits as long as the provider's `Retry-After`
    // says (up to a minute), which is longer than a person waits on a chat. One
    // failed attempt falls back to the local engine straight away instead.
    maxRetries: 0,
    timeout: MODEL_CONFIG.modelTimeout,
    reasoning: engine.reasoning,
    // Errors are handled below from the stream's `error` part. Without this the SDK also dumps them to the console.
    onError: () => {},
    // FE-07: the model may call the three tools in src/lib/ai/tools.ts, then write a summary step.
    tools: UNDERWRITING_TOOLS,
    stopWhen: stepCountIs(MAX_MODEL_STEPS),
  })

  let finishReason = 'stop'
  let outputTokens: number | null = null
  /** Tool calls that already sent `tool-input-start`: some providers send the whole input in one `tool-call`. */
  const started = new Set<string>()
  const sendTool = (event: Parameters<Send>[0]): void => {
    progress.toolEvents += 1
    send(event)
  }
  const startTool = (toolCallId: string, toolName: string): void => {
    if (started.has(toolCallId)) return
    started.add(toolCallId)
    const whenToUse = isToolName(toolName) ? TOOL_META[toolName].whenToUse : 'The model chose a tool.'
    sendTool({ type: 'tool-input-start', toolCallId, toolName, rationale: `Model's choice. ${whenToUse}` })
  }
  for await (const part of result.stream) {
    progress.parts[part.type] = (progress.parts[part.type] ?? 0) + 1
    if (PROVIDER_OUTPUT.test(part.type)) onFirstResponse()
    if (part.type === 'text-delta') {
      progress.deltas += 1
      send({ type: 'token', text: part.text })
    } else if (part.type === 'tool-input-start') {
      startTool(part.id, part.toolName)
    } else if (part.type === 'tool-input-delta') {
      sendTool({ type: 'tool-input-delta', toolCallId: part.id, delta: part.delta })
    } else if (part.type === 'tool-call') {
      startTool(part.toolCallId, part.toolName)
      sendTool({ type: 'tool-input-available', toolCallId: part.toolCallId, toolName: part.toolName, input: part.input })
    } else if (part.type === 'tool-result') {
      sendTool({ type: 'tool-output-available', toolCallId: part.toolCallId, output: part.output })
    } else if (part.type === 'tool-error') {
      startTool(part.toolCallId, part.toolName)
      sendTool({
        type: 'tool-output-error',
        toolCallId: part.toolCallId,
        errorCode: toolErrorCode(part.error),
        errorText: toolErrorText(part.error),
      })
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
  // A "successful" reply with no text and no tool call would leave an empty bubble. Treat it as a failure.
  if (progress.deltas === 0 && progress.toolEvents === 0) throw new ModelSilentError('model returned no text')
  send({ type: 'done', finishReason })
  return outputTokens
}

/**
 * GET /api/chat — status, counters only.
 *
 * Reports which engine this deployment uses, the rate-limit rules, how many
 * clients the limiter is tracking, and how hosted-model requests ended on THIS
 * server instance (done / aborted / error / fallback, plus the last one's
 * timing). It contains no prompt, reply, IP or key.
 *
 * It answers two questions without access to the host's logs:
 *   - Server-side cancellation: press Stop, then read `last`. `outcome:
 *     "aborted"` with a small `deltas` means the disconnect reached this
 *     function and the provider call was cancelled.
 *   - Rate limit: `rateLimited` counts requests refused with 429.
 * `instance` changes when a different server instance answers; compare two
 * readings only when it matches.
 */
export function GET(): Response {
  const engine = describeEngine()
  return Response.json(
    {
      engine,
      // Which commit this deployment was built from (set by the host; public, the repo is public).
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      rateLimit: { rules: CHAT_RATE_LIMIT, appliesTo: 'hosted model requests', trackedClients: chatRateLimiter.size() },
      // FE-11: the limit and caps every POST meets first. Rules only: no client keys.
      requestLimit: { rule: CHAT_REQUEST_LIMIT, appliesTo: 'every POST', trackedClients: chatRequestLimiter.size() },
      limits: { ...CHAT_LIMITS, maxDurationSeconds: maxDuration },
      ...chatStats.snapshot(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(req: Request): Promise<Response> {
  const requestStartedAt = Date.now()
  // 0. FE-11: the per-client limit comes first, so an over-limit client costs one Map lookup, not a body read.
  const allowed = chatRequestLimiter.check(clientKey(req.headers))
  if (!allowed.ok) {
    chatStats.recordRateLimited()
    return apiError(429, 'RATE_LIMITED', `Too many requests from this network. Try again in ${describeWait(allowed.retryAfterSeconds)}.`, {
      retryAfterSeconds: allowed.retryAfterSeconds,
    })
  }

  // 1. Validate. The body is read with a byte cap, and stays `unknown` until `parseChatRequest` has checked every field.
  const read = await readJsonBody(req, CHAT_LIMITS.maxBodyBytes)
  if (!read.ok) return read.response
  const { body } = read
  const parsed = parseChatRequest(body)
  if (!parsed.ok) return apiError(400, 'INVALID_REQUEST', parsed.error)
  const { messages, requestId } = parsed

  // FE-08 drills: header first, then `sabotage` in the body. An unknown mode is a 400, not ignored.
  const rawSabotage =
    req.headers.get(SABOTAGE_HEADER) ??
    (typeof body === 'object' && body !== null && 'sabotage' in body ? body.sabotage : null)
  if (rawSabotage !== null && rawSabotage !== '') {
    if (!isSabotageMode(rawSabotage)) {
      return apiError(400, 'UNKNOWN_SABOTAGE_MODE', `Unknown ${SABOTAGE_HEADER}. Use one of: ${SABOTAGE_MODES.join(', ')}.`)
    }
    return sabotageResponse(rawSabotage, messages, req)
  }

  // FE-07 "Retry Tool Call with Sanitized Inputs": run exactly that tool, re-validated, with no model.
  if (parsed.toolCall !== null) {
    const { toolName, input } = parsed.toolCall
    if (!isToolName(toolName)) return apiError(400, 'UNKNOWN_TOOL', `Unknown tool ${toolName}.`)
    return directToolResponse({ toolName, input, rationale: 'Retry from the error card, with the inputs it sanitized.' }, req)
  }

  // 2. Pick the engine. Keys are read here, on the server, per request.
  const engine = resolveChatEngine()

  // 3. Rate-limit anything that would spend money. Checked before the stream
  //    opens, so an over-limit client gets a plain 429, not a half-open stream.
  if (engine.kind !== 'local') {
    const verdict = chatRateLimiter.check(clientKey(req.headers))
    if (!verdict.ok) {
      chatStats.recordRateLimited()
      return apiError(429, 'RATE_LIMITED', `Too many requests from this network. Try again in ${describeWait(verdict.retryAfterSeconds)}.`, {
        retryAfterSeconds: verdict.retryAfterSeconds,
      })
    }
  }

  // 4. One abort signal for "stop this reply", whoever says so: the connection
  //    closing (`req.signal`, the stream's `cancel`) or an explicit DELETE that
  //    names this request.
  const abort = new AbortController()
  const onRequestAbort = (): void => abort.abort()
  if (req.signal.aborted) abort.abort()
  else req.signal.addEventListener('abort', onRequestAbort, { once: true })
  if (requestId !== null) activeRequests.register(requestId, abort)

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

        const progress: StreamProgress = { deltas: 0, parts: {}, stalled: false, toolEvents: 0 }
        const startedAt = Date.now()
        const log = (outcome: ModelOutcome, outputTokens: number | null, status: number | null = null): void =>
          logModelRequest({
            outcome,
            engine: engine.label,
            parts: progress.parts,
            deltas: progress.deltas,
            outputTokens,
            ms: Date.now() - startedAt,
            status,
          })

        try {
          const outputTokens = await streamFromModel(engine, messages, abort.signal, send, progress)
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
          const timedOut =
            progress.stalled ||
            (error instanceof ModelSilentError && error.reason === 'model call timed out') ||
            (error instanceof Error && error.name === 'TimeoutError')
          if (timedOut && progress.deltas > 0) {
            // FE-11: OUR time budget (27 s, under the 30 s maxDuration) ended a reply that was still streaming.
            // The model did not fail, so this is no error card: the partial answer stays and the UI marks it
            // "[Ended early: time-limit]".
            log('error', null, status)
            send({ type: 'done', finishReason: 'time-limit' })
            return
          }
          if (progress.deltas > 0 || progress.toolEvents > 0) {
            log('error', null, status)
            send({ type: 'error', message: 'The model stopped responding part-way through. The partial reply is kept.' })
            return
          }
          // Nothing reached the user yet (bad key, rate limit, provider outage):
          // answer from the local engine and say so, instead of showing a dead chat.
          // The label carries the status, so "wrong key" and "wrong model ID" can be
          // told apart from the browser without access to the server logs.
          log('fallback', null, status)
          const reason = timedOut
            ? describeTimeout(progress)
            : error instanceof ModelSilentError
              ? error.reason
              : status === null
                ? 'model call failed'
                : `model call failed: HTTP ${status}`
          send({ type: 'meta', engine: { kind: 'local', label: `local rule engine (${reason})` } })
          // FE-11: a late hand-over streams unpaced, so it ends inside the 30 s maxDuration.
          await streamFromLocalEngine(messages, abort.signal, send, fallbackPacing(Date.now() - requestStartedAt, MODEL_CONFIG))
        }
      } catch {
        if (!abort.signal.aborted) send({ type: 'error', message: 'The copilot could not produce a reply.' })
      } finally {
        req.signal.removeEventListener('abort', onRequestAbort)
        if (requestId !== null) activeRequests.release(requestId)
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

/** Streams one direct tool call (no model, nothing billed) through the same lifecycle frames. */
function directToolResponse(plan: Parameters<typeof streamLocalToolCall>[0], req: Request): Response {
  const encoder = new TextEncoder()
  const abort = new AbortController()
  const onRequestAbort = (): void => abort.abort()
  req.signal.addEventListener('abort', onRequestAbort, { once: true })
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Send = (event) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(encodeSseFrame(event)))
      }
      try {
        send({ type: 'meta', engine: { kind: 'local', label: 'local tool runner (retry with sanitized inputs)' } })
        await streamLocalToolCall(plan, abort.signal, send, toolTiming())
        send({ type: 'done', finishReason: 'stop' })
      } finally {
        req.signal.removeEventListener('abort', onRequestAbort)
        try {
          controller.close()
        } catch {
          // Already closed by `cancel`.
        }
      }
    },
    cancel() {
      abort.abort()
    },
  })
  return new Response(stream, { headers: SSE_HEADERS })
}

/**
 * DELETE /api/chat?requestId=<uuid> — stop one reply.
 *
 * Sent by the Stop button alongside the fetch abort. `cancelled: true` means
 * this server instance was running that request and has aborted it: the model
 * call is cancelled and no more tokens are generated. `cancelled: false` means
 * the request is not running here (already finished, or on another instance).
 */
export function DELETE(req: Request): Response {
  const requestId = new URL(req.url).searchParams.get('requestId')
  if (!isRequestId(requestId)) {
    return Response.json({ error: 'requestId must be the UUID sent with the chat request.' }, { status: 400 })
  }
  const cancelled = activeRequests.cancel(requestId)
  chatStats.recordCancel(cancelled)
  return Response.json({ cancelled }, { headers: { 'Cache-Control': 'no-store' } })
}
