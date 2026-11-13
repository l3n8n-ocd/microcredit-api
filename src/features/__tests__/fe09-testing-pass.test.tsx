/**
 * FE-09 · Testing pass: the three highest-risk UIs, tested the way a user meets them.
 *
 *   1. The chat renderer and its streaming lifecycle (StreamingUnderwritingChat + StreamingMarkdown)
 *   2. The validated money form (DisbursementForm)
 *   3. The tool-result card (ToolInvocationCard)
 *
 * Rules this file keeps (docs/FE-09_TESTING_PASS.md §1):
 *   - Queries by role, label and visible text only. No test ids, no class names,
 *     no data-* attributes: renaming a Tailwind class cannot break a test here.
 *   - `/api/chat` is mocked with `vi.spyOn(globalThis, 'fetch')`. The chat runs its
 *     real `fetchChatTransport` and SSE parser against a scripted stream the test
 *     controls frame by frame. Any other request throws, so nothing leaves the runner.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { evaluateBorrowerTrustScore, proposeDisbursementExecution, verifyLedgerAndIdempotency } from '../../lib/ai/tools.ts'
import type { ChatStreamEvent } from '../ai-copilot/chatProtocol.ts'
import type { StarterPrompt, ToolDecision, ToolPart, ToolState } from '../ai-copilot/chatTypes.ts'
import { copilotServer, resetCopilotServer } from '../ai-copilot/copilotLedger.ts'
import { StreamingUnderwritingChat } from '../ai-copilot/StreamingUnderwritingChat.tsx'
import { ToolInvocationCard } from '../ai-copilot/ToolInvocationCard.tsx'
import { DisbursementForm } from '../disbursement/DisbursementForm.tsx'
import { createDisbursementServer, type DisbursementServer } from '../disbursement/disbursementServer.ts'
import { accountBalance, journalTotals } from '../disbursement/ledger.ts'
import { SEED_LOANS } from '../disbursement/seedLoans.ts'

// ── The mocked /api/chat ────────────────────────────────────────────────────

/** One scripted reply: the test pushes SSE frames into it, or ends or breaks it. */
interface ScriptedReply {
  readonly push: (...events: ChatStreamEvent[]) => Promise<void>
  readonly close: () => Promise<void>
  /** The request body the browser sent for this reply. */
  readonly body: () => Record<string, unknown>
  /** The fetch signal: Stop must abort it. */
  readonly signal: () => AbortSignal | null
}

type Responder = (init: RequestInit) => Response

/** Lets the stream reader and React commit everything that is ready. */
const settle = (): Promise<void> => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

function scriptedReply(): { readonly reply: ScriptedReply; readonly respond: Responder } {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let init: RequestInit | null = null
  const respond: Responder = (requestInit) => {
    init = requestInit
    const stream = new ReadableStream<Uint8Array>({
      start(ready) {
        controller = ready
      },
    })
    // A real fetch errors its body when aborted. So does this one.
    requestInit.signal?.addEventListener('abort', () => controller?.error(new DOMException('The operation was aborted.', 'AbortError')))
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  const reply: ScriptedReply = {
    push: async (...events) => {
      for (const event of events) {
        controller?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        await settle()
      }
    },
    close: async () => {
      controller?.close()
      await settle()
    },
    body: () => JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    signal: () => init?.signal ?? null,
  }
  return { reply, respond }
}

interface ChatRoute {
  readonly fetchSpy: MockInstance<typeof fetch>
  /** Queue the response for the next POST /api/chat. */
  readonly next: (respond: Responder) => void
  readonly posts: () => number
  readonly deletes: () => string[]
}

function mockChatRoute(): ChatRoute {
  const queue: Responder[] = []
  let posts = 0
  const deletes: string[] = []
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init.method ?? 'GET'
    if (url.startsWith('/api/chat') && method === 'DELETE') {
      deletes.push(url)
      return Response.json({ cancelled: true })
    }
    if (url === '/api/chat' && method === 'POST') {
      posts += 1
      const respond = queue.shift()
      if (respond === undefined) throw new Error('A chat request arrived that the test did not script.')
      return respond(init)
    }
    // Never the real network: an unexpected call fails the test loudly.
    throw new Error(`Unexpected network call in a test: ${method} ${url}`)
  })
  return { fetchSpy, next: (respond) => queue.push(respond), posts: () => posts, deletes: () => deletes }
}

const STARTERS: readonly StarterPrompt[] = [{ id: 'score', label: 'Explain a trust score', prompt: "Explain Nena's trust score." }]
const PROMPT = "Evaluate sari-sari store owner Liza's trust score from her GCash load history and utility bills."

function renderChat(): void {
  render(<StreamingUnderwritingChat starterPrompts={STARTERS} engine={{ kind: 'local', label: 'test engine' }} />)
}

const field = (): HTMLTextAreaElement => screen.getByLabelText<HTMLTextAreaElement>('Ask the copilot')
const log = (): HTMLElement => screen.getByRole('log', { name: 'Conversation' })
const reply = (): HTMLElement => {
  const replies = screen.getAllByRole('group', { name: 'Copilot reply' })
  const last = replies.at(-1)
  if (last === undefined) throw new Error('no reply rendered')
  return last
}

async function ask(text: string): Promise<void> {
  fireEvent.change(field(), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await settle()
}

const token = (text: string): ChatStreamEvent => ({ type: 'token', text })
const DONE: ChatStreamEvent = { type: 'done', finishReason: 'stop' }
const TRUST_INPUT = {
  borrowerName: "Liza's Bigasan & Load",
  businessType: 'market-vendor',
  monthlyUtilityOnTimeRatio: 92,
  supplierInvoiceCount: 18,
  gcashLoadWeeklyCadence: 5,
} as const

let route: ChatRoute

beforeEach(() => {
  window.localStorage.clear()
  route = mockChatRoute()
})

afterEach(() => {
  cleanup()
  // Every request in this file went to the mocked /api/chat. None went anywhere else.
  for (const call of route.fetchSpy.mock.calls) expect(String(call[0])).toMatch(/^\/api\/chat/)
  vi.restoreAllMocks()
})

// ── High-risk UI 1: the chat renderer and its streaming lifecycle ───────────

describe('FE-09 · chat streaming lifecycle (mocked /api/chat)', () => {
  it('Test 1 · pending: the user turn shows at once, with an accessible "thinking" state before any token', async () => {
    const { reply: stream, respond } = scriptedReply()
    route.next(respond)
    renderChat()
    await ask(PROMPT)

    expect(within(log()).getByText(PROMPT)).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe('Copilot is thinking.')
    expect(within(reply()).getByText('Thinking…')).toBeDefined()
    expect(log().getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDefined()
    // The request carried the prompt as the last user turn.
    expect(stream.body().messages).toEqual([{ role: 'user', content: PROMPT }])
  })

  it('Test 2 · streaming: tokens, an unclosed code fence and a tool-call part render as they arrive', async () => {
    const { reply: stream, respond } = scriptedReply()
    route.next(respond)
    renderChat()
    await ask(PROMPT)

    await stream.push({ type: 'meta', engine: { kind: 'local', label: 'test engine' } }, token('Trust '), token('score '))
    expect(reply().textContent).toBe('Trust score')
    expect(screen.getByRole('status').textContent).toBe('Copilot is replying.')

    // A fence that is still open mid-stream: shown as code, markers never visible.
    await stream.push(token('\n\n```text\n'), token('DEBIT  loans_receivable 500000'))
    // getByText collapses runs of spaces in the page text, so the matcher uses one space…
    const code = within(reply()).getByText('DEBIT loans_receivable 500000')
    // …while the code block itself keeps both, because ledger columns line up on them.
    expect(code.textContent).toBe('DEBIT  loans_receivable 500000')
    expect(code.closest('[aria-busy]')?.getAttribute('aria-busy')).toBe('true')
    expect(reply().textContent).not.toContain('```')

    await stream.push(token('\nCREDIT wallet_clearing  500000\n```\n\n'))
    expect(code.closest('[aria-busy]')?.getAttribute('aria-busy')).toBe('false')

    // A tool-call part, through its lifecycle, inside the same reply.
    await stream.push(
      { type: 'tool-input-start', toolCallId: 'c1', toolName: 'evaluateBorrowerTrustScore', rationale: 'Asked for a score.' },
      { type: 'tool-input-delta', toolCallId: 'c1', delta: JSON.stringify(TRUST_INPUT) },
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 'evaluateBorrowerTrustScore', input: TRUST_INPUT },
    )
    expect(within(reply()).getByRole('region', { name: 'Tool call evaluateBorrowerTrustScore: input-available' })).toBeDefined()
    await stream.push(
      { type: 'tool-output-available', toolCallId: 'c1', output: evaluateBorrowerTrustScore(TRUST_INPUT) },
      token('**798** / 1000.'),
      DONE,
    )
    const card = within(reply()).getByRole('region', { name: 'Tool call evaluateBorrowerTrustScore: output-available' })
    expect(within(card).getByRole('img', { name: 'Trust score breakdown, 3 pillars' })).toBeDefined()
    expect(within(reply()).getByRole('strong').textContent).toBe('798')
    expect(screen.getByRole('status').textContent).toBe('Reply complete.')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDefined()
  })

  it('Test 3a · error mid-stream: the partial reply stays, an alert names the failure, and Retry re-sends only that turn', async () => {
    const first = scriptedReply()
    route.next(first.respond)
    renderChat()
    await ask(PROMPT)
    await first.reply.push(token('Partial '), token('answer about Liza'), {
      type: 'error',
      message: 'Sabotage drill: the stream was cut after 2 tokens. The partial reply is kept.',
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('The reply stopped part-way. The partial answer above is kept.')
    expect(within(alert).getByText('ERR_MID_STREAM')).toBeDefined()
    expect(within(log()).getByText('Partial answer about Liza')).toBeDefined()
    expect(within(log()).getByText('[Reply failed]')).toBeDefined()

    const second = scriptedReply()
    route.next(second.respond)
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await settle()
    expect(route.posts()).toBe(2)
    // Only the failed turn goes out again: no partial reply in the history.
    expect(second.reply.body().messages).toEqual([{ role: 'user', content: PROMPT }])

    await second.reply.push(token('Recovered.'), DONE)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getAllByRole('group', { name: 'Copilot reply' })).toHaveLength(1)
    expect(reply().textContent).toBe('Recovered.')
  })

  it('Test 3b · HTTP 429: the rate-limit alert appears, and Retry sends the turn again', async () => {
    route.next(() =>
      Response.json({ error: 'Too many requests from this network. Try again now.' }, { status: 429, headers: { 'Retry-After': '0' } }),
    )
    renderChat()
    await ask(PROMPT)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Rate limit reached (HTTP 429).')
    expect(within(alert).getByText('HTTP_429')).toBeDefined()

    const retry = scriptedReply()
    route.next(retry.respond)
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await settle()
    await retry.reply.push(token('Answered on the second try.'), DONE)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(reply().textContent).toBe('Answered on the second try.')
  })

  it('Test 4 · Stop: aborts the request, keeps the partial text, and frees the input for the next turn', async () => {
    const { reply: stream, respond } = scriptedReply()
    route.next(respond)
    renderChat()
    await ask(PROMPT)
    await stream.push(token('Half of '), token('an answer'))

    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    await settle()

    expect(stream.signal()?.aborted).toBe(true)
    // Stop also tells the server, by request ID.
    expect(route.deletes()).toEqual([`/api/chat?requestId=${String(stream.body().requestId)}`])
    expect(reply().textContent).toBe('Half of an answer')
    expect(within(log()).getByText('[Stopped mid-stream]')).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe('Stopped. The partial reply is kept.')
    expect(field().disabled).toBe(false)
    expect(document.activeElement).toBe(field())

    // The next turn goes straight through.
    const next = scriptedReply()
    route.next(next.respond)
    await ask('And for Nena?')
    await next.reply.push(token('Nena next.'), DONE)
    expect(reply().textContent).toBe('Nena next.')
  })
})

// ── High-risk UI 2: the validated money form ────────────────────────────────

function keyFactory(): () => string {
  let n = 0
  return () => {
    n += 1
    return `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
  }
}

function renderForm(server: DisbursementServer = createDisbursementServer(SEED_LOANS)) {
  render(<DisbursementForm server={server} createKey={keyFactory()} />)
  return server
}

function fillPayout(amount: string): void {
  fireEvent.change(screen.getByLabelText('Approved loan'), { target: { value: 'L-1042' } })
  fireEvent.change(screen.getByLabelText('Wallet provider'), { target: { value: 'gcash' } })
  fireEvent.change(screen.getByLabelText('Recipient mobile number'), { target: { value: '09171234567' } })
  fireEvent.change(screen.getByLabelText('Principal amount (PHP)'), { target: { value: amount } })
}

/** The error text an input points at through aria-describedby. */
function errorFor(input: HTMLElement): string {
  const id = (input.getAttribute('aria-describedby') ?? '').split(' ').find((candidate) => candidate.endsWith('-error'))
  return id === undefined ? '' : (document.getElementById(id)?.textContent ?? '')
}

describe('FE-09 · DisbursementForm (validated money form)', () => {
  it.each([
    ['₱0', '0', 'Enter an amount from ₱500.00 to ₱50,000.00.'],
    ['a negative amount', '-500', 'Use digits'],
    ['more than the ₱50,000.00 limit', '60,000.00', 'Enter an amount from ₱500.00 to ₱50,000.00.'],
  ])('Test 5a · rejects %s with an accessible error, and posts nothing', (_label, amount, message) => {
    const server = renderForm()
    fillPayout(amount)
    fireEvent.click(screen.getByRole('button', { name: /^Disburs/ }))

    const input = screen.getByLabelText('Principal amount (PHP)')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(errorFor(input)).toContain(message)
    expect(screen.getByRole('alert')).toBeDefined()
    expect(document.activeElement).toBe(input)
    expect(server.getLedger()).toHaveLength(0)
  })

  it('Test 5b · ₱5,000 disburses L-1042 (APPROVED → DISBURSED) and posts 500000 debits = 500000 credits', async () => {
    const server = renderForm()
    fillPayout('5000')
    const input = screen.getByLabelText('Principal amount (PHP)')
    expect(input.getAttribute('aria-invalid')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /^Disburs/ }))

    const loansTable = screen.getByRole('region', { name: 'Loans' })
    await waitFor(() => {
      expect(within(loansTable).getByRole('row', { name: /L-1042/ }).textContent).toContain('DISBURSED')
    })
    const totals = within(screen.getByRole('row', { name: /^Σ \(balanced\)/ })).getAllByRole('cell')
    expect(totals.map((cell) => cell.textContent)).toEqual(['₱5,000.00', '₱5,000.00'])
    // The same fact in integer centavos, straight from the ledger.
    expect(journalTotals(server.getLedger().flatMap((entry) => entry.lines))).toEqual({ debits: 500_000, credits: 500_000, balanced: true })
  })

  it('Test 6 · "Simulate double-click / network retry" sends the same Idempotency-Key twice and pays once (₱0.00 extra)', async () => {
    const server = renderForm()
    fillPayout('5000')
    fireEvent.click(screen.getByRole('button', { name: /simulate double-click/i }))

    const entries = (): HTMLElement[] => within(screen.getByRole('region', { name: 'Request log' })).queryAllByRole('listitem')
    await waitFor(() => {
      expect(entries()).toHaveLength(2)
    })
    const [first, second] = entries()
    expect(first?.textContent).toContain('201 Created · posted JE-0001')
    expect(second?.textContent).toContain('201 Idempotent replay of JE-0001 · no new ledger entry')
    // One ledger entry, one payout: the borrower's receivable is ₱5,000.00, not ₱10,000.00.
    expect(server.getLedger()).toHaveLength(1)
    expect(accountBalance(server.getLedger(), 'loans_receivable:borrower-42')).toBe(500_000)
  })
})

// ── High-risk UI 3: the tool-result card ────────────────────────────────────

const KEY = '7f3c2a10-1b2c-4d3e-8f40-123456789abc'

function toolPart(toolName: string, state: ToolState, extra: Partial<ToolPart> = {}): ToolPart {
  return {
    type: 'tool',
    toolCallId: `call_${state}`,
    toolName,
    state,
    rationale: 'The request asks how creditworthy a borrower is.',
    inputText: '',
    input: null,
    output: null,
    errorCode: null,
    errorText: null,
    timeline: [{ state, at: 1_000 }],
    decision: null,
    ...extra,
  }
}

function renderCard(part: ToolPart) {
  const onDecision = vi.fn<(decision: ToolDecision) => void>()
  const onRetry = vi.fn()
  render(<ToolInvocationCard part={part} live={part.state === 'input-available'} onDecision={onDecision} onRetry={onRetry} retryDisabled={false} />)
  return { onDecision, onRetry, card: screen.getByRole('region', { name: `Tool call ${part.toolName}: ${part.state}` }) }
}

describe('FE-09 · ToolInvocationCard (tool-result component)', () => {
  it('Test 7 · each of the 4 states renders its own accessible output: never raw JSON', async () => {
    const streaming = renderCard(
      toolPart('evaluateBorrowerTrustScore', 'input-streaming', { inputText: '{"borrowerName":"Liza\'s Bigasan & Load","businessType":"mar' }),
    )
    expect(within(streaming.card).getByText('Choosing tool')).toBeDefined()
    expect(within(within(streaming.card).getByRole('list', { name: 'Arguments so far' })).getAllByRole('listitem')[0]?.textContent).toContain(
      '(received)',
    )
    cleanup()

    const available = renderCard(toolPart('evaluateBorrowerTrustScore', 'input-available', { input: TRUST_INPUT }))
    expect(within(available.card).getByText('Inputs locked')).toBeDefined()
    expect(within(available.card).getByText('92%')).toBeDefined()
    cleanup()

    const score = renderCard(toolPart('evaluateBorrowerTrustScore', 'output-available', { output: evaluateBorrowerTrustScore(TRUST_INPUT) }))
    expect(within(score.card).getByRole('img', { name: 'Trust score breakdown, 3 pillars' })).toBeDefined()
    expect(score.card.textContent).not.toMatch(/[{}]"/)
    cleanup()

    const ledger = await verifyLedgerAndIdempotency({ loanId: 'L-1042', disbursementCentavos: 500_000, walletProvider: 'GCash', idempotencyKey: KEY, expectedVersion: 3 })
    const table = renderCard(toolPart('verifyLedgerAndIdempotency', 'output-available', { output: ledger }))
    const findings = within(table.card).getByRole('table', { name: /^Journal entry posted by the dry run/ })
    expect(within(findings).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Account',
      'Debit (centavos)',
      'Credit (centavos)',
    ])
    expect(within(findings).getByRole('row', { name: /^Σ debits === Σ credits/ }).textContent).toContain('500000')
    cleanup()

    const failed = renderCard(
      toolPart('evaluateBorrowerTrustScore', 'output-error', {
        input: { ...TRUST_INPUT, requestedCentavos: -500_000 },
        errorCode: 'ERR_TOOL_SCHEMA_BOUNDS',
        errorText: 'requestedCentavos: Too small: expected number to be >=50000',
      }),
    )
    expect(within(failed.card).getByText('ERR_TOOL_SCHEMA_BOUNDS')).toBeDefined()
    fireEvent.click(within(failed.card).getByRole('button', { name: 'Retry Tool Call with Sanitized Inputs' }))
    expect(failed.onRetry).toHaveBeenCalledWith('evaluateBorrowerTrustScore', TRUST_INPUT, 'requestedCentavos: -500000 → (removed)')
  })

  it('Test 8 · the disbursement proposal resolves only when the officer presses Approve', async () => {
    resetCopilotServer(0)
    const proposal = proposeDisbursementExecution({ loanId: 'L-1042', disbursementCentavos: 500_000, walletProvider: 'GCash', expectedVersion: 3 })
    const { onDecision, card } = renderCard(toolPart('proposeDisbursementExecution', 'output-available', { output: proposal }))
    const entries = (): number => copilotServer().getLedger().filter((entry) => entry.loanId === 'L-1042').length

    // Proposed, not executed: nothing resolves and nothing is posted on its own.
    await settle()
    expect(onDecision).not.toHaveBeenCalled()
    expect(entries()).toBe(0)
    expect(within(card).queryByRole('status')).toBeNull()

    fireEvent.click(within(card).getByRole('button', { name: /confirm|approve/i }))
    await waitFor(() => {
      expect(onDecision).toHaveBeenCalledTimes(1)
    })
    expect(onDecision.mock.calls[0]?.[0]).toMatchObject({ kind: 'executed', status: 201, outcome: 'CREATED', loanStatus: 'DISBURSED' })
    expect(entries()).toBe(1)
  })
})
