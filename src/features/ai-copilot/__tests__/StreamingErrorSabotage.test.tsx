/**
 * FE-08 sabotage suite: every designed failure state, driven on purpose.
 *
 * The chat runs with an injected transport the test controls frame by frame,
 * so each failure lands at an exact moment: before send, after partial tokens,
 * as a 429, as a malformed frame. The real `fetchChatTransport` is tested
 * separately below against stubbed `fetch` responses.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDisbursementServer, SEED_LOANS } from '../../disbursement/index.ts'
import { UnderwritingWorkbench } from '../../scoring/UnderwritingWorkbench.tsx'
import { RouteErrorPanel } from '../../../components/RouteErrorPanel.tsx'
import { CHAT_TURN_RESERVE } from '../../../components/ui/SkeletonCard.tsx'
import { SABOTAGE_MODES, type ChatStreamEvent, type SabotageMode, type WireMessage } from '../chatProtocol.ts'
import { ChatRequestError, fetchChatTransport, parseRetryAfter, type ChatTransport } from '../chatTransport.ts'
import type { StarterPrompt } from '../chatTypes.ts'
import { SLOW_REPLY_MS, StreamingUnderwritingChat } from '../StreamingUnderwritingChat.tsx'

const STARTERS: readonly StarterPrompt[] = [
  { id: 'score', label: 'Explain a trust score', prompt: "Explain Nena's trust score." },
  { id: 'lifecycle', label: 'Walk the 10 loan states', prompt: 'Walk me through the 10 loan states.' },
  { id: 'ledger', label: 'Prove Σ debits === Σ credits', prompt: 'Show the journal entry for ₱5,000.00.' },
  { id: 'idempotency', label: 'Two admins click Disburse', prompt: 'Two admins click Disburse at once.' },
]

const PROMPT = "Evaluate sari-sari store owner Liza's trust score from her GCash load history and utility bills."

interface Call {
  readonly messages: readonly WireMessage[]
  readonly sabotage: SabotageMode | undefined
  readonly emit: (event: ChatStreamEvent) => void
  readonly close: () => void
  readonly fail: (error: Error) => void
}

function createTransport(): { transport: ChatTransport; calls: Call[] } {
  const calls: Call[] = []
  const transport: ChatTransport = ({ messages, signal, onEvent, sabotage }) =>
    new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
      calls.push({ messages, sabotage, emit: onEvent, close: resolve, fail: reject })
    })
  return { transport, calls }
}

function renderChat() {
  const fake = createTransport()
  render(
    <StreamingUnderwritingChat
      starterPrompts={STARTERS}
      engine={{ kind: 'local', label: 'test engine' }}
      transport={fake.transport}
    />,
  )
  return fake
}

const input = (): HTMLTextAreaElement => screen.getByLabelText<HTMLTextAreaElement>('Ask the copilot')
const log = (): HTMLElement => screen.getByRole('log', { name: 'Conversation' })
/** The failure banner is the chat's one `role="alert"`. */
const banner = (): HTMLElement => screen.getByRole('alert')
const reply = (): HTMLElement => screen.getAllByRole('group', { name: 'Copilot reply' }).at(-1) ?? screen.getByRole('log')
/** Who said each turn, read the way a screen reader hears it: "You said:" or a "Copilot reply" group. */
const speakers = (): string[] => {
  const log = within(screen.getByRole('log', { name: 'Conversation' }))
  // Top-level turns only: items of the conversation's first list, not bullets inside a reply.
  const turns = log.getAllByRole('list')[0]
  return log
    .getAllByRole('listitem')
    .filter((item) => item.parentElement === turns)
    .map((item) => (within(item).queryByRole('group', { name: 'Copilot reply' }) === null ? 'user' : 'assistant'))
}
const retryButton = (): HTMLButtonElement => within(banner()).getByRole<HTMLButtonElement>('button')
const token = (text: string): ChatStreamEvent => ({ type: 'token', text })
const DONE: ChatStreamEvent = { type: 'done', finishReason: 'stop' }

function at(calls: readonly Call[], index: number): Call {
  const call = calls[index]
  if (call === undefined) throw new Error(`transport call ${index} was never made`)
  return call
}

function emit(call: Call, ...events: ChatStreamEvent[]): void {
  for (const event of events) act(() => call.emit(event))
}

async function failWith(call: Call, error: Error): Promise<void> {
  await act(async () => {
    call.fail(error)
    await Promise.resolve()
  })
}

function send(text: string): void {
  fireEvent.change(input(), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('FE-08 sabotage drills: the chat', () => {
  it('1. happy path: completes with zero console.error calls', () => {
    const consoleError = vi.spyOn(console, 'error')
    const { calls } = renderChat()
    send(PROMPT)
    emit(at(calls, 0), { type: 'meta', engine: { kind: 'local', label: 'test engine' } }, token('Trust score '), token('**712 / 1000**'), DONE)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(within(log()).getByText('712 / 1000')).toBeDefined()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('2. mid-stream failure keeps the partial text, names the failed prompt, and Retry ignores a double-click', () => {
    const { calls } = renderChat()
    send(PROMPT)
    emit(at(calls, 0), token('Partial '), token('answer about Liza'), {
      type: 'error',
      message: 'Sabotage drill: the stream was cut after 2 tokens. The partial reply is kept.',
    })

    expect(banner().textContent).toContain('The reply stopped part-way.')
    expect(banner().textContent).toContain('The partial answer above is kept.')
    expect(within(banner()).getByText('ERR_MID_STREAM')).toBeDefined()
    expect(within(log()).getByText('Partial answer about Liza')).toBeDefined()
    expect(retryButton().textContent).toBe('Retry failed prompt: “Evaluate sari-sari store owner Liza\'s trust…”')
    expect(retryButton().title).toBe(PROMPT)

    // Two clicks in one frame: React has not re-rendered `disabled` yet. The in-flight lock must hold.
    act(() => {
      fireEvent.click(retryButton())
      fireEvent.click(retryButton())
    })
    expect(calls).toHaveLength(2) // the original send + exactly one retry
    expect(retryButton().disabled).toBe(true)
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    expect(retryButton().textContent).toContain('Retrying')
    // Only the failed turn is re-sent: the history ends at its prompt, with no partial reply in it.
    expect(at(calls, 1).messages).toEqual([{ role: 'user', content: PROMPT }])
    expect(at(calls, 1).sabotage).toBeUndefined()

    // The banner leaves as soon as the retried reply streams, not only when it finishes.
    emit(at(calls, 1), token('Recovered: 712 / 1000.'))
    expect(screen.queryByRole('alert')).toBeNull()
    emit(at(calls, 1), DONE)
    // The retry replaced the failed reply in place: one question, one answer, nothing wiped.
    expect(speakers()).toEqual(['user', 'assistant'])
    expect(within(log()).getByText('Recovered: 712 / 1000.')).toBeDefined()
  })

  it('3. a 429 shows the rate-limit banner, counts down Retry-After, then retries', async () => {
    vi.useFakeTimers()
    const { calls } = renderChat()
    send(PROMPT)
    await failWith(
      at(calls, 0),
      new ChatRequestError('Too many requests from this network. Try again in 2 seconds.', {
        kind: 'rate-limit',
        status: 429,
        retryAfterSeconds: 2,
      }),
    )
    expect(banner().textContent).toContain('Retry-After')
    expect(banner().textContent).toContain('Rate limit reached (HTTP 429).')
    expect(within(banner()).getByText('HTTP_429')).toBeDefined()
    expect(banner().textContent).toContain('Retry-After: 2 s')
    expect(retryButton().disabled).toBe(true)

    act(() => {
      vi.advanceTimersByTime(2100)
    })
    expect(banner().textContent).not.toContain('Retry-After')
    expect(retryButton().disabled).toBe(false)
    fireEvent.click(retryButton())
    expect(calls).toHaveLength(2)
    expect(at(calls, 1).messages.at(-1)).toEqual({ role: 'user', content: PROMPT })
  })

  it('a malformed tool frame ends the reply with its own banner and keeps the partial text', async () => {
    const { calls } = renderChat()
    send(PROMPT)
    emit(at(calls, 0), token('Scoring Liza'))
    await failWith(
      at(calls, 0),
      new ChatRequestError('A stream frame was not valid JSON (a tool payload was cut off).', { kind: 'malformed' }),
    )
    expect(banner().textContent).toContain('A reply frame was not valid JSON.')
    expect(within(banner()).getByText('ERR_MALFORMED_FRAME')).toBeDefined()
    expect(within(log()).getByText('Scoring Liza')).toBeDefined()
  })

  it('the drill toolbar: every mode is a bound, labelled control, arms one request, then disarms', () => {
    const { calls } = renderChat()
    for (const choice of ['off', ...SABOTAGE_MODES]) {
      const radio = screen.getByLabelText<HTMLInputElement>(choice === 'off' ? 'off (normal)' : choice)
      expect(radio.getAttribute('aria-invalid')).toBe('false')
      expect(radio.getAttribute('aria-describedby')).toBe('copilot-drill-hint')
    }
    fireEvent.click(screen.getByLabelText('mid-stream-error'))
    send(PROMPT)
    expect(at(calls, 0).sabotage).toBe('mid-stream-error')
    expect(screen.getByLabelText<HTMLInputElement>('off (normal)').checked).toBe(true)
  })

  it('1b. network-drop fails before send: no request goes out, the question is kept, Retry sends it clean', () => {
    const { calls } = renderChat()
    fireEvent.click(screen.getByLabelText('network-drop'))
    send(PROMPT)
    expect(calls).toHaveLength(0)
    expect(banner().textContent).toContain('No connection. Nothing was sent.')
    expect(within(banner()).getByText('ERR_OFFLINE')).toBeDefined()
    expect(within(log()).getByText(PROMPT)).toBeDefined()

    fireEvent.click(retryButton())
    expect(calls).toHaveLength(1)
    expect(at(calls, 0).sabotage).toBeUndefined()
  })

  it('whitespace-only input is not sent and the field says why', () => {
    const { calls } = renderChat()
    fireEvent.change(input(), { target: { value: '   \n  ' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(calls).toHaveLength(0)
    expect(input().getAttribute('aria-invalid')).toBe('true')
    expect(input().getAttribute('aria-describedby')).toBe('copilot-input-hint copilot-input-error')
    expect(screen.getByRole('alert').textContent).toContain('Type a question first')
    fireEvent.change(input(), { target: { value: 'What is If-Match?' } })
    expect(input().getAttribute('aria-invalid')).toBe('false')
  })

  it('a reply with no first token after 1.5 s shows a skeleton, and the first tokens keep its height', () => {
    vi.useFakeTimers()
    const { calls } = renderChat()
    send(PROMPT)
    expect(screen.getByText('Thinking…')).toBeDefined()
    act(() => {
      vi.advanceTimersByTime(SLOW_REPLY_MS + 10)
    })
    const body = reply()
    expect(within(body).getByText('Still working: no first token after 1.5 s.')).toBeDefined()
    // jsdom has no layout, so the height reserve is checked as the shared constant, not a hard-coded class name.
    expect(body.className).toContain(CHAT_TURN_RESERVE)
    emit(at(calls, 0), token('Late but whole.'))
    expect(within(body).queryByText('Still working: no first token after 1.5 s.')).toBeNull()
    expect(body.className).toContain(CHAT_TURN_RESERVE)
  })
})

describe('FE-08 empty states are next actions', () => {
  it('4a. first run: the onboarding card says what is checked and runs a prompt in one click', () => {
    const { calls } = renderChat()
    const card = screen.getByRole('region', { name: 'What this copilot checks' })
    expect(card.textContent).toContain('Σ debits === Σ credits')
    expect(card.textContent).toContain('APPROVED → DISBURSED')
    expect(card.textContent).toContain('GCash / Maya')
    const chips = within(card).getAllByRole('button')
    expect(chips).toHaveLength(4)
    fireEvent.click(within(card).getByRole('button', { name: 'Walk the 10 loan states' }))
    expect(at(calls, 0).messages).toEqual([{ role: 'user', content: 'Walk me through the 10 loan states.' }])
  })

  it('4b. no results: names the filter and query, resets in one click, or opens a sample application', async () => {
    render(<UnderwritingWorkbench server={createDisbursementServer(SEED_LOANS)} debounceMs={0} />)
    const search = screen.getByLabelText('Search borrower name or loan ID')
    expect(search.getAttribute('aria-invalid')).toBe('false')

    fireEvent.change(search, { target: { value: 'zzz-nobody' } })
    const empty = await screen.findByRole('region', { name: 'No loans match this view.' })
    expect(empty.textContent).toContain('ALL')
    expect(empty.textContent).toContain('“zzz-nobody”')
    fireEvent.click(within(empty).getByRole('button', { name: `Reset filters & show all loans (${SEED_LOANS.length})` }))
    expect(screen.queryByRole('region', { name: 'No loans match this view.' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Review / })).toHaveLength(SEED_LOANS.length)
    expect((search as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(search)

    fireEvent.click(screen.getByLabelText('SETTLED'))
    const settledEmpty = await screen.findByRole('region', { name: 'No loans match this view.' })
    expect(settledEmpty.textContent).toContain('SETTLED')
    fireEvent.click(within(settledEmpty).getByRole('button', { name: 'Load sample borrower application (L-1045 · APPLIED)' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: /^L-1045/ })).toBeDefined()
    })
  })
})

describe('FE-08 route error boundary panel', () => {
  it('focuses its heading, shows a code, logs no message, and Retry calls retry()', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const retry = vi.fn()
    render(
      <RouteErrorPanel
        error={new Error('borrower 0917-555-0101 broke it')}
        retry={retry}
        boundary="underwriting"
        title="The underwriting screen hit an error."
      />,
    )
    const heading = screen.getByRole('heading', { level: 1, name: 'The underwriting screen hit an error.' })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByText('ERR_ROUTE_ERROR')).toBeDefined()
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(String(consoleError.mock.calls[0]?.[0])).toBe('{"event":"route.error","boundary":"underwriting","type":"Error","digest":null}')
    fireEvent.click(screen.getByRole('button', { name: 'Retry this page' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('uses the server digest as the code when there is one', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = Object.assign(new Error('An error occurred in the Server Components render.'), { digest: '2417760583' })
    render(<RouteErrorPanel error={error} retry={() => {}} boundary="root" title="This page hit an error." />)
    expect(screen.getByText('DIGEST_2417760583')).toBeDefined()
  })
})

describe('FE-08 fetchChatTransport against real responses', () => {
  function sse(...frames: string[]): Response {
    return new Response(frames.join(''), { headers: { 'Content-Type': 'text/event-stream' } })
  }

  it('sends the sabotage header, and turns a 429 into a rate-limit error with Retry-After', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Rate limit drill. Try again in 5 seconds.' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '5' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const error = await fetchChatTransport({
      messages: [{ role: 'user', content: PROMPT }],
      signal: new AbortController().signal,
      onEvent: () => {},
      sabotage: 'rate-limit-429',
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ChatRequestError)
    expect(error).toMatchObject({ kind: 'rate-limit', status: 429, retryAfterSeconds: 5 })
    const init = fetchMock.mock.calls.at(0)?.at(1)
    expect(new Headers((init as RequestInit | undefined)?.headers).get('x-sabotage-mode')).toBe('rate-limit-429')
    vi.unstubAllGlobals()
  })

  it('delivers tokens before a malformed frame, then stops with a malformed error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse('data: {"type":"token","text":"Scoring "}\n\n', 'data: {"type":"tool-call","input":{"borrowerId":"b\n\n')),
    )
    const events: ChatStreamEvent[] = []
    const error = await fetchChatTransport({
      messages: [{ role: 'user', content: PROMPT }],
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    }).catch((caught: unknown) => caught)
    expect(events).toEqual([{ type: 'token', text: 'Scoring ' }])
    expect(error).toMatchObject({ kind: 'malformed' })
    vi.unstubAllGlobals()
  })

  it('a fetch that never reaches the server is an offline error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const error = await fetchChatTransport({
      messages: [{ role: 'user', content: PROMPT }],
      signal: new AbortController().signal,
      onEvent: () => {},
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ kind: 'offline' })
    vi.unstubAllGlobals()
  })

  it('reads Retry-After seconds and ignores dates and garbage', () => {
    expect(parseRetryAfter('27')).toBe(27)
    expect(parseRetryAfter(' 5 ')).toBe(5)
    expect(parseRetryAfter('99999')).toBe(3600)
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull()
    expect(parseRetryAfter('-1')).toBeNull()
    expect(parseRetryAfter(null)).toBeNull()
  })
})
