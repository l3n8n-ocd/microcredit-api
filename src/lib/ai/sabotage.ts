/**
 * FE-08 sabotage drills for `POST /api/chat`.
 *
 * Each mode breaks one request in one known way, so the UI's failure states can
 * be shown on demand (from the drill toolbar, a test, or `curl`). Rules:
 *   - A drill never calls a hosted model. Tokens come from the local rule
 *     engine, and the `meta` frame says "sabotage drill" so nobody mistakes it
 *     for a real outage.
 *   - A drill touches no shared state: it does not count against the real rate
 *     limiter and is not recorded in `chatStats`.
 *   - `network-drop` is refused here with 400. It is simulated in the browser,
 *     before `fetch`, because a real dropped network never reaches a server.
 */
import { encodeSseFrame, type ChatStreamEvent, type SabotageMode, type WireMessage } from '../../features/ai-copilot/chatProtocol.ts'
import { streamLocalReply } from './local-engine.ts'
import { MODEL_CONFIG } from './underwriting-model.ts'

/** Tokens streamed before the mid-stream drill cuts the reply. */
export const MID_STREAM_CUT_AFTER = 14
/** Tokens streamed before the malformed-frame drill sends its broken frame. */
export const MALFORMED_AFTER = 10
/** `Retry-After` sent by the 429 drill. Short, so the countdown is watchable. */
export const DRILL_RETRY_AFTER_SECONDS = 5
/** Silence before the first token in the slow drill: past the UI's 1.5 s skeleton threshold. */
export const SLOW_DRILL_MS = 3000

/** A tool-call frame cut off mid-string: what a truncated tool payload looks like on the wire. */
export const MALFORMED_FRAME = 'data: {"type":"tool-call","toolName":"score_applicant","input":{"borrowerId":"borrower-0\n\n'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
} as const

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

export function sabotageResponse(mode: SabotageMode, messages: readonly WireMessage[], req: Request): Response {
  const drillHeaders = { 'X-Sabotage-Mode': mode, 'Cache-Control': 'no-store' }

  if (mode === 'network-drop') {
    return Response.json(
      { error: 'network-drop is simulated in the browser: a dropped network never reaches the server.' },
      { status: 400, headers: drillHeaders },
    )
  }
  if (mode === 'rate-limit-429') {
    return Response.json(
      { error: `Rate limit drill (x-sabotage-mode: rate-limit-429). Try again in ${DRILL_RETRY_AFTER_SECONDS} seconds.` },
      { status: 429, headers: { ...drillHeaders, 'Retry-After': String(DRILL_RETRY_AFTER_SECONDS) } },
    )
  }

  const abort = new AbortController()
  const onRequestAbort = (): void => abort.abort()
  if (req.signal.aborted) abort.abort()
  else req.signal.addEventListener('abort', onRequestAbort, { once: true })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string): void => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(text))
      }
      const send = (event: ChatStreamEvent): void => write(encodeSseFrame(event))
      const tokens = (): AsyncGenerator<string, void, void> =>
        streamLocalReply(messages, {
          signal: abort.signal,
          tokenDelayMs: MODEL_CONFIG.localTokenDelayMs,
          firstTokenDelayMs: MODEL_CONFIG.localFirstTokenDelayMs,
        })

      try {
        send({ type: 'meta', engine: { kind: 'local', label: `local rule engine (sabotage drill: ${mode})` } })

        if (mode === 'slow-3s') {
          await wait(SLOW_DRILL_MS, abort.signal)
          for await (const text of tokens()) send({ type: 'token', text })
          send({ type: 'done', finishReason: 'stop' })
          return
        }

        const cutAfter = mode === 'mid-stream-error' ? MID_STREAM_CUT_AFTER : MALFORMED_AFTER
        let sent = 0
        for await (const text of tokens()) {
          send({ type: 'token', text })
          sent += 1
          if (sent >= cutAfter) break
        }
        if (mode === 'mid-stream-error') {
          send({
            type: 'error',
            message: `Sabotage drill: the stream was cut after ${sent} tokens. The partial reply is kept.`,
          })
        } else {
          // No `done` follows: a broken tool payload ends the reply.
          write(MALFORMED_FRAME)
        }
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

  return new Response(stream, { headers: { ...SSE_HEADERS, 'X-Sabotage-Mode': mode } })
}
