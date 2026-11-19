/**
 * POST /api/agent — run one SentinelScout triage and stream every step.
 *
 * Request:  { "request": string, "planner"?: "rules" | "model" }
 * Response: NDJSON, one AgentEvent per line (start, turn, tool_call,
 *           tool_result, guardrail, final | halt).
 *
 * Same engine and same tool code as `npm run agent:run`, called in-process:
 * a serverless function cannot keep an MCP stdio child alive. Differences
 * from the CLI, on purpose:
 *   - the brief is written to the server's temp folder, never into the repo;
 *   - `run_checks` reports "not available on this host": a public endpoint
 *     does not spawn tsc and Vitest;
 *   - every client is rate-limited, because each run calls GitHub (and a
 *     model, with the model planner);
 *   - FE-11: a 30 s ceiling. Advisory fetches give up after 5 s and the model
 *     planner after 24 s, so a slow run ends in a `halt` event, not a cut stream.
 *
 * FE-11 order: rate limit (before the body is read) → 4 KB body cap (`413`) →
 * JSON (`400`) → `request` at most 600 characters (`400`). Refusals are
 * `{ error, code }` JSON with fixed messages.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRateLimiter, clientKey, describeWait } from '../../../lib/ai/rate-limit.ts'
import { apiError, readJsonBody } from '../../../lib/http/request-guard.ts'
import { newTriageId, runTriage } from '../../../lib/sentinel-scout/engine.ts'
import { resolvePlannerModel } from '../../../lib/sentinel-scout/model.ts'
import { AGENT_LIMITS, parseAgentRequest } from '../../../lib/sentinel-scout/protocol.ts'
import { createToolbox } from '../../../lib/sentinel-scout/tools.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** FE-11: the Vercel function ceiling, in seconds. `AGENT_LIMITS` (protocol.ts) keeps a run inside it. */
export const maxDuration = 30

/** Per client: 6 runs a minute, 40 a day. In-memory, per server instance (see FE-06 notes). */
const limiter = createRateLimiter([
  { limit: 6, windowMs: 60_000 },
  { limit: 40, windowMs: 24 * 60 * 60_000 },
])

export async function POST(req: Request): Promise<Response> {
  const verdict = limiter.check(clientKey(req.headers))
  if (!verdict.ok) {
    return apiError(429, 'RATE_LIMITED', `Too many runs from this network. Try again in ${describeWait(verdict.retryAfterSeconds)}.`, {
      retryAfterSeconds: verdict.retryAfterSeconds,
    })
  }

  const read = await readJsonBody(req, AGENT_LIMITS.maxBodyBytes)
  if (!read.ok) return read.response
  const parsed = parseAgentRequest(read.body)
  if (!parsed.ok) return apiError(400, 'INVALID_REQUEST', parsed.error)

  const model = parsed.planner === 'model' ? resolvePlannerModel() : null
  const now = new Date()
  const toolbox = createToolbox({
    root: process.cwd(),
    fetch: globalThis.fetch,
    now: () => new Date(),
    draftsDir: join(tmpdir(), 'sentinel-scout', 'drafts'),
    cacheDir: join(tmpdir(), 'sentinel-scout', 'cache'),
    snapshotDir: join(process.cwd(), 'agents/sentinel-scout/snapshots'),
    timeoutMs: AGENT_LIMITS.fetchTimeoutMs,
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown): void => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
      try {
        await runTriage({
          request: parsed.request,
          toolbox,
          triageId: newTriageId(now, now.getUTCSeconds() + 1),
          emit: send,
          modelTimeoutMs: AGENT_LIMITS.modelTimeoutMs,
          ...(model === null ? {} : { model }),
        })
      } catch (error) {
        send({ type: 'halt', at: new Date().toISOString(), reason: `The run failed (${error instanceof Error ? error.name : 'error'}).` })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } })
}
