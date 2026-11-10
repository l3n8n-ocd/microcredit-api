import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHAT_LIMITS, createSseParser, encodeSseFrame, type ChatStreamEvent } from '../chatProtocol.ts'
import { chatReducer, createInitialState, toWireHistory, type ChatState } from '../chatReducer.ts'
import { fetchChatTransport } from '../chatTransport.ts'
import { messageText, type ChatMessage } from '../chatTypes.ts'
import { parseInline, parseStreamingMarkdown } from '../streamingMarkdownParser.ts'

function message(id: string, role: ChatMessage['role'], text: string, outcome: ChatMessage['outcome'] = 'complete'): ChatMessage {
  return { id, role, parts: [{ type: 'text', text }], createdAt: '2026-11-10T00:00:00.000Z', outcome }
}

function submit(state: ChatState, turn: number): ChatState {
  return chatReducer(state, {
    type: 'SUBMIT',
    user: message(`u${turn}`, 'user', `question ${turn}`),
    assistant: message(`a${turn}`, 'assistant', '', 'pending'),
  })
}

describe('createSseParser', () => {
  const events: ChatStreamEvent[] = [
    { type: 'meta', engine: { kind: 'local', label: 'local' } },
    { type: 'token', text: '₱5,000.00 ' },
    { type: 'token', text: 'Σ debits\n\n=== Σ credits' },
    { type: 'done', finishReason: 'stop' },
  ]
  const wire = events.map(encodeSseFrame).join('')

  it('decodes the same events however the bytes are chunked', () => {
    for (const size of [1, 2, 3, 7, 16, wire.length]) {
      const seen: ChatStreamEvent[] = []
      const parser = createSseParser((event) => seen.push(event))
      for (let index = 0; index < wire.length; index += size) parser.push(wire.slice(index, index + size))
      expect(seen).toEqual(events)
    }
  })

  it('skips keep-alive comments, malformed JSON and unknown event types', () => {
    const seen: ChatStreamEvent[] = []
    const parser = createSseParser((event) => seen.push(event))
    parser.push(': ping\n\ndata: {not json}\n\ndata: {"type":"tool","name":"x"}\n\ndata: {"type":"token","text":"ok"}\n\n')
    expect(seen).toEqual([{ type: 'token', text: 'ok' }])
  })
})

describe('chatReducer — the Send / Stop state machine', () => {
  it('walks idle → submitted → streaming → idle', () => {
    let state = submit(createInitialState([]), 1)
    expect(state.status).toBe('submitted')
    expect(state.activeId).toBe('a1')

    state = chatReducer(state, { type: 'TOKEN', id: 'a1', text: 'Hel' })
    state = chatReducer(state, { type: 'TOKEN', id: 'a1', text: 'lo' })
    expect(state.status).toBe('streaming')

    state = chatReducer(state, { type: 'DONE', id: 'a1', finishReason: 'stop' })
    expect(state.status).toBe('idle')
    expect(state.activeId).toBeNull()
    expect(state.messages.map((item) => [messageText(item), item.outcome])).toEqual([
      ['question 1', 'complete'],
      ['Hello', 'complete'],
    ])
  })

  it('ignores a second SUBMIT while a request is in flight', () => {
    const state = submit(createInitialState([]), 1)
    expect(submit(state, 2)).toBe(state)
  })

  it('STOP keeps the partial text, and late tokens from the stopped run are dropped', () => {
    let state = submit(createInitialState([]), 1)
    state = chatReducer(state, { type: 'TOKEN', id: 'a1', text: 'Partial' })
    state = chatReducer(state, { type: 'STOP' })
    expect(state.status).toBe('stopped')
    expect(state.messages.at(-1)).toMatchObject({ outcome: 'stopped', parts: [{ type: 'text', text: 'Partial' }] })

    const afterLate = chatReducer(state, { type: 'TOKEN', id: 'a1', text: ' LATE' })
    expect(afterLate).toBe(state)
    expect(chatReducer(state, { type: 'DONE', id: 'a1', finishReason: 'stop' })).toBe(state)
  })

  it('after stop → send again, a late token from run 1 cannot land in run 2', () => {
    let state = submit(createInitialState([]), 1)
    state = chatReducer(state, { type: 'TOKEN', id: 'a1', text: 'one' })
    state = chatReducer(state, { type: 'STOP' })
    state = submit(state, 2)
    expect(state.status).toBe('submitted')

    state = chatReducer(state, { type: 'TOKEN', id: 'a1', text: ' LEAK' })
    state = chatReducer(state, { type: 'TOKEN', id: 'a2', text: 'two' })
    expect(state.messages.map(messageText)).toEqual(['question 1', 'one', 'question 2', 'two'])
  })

  it('FAIL moves to error and a new SUBMIT recovers', () => {
    let state = submit(createInitialState([]), 1)
    state = chatReducer(state, { type: 'FAIL', id: 'a1', message: 'offline' })
    expect(state).toMatchObject({ status: 'error', error: 'offline', activeId: null })
    state = submit(state, 2)
    expect(state).toMatchObject({ status: 'submitted', error: null })
  })

  it('treats DONE with no text as an error, not as an empty success', () => {
    const state = chatReducer(submit(createInitialState([]), 1), { type: 'DONE', id: 'a1', finishReason: 'stop' })
    expect(state.status).toBe('error')
  })

  it('records a non-stop finish reason on the message', () => {
    let state = submit(createInitialState([]), 1)
    state = chatReducer(state, { type: 'TOKEN', id: 'a1', text: 'cut' })
    state = chatReducer(state, { type: 'DONE', id: 'a1', finishReason: 'length' })
    expect(state.messages.at(-1)?.finishReason).toBe('length')
  })
})

describe('toWireHistory', () => {
  it('drops empty turns and keeps stopped partial replies', () => {
    const history = toWireHistory([
      message('u1', 'user', 'first'),
      message('a1', 'assistant', '', 'stopped'),
      message('u2', 'user', 'second'),
      message('a2', 'assistant', 'partial', 'stopped'),
      message('u3', 'user', 'third'),
    ])
    expect(history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'partial' },
      { role: 'user', content: 'third' },
    ])
  })

  it('keeps the newest turns within the server cap and starts on a user turn', () => {
    const long = Array.from({ length: 31 }, (_, index) =>
      message(`m${index}`, index % 2 === 0 ? 'user' : 'assistant', `turn ${index}`),
    )
    const history = toWireHistory(long)
    expect(history.length).toBeLessThanOrEqual(CHAT_LIMITS.maxMessages)
    expect(history[0]?.role).toBe('user')
    expect(history.at(-1)).toEqual({ role: 'user', content: 'turn 30' })
  })
})

describe('parseStreamingMarkdown — never shows half a marker', () => {
  it('renders an unclosed fence as an open code block from its first line', () => {
    const blocks = parseStreamingMarkdown('Here:\n\n```ts\nconst a = 1', true)
    expect(blocks).toEqual([
      { type: 'paragraph', inline: [{ type: 'text', text: 'Here:' }] },
      { type: 'code', lang: 'ts', code: 'const a = 1', open: true },
    ])
  })

  it('keeps the block count stable for every prefix of a streamed reply (no re-flow)', () => {
    const full = 'Intro **bold** and `code`.\n\n```text\nDEBIT  500000\nCREDIT 500000\n```\n\n- one\n- two\n\nDone.'
    let previous = 0
    for (let length = 1; length <= full.length; length += 1) {
      const blocks = parseStreamingMarkdown(full.slice(0, length), true)
      // A stream only appends: the number of blocks never goes down.
      expect(blocks.length).toBeGreaterThanOrEqual(previous)
      previous = blocks.length
      const rendered = JSON.stringify(blocks.filter((block) => block.type !== 'code'))
      expect(rendered).not.toContain('**')
      expect(rendered).not.toContain('`')
    }
    expect(parseStreamingMarkdown(full, false).map((block) => block.type)).toEqual(['paragraph', 'code', 'list', 'paragraph'])
  })

  it('holds back a partial opening or closing fence', () => {
    expect(parseStreamingMarkdown('Text\n``', true)).toEqual([
      { type: 'paragraph', inline: [{ type: 'text', text: 'Text' }] },
    ])
    expect(parseStreamingMarkdown('```\nx = 1\n``', true)).toEqual([{ type: 'code', lang: '', code: 'x = 1', open: true }])
    expect(parseStreamingMarkdown('```\nx = 1\n```', true)).toEqual([{ type: 'code', lang: '', code: 'x = 1', open: false }])
  })

  it('does not show a half-typed language tag', () => {
    expect(parseStreamingMarkdown('```t', true)).toEqual([{ type: 'code', lang: '', code: '', open: true }])
    expect(parseStreamingMarkdown('```ts\n', true)).toEqual([{ type: 'code', lang: 'ts', code: '', open: true }])
  })

  it('treats a dangling ** or backtick as open while streaming, and as literal text when finished', () => {
    expect(parseInline('pay **onc', true)).toEqual([
      { type: 'text', text: 'pay ' },
      { type: 'bold', children: [{ type: 'text', text: 'onc' }] },
    ])
    expect(parseInline('send `If-Mat', true)).toEqual([
      { type: 'text', text: 'send ' },
      { type: 'code', text: 'If-Mat' },
    ])
    expect(parseInline('half *', true)).toEqual([{ type: 'text', text: 'half ' }])
    expect(parseInline('2 ** 3 and a ` tick', false)).toEqual([{ type: 'text', text: '2 ** 3 and a ` tick' }])
  })

  it('nests inline code inside bold', () => {
    expect(parseInline('**`Idempotency-Key`** names one intent', false)).toEqual([
      { type: 'bold', children: [{ type: 'code', text: 'Idempotency-Key' }] },
      { type: 'text', text: ' names one intent' },
    ])
  })

  it('parses headings and ordered lists', () => {
    expect(parseStreamingMarkdown('### Nena\n\n1. first\n2. second', false)).toEqual([
      { type: 'heading', level: 3, inline: [{ type: 'text', text: 'Nena' }] },
      { type: 'list', ordered: true, items: [[{ type: 'text', text: 'first' }], [{ type: 'text', text: 'second' }]] },
    ])
  })
})

describe('fetchChatTransport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects with the server message on 429, so the chat can show how long to wait', async () => {
    const body = { error: 'Too many requests from this network. Try again in 50 seconds.' }
    vi.stubGlobal('fetch', async () => Response.json(body, { status: 429, headers: { 'Retry-After': '50' } }))
    const events: ChatStreamEvent[] = []
    await expect(
      fetchChatTransport({
        messages: [{ role: 'user', content: 'hi' }],
        signal: new AbortController().signal,
        onEvent: (event) => events.push(event),
      }),
    ).rejects.toThrow(body.error)
    expect(events).toEqual([])
  })

  it('decodes a streamed body whose multi-byte characters are split across chunks', async () => {
    const frames = new TextEncoder().encode(
      encodeSseFrame({ type: 'token', text: '₱5,000.00 Σ' }) + encodeSseFrame({ type: 'done', finishReason: 'stop' }),
    )
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // One byte per chunk: every multi-byte character arrives in pieces.
        for (const byte of frames) controller.enqueue(new Uint8Array([byte]))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }))
    const events: ChatStreamEvent[] = []
    await fetchChatTransport({
      messages: [{ role: 'user', content: 'hi' }],
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    })
    expect(events).toEqual([
      { type: 'token', text: '₱5,000.00 Σ' },
      { type: 'done', finishReason: 'stop' },
    ])
  })
})
