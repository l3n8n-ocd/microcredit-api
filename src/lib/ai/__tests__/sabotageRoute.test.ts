// @vitest-environment node
/**
 * FE-08: the real `POST /api/chat` handler, driven with each sabotage header.
 * These are the same requests the drill toolbar sends on the live site.
 */
import { describe, expect, it, vi } from 'vitest'
import { POST } from '../../../app/api/chat/route.ts'
import { DRILL_RETRY_AFTER_SECONDS, MALFORMED_FRAME, MID_STREAM_CUT_AFTER } from '../sabotage.ts'

// `server-only` throws outside a React Server Component bundle (same as chatRoute.test.ts).
vi.mock('server-only', () => ({}))

function chat(headers: Record<string, string>, body: Record<string, unknown> = {}): Promise<Response> {
  return POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Walk me through the 10 loan states.' }], ...body }),
    }),
  )
}

function frames(text: string): unknown[] {
  return text
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => {
      try {
        return JSON.parse(frame.slice(6)) as unknown
      } catch {
        return { malformed: frame }
      }
    })
}

describe('POST /api/chat sabotage drills', () => {
  it('rate-limit-429: a 429 with Retry-After, and no stream', async () => {
    const response = await chat({ 'x-sabotage-mode': 'rate-limit-429' })
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe(String(DRILL_RETRY_AFTER_SECONDS))
    expect(response.headers.get('X-Sabotage-Mode')).toBe('rate-limit-429')
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Rate limit drill') })
  })

  it('mid-stream-error: a labelled meta frame, exactly 14 tokens, then an error frame and no done', async () => {
    const parsed = frames(await (await chat({ 'x-sabotage-mode': 'mid-stream-error' })).text())
    expect(parsed[0]).toEqual({ type: 'meta', engine: { kind: 'local', label: 'local rule engine (sabotage drill: mid-stream-error)' } })
    const types = parsed.map((frame) => (frame as { type?: string }).type)
    expect(types.filter((type) => type === 'token')).toHaveLength(MID_STREAM_CUT_AFTER)
    expect(types.at(-1)).toBe('error')
    expect(types).not.toContain('done')
  })

  it('malformed-tool-json: tokens, then the cut-off tool frame, and no done', async () => {
    const text = await (await chat({}, { sabotage: 'malformed-tool-json' })).text()
    expect(text.endsWith(MALFORMED_FRAME)).toBe(true)
    expect(frames(text).some((frame) => (frame as { type?: string }).type === 'done')).toBe(false)
  })

  it('an unknown mode is a 400, and network-drop is refused because it is a browser-side drill', async () => {
    expect((await chat({ 'x-sabotage-mode': 'delete-prod' })).status).toBe(400)
    expect((await chat({ 'x-sabotage-mode': 'network-drop' })).status).toBe(400)
  })
})
