#!/usr/bin/env node
/**
 * SentinelScout CLI (FL-07).
 *
 *   npm run agent:run                       triage the default request below
 *   npm run agent:run -- --request "..."    triage your own request
 *   npm run agent:run -- --planner model    let a model plan (needs ANTHROPIC_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY)
 *   npm run agent:eval                      run the six FL-06 eval cases; exits 1 unless 6/6 pass
 *
 * agent:run is a real MCP host: it starts mcp/microcredit-mcp-server.mjs as a
 * child process and makes every tool call as a JSON-RPC `tools/call` over
 * stdin/stdout. The server owns the tools and the 4-call budget.
 *
 * agent:eval runs the same engine and the same tool code in-process, with a
 * fake network and temporary folders, so it never touches docs/drafts or src/.
 *
 * Needs Node >= 22.18 (it imports the TypeScript in src/lib/sentinel-scout).
 */
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

if (!process.features?.typescript) {
  process.stderr.write(`SentinelScout needs Node >= 22.18 (TypeScript type stripping). This is ${process.version}.\n`)
  process.exit(2)
}

const { newTriageId, runTriage } = await import('../../src/lib/sentinel-scout/engine.ts')
const { runAllEvals, EVAL_CASES } = await import('../../src/lib/sentinel-scout/evals.ts')
const { resolvePlannerModel } = await import('../../src/lib/sentinel-scout/model.ts')

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SERVER = join(ROOT, 'mcp/microcredit-mcp-server.mjs')
const DEFAULT_REQUEST =
  'Triage GHSA-2464-fhr4-w9xw against our local microcredit-api repo, audit our TypeScript centavo and idempotency invariants, and write a sanitized triage brief to disk.'

// ── Telemetry ────────────────────────────────────────────────────────────────
const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code, text) => (color ? `\u001b[${code}m${text}\u001b[0m` : text)
const stamp = () => paint('2', new Date().toISOString().slice(11, 23))
const line = (tag, code, text) => process.stdout.write(`${stamp()} ${paint(code, tag)} ${text}\n`)
const short = (value, max = 160) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function describeResult(tool, result) {
  if (result?.ok === false) return `${paint('31', `✗ ${result.error}`)} ${result.message}`
  switch (tool) {
    case 'fetch_ghsa_advisory':
      return `✓ source=${result.source} advisories=${result.advisories.length} ${result.advisories.map((a) => `${a.ghsa_id} ${a.severity} [${a.affected.map((p) => `${p.package} ${p.vulnerable_range}`).join('; ')}]`).join(' | ')}`
    case 'scan_local_repo_exposure':
      return `✓ exposed=${result.exposed} ${result.results.map((r) => `${r.package}: ${r.installed.map((c) => `${c.version}${c.direct ? ' direct' : ''} in_range=${c.in_range}`).join(', ') || 'not installed'}`).join(' | ')} (lockfile ${result.lockfile_packages} pkgs)`
    case 'audit_centavos_and_idempotency':
      return `✓ verdict=${result.verdict} files=${result.files_scanned} float_money_lines=${result.violations.length} Idempotency-Key=${result.idempotency_key_header_required} If-Match=${result.if_match_header_required} checks=${result.checks.ran ? `typecheck ${result.checks.typecheck}, tests ${result.checks.tests} (${result.checks.tests_summary})` : `not run: ${result.checks.reason}`}`
    case 'write_sanitized_triage_brief':
      return `✓ ${result.path} (${result.bytes} bytes)`
    default:
      return short(result)
  }
}

function print(event) {
  switch (event.type) {
    case 'start':
      line('[START]', '1', `triage ${event.triage_id} · planner: ${event.planner}`)
      line('[REQUEST]', '1', event.request)
      break
    case 'turn':
      process.stdout.write('\n')
      line(`[TURN ${event.turn}/${event.max}]`, '1;36', event.reason)
      break
    case 'tool_call':
      line('[MCP TOOL CALL]', '35', `${event.tool} ${short(event.args, 220)}`)
      break
    case 'tool_result':
      line('[TOOL RESULT]', '34', `${event.tool} · ${event.ms} ms · ${describeResult(event.tool, event.result)}`)
      break
    case 'guardrail':
      line('[GUARDRAIL CHECK]', event.passed ? '32' : '31', `${event.passed ? '✓' : '✗'} ${event.check}: ${event.detail}`)
      break
    case 'final':
      process.stdout.write('\n')
      line('[FINAL ARTIFACT WRITTEN]', '1;32', `${event.latest_path} · verdict ${event.verdict} · sha256 ${event.sha256}`)
      break
    case 'halt':
      line('[HALTED]', '1;31', event.reason)
      break
  }
}

// ── A minimal MCP client over stdio ──────────────────────────────────────────
function startServer() {
  const child = spawn(process.execPath, ['--use-env-proxy', '--no-warnings', SERVER], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] })
  createInterface({ input: child.stderr }).on('line', (text) => line('[MCP SERVER]', '2', text))
  const pending = new Map()
  let nextId = 1
  createInterface({ input: child.stdout }).on('line', (text) => {
    let message
    try {
      message = JSON.parse(text)
    } catch {
      // Anything on stdout that is not a JSON-RPC frame means the stream is corrupt.
      for (const { reject } of pending.values()) reject(new Error(`MCP stdout is not JSON-RPC: ${short(text, 80)}`))
      pending.clear()
      return
    }
    const waiter = pending.get(message.id)
    if (waiter === undefined) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(`${message.error.code} ${message.error.message}`))
    else waiter.resolve(message.result)
  })
  child.on('exit', (code) => {
    for (const { reject } of pending.values()) reject(new Error(`MCP server exited (${code})`))
    pending.clear()
  })
  const request = (method, params = {}) =>
    new Promise((resolvePromise, reject) => {
      const id = nextId++
      pending.set(id, { resolve: resolvePromise, reject })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  const notify = (method, params = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  return { child, request, notify }
}

async function runOnce(requestText, plannerChoice) {
  const server = startServer()
  try {
    const init = await server.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'sentinel-scout-cli', version: '1.0.0' } })
    server.notify('notifications/initialized')
    const { tools } = await server.request('tools/list')
    line('[MCP CONNECTED]', '1', `${init.serverInfo.name} ${init.serverInfo.version} · protocol ${init.protocolVersion} · ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`)

    const toolbox = {
      call: async (name, args) => {
        let result
        try {
          result = await server.request('tools/call', { name, arguments: args })
        } catch (error) {
          // A broken stream is a tool failure the loop can report, not a crash.
          return { ok: false, error: 'MCP_TRANSPORT_ERROR', message: `${error instanceof Error ? error.message : 'error'}. Stop and tell Lenon.` }
        }
        const text = result?.content?.[0]?.text
        if (typeof text !== 'string') return { ok: false, error: 'BAD_TOOL_RESPONSE', message: 'The MCP server returned no text content.' }
        try {
          return JSON.parse(text)
        } catch {
          return { ok: false, error: 'BAD_TOOL_RESPONSE', message: short(text, 200) }
        }
      },
    }

    let model
    if (plannerChoice === 'model') {
      model = resolvePlannerModel() ?? undefined
      if (model === undefined) {
        line('[PLANNER]', '33', 'No ANTHROPIC_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY set: using the FL-06 rules planner instead.')
      }
    }
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    let existing = 0
    try {
      existing = readdirSync(join(ROOT, 'docs/drafts')).filter((f) => f.startsWith(`T-${today}-`)).length
    } catch {
      existing = 0
    }
    const started = Date.now()
    const result = await runTriage({
      request: requestText,
      toolbox,
      triageId: newTriageId(new Date(), existing + 1),
      emit: print,
      ...(model === undefined ? {} : { model }),
    })
    process.stdout.write('\n')
    line('[DONE]', '1', `${result.calls.length} tool calls · ${Date.now() - started} ms · ${result.halted === null ? 'completed' : `halted: ${result.halted}`}`)
    line('[REPLY]', '1', result.reply)
    return result.halted === null ? 0 : 1
  } finally {
    server.child.kill()
  }
}

async function runEvals() {
  line('[EVAL]', '1', `Running ${EVAL_CASES.length} FL-06 eval cases (synthetic fixtures, fake network, temporary folders)`)
  const results = await runAllEvals(ROOT)
  process.stdout.write('\n')
  for (const r of results) {
    line(r.passed ? '[PASS]' : '[FAIL]', r.passed ? '32' : '31', `${r.id}. ${r.name}${r.blocker ? ' (blocker)' : ''} · ${r.tools.join(' → ')} · ${r.verdict ?? 'no verdict'} · ${r.ms} ms`)
    for (const failure of r.failures) line('      ', '31', failure)
  }
  const passed = results.filter((r) => r.passed).length
  const blockerFailed = results.some((r) => r.blocker && !r.passed)
  process.stdout.write('\n')
  line('[EVAL RESULT]', passed === results.length ? '1;32' : '1;31', `${passed}/${results.length} passed${blockerFailed ? ' · a blocker failed: do not ship' : ''}`)
  return passed === results.length ? 0 : 1
}

const argv = process.argv.slice(2)
const flag = (name) => {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}
const exitCode = argv.includes('--eval') ? await runEvals() : await runOnce(flag('--request') ?? DEFAULT_REQUEST, flag('--planner') ?? 'rules')
process.exit(exitCode)
