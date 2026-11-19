/**
 * FE-11 · request hygiene shared by the public route handlers (`/api/chat`, `/api/agent`).
 *
 * Two jobs:
 *   1. `readJsonBody` reads a request body with a hard byte cap. It trusts `Content-Length` only to
 *      refuse early: a missing or false header is caught while the body streams in, and the read stops
 *      at the cap instead of buffering whatever a client sends.
 *   2. `apiError` is the one shape every refusal takes: `{ error, code }` (plus `retryAfterSeconds` on a
 *      429), `Cache-Control: no-store`, and a fixed message. Never an exception message or a stack trace.
 *
 * `error` stays a plain string because the chat client already shows it (chatTransport.ts); `code` is
 * for scripts and tests.
 */

/** The largest JSON body `/api/chat` accepts. The client trims history to fit (chatReducer.ts). */
export const MAX_JSON_BODY_BYTES = 32 * 1024

export type ApiErrorCode =
  | 'BODY_TOO_LARGE'
  | 'INVALID_JSON'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'UNKNOWN_TOOL'
  | 'UNKNOWN_SABOTAGE_MODE'

export interface ApiErrorOptions {
  /** Sets `Retry-After` and `retryAfterSeconds` (429 only). */
  readonly retryAfterSeconds?: number
  readonly headers?: Readonly<Record<string, string>>
}

export function apiError(status: number, code: ApiErrorCode, message: string, options: ApiErrorOptions = {}): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', ...options.headers }
  const retry = options.retryAfterSeconds
  if (retry !== undefined) headers['Retry-After'] = String(retry)
  return Response.json({ error: message, code, ...(retry === undefined ? {} : { retryAfterSeconds: retry }) }, { status, headers })
}

export type JsonBodyResult = { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly response: Response }

const kilobytes = (bytes: number): string => `${Math.round(bytes / 1024)} KB`

/**
 * Reads `req` as JSON, refusing more than `maxBytes` with `413 BODY_TOO_LARGE`, and anything that is
 * not UTF-8 JSON with `400 INVALID_JSON`. The parsed value is `unknown`: the caller validates it.
 */
export async function readJsonBody(req: Request, maxBytes: number): Promise<JsonBodyResult> {
  const tooLarge = (): JsonBodyResult => ({ ok: false, response: apiError(413, 'BODY_TOO_LARGE', `Request body is over ${kilobytes(maxBytes)}.`) })
  const notJson = (): JsonBodyResult => ({ ok: false, response: apiError(400, 'INVALID_JSON', 'Request body must be JSON.') })

  const declared = req.headers.get('content-length')?.trim() ?? ''
  if (/^\d+$/.test(declared) && Number(declared) > maxBytes) return tooLarge()
  if (req.body === null) return notJson()

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      return tooLarge()
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return { ok: true, body }
  } catch {
    return notJson()
  }
}
