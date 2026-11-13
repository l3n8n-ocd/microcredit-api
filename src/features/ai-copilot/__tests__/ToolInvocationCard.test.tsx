/**
 * FE-07: tool contracts and the 4-state generative UI.
 *
 * 1. The Zod schemas: bounds, the optional field, `.describe()` on every field.
 * 2. Four states, four different DOMs (not one card with a swapped badge).
 * 3. Results drawn as components: the SVG chart, the findings table. No raw JSON.
 * 4. Human-in-the-loop: Approve pays once (double-click included), the replay
 *    test posts nothing new, Cancel sends nothing.
 * 5. output-error: the sanitized retry, and the chat wiring around all of it.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  evaluateBorrowerTrustScore,
  ledgerInputSchema,
  proposalInputSchema,
  proposeDisbursementExecution,
  sanitizeToolInput,
  trustScoreInputSchema,
  trustScoreOutputSchema,
  verifyLedgerAndIdempotency,
  type ToolOutput,
} from '../../../lib/ai/tools.ts'
import type { ChatStreamEvent, DirectToolCall, SabotageMode } from '../chatProtocol.ts'
import type { ChatTransport } from '../chatTransport.ts'
import type { StarterPrompt, ToolDecision, ToolPart, ToolState } from '../chatTypes.ts'
import { copilotServer, resetCopilotServer } from '../copilotLedger.ts'
import { loadConversation, saveConversation } from '../conversationStore.ts'
import { StreamingUnderwritingChat } from '../StreamingUnderwritingChat.tsx'
import { partialArguments } from '../toolArgs.ts'
import { ToolInvocationCard } from '../ToolInvocationCard.tsx'

const TRUST_INPUT = {
  borrowerName: "Nena's Sari-Sari Store",
  businessType: 'sari-sari',
  monthlyUtilityOnTimeRatio: 92,
  supplierInvoiceCount: 18,
  gcashLoadWeeklyCadence: 5,
} as const

const KEY = '7f3c2a10-1b2c-4d3e-8f40-123456789abc'

function part(overrides: Partial<ToolPart> & { readonly toolName: string; readonly state: ToolState }): ToolPart {
  const states: ToolState[] = ['input-streaming']
  if (overrides.state !== 'input-streaming') states.push('input-available')
  if (overrides.state === 'output-available' || overrides.state === 'output-error') states.push(overrides.state)
  return {
    type: 'tool',
    toolCallId: 'call_test',
    rationale: 'The request asks how creditworthy a borrower is.',
    inputText: '',
    input: null,
    output: null,
    errorCode: null,
    errorText: null,
    timeline: states.map((state, index) => ({ state, at: 1_000 + index * 500 })),
    decision: null,
    ...overrides,
  }
}

function renderCard(tool: ToolPart, options: { live?: boolean; retryDisabled?: boolean } = {}) {
  const onDecision = vi.fn<(decision: ToolDecision) => void>()
  const onRetry = vi.fn<(toolName: string, input: Record<string, unknown>, changes: string) => void>()
  const view = render(
    <ToolInvocationCard
      part={tool}
      live={options.live ?? false}
      onDecision={onDecision}
      onRetry={onRetry}
      retryDisabled={options.retryDisabled ?? false}
    />,
  )
  return { onDecision, onRetry, view, card: screen.getByRole('region', { name: /^Tool call / }) }
}

beforeEach(() => {
  resetCopilotServer(0)
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('FE-07 tool schemas (src/lib/ai/tools.ts)', () => {
  it('describes every field, so the model knows what each one means', () => {
    for (const schema of [trustScoreInputSchema, ledgerInputSchema, proposalInputSchema]) {
      for (const [field, fieldSchema] of Object.entries(schema.shape)) {
        expect(fieldSchema.description, field).toBeTruthy()
      }
    }
  })

  it('accepts a call with requestedCentavos omitted, and the result falls back to "no request"', () => {
    const input = trustScoreInputSchema.parse(TRUST_INPUT)
    expect(input).not.toHaveProperty('requestedCentavos')
    const output = trustScoreOutputSchema.parse(evaluateBorrowerTrustScore(input))
    expect(output.requested).toBeNull()
    expect(output.score).toBe(798)
    expect(output.pillars.map((pillar) => pillar.points)).toEqual([322, 262, 214])
    expect(output.recommendedLimitCentavos).toBe(2_500_000)
  })

  it.each([
    ['negative centavos', { ...TRUST_INPUT, requestedCentavos: -500_000 }],
    ['fractional centavos', { ...TRUST_INPUT, requestedCentavos: 150_000.5 }],
    ['centavos over ₱50,000.00', { ...TRUST_INPUT, requestedCentavos: 5_000_100 }],
    ['a ratio over 100', { ...TRUST_INPUT, monthlyUtilityOnTimeRatio: 101 }],
    ['an unknown business type', { ...TRUST_INPUT, businessType: 'bank' }],
  ])('rejects %s', (_label, input) => {
    expect(trustScoreInputSchema.safeParse(input).success).toBe(false)
  })

  it('ledger tool: a same-key retry replays the original and posts one entry; a stale If-Match posts nothing', async () => {
    const fresh = await verifyLedgerAndIdempotency({ loanId: 'L-1042', disbursementCentavos: 500_000, walletProvider: 'GCash', idempotencyKey: KEY, expectedVersion: 3 })
    expect(fresh).toMatchObject({ firstAttempt: { kind: 'CREATED' }, retrySameKey: { kind: 'REPLAYED' }, ledgerEntriesPosted: 1, balanced: true })
    const stale = await verifyLedgerAndIdempotency({ loanId: 'L-1042', disbursementCentavos: 500_000, walletProvider: 'GCash', idempotencyKey: KEY, expectedVersion: 2 })
    expect(stale).toMatchObject({ idempotencyStatus: 'STALE_IF_MATCH_409', ledgerEntriesPosted: 0, linesSource: 'PREVIEW' })
  })

  it('sanitizer: drops a bad optional field and clamps a bad number, never inventing values', () => {
    const dropped = sanitizeToolInput('evaluateBorrowerTrustScore', { ...TRUST_INPUT, requestedCentavos: -500_000 }, 'ERR_TOOL_SCHEMA_BOUNDS')
    expect(dropped).toMatchObject({ fixable: true, changes: [{ field: 'requestedCentavos', from: -500_000, to: '(removed)' }] })
    expect(dropped.input).toEqual(TRUST_INPUT)
    const clamped = sanitizeToolInput('evaluateBorrowerTrustScore', { ...TRUST_INPUT, monthlyUtilityOnTimeRatio: 140 }, 'ERR_TOOL_SCHEMA_BOUNDS')
    expect(clamped.changes).toEqual([{ field: 'monthlyUtilityOnTimeRatio', from: 140, to: 100 }])
  })

  it('reads arguments while their JSON is still arriving', () => {
    expect(partialArguments('{"borrowerName":"Nena","monthlyUtilityOnTimeRatio":9')).toEqual({
      done: new Map([['borrowerName', 'Nena']]),
      writing: { key: 'monthlyUtilityOnTimeRatio', raw: '9' },
    })
  })
})

describe('FE-07 ToolInvocationCard: four states, four different DOMs', () => {
  const trustOutput = evaluateBorrowerTrustScore({ ...TRUST_INPUT, requestedCentavos: 1_500_000 })

  const views: Record<ToolState, ToolPart> = {
    'input-streaming': part({ toolName: 'evaluateBorrowerTrustScore', state: 'input-streaming', inputText: '{"borrowerName":"Nena\'s Sari-Sari Store","businessType":"sari-sari","monthlyUtilityOnTimeRatio":9' }),
    'input-available': part({ toolName: 'evaluateBorrowerTrustScore', state: 'input-available', input: TRUST_INPUT }),
    'output-available': part({ toolName: 'evaluateBorrowerTrustScore', state: 'output-available', input: TRUST_INPUT, output: trustOutput }),
    'output-error': part({
      toolName: 'evaluateBorrowerTrustScore',
      state: 'output-error',
      input: { ...TRUST_INPUT, requestedCentavos: -500_000 },
      errorCode: 'ERR_TOOL_SCHEMA_BOUNDS',
      errorText: 'requestedCentavos: Too small: expected number to be >=50000',
    }),
  }

  it('each state answers its own question with its own elements and frame', () => {
    const frames = new Set<string>()
    for (const [state, tool] of Object.entries(views) as [ToolState, ToolPart][]) {
      const { card } = renderCard(tool, { live: state === 'input-available' })
      // The region's accessible name carries the state.
      expect(screen.getByRole('region', { name: `Tool call evaluateBorrowerTrustScore: ${state}` })).toBe(card)
      const ui = within(card)
      switch (state) {
        case 'input-streaming': {
          expect(ui.getByText('Choosing tool')).toBeDefined()
          const pills = ui.getAllByRole('listitem').map((pill) => pill.textContent ?? '')
          expect(pills.some((text) => text.includes('(received)'))).toBe(true)
          expect(pills.some((text) => text.includes('(arriving)'))).toBe(true)
          expect(pills.some((text) => text.includes('(waiting)'))).toBe(true)
          expect(ui.queryByRole('img')).toBeNull()
          break
        }
        case 'input-available':
          expect(ui.getByText('Inputs locked')).toBeDefined()
          expect(ui.getByText('running on the server')).toBeDefined()
          expect(ui.queryByText('Choosing tool')).toBeNull()
          break
        case 'output-available':
          expect(ui.getByRole('img', { name: 'Trust score breakdown, 3 pillars' })).toBeDefined()
          expect(ui.queryByText('Inputs locked')).toBeNull()
          break
        case 'output-error':
          expect(ui.getByText('ERR_TOOL_SCHEMA_BOUNDS')).toBeDefined()
          expect(ui.getByRole('button', { name: 'Retry Tool Call with Sanitized Inputs' })).toBeDefined()
          break
      }
      // Compared to each other, not to a class name: renaming a Tailwind class cannot break this.
      frames.add(card.className)
      cleanup()
    }
    // Four different frames, not one card with a swapped badge.
    expect(frames.size).toBe(4)
  })

  it('input-available shows the inputs in plain words, and the optional field as a fallback', () => {
    renderCard(views['input-available'])
    const omitted = screen.getByText('Requested').nextElementSibling
    expect(omitted?.textContent).toContain('not stated: recommended limit only')
    expect(omitted?.textContent).toContain('fallback')
    expect(screen.getByText('Utility on time').nextElementSibling?.textContent).toBe('92%')
  })

  it('output-available draws an SVG chart with three bars, never raw JSON', () => {
    const { card } = renderCard(views['output-available'])
    const chart = within(card).getByRole('img', { name: /Trust score breakdown/ })
    expect(chart.tagName.toLowerCase()).toBe('svg')
    // The bar values are the chart's accessible description, so a screen reader gets the same numbers.
    expect(
      within(card).getByRole('img', {
        name: 'Trust score breakdown, 3 pillars',
        description: 'Utility consistency 322 of 350 points; Supplier history 262 of 350 points; GCash cadence 214 of 300 points',
      }),
    ).toBe(chart)
    expect(within(card).getByText('LOW_RISK')).toBeDefined()
    expect(within(card).getByText(/^798/)).toBeDefined()
    expect(card.textContent).toContain('₱25,000.00')
    expect(card.textContent).toContain('WITHIN_LIMIT')
    expect(card.textContent).not.toMatch(/[{}]"/)
  })

  it('shows the fallback badge when requestedCentavos was omitted', () => {
    renderCard(part({ toolName: 'evaluateBorrowerTrustScore', state: 'output-available', input: TRUST_INPUT, output: evaluateBorrowerTrustScore(TRUST_INPUT) }))
    expect(screen.getByText('Fallback: no amount requested, showing the recommended limit only')).toBeDefined()
  })

  it('ledger output draws the double-entry findings table and the replay result', async () => {
    const output = await verifyLedgerAndIdempotency({ loanId: 'L-1042', disbursementCentavos: 500_000, walletProvider: 'GCash', idempotencyKey: KEY, expectedVersion: 3 })
    const { card } = renderCard(part({ toolName: 'verifyLedgerAndIdempotency', state: 'output-available', output }))
    const table = within(card).getByRole('table', { name: /^Journal entry posted by the dry run/ })
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Account', 'Debit (centavos)', 'Credit (centavos)'])
    expect(within(table).getByText('loans_receivable:borrower-42')).toBeDefined()
    expect(within(card).getByText('✓ Balanced: ₱5,000.00 on each side.')).toBeDefined()
    const retries = within(card).getByRole('table', { name: /^Same request sent twice/ })
    expect(within(retries).getByRole('row', { name: /^Retry, same key/ }).textContent).toContain('201 REPLAYED')
    expect(within(card).getByText('NEW_INTENT_POSTED_ONCE')).toBeDefined()
  })

  it('a result that does not match its output schema is not drawn', () => {
    renderCard(part({ toolName: 'evaluateBorrowerTrustScore', state: 'output-available', output: { score: 'high' } }))
    expect(screen.getByRole('alert').textContent).toContain('ERR_TOOL_OUTPUT_SHAPE')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('the inspector pins any reached state, and an unreached one is disabled', () => {
    const { card } = renderCard(views['output-available'])
    const inspector = within(card).getByRole('group', { name: 'Tool Lifecycle State Inspector' })
    expect(within(inspector).getByRole('button', { name: /output-error/ })).toHaveProperty('disabled', true)
    fireEvent.click(within(inspector).getByRole('button', { name: /input-streaming/ }))
    // Pinned: the past view shows, while the call itself is still output-available.
    expect(within(card).getByText('Choosing tool')).toBeDefined()
    expect(within(card).queryByRole('img')).toBeNull()
    expect(card.getAttribute('aria-label')).toBe('Tool call evaluateBorrowerTrustScore: output-available')
    expect(within(inspector).getByRole('button', { name: /input-streaming/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(inspector).getByRole('button', { name: 'live' }))
    expect(within(card).getByRole('img', { name: 'Trust score breakdown, 3 pillars' })).toBeDefined()
  })
})

describe('FE-07 human in the loop: proposeDisbursementExecution', () => {
  const proposal = (): ToolOutput => proposeDisbursementExecution({ loanId: 'L-1042', disbursementCentavos: 500_000, walletProvider: 'GCash', expectedVersion: 3 })
  const entries = (): number => copilotServer().getLedger().filter((entry) => entry.loanId === 'L-1042').length

  it('Approve & Execute Payout pays once, even when double-clicked', async () => {
    const { onDecision } = renderCard(part({ toolName: 'proposeDisbursementExecution', state: 'output-available', output: proposal() }))
    const approve = screen.getByRole('button', { name: 'Approve & Execute Payout' })
    await act(async () => {
      fireEvent.click(approve)
      fireEvent.click(approve)
    })
    // The server answers after a timer, even at 0 ms latency: wait for it, then a little longer, so a late second call would show.
    await waitFor(() => expect(onDecision).toHaveBeenCalled())
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)))
    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision.mock.calls[0]?.[0]).toMatchObject({ kind: 'executed', status: 201, outcome: 'CREATED', loanStatus: 'DISBURSED', entriesForLoan: 1 })
    expect(entries()).toBe(1)
  })

  it('the receipt offers a replay test: same request, REPLAYED, still one entry', async () => {
    const output = proposal()
    const first = vi.fn<(decision: ToolDecision) => void>()
    render(<ToolInvocationCard part={part({ toolName: 'proposeDisbursementExecution', state: 'output-available', output })} live={false} onDecision={first} onRetry={() => {}} retryDisabled={false} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve & Execute Payout' }))
    })
    await waitFor(() => expect(first).toHaveBeenCalled())
    const decision = first.mock.calls[0]?.[0]
    if (decision === undefined) throw new Error('no decision')
    cleanup()

    const second = vi.fn<(decision: ToolDecision) => void>()
    render(<ToolInvocationCard part={part({ toolName: 'proposeDisbursementExecution', state: 'output-available', output, decision })} live={false} onDecision={second} onRetry={() => {}} retryDisabled={false} />)
    expect(screen.getByRole('status').textContent).toContain('201 CREATED')
    expect(screen.queryByRole('button', { name: 'Approve & Execute Payout' })).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Re-send the same request (replay test)' }))
    })
    await waitFor(() => expect(second).toHaveBeenCalled())
    expect(second.mock.calls[0]?.[0]).toMatchObject({ replays: 1, lastReplay: '201 REPLAYED', entriesForLoan: 1 })
    expect(entries()).toBe(1)
  })

  it('Cancel Action resolves the call and sends nothing', () => {
    const { onDecision } = renderCard(part({ toolName: 'proposeDisbursementExecution', state: 'output-available', output: proposal() }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Action' }))
    expect(onDecision.mock.calls[0]?.[0]).toMatchObject({ kind: 'cancelled' })
    expect(entries()).toBe(0)
  })
})

describe('FE-07 output-error recovery', () => {
  const failed = part({
    toolName: 'evaluateBorrowerTrustScore',
    state: 'output-error',
    input: { ...TRUST_INPUT, requestedCentavos: -500_000 },
    errorCode: 'ERR_TOOL_SCHEMA_BOUNDS',
    errorText: 'requestedCentavos: Too small: expected number to be >=50000',
  })

  it('keeps the inputs, flags the bad one, and retries with only that field fixed', () => {
    const { onRetry, card } = renderCard(failed)
    expect(within(card).getByText('ERR_TOOL_SCHEMA_BOUNDS')).toBeDefined()
    expect(card.textContent).toContain('-500000 centavos')
    expect(card.textContent).toContain('out of bounds')
    expect(card.textContent).toContain('requestedCentavos: -500000 → (removed)')
    fireEvent.click(within(card).getByRole('button', { name: 'Retry Tool Call with Sanitized Inputs' }))
    expect(onRetry).toHaveBeenCalledWith('evaluateBorrowerTrustScore', TRUST_INPUT, 'requestedCentavos: -500000 → (removed)')
  })

  it('Retry waits while another reply is streaming', () => {
    renderCard(failed, { retryDisabled: true })
    expect(screen.getByRole('button', { name: 'Retry Tool Call with Sanitized Inputs' })).toHaveProperty('disabled', true)
  })
})

describe('FE-07 in the chat', () => {
  interface Call {
    readonly emit: (event: ChatStreamEvent) => void
    readonly close: () => void
    readonly sabotage: SabotageMode | undefined
    readonly toolCall: DirectToolCall | undefined
  }
  const TOOL_PROMPTS: readonly StarterPrompt[] = [
    { id: 'tool-score', label: 'Run Trust Score Tool (Chart)', prompt: 'Run the trust score tool for Nena.' },
    { id: 'tool-error', label: 'Simulate Tool Error State', prompt: 'Simulate tool error.', drill: 'tool-error' },
  ]

  function renderChat() {
    const calls: Call[] = []
    const transport: ChatTransport = ({ signal, onEvent, sabotage, toolCall }) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        calls.push({ emit: onEvent, close: resolve, sabotage, toolCall })
      })
    render(<StreamingUnderwritingChat starterPrompts={[]} toolPrompts={TOOL_PROMPTS} engine={{ kind: 'local', label: 'test' }} transport={transport} />)
    return calls
  }
  const emit = (call: Call | undefined, ...events: ChatStreamEvent[]): void => {
    for (const event of events) act(() => call?.emit(event))
  }

  it('one card morphs through the live states as frames arrive, then text follows it', () => {
    const calls = renderChat()
    fireEvent.click(within(screen.getByRole('list', { name: 'Tool demos' })).getByRole('button', { name: 'Run Trust Score Tool (Chart)' }))
    const call = calls[0]
    emit(call, { type: 'tool-input-start', toolCallId: 'c1', toolName: 'evaluateBorrowerTrustScore', rationale: 'Asked for a score.' })
    expect(screen.getByRole('region', { name: 'Tool call evaluateBorrowerTrustScore: input-streaming' })).toBeDefined()
    emit(call, { type: 'tool-input-delta', toolCallId: 'c1', delta: '{"borrowerName":"Nena\'s Sari-Sari Store",' })
    const borrowerPill = within(screen.getByRole('list', { name: 'Arguments so far' }))
      .getAllByRole('listitem')
      .find((pill) => (pill.textContent ?? '').startsWith('Borrower'))
    expect(borrowerPill?.textContent).toContain('(received)')
    emit(call, { type: 'tool-input-available', toolCallId: 'c1', toolName: 'evaluateBorrowerTrustScore', input: TRUST_INPUT })
    expect(screen.getByRole('region', { name: 'Tool call evaluateBorrowerTrustScore: input-available' })).toBeDefined()
    emit(call, { type: 'tool-output-available', toolCallId: 'c1', output: evaluateBorrowerTrustScore(TRUST_INPUT) })
    emit(call, { type: 'token', text: 'Nena scores 798.' }, { type: 'done', finishReason: 'stop' })
    expect(screen.getAllByRole('region', { name: /^Tool call / })).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Tool call evaluateBorrowerTrustScore: output-available' })).toBeDefined()
    const body = screen.getAllByRole('group', { name: 'Copilot reply' }).at(-1)
    expect(body?.textContent?.indexOf('798 / 1000')).toBeLessThan(body?.textContent?.indexOf('Nena scores 798.') ?? -1)
  })

  it('the tool-error chip and the toolbar button send the tool-error drill; the error card retry sends a direct tool call', () => {
    const calls = renderChat()
    fireEvent.click(within(screen.getByRole('list', { name: 'Tool demos' })).getByRole('button', { name: 'Simulate Tool Error State' }))
    expect(calls[0]?.sabotage).toBe('tool-error')
    emit(calls[0], { type: 'tool-input-start', toolCallId: 'e1', toolName: 'evaluateBorrowerTrustScore', rationale: 'Drill.' })
    emit(calls[0], { type: 'tool-input-available', toolCallId: 'e1', toolName: 'evaluateBorrowerTrustScore', input: { ...TRUST_INPUT, requestedCentavos: -500_000 } })
    emit(calls[0], { type: 'tool-output-error', toolCallId: 'e1', errorCode: 'ERR_TOOL_SCHEMA_BOUNDS', errorText: 'requestedCentavos: Too small' }, { type: 'done', finishReason: 'stop' })

    fireEvent.click(screen.getByRole('button', { name: 'Retry Tool Call with Sanitized Inputs' }))
    expect(calls[1]?.toolCall).toEqual({ toolName: 'evaluateBorrowerTrustScore', input: TRUST_INPUT })
    expect(calls[1]?.sabotage).toBeUndefined()
    emit(calls[1], { type: 'done', finishReason: 'stop' })

    fireEvent.click(screen.getByText('Sabotage & Resilience Drill Toolbar'))
    fireEvent.click(screen.getByRole('button', { name: /Trigger Tool Execution Error/ }))
    expect(calls[2]?.sabotage).toBe('tool-error')
  })

  it('tool parts and the officer decision survive a reload; junk in storage is dropped', () => {
    const tool = part({ toolName: 'proposeDisbursementExecution', state: 'output-available', output: { any: 1 }, decision: { kind: 'cancelled', at: '2026-11-13T00:00:00.000Z' } })
    saveConversation([
      { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Pay L-1042' }], createdAt: '2026-11-13T00:00:00.000Z', outcome: 'complete' },
      { id: 'a', role: 'assistant', parts: [tool, { type: 'text', text: 'Done.' }], createdAt: '2026-11-13T00:00:00.000Z', outcome: 'complete' },
    ])
    const raw: unknown = JSON.parse(window.localStorage.getItem('microcredit_ai_copilot_v1') ?? '[]')
    if (!Array.isArray(raw)) throw new Error('not stored')
    const reply = raw[1] as { parts: unknown[] }
    reply.parts.push({ type: 'tool', toolCallId: 'x', toolName: 'y', state: 'exploded' })
    window.localStorage.setItem('microcredit_ai_copilot_v1', JSON.stringify(raw))

    const loaded = loadConversation()
    expect(loaded[1]?.parts.map((p) => p.type)).toEqual(['tool', 'text'])
    expect(loaded[1]?.parts[0]).toMatchObject({ toolCallId: 'call_test', state: 'output-available', decision: { kind: 'cancelled' } })
  })
})
