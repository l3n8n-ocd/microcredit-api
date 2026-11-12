import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRunner, DEFAULT_AGENT_REQUEST } from '../AgentRunner.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const EVENTS = [
  { type: 'start', at: 't', triage_id: 'T-20261112-01', request: 'r', planner: 'FL-06 rules (no model)' },
  { type: 'turn', at: 't', turn: 1, max: 4, reason: 'Fetch GHSA-2464-fhr4-w9xw.' },
  { type: 'tool_call', at: 't', turn: 1, tool: 'fetch_ghsa_advisory', args: { triage_id: 'T-20261112-01', ghsa_id: 'GHSA-2464-fhr4-w9xw' } },
  { type: 'tool_result', at: 't', turn: 1, tool: 'fetch_ghsa_advisory', ms: 12, result: { ok: true, source: 'osv' } },
  { type: 'guardrail', at: 't', check: 'untrusted advisory text', passed: true, detail: 'Wrapped.' },
  { type: 'final', at: 't', verdict: 'NOT_AFFECTED', path: '/tmp/a.md', latest_path: '/tmp/latest-triage-brief.md', sha256: 'abc', markdown: '## 1. Verdict\n\n**NOT_AFFECTED**.\n\n| Package | In range |\n| --- | --- |\n| `next` | no |' },
]

function streamResponse(lines: readonly unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Split mid-line on purpose: the client must buffer partial lines.
      const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
      const half = Math.floor(text.length / 2)
      controller.enqueue(new TextEncoder().encode(text.slice(0, half)))
      controller.enqueue(new TextEncoder().encode(text.slice(half)))
      controller.close()
    },
  })
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })
}

describe('AgentRunner', () => {
  it('binds both fields: label, aria-invalid and a hint', () => {
    render(<AgentRunner modelLabel={null} />)
    const request = screen.getByLabelText('Request')
    expect(request).toHaveProperty('value', DEFAULT_AGENT_REQUEST)
    expect(request.getAttribute('aria-invalid')).toBe('false')
    expect(document.getElementById(request.getAttribute('aria-describedby') ?? '')?.textContent).toContain('GHSA ID')
    const planner = screen.getByLabelText('Planner')
    expect(planner.getAttribute('aria-invalid')).toBe('false')
    expect(document.getElementById(planner.getAttribute('aria-describedby') ?? '')?.textContent).toContain('4-call limit')
  })

  it('offers the model planner only when the server has a model', () => {
    const { unmount } = render(<AgentRunner modelLabel={null} />)
    expect(screen.getByRole<HTMLOptionElement>('option', { name: /no key set/ }).disabled).toBe(true)
    unmount()
    render(<AgentRunner modelLabel="gemini-3.5-flash-lite" />)
    expect(screen.getByRole<HTMLOptionElement>('option', { name: 'Model planner: gemini-3.5-flash-lite' }).disabled).toBe(false)
  })

  it('rejects an empty request with an alert and focuses the field, without calling the server', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const user = userEvent.setup()
    render(<AgentRunner modelLabel={null} />)
    const request = screen.getByLabelText('Request')
    await user.clear(request)
    await user.click(screen.getByRole('button', { name: 'Run End-to-End Agent Loop' }))
    expect(request.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('Enter a request.')
    expect(request.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id)
    expect(document.activeElement).toBe(request)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('streams each step, shows the raw JSON, and renders the final brief', async () => {
    const fetchSpy = vi.fn(async () => streamResponse(EVENTS))
    vi.stubGlobal('fetch', fetchSpy)
    const user = userEvent.setup()
    render(<AgentRunner modelLabel={null} />)
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Run End-to-End Agent Loop' }))
    })

    const sent = JSON.parse(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>
    expect(sent).toEqual({ request: DEFAULT_AGENT_REQUEST, planner: 'rules' })

    const steps = screen.getByRole('list', { name: 'Agent steps' })
    expect(within(steps).getByText('[TURN 1/4]')).toBeDefined()
    expect(within(steps).getByText('fetch_ghsa_advisory', { selector: 'code.font-semibold' })).toBeDefined()
    expect(within(steps).getByText('✓ passed')).toBeDefined()
    expect(within(steps).getByText('Raw input (JSON)').closest('details')?.textContent).toContain('GHSA-2464-fhr4-w9xw')
    expect(screen.getByRole('status').textContent).toBe('Done: NOT_AFFECTED, brief written.')
    const brief = screen.getByRole('region', { name: 'The sanitized triage brief' })
    expect(within(brief).getByRole('table')).toBeDefined()
    expect(within(brief).getByRole('cell', { name: 'next' })).toBeDefined()
  })

  it('reports a halted run and a refused request as such', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse([EVENTS[0], { type: 'halt', at: 't', reason: 'BUDGET_EXCEEDED' }])))
    const user = userEvent.setup()
    const { unmount } = render(<AgentRunner modelLabel={null} />)
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Run End-to-End Agent Loop' }))
    })
    expect(screen.getByRole('status').textContent).toContain('halted without a brief')
    expect(screen.getByText('BUDGET_EXCEEDED')).toBeDefined()
    unmount()

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Too many runs from this network. Try again in 30 seconds.' }, { status: 429 })))
    render(<AgentRunner modelLabel={null} />)
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Run End-to-End Agent Loop' }))
    })
    expect(screen.getByRole('alert').textContent).toContain('Too many runs')
  })
})
