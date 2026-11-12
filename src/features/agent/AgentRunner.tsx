'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import type { AgentEvent } from '../../lib/sentinel-scout/engine.ts'
import { isAgentEvent, MAX_REQUEST_CHARS } from '../../lib/sentinel-scout/protocol.ts'
import { StreamingMarkdown } from '../ai-copilot/StreamingMarkdown.tsx'

/**
 * Runs SentinelScout from the browser and shows every step as it happens:
 * each turn, the raw tool input and output, each guardrail check, and the
 * final brief. The page never fakes a step: everything shown came from
 * /api/agent's event stream.
 */

export const DEFAULT_AGENT_REQUEST =
  'Triage GHSA-2464-fhr4-w9xw against our local microcredit-api repo, audit our TypeScript centavo and idempotency invariants, and write a sanitized triage brief.'

export interface AgentRunnerProps {
  /** The model the server would use, or null when no key is set. Label only. */
  readonly modelLabel: string | null
}

type RunState = 'idle' | 'running' | 'done' | 'halted' | 'error'

const FIELD = 'mt-1 w-full rounded-md border bg-white px-3 py-2 text-base text-ink sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

function ResultSummary({ event }: { readonly event: Extract<AgentEvent, { type: 'tool_result' }> }) {
  const result: unknown = event.result
  const failed = typeof result === 'object' && result !== null && 'ok' in result && result.ok === false
  const code = failed && 'error' in result && typeof result.error === 'string' ? result.error : null
  return (
    <p className="mt-2 text-sm">
      <span className={`font-mono font-semibold ${failed ? 'text-rose-800' : 'text-emerald-800'}`}>{failed ? `✗ ${code ?? 'error'}` : '✓ ok'}</span>{' '}
      <span className="text-slate-600">· {event.ms} ms</span>
    </p>
  )
}

function Raw({ label, value }: { readonly label: string; readonly value: unknown }) {
  return (
    <details className="mt-2 rounded border border-slate-200 bg-canvas">
      <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent">{label}</summary>
      <pre className="max-h-72 overflow-auto border-t border-slate-200 p-3 font-mono text-xs leading-relaxed text-ink" tabIndex={0}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}

export function AgentRunner({ modelLabel }: AgentRunnerProps) {
  const id = useId()
  const requestId = `${id}-request`
  const plannerId = `${id}-planner`
  const [request, setRequest] = useState(DEFAULT_AGENT_REQUEST)
  const [planner, setPlanner] = useState<'rules' | 'model'>('rules')
  const [requestError, setRequestError] = useState<string | null>(null)
  const [events, setEvents] = useState<readonly AgentEvent[]>([])
  const [state, setState] = useState<RunState>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  const requestRef = useRef<HTMLTextAreaElement>(null)

  const running = state === 'running'
  const final = events.find((e): e is Extract<AgentEvent, { type: 'final' }> => e.type === 'final')
  const turns = events.filter((e) => e.type === 'turn').length
  const lastTool = [...events].reverse().find((e): e is Extract<AgentEvent, { type: 'tool_call' }> => e.type === 'tool_call')

  async function run(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (running) return
    const trimmed = request.trim()
    const problem = trimmed === '' ? 'Enter a request.' : trimmed.length > MAX_REQUEST_CHARS ? `Keep the request under ${MAX_REQUEST_CHARS} characters.` : null
    setRequestError(problem)
    if (problem !== null) {
      requestRef.current?.focus()
      return
    }
    setEvents([])
    setFailure(null)
    setState('running')
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: trimmed, planner }),
      })
      if (!response.ok || response.body === null) {
        const data: unknown = await response.json().catch(() => null)
        const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`
        throw new Error(message)
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let sawFinal = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim() === '') continue
          const parsed: unknown = JSON.parse(line)
          if (!isAgentEvent(parsed)) continue
          if (parsed.type === 'final') sawFinal = true
          setEvents((previous) => [...previous, parsed])
        }
      }
      setState(sawFinal ? 'done' : 'halted')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The run failed.')
      setState('error')
    }
  }

  const status =
    state === 'running'
      ? lastTool === undefined
        ? 'Starting the agent…'
        : `Turn ${turns} of 4: ${lastTool.tool}`
      : state === 'done'
        ? `Done: ${final?.verdict ?? ''}, brief written.`
        : state === 'halted'
          ? 'The agent halted without a brief. See the last step.'
          : ''

  return (
    <div>
      <form onSubmit={(e) => void run(e)} noValidate className="rounded-lg border border-main bg-white p-4">
        <label htmlFor={requestId} className="block text-sm font-semibold text-ink">
          Request
        </label>
        <textarea
          ref={requestRef}
          id={requestId}
          rows={3}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          aria-invalid={requestError === null ? 'false' : 'true'}
          aria-describedby={requestError === null ? `${requestId}-hint` : `${requestId}-hint ${requestId}-error`}
          className={`${FIELD} ${requestError === null ? 'border-slate-500' : 'border-rose-600'}`}
        />
        <p id={`${requestId}-hint`} className="mt-1 text-xs text-slate-600">
          Name a GHSA ID, or say &quot;pre-release check&quot;. Notes after &quot;notes:&quot; are redacted before any tool sees them.
        </p>
        {requestError !== null && (
          <p id={`${requestId}-error`} role="alert" className="mt-1 text-xs font-semibold text-rose-800">
            {requestError}
          </p>
        )}

        <label htmlFor={plannerId} className="mt-4 block text-sm font-semibold text-ink">
          Planner
        </label>
        <select
          id={plannerId}
          value={planner}
          onChange={(e) => setPlanner(e.target.value === 'model' ? 'model' : 'rules')}
          aria-invalid="false"
          aria-describedby={`${plannerId}-hint`}
          className={`${FIELD} border-slate-500 sm:w-auto`}
        >
          <option value="rules">FL-06 rules (no model)</option>
          <option value="model" disabled={modelLabel === null}>
            {modelLabel === null ? 'Model planner (no key set on this server)' : `Model planner: ${modelLabel}`}
          </option>
        </select>
        <p id={`${plannerId}-hint`} className="mt-1 text-xs text-slate-600">
          Rules: the FL-06 loop as code, the same every run. Model: a language model reads the FL-06 prompt and picks the tools. Both go through the same 4-call limit and gates.
        </p>

        <button
          type="submit"
          disabled={running}
          aria-busy={running}
          className="mt-4 min-h-11 rounded-md border border-main bg-main px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {running ? 'Running…' : 'Run End-to-End Agent Loop'}
        </button>
      </form>

      <p role="status" className="mt-3 min-h-5 text-sm font-semibold text-ink">
        {status}
      </p>
      {failure !== null && (
        <p role="alert" className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {failure}
        </p>
      )}

      {events.length > 0 && (
        <ol aria-label="Agent steps" className="mt-4 space-y-3">
          {events.map((event, index) => {
            switch (event.type) {
              case 'start':
                return (
                  <li key={index} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                    <span className="font-mono text-xs text-slate-600">[START]</span> triage <code className="font-mono">{event.triage_id}</code> · planner: {event.planner}
                  </li>
                )
              case 'turn':
                return (
                  <li key={index} className="pt-2 text-sm font-semibold text-ink">
                    <span className="font-mono">[TURN {event.turn}/{event.max}]</span> {event.reason}
                  </li>
                )
              case 'tool_call':
                return (
                  <li key={index} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                    <span className="font-mono text-xs text-slate-600">[TOOL CALL]</span> <code className="font-mono font-semibold">{event.tool}</code>
                    <Raw label="Raw input (JSON)" value={event.args} />
                  </li>
                )
              case 'tool_result':
                return (
                  <li key={index} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                    <span className="font-mono text-xs text-slate-600">[TOOL RESULT]</span> <code className="font-mono">{event.tool}</code>
                    <ResultSummary event={event} />
                    <Raw label="Raw output (JSON)" value={event.result} />
                  </li>
                )
              case 'guardrail':
                return (
                  <li key={index} className={`rounded-md border px-3 py-2 text-sm ${event.passed ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
                    <span className="font-mono text-xs text-slate-700">[GUARDRAIL CHECK]</span>{' '}
                    <span className="font-semibold">{event.passed ? '✓ passed' : '✗ blocked'}</span> · {event.check}: {event.detail}
                  </li>
                )
              case 'final':
                return (
                  <li key={index} className="rounded-md border border-main bg-white p-3 text-sm">
                    <span className="font-mono text-xs text-slate-600">[FINAL ARTIFACT WRITTEN]</span> verdict <strong>{event.verdict}</strong> ·{' '}
                    <code className="font-mono break-all">{event.latest_path}</code>
                    <p className="mt-1 font-mono text-xs break-all text-slate-600">sha256 {event.sha256}</p>
                  </li>
                )
              case 'halt':
                return (
                  <li key={index} className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    <span className="font-mono text-xs">[HALTED]</span> {event.reason}
                  </li>
                )
            }
          })}
        </ol>
      )}

      {final !== undefined && (
        <section aria-labelledby={`${id}-brief`} className="mt-6 rounded-lg border border-main bg-white p-4 text-sm text-ink">
          <h2 id={`${id}-brief`} className="text-lg font-semibold">
            The sanitized triage brief
          </h2>
          <div className="mt-3">
            <StreamingMarkdown text={final.markdown} streaming={false} />
          </div>
        </section>
      )}
    </div>
  )
}
