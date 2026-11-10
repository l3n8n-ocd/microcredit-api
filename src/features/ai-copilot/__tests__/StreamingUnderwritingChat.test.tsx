import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatStreamEvent, WireMessage } from '../chatProtocol.ts'
import type { ChatTransport } from '../chatTransport.ts'
import type { StarterPrompt } from '../chatTypes.ts'
import { STORAGE_KEY } from '../conversationStore.ts'
import { StreamingUnderwritingChat } from '../StreamingUnderwritingChat.tsx'

const STARTERS: readonly StarterPrompt[] = [
  { id: 'score', label: 'Explain a trust score', prompt: "Explain Nena's trust score." },
  { id: 'lifecycle', label: 'Walk the 10 loan states', prompt: 'Walk me through the 10 loan states.' },
  { id: 'ledger', label: 'Prove Σ debits === Σ credits', prompt: 'Show the journal entry for ₱5,000.00.' },
  { id: 'idempotency', label: 'Two admins click Disburse', prompt: 'Two admins click Disburse at once.' },
]

interface FakeCall {
  readonly messages: readonly WireMessage[]
  readonly signal: AbortSignal
  /** Push one stream event into the component, as the network would. */
  readonly emit: (event: ChatStreamEvent) => void
  /** End the stream without a `done` frame (a dropped connection). */
  readonly close: () => void
  readonly fail: (error: Error) => void
}

/**
 * A transport the test drives by hand: nothing arrives until the test emits it,
 * and an aborted signal rejects exactly like `fetch` does.
 */
function createFakeTransport(): { transport: ChatTransport; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const transport: ChatTransport = ({ messages, signal, onEvent }) =>
    new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
      calls.push({ messages, signal, emit: onEvent, close: resolve, fail: reject })
    })
  return { transport, calls }
}

function renderChat() {
  const fake = createFakeTransport()
  const view = render(
    <StreamingUnderwritingChat
      starterPrompts={STARTERS}
      engine={{ kind: 'local', label: 'test engine' }}
      transport={fake.transport}
    />,
  )
  return { ...fake, view }
}

const input = (): HTMLTextAreaElement => screen.getByLabelText<HTMLTextAreaElement>('Ask the copilot')
const sendButton = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('button', { name: 'Send' })
const stopButton = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('button', { name: 'Stop' })
const log = (): HTMLElement => screen.getByRole('log', { name: 'Conversation' })
const lastAssistantBody = (): HTMLElement => {
  const body = screen.getAllByTestId('assistant-body').at(-1)
  if (body === undefined) throw new Error('no assistant message rendered')
  return body
}

function sendMessage(text: string): void {
  fireEvent.change(input(), { target: { value: text } })
  fireEvent.click(sendButton())
}

function callAt(calls: readonly FakeCall[], index: number): FakeCall {
  const call = calls[index]
  if (call === undefined) throw new Error(`transport call ${index} was never made`)
  return call
}

/** Emits events inside `act` so React commits each one before the next assertion. */
function emit(call: FakeCall, ...events: ChatStreamEvent[]): void {
  for (const event of events) act(() => call.emit(event))
}

const token = (text: string): ChatStreamEvent => ({ type: 'token', text })
const DONE: ChatStreamEvent = { type: 'done', finishReason: 'stop' }

/** jsdom has no layout. Give the scroll container real-looking metrics. */
function setScrollMetrics(element: HTMLElement, metrics: { scrollHeight: number; clientHeight: number }): void {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: metrics.scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: metrics.clientHeight })
}

function userScrollsTo(element: HTMLElement, scrollTop: number): void {
  element.scrollTop = scrollTop
  fireEvent.scroll(element)
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('StreamingUnderwritingChat', () => {
  it('shows an inline thinking indicator, then streams tokens into the same container (Tip 3)', () => {
    const { calls } = renderChat()
    sendMessage("Explain Nena's trust score.")

    // submitted: the assistant bubble already exists and holds the thinking indicator.
    const body = lastAssistantBody()
    expect(within(body).getByTestId('thinking-indicator').textContent).toContain('Thinking')
    expect(log().getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe('Copilot is thinking.')
    expect(stopButton()).toBeDefined()
    expect(within(log()).getByText("Explain Nena's trust score.")).toBeDefined()

    // First token: same DOM node, indicator gone, text in its place.
    const call = callAt(calls, 0)
    emit(call, { type: 'meta', engine: { kind: 'local', label: 'local rule engine' } }, token('Trust '))
    expect(lastAssistantBody()).toBe(body)
    expect(screen.queryByTestId('thinking-indicator')).toBeNull()
    expect(body.textContent).toBe('Trust')
    expect(screen.getByRole('status').textContent).toBe('Copilot is replying.')

    // Tokens append one by one.
    emit(call, token('score '), token('**980'), token(' / 1000**'))
    expect(body.textContent).toBe('Trust score 980 / 1000')
    expect(body.querySelector('strong')?.textContent).toBe('980 / 1000')

    emit(call, DONE)
    expect(lastAssistantBody()).toBe(body)
    expect(log().getAttribute('aria-busy')).toBe('false')
    expect(screen.getByRole('status').textContent).toBe('Reply complete.')
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(within(log()).getByText(/local rule engine/)).toBeDefined()
  })

  it('Stop mid-stream aborts, keeps the partial reply, re-enables the input, and allows "stop, then send again" (Tip 2)', () => {
    const { calls } = renderChat()

    sendMessage('First question')
    const first = callAt(calls, 0)
    emit(first, token('Partial '), token('answer'), token(' with **`Idem'))
    fireEvent.click(stopButton())

    // The request itself was aborted, not just hidden.
    expect(first.signal.aborted).toBe(true)
    // The partial text stays, flagged.
    // Stopped inside "**`Idempotency-Key`**": the half-written markers must not show as raw symbols.
    expect(lastAssistantBody().textContent).toBe('Partial answer with Idem')
    expect(lastAssistantBody().querySelector('strong code')?.textContent).toBe('Idem')
    expect(within(log()).getByText('[Stopped mid-stream]')).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe('Stopped. The partial reply is kept.')
    // The composer is live again in the same render: input enabled and focused, Send back.
    expect(input().disabled).toBe(false)
    expect(document.activeElement).toBe(input())
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()

    // A token from the aborted request that lands late is dropped.
    emit(first, token(' LATE TOKEN'), DONE)
    expect(log().textContent).not.toContain('LATE TOKEN')

    // Send again immediately. The history carries the partial reply.
    sendMessage('Second question')
    const second = callAt(calls, 1)
    expect(second.signal.aborted).toBe(false)
    expect(second.messages).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Partial answer with **`Idem' },
      { role: 'user', content: 'Second question' },
    ])
    emit(second, token('Full second answer'), DONE)
    expect(lastAssistantBody().textContent).toBe('Full second answer')

    // Unlimited turns: stop → send → stop → send keeps working, including a stop before the first token.
    for (let turn = 3; turn <= 6; turn += 1) {
      sendMessage(`Question ${turn}`)
      const call = callAt(calls, turn - 1)
      if (turn % 2 === 0) emit(call, token(`Partial ${turn}`))
      fireEvent.click(stopButton())
      expect(call.signal.aborted).toBe(true)
      expect(input().disabled).toBe(false)
    }
    expect(calls).toHaveLength(6)
    expect(within(log()).getAllByText('[Stopped mid-stream]')).toHaveLength(5)
    // A reply stopped before its first token has no text, so it is left out of the next request.
    sendMessage('Question 7')
    expect(callAt(calls, 6).messages.filter((item) => item.content === '')).toHaveLength(0)
    expect(callAt(calls, 6).messages.at(-1)).toEqual({ role: 'user', content: 'Question 7' })
  })

  it('keeps multi-turn state and persists it to localStorage, surviving a remount', () => {
    const { calls, view } = renderChat()

    sendMessage('Turn one')
    emit(callAt(calls, 0), token('Answer one'), DONE)
    sendMessage('Turn two')
    // The second request carries the whole first turn: that is the model's context.
    expect(callAt(calls, 1).messages).toEqual([
      { role: 'user', content: 'Turn one' },
      { role: 'assistant', content: 'Answer one' },
      { role: 'user', content: 'Turn two' },
    ])
    emit(callAt(calls, 1), token('Answer two'), DONE)

    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    expect(stored).toHaveLength(4)
    expect(stored).toMatchObject([
      { role: 'user', parts: [{ type: 'text', text: 'Turn one' }], outcome: 'complete' },
      { role: 'assistant', parts: [{ type: 'text', text: 'Answer one' }], outcome: 'complete' },
      { role: 'user', parts: [{ type: 'text', text: 'Turn two' }], outcome: 'complete' },
      { role: 'assistant', parts: [{ type: 'text', text: 'Answer two' }], outcome: 'complete' },
    ])

    // A fresh mount (a page reload) restores the conversation from storage.
    view.unmount()
    const reloaded = renderChat()
    expect(within(log()).getByText('Turn one')).toBeDefined()
    expect(within(log()).getByText('Answer two')).toBeDefined()
    sendMessage('Turn three')
    expect(callAt(reloaded.calls, 0).messages).toHaveLength(5)
    emit(callAt(reloaded.calls, 0), token('Answer three'), DONE)

    // Clear / Reset wipes the screen and the storage key.
    fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }))
    expect(within(log()).queryByText('Turn one')).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Clear conversation' }).disabled).toBe(true)
  })

  it('ignores corrupt or foreign localStorage data instead of crashing', () => {
    window.localStorage.setItem(STORAGE_KEY, '{"not":"an array"')
    renderChat()
    expect(screen.getAllByRole('button', { name: 'Explain a trust score' })).toHaveLength(1)

    cleanup()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ role: 'admin', parts: 'x' }, 42, null]))
    renderChat()
    expect(within(log()).getAllByRole('listitem')).toHaveLength(STARTERS.length) // starter chips only
    expect(log().querySelector('[data-role]')).toBeNull()
  })

  it('renders an unclosed code fence and dangling bold mid-stream without crashing or flashing markers (Tip 4)', () => {
    const { calls } = renderChat()
    sendMessage('Show the journal entry')
    const call = callAt(calls, 0)

    emit(call, token('Entry:\n\n'), token('```text\n'), token('DEBIT  loans_receivable 500000'))
    const body = lastAssistantBody()
    const pre = body.querySelector('pre')
    expect(pre?.textContent).toBe('DEBIT  loans_receivable 500000')
    expect(body.querySelector('[data-code-open]')?.getAttribute('data-code-open')).toBe('true')
    expect(body.textContent).not.toContain('```')

    // The closing fence arrives a backtick at a time. No backtick ever shows; the <pre> is never re-mounted.
    emit(call, token('\nCREDIT wallet_clearing  500000\n'), token('`'), token('`'))
    expect(body.textContent).not.toContain('`')
    emit(call, token('`\n\n'), token('Balanced: **yes'))
    expect(body.querySelector('pre')).toBe(pre)
    expect(body.querySelector('[data-code-open]')?.getAttribute('data-code-open')).toBe('false')
    expect(pre?.textContent).toBe('DEBIT  loans_receivable 500000\nCREDIT wallet_clearing  500000')
    // Dangling bold renders as bold-in-progress, not as raw asterisks.
    expect(body.querySelector('strong')?.textContent).toBe('yes')
    expect(body.textContent).not.toContain('**')

    // A reply that ends with a fence still open is shown as code, not dropped.
    emit(call, token('**\n\n```ts\nconst never = "closed"'), DONE)
    const blocks = body.querySelectorAll('pre')
    expect(blocks).toHaveLength(2)
    expect(blocks[1]?.textContent).toBe('const never = "closed"')
    expect(body.textContent).not.toContain('```')
  })

  it('auto-scrolls only while pinned within 48px; scrolling up releases it and shows "Jump to latest" (Tip 1)', () => {
    const { calls } = renderChat()
    sendMessage('Walk me through the 10 loan states.')
    const call = callAt(calls, 0)
    const scroller = log()
    setScrollMetrics(scroller, { scrollHeight: 1000, clientHeight: 400 })

    // Pinned: each token moves the view to the bottom.
    emit(call, token('APPLIED '))
    expect(scroller.scrollTop).toBe(1000)
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull()

    // The user scrolls up 300px to read. The pin is released and the pill appears.
    userScrollsTo(scroller, 300)
    expect(screen.getByRole('button', { name: '↓ Jump to latest (streaming…)' })).toBeDefined()

    // New tokens keep arriving, the content grows, and the view does NOT move.
    setScrollMetrics(scroller, { scrollHeight: 1400, clientHeight: 400 })
    emit(call, token('UNDER_REVIEW '), token('APPROVED '))
    expect(scroller.scrollTop).toBe(300)

    // The race that matters in a real browser: the user has scrolled, but the scroll EVENT
    // has not been delivered yet when the next token commits. The view must still not move.
    userScrollsTo(scroller, 1400 - 400) // back at the bottom, pinned
    emit(call, token('(pinned) '))
    scroller.scrollTop = 250 // scrolled up; no scroll event fired yet
    emit(call, token('(token in the gap) '))
    expect(scroller.scrollTop).toBe(250)

    // 48px from the bottom still counts as following: pinned again, pill gone.
    userScrollsTo(scroller, 1400 - 400 - 48)
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull()
    emit(call, token('DISBURSED '))
    expect(scroller.scrollTop).toBe(1400)

    // 49px is past the threshold: released.
    userScrollsTo(scroller, 1400 - 400 - 49)
    emit(call, token('REPAYING '))
    expect(scroller.scrollTop).toBe(1400 - 400 - 49)

    // The pill jumps to the bottom and re-pins.
    fireEvent.click(screen.getByRole('button', { name: '↓ Jump to latest (streaming…)' }))
    expect(scroller.scrollTop).toBe(1400)
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull()
    emit(call, token('SETTLED'))
    expect(scroller.scrollTop).toBe(1400)

    // After the stream ends the pill drops the "(streaming…)" suffix.
    emit(call, DONE)
    userScrollsTo(scroller, 0)
    expect(screen.getByRole('button', { name: '↓ Jump to latest' })).toBeDefined()

    // Sending a new message is an explicit jump to the latest.
    sendMessage('And DELINQUENT?')
    expect(scroller.scrollTop).toBe(1400)
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull()
  })

  it('binds the message field: label, aria-invalid, hint, and an error past the length limit', () => {
    renderChat()
    const field = screen.getByLabelText('Ask the copilot')
    expect(field.getAttribute('aria-invalid')).toBe('false')
    expect(field.getAttribute('aria-describedby')).toBe('copilot-input-hint')
    expect(document.getElementById('copilot-input-hint')?.textContent).toContain('Enter sends')
    expect(sendButton().disabled).toBe(true)

    fireEvent.change(field, { target: { value: 'x'.repeat(2001) } })
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby')).toBe('copilot-input-hint copilot-input-error')
    expect(screen.getByRole('alert').textContent).toContain('2001 of 2000 characters')
    expect(sendButton().disabled).toBe(true)

    fireEvent.change(field, { target: { value: 'ok' } })
    expect(field.getAttribute('aria-invalid')).toBe('false')
    expect(sendButton().disabled).toBe(false)
  })

  it('sends on Enter, not on Shift+Enter, and never while a reply is streaming', () => {
    const { calls } = renderChat()
    fireEvent.change(input(), { target: { value: 'Line one' } })
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true })
    expect(calls).toHaveLength(0)

    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(calls).toHaveLength(1)
    expect(input().value).toBe('')

    // Typing ahead is allowed, but Enter does not start a second request mid-stream.
    fireEvent.change(input(), { target: { value: 'Typed ahead' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(calls).toHaveLength(1)
    expect(input().value).toBe('Typed ahead')
  })

  it('sends a starter prompt in one click and disables the chips while busy', () => {
    const { calls } = renderChat()
    fireEvent.click(screen.getByRole('button', { name: 'Two admins click Disburse' }))
    expect(callAt(calls, 0).messages).toEqual([{ role: 'user', content: 'Two admins click Disburse at once.' }])
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Explain a trust score' }).disabled).toBe(true)

    emit(callAt(calls, 0), token('ok'), DONE)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Explain a trust score' }).disabled).toBe(false)
  })

  it('shows a failed request as an error, keeps the conversation, and recovers on the next send', async () => {
    const { calls } = renderChat()
    sendMessage('Will this fail?')
    await act(async () => {
      callAt(calls, 0).fail(new Error('The copilot request failed (HTTP 500).'))
      await Promise.resolve()
    })
    expect(screen.getByRole('alert').textContent).toContain('HTTP 500')
    expect(within(log()).getByText('[Reply failed]')).toBeDefined()
    expect(within(log()).getByText('Will this fail?')).toBeDefined()

    sendMessage('Try again')
    expect(screen.queryByRole('alert')).toBeNull()
    emit(callAt(calls, 1), token('Recovered'), DONE)
    expect(lastAssistantBody().textContent).toBe('Recovered')
  })

  it('treats a stream that closes without a done frame as a failure, and keeps the partial text', async () => {
    const { calls } = renderChat()
    sendMessage('Dropped connection')
    emit(callAt(calls, 0), token('Half a rep'))
    await act(async () => {
      callAt(calls, 0).close()
      await Promise.resolve()
    })
    expect(screen.getByRole('alert').textContent).toContain('connection closed')
    expect(lastAssistantBody().textContent).toBe('Half a rep')
  })
})
