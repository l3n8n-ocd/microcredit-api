/**
 * FE-10 · accessibility and performance fixes, unit level. Queries are by role, label and text only (FE-09).
 *
 *   1. The chat speaks through one polite status region: thinking → replying → a one-sentence summary
 *      of the settled reply (`settledSummary`). The transcript itself stays aria-live="off".
 *   2. Stop is the button right after the prompt, named "Stop generating AI response" with
 *      aria-keyshortcuts="Escape" while a reply is in flight; Escape anywhere in the chat stops it
 *      and puts focus back in the prompt.
 *   3. The live reply bubble reports aria-busy="true" until it settles.
 *   4. The pending Idempotency-Key placeholder is as long as a UUID (no layout shift at hydration).
 *   5. The tool card is a lazy chunk: before it arrives a placeholder holds its place, then the card renders.
 *
 * This file never preloads the tool card, so (5) sees the chunk arrive for the first time.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IdempotencyKeyText } from '../../components/ui/IdempotencyKeyText.tsx'
import { PENDING_IDEMPOTENCY_KEY } from '../../hooks/useIdempotencyKey.ts'
import { evaluateBorrowerTrustScore } from '../../lib/ai/tools.ts'
import type { ChatStreamEvent } from '../ai-copilot/chatProtocol.ts'
import type { ChatTransport } from '../ai-copilot/chatTransport.ts'
import { SUMMARY_MAX_CHARS, settledSummary, type ChatMessage, type StarterPrompt } from '../ai-copilot/chatTypes.ts'
import { StreamingUnderwritingChat } from '../ai-copilot/StreamingUnderwritingChat.tsx'

const STARTERS: readonly StarterPrompt[] = [{ id: 'score', label: 'Explain a trust score', prompt: "Explain Nena's trust score." }]
const TOOL_PROMPTS: readonly StarterPrompt[] = [{ id: 'tool-score', label: 'Run Trust Score Tool (Chart)', prompt: "Score Nena's store." }]

interface Call {
  readonly emit: (event: ChatStreamEvent) => void
  readonly signal: AbortSignal
}

function renderChat(): Call[] {
  const calls: Call[] = []
  const transport: ChatTransport = ({ signal, onEvent }) =>
    new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
      calls.push({ emit: onEvent, signal })
    })
  render(<StreamingUnderwritingChat starterPrompts={STARTERS} toolPrompts={TOOL_PROMPTS} engine={{ kind: 'local', label: 'test engine' }} transport={transport} />)
  return calls
}

function emit(call: Call | undefined, ...events: ChatStreamEvent[]): void {
  if (call === undefined) throw new Error('no request was made')
  for (const event of events) act(() => call.emit(event))
}

const prompt = (): HTMLTextAreaElement => screen.getByLabelText<HTMLTextAreaElement>('Ask the copilot')
const status = (): HTMLElement => screen.getByRole('status')
const reply = (): HTMLElement => {
  const group = screen.getAllByRole('group', { name: 'Copilot reply' }).at(-1)
  if (group === undefined) throw new Error('no reply rendered')
  return group
}

function send(text: string): void {
  fireEvent.change(prompt(), { target: { value: text } })
  fireEvent.keyDown(prompt(), { key: 'Enter' })
}

function message(text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'a1', role: 'assistant', parts: [{ type: 'text', text }], createdAt: '2026-11-18T00:00:00.000Z', outcome: 'complete', ...extra }
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('settledSummary: what the status line reads once a reply settles', () => {
  it('reads the first sentence, without Markdown symbols or code', () => {
    expect(settledSummary(message('**No.** A `REJECTED` loan has no transition to `DISBURSED`. It must be re-applied.'))).toBe('No.')
    expect(settledSummary(message('A REJECTED loan cannot become DISBURSED; the server returns 409. Second sentence.'))).toBe(
      'A REJECTED loan cannot become DISBURSED; the server returns 409.',
    )
    expect(settledSummary(message('```ts\nconst x = 1\n```\nThe journal balances.'))).toBe('(code) The journal balances.')
  })

  it('caps a long sentence at 160 characters and names tool-only replies', () => {
    const long = settledSummary(message(`${'word '.repeat(60)}end.`))
    expect(long.length).toBe(SUMMARY_MAX_CHARS)
    expect(long.endsWith('…')).toBe(true)
    const toolOnly = message('', {
      parts: [
        {
          type: 'tool',
          toolCallId: 't1',
          toolName: 'evaluateBorrowerTrustScore',
          state: 'input-available',
          rationale: 'Asked for a score.',
          inputText: '{}',
          input: {},
          output: null,
          errorCode: null,
          errorText: null,
          timeline: [],
          decision: null,
        },
      ],
    })
    expect(settledSummary(toolOnly)).toBe('1 tool result below.')
    expect(settledSummary(message(''))).toBe('')
  })
})

describe('Streamed output is announced politely, without token spam', () => {
  it('one status region: thinking, replying, then "Reply complete." with the first sentence', () => {
    const calls = renderChat()
    expect(status().getAttribute('aria-live')).toBe('polite')
    expect(status().getAttribute('aria-atomic')).toBe('false')
    expect(screen.getByRole('log', { name: 'Conversation' }).getAttribute('aria-live')).toBe('off')

    send('Can a REJECTED loan be DISBURSED?')
    expect(status().textContent).toBe('Copilot is thinking.')
    expect(reply().getAttribute('aria-busy')).toBe('true')

    emit(calls[0], { type: 'token', text: 'No. A REJECTED loan ' })
    expect(status().textContent).toBe('Copilot is replying.')
    emit(calls[0], { type: 'token', text: 'has no path to DISBURSED.' }, { type: 'done', finishReason: 'stop' })
    expect(status().textContent).toBe('Reply complete. No.')
    expect(reply().getAttribute('aria-busy')).toBe('false')
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })
})

describe('Stop is keyboard-reachable and Escape stops the reply', () => {
  it('names Stop and its shortcut only while a reply is in flight', () => {
    const calls = renderChat()
    send('Walk me through the loan states.')
    const stop = screen.getByRole('button', { name: 'Stop generating AI response' })
    expect(stop.getAttribute('aria-keyshortcuts')).toBe('Escape')
    // Right after the prompt in the DOM, and nothing focusable between them: the next Tab stop.
    expect(prompt().compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(prompt().nextElementSibling).toBe(stop)

    emit(calls[0], { type: 'token', text: 'Ten states.' }, { type: 'done', finishReason: 'stop' })
    const send2 = screen.getByRole('button', { name: 'Send' })
    expect(send2.hasAttribute('aria-keyshortcuts')).toBe(false)
  })

  it('Escape inside the chat aborts the request, keeps the partial reply and returns focus to the prompt', () => {
    const calls = renderChat()
    send('Explain the ledger.')
    emit(calls[0], { type: 'token', text: 'Debits first' })
    screen.getByRole('button', { name: 'Stop generating AI response' }).focus()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Stop generating AI response' }), { key: 'Escape' })
    expect(calls[0]?.signal.aborted).toBe(true)
    expect(status().textContent).toBe('Stopped. The partial reply is kept.')
    expect(reply().textContent).toContain('Debits first')
    expect(document.activeElement).toBe(prompt())
    expect(screen.queryByRole('button', { name: 'Stop generating AI response' })).toBeNull()
  })

  it('Escape does nothing when no reply is in flight', () => {
    renderChat()
    fireEvent.change(prompt(), { target: { value: 'draft' } })
    fireEvent.keyDown(prompt(), { key: 'Escape' })
    expect(prompt().value).toBe('draft')
    expect(status().textContent).toBe('')
  })
})

describe('Layout shift and lazy chunks', () => {
  it('the pending key placeholder is 36 characters, like the UUID that replaces it, and reads as "pending"', () => {
    const { container } = render(
      <dd>
        <IdempotencyKeyText value={PENDING_IDEMPOTENCY_KEY} />
      </dd>,
    )
    expect(container.textContent).toHaveLength(36)
    expect(container.textContent?.startsWith('pending')).toBe(true)
    const mask = container.querySelector('[aria-hidden="true"]')
    expect(mask?.textContent).toHaveLength(29)
    cleanup()
    const real = render(
      <dd>
        <IdempotencyKeyText value="7f3c2a10-5b1e-4c7a-9d2e-0a1b2c3d4e5f" />
      </dd>,
    )
    expect(real.container.textContent).toHaveLength(36)
  })

  it('the tool card holds a placeholder until its chunk arrives, then renders the card', async () => {
    const calls = renderChat()
    fireEvent.click(screen.getByRole('button', { name: 'Run Trust Score Tool (Chart)' }))
    const input = { borrowerName: "Nena's Sari-Sari Store", businessType: 'sari-sari', monthlyUtilityOnTimeRatio: 92, supplierInvoiceCount: 18, gcashLoadWeeklyCadence: 5 } as const
    emit(calls[0], { type: 'tool-input-start', toolCallId: 'c1', toolName: 'evaluateBorrowerTrustScore', rationale: 'Asked for a score.' })
    expect(screen.getByText('Loading the tool result…')).toBeDefined()
    expect(await screen.findByRole('region', { name: 'Tool call evaluateBorrowerTrustScore: input-streaming' }, { timeout: 5000 })).toBeDefined()
    emit(
      calls[0],
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 'evaluateBorrowerTrustScore', input },
      { type: 'tool-output-available', toolCallId: 'c1', output: evaluateBorrowerTrustScore(input) },
      { type: 'done', finishReason: 'stop' },
    )
    expect(screen.getByRole('region', { name: 'Tool call evaluateBorrowerTrustScore: output-available' })).toBeDefined()
    expect(screen.queryByText('Loading the tool result…')).toBeNull()
  })
})
