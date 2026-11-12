/**
 * The SentinelScout loop: Observe → Decide tool → Execute → Inspect → Halt.
 *
 * One loop, two planners:
 *   - `rules`: the FL-06 §3 loop rules written as code. No model, no key, the
 *     same run every time. This is what the evals and the CLI default use.
 *   - `model`: a language model reads the FL-06 system prompt and chooses the
 *     tools itself (AI SDK tool calling). Used when a key is configured and asked for.
 *
 * Both planners go through the same `Toolbox`, so the 4-call budget, the
 * input checks and the leak gate apply to both. Every step is reported as an
 * `AgentEvent`; the CLI prints them and the /agent page renders them.
 */
import { generateText, jsonSchema, stepCountIs, tool, type LanguageModel } from 'ai'
import { findLeaks, GHSA_ID, MAX_TOOL_CALLS, redact, UNTRUSTED_CLOSE, UNTRUSTED_OPEN } from './guards.ts'
import { SYSTEM_PROMPT } from './system-prompt.ts'
import {
  TOOL_NAMES,
  TOOL_SCHEMAS,
  type Advisory,
  type AuditOk,
  type FetchOk,
  type ScanOk,
  type ToolError,
  type ToolName,
  type Toolbox,
  type ToolOutcome,
  type Verdict,
  type WriteOk,
} from './tools.ts'

// ── Events ───────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { readonly type: 'start'; readonly at: string; readonly triage_id: string; readonly request: string; readonly planner: string }
  | { readonly type: 'turn'; readonly at: string; readonly turn: number; readonly max: number; readonly reason: string }
  | { readonly type: 'tool_call'; readonly at: string; readonly turn: number; readonly tool: ToolName; readonly args: Record<string, unknown> }
  | { readonly type: 'tool_result'; readonly at: string; readonly turn: number; readonly tool: ToolName; readonly ms: number; readonly result: unknown }
  | { readonly type: 'guardrail'; readonly at: string; readonly check: string; readonly passed: boolean; readonly detail: string }
  | { readonly type: 'final'; readonly at: string; readonly verdict: Verdict; readonly path: string; readonly latest_path: string; readonly sha256: string; readonly markdown: string }
  | { readonly type: 'halt'; readonly at: string; readonly reason: string }

export interface RunResult {
  readonly triage_id: string
  readonly planner: 'rules' | 'model'
  readonly calls: readonly { readonly tool: ToolName; readonly args: Record<string, unknown>; readonly result: unknown }[]
  readonly verdict: Verdict | null
  readonly markdown: string | null
  readonly written: WriteOk | null
  readonly halted: string | null
  /** Everything the agent said to the user outside the brief. Checked for leaks too. */
  readonly reply: string
}

export interface RunOptions {
  readonly request: string
  /** Anything with `call`: the in-process toolbox, or an MCP client over stdio. */
  readonly toolbox: Pick<Toolbox, 'call'>
  readonly triageId: string
  readonly now?: () => Date
  readonly emit?: (event: AgentEvent) => void
  /** Present → the model plans. Absent → the FL-06 rules plan. */
  readonly model?: { readonly model: LanguageModel; readonly label: string }
}

export function newTriageId(now: Date, sequence = 1): string {
  const ymd = now.toISOString().slice(0, 10).replaceAll('-', '')
  return `T-${ymd}-${String(sequence % 100).padStart(2, '0')}`
}

const isError = (value: unknown): value is ToolError =>
  typeof value === 'object' && value !== null && 'ok' in value && value.ok === false

// ── Reading the request ──────────────────────────────────────────────────────

export interface ParsedRequest {
  readonly mode: 'ghsa' | 'latest' | 'pre-release'
  readonly ghsaId: string | null
  /** The user's own notes (after "notes:"), already redacted. */
  readonly notes: string | null
  readonly redactedKinds: readonly string[]
  /** The request asks for the audit explicitly ("audit" or "pre-release"). */
  readonly wantsAudit: boolean
}

export function parseRequest(request: string): ParsedRequest {
  const id = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(request)?.[0]?.toLowerCase().replace(/^ghsa/, 'GHSA') ?? null
  const notesMatch = /notes\s*:\s*([\s\S]+)$/i.exec(request)
  const rawNotes = notesMatch?.[1]?.trim() ?? null
  const redactedKinds = rawNotes === null ? [] : findLeaks(rawNotes)
  const mode = id !== null ? 'ghsa' : /pre-?release/i.test(request) ? 'pre-release' : 'latest'
  // Only the user's own words count, not the notes they pasted.
  const instruction = notesMatch === null ? request : request.slice(0, notesMatch.index)
  return {
    mode,
    ghsaId: id !== null && GHSA_ID.test(id) ? id : null,
    notes: rawNotes === null ? null : redact(rawNotes),
    redactedKinds,
    wantsAudit: /\baudit\b|pre-?release/i.test(instruction),
  }
}

// ── Writing the brief from tool results only ─────────────────────────────────

/** First line of the author's text, as data: tags stripped, capped, redacted. */
function advisoryTitle(advisory: Advisory): string {
  const inner = advisory.summary.replace(UNTRUSTED_OPEN, '').replace(UNTRUSTED_CLOSE, '')
  const first = inner.split('\n').find((line) => line.trim() !== '')?.trim() ?? ''
  return redact(first.length > 120 ? `${first.slice(0, 120)}…` : first).replaceAll('`', "'")
}

export interface BriefInput {
  readonly verdict: Verdict
  readonly request: ParsedRequest
  readonly fetch: FetchOk | ToolError | null
  readonly scan: ScanOk | ToolError | null
  readonly audit: AuditOk | ToolError | null
  readonly skipped: readonly string[]
  readonly generatedAt: string
}

/** GitHub-flavoured Markdown splits table cells on `|`, even inside a code span: escape it. */
const cell = (text: string): string => text.replaceAll('|', '\\|')

const VERDICT_WHY: Readonly<Record<Verdict, string>> = {
  AFFECTED: 'A vulnerable version is installed.',
  NOT_AFFECTED: 'No installed version is in the vulnerable range.',
  INVARIANT_FAIL: 'The money or idempotency audit failed, whatever the advisory says.',
  NEEDS_HUMAN: 'A tool failed or data is missing, so this needs a person.',
}

export function composeBrief(input: BriefInput): string {
  const { fetch, scan, audit } = input
  const lines: string[] = []
  const advisories = fetch !== null && !isError(fetch) ? fetch.advisories : []
  lines.push(`# SentinelScout triage brief`, '', `Generated ${input.generatedAt}. Draft for Lenon's sign-off; nothing here was applied.`, '')

  lines.push('## 1. Verdict', '', `**${input.verdict}**. ${VERDICT_WHY[input.verdict]}`, '')

  lines.push('## 2. Advisory', '')
  if (fetch === null) lines.push('No advisory fetched: this was a pre-release check.')
  else if (isError(fetch)) lines.push(`Could not fetch the advisory: \`${fetch.error}\`. ${fetch.message}`)
  else {
    lines.push(`Source: **${fetch.source}**, fetched ${fetch.fetched_at}.`, '')
    for (const advisory of advisories) {
      lines.push(
        `- **${advisory.ghsa_id}**${advisory.cve_id === null ? '' : ` (${advisory.cve_id})`}, severity **${advisory.severity}** (from the advisory's severity field)`,
        `  - CVSS: ${advisory.cvss === null ? 'none given' : `\`${advisory.cvss.vector}\`${advisory.cvss.score === null ? '' : `, score ${advisory.cvss.score}`}`}`,
        `  - Title, as written by the advisory author: "${advisoryTitle(advisory)}"`,
        `  - ${advisory.url}`,
      )
      if (advisory.injection_suspected) lines.push('  - **The advisory text contained instructions; they were ignored.**')
    }
  }
  lines.push('')

  lines.push('## 3. Exposure', '')
  if (scan === null) lines.push('Not scanned.')
  else if (isError(scan)) lines.push(`Scan failed: \`${scan.error}\`. ${scan.message}`)
  else {
    lines.push(`Checked against \`package-lock.json\` (${scan.lockfile_packages} packages).`, '')
    lines.push('| Package | Vulnerable range | Installed | Direct | In range |', '| --- | --- | --- | --- | --- |')
    for (const result of scan.results) {
      if (result.installed.length === 0) lines.push(`| \`${result.package}\` | \`${cell(result.vulnerable_range)}\` | not installed | no | no |`)
      for (const copy of result.installed) {
        lines.push(`| \`${result.package}\` | \`${cell(result.vulnerable_range)}\` | ${copy.version} | ${copy.direct ? 'yes' : 'no'} | **${copy.in_range ? 'yes' : 'no'}** |`)
      }
    }
    const importers = scan.results.flatMap((r) => r.imported_in_src.map((file) => `\`${file}\``))
    if (importers.length > 0) lines.push('', `Imported in: ${importers.slice(0, 8).join(', ')}${importers.length > 8 ? ', …' : ''}.`)
  }
  lines.push('')

  lines.push('## 4. Invariants', '')
  if (audit === null) lines.push('Not audited: nothing was exposed, so the audit was skipped to save a tool call.')
  else if (isError(audit)) lines.push(`Audit failed: \`${audit.error}\`. ${audit.message}`)
  else {
    lines.push(
      `- Regex audit of \`${audit.dir}\` (${audit.files_scanned} files, CLAUDE.md §11 rule 2): **${audit.verdict}**, ${audit.violations.length} floating-point money ${audit.violations.length === 1 ? 'line' : 'lines'}.`,
      `- \`Idempotency-Key\` required: ${audit.idempotency_key_header_required ? 'yes' : '**no**'}. \`If-Match\` required: ${audit.if_match_header_required ? 'yes' : '**no**'}.`,
      `- Type check and unit tests: ${audit.checks.ran ? `typecheck ${audit.checks.typecheck}, tests ${audit.checks.tests}${audit.checks.tests_summary ? ` (${audit.checks.tests_summary})` : ''}` : `not run (${audit.checks.reason ?? 'not requested'})`}.`,
    )
    for (const violation of audit.violations.slice(0, 10)) lines.push(`  - \`${violation}\``)
    lines.push('', 'A regex audit, not a proof: it finds the known patterns, not every way to do float math.')
  }
  lines.push('')

  lines.push('## 5. For Lenon', '')
  const decisions: string[] = []
  if (input.verdict === 'AFFECTED' && scan !== null && !isError(scan)) {
    for (const result of scan.results.filter((r) => r.exposed)) {
      const direct = result.installed.find((copy) => copy.direct && copy.in_range)
      if (direct !== undefined && result.fix_hint !== null) {
        decisions.push(`Upgrade \`${result.package}\` from ${direct.version} to ${result.fix_hint} or later. Proposed diff, not applied:`)
        decisions.push('', '```diff', `-    "${result.package}": "^${direct.version}",`, `+    "${result.package}": "^${result.fix_hint}",`, '```', '')
      } else {
        decisions.push(`\`${result.package}\` is pulled in by another package. Find which one with \`npm ls ${result.package}\`, then decide whether an \`overrides\` entry is safe.`)
      }
    }
  }
  if (input.verdict === 'INVARIANT_FAIL') decisions.push('Fix each line above through `parsePesosToCentavos` / integer `Centavos` (CLAUDE.md §4), then rerun the pre-release check.')
  if (input.verdict === 'NOT_AFFECTED') decisions.push('Nothing to change. Confirm the range comparison in section 3 and sign off.')
  if (input.verdict === 'NEEDS_HUMAN') decisions.push('Fetch or check this by hand. No advisory details were guessed.')
  lines.push(...decisions.map((d) => (d === '' || d.startsWith('```') || d.startsWith('-  ') || d.startsWith('+  ') ? d : `- ${d}`)))
  if (input.skipped.length > 0) lines.push(`- Skipped: ${input.skipped.join('; ')}.`)
  if (input.request.notes !== null) {
    lines.push(`- Your notes, redacted${input.request.redactedKinds.length > 0 ? ` (${input.request.redactedKinds.join(', ')} removed)` : ''}: ${input.request.notes}`)
  }
  lines.push('', 'Sign-off stays with Lenon (FL-01). SentinelScout does not apply diffs, commit, push or publish.')
  return `${lines.join('\n')}\n`
}

// ── The loop ─────────────────────────────────────────────────────────────────

export async function runTriage(options: RunOptions): Promise<RunResult> {
  const now = options.now ?? (() => new Date())
  const at = (): string => now().toISOString()
  const emit = options.emit ?? (() => {})
  const planner = options.model === undefined ? 'rules' : 'model'
  emit({ type: 'start', at: at(), triage_id: options.triageId, request: redact(options.request), planner: options.model?.label ?? 'FL-06 rules (no model)' })

  const calls: { tool: ToolName; args: Record<string, unknown>; result: unknown }[] = []
  let turn = 0
  async function call<N extends ToolName>(name: N, args: Record<string, unknown>, reason: string): Promise<ToolOutcome<N>> {
    turn += 1
    emit({ type: 'turn', at: at(), turn, max: MAX_TOOL_CALLS, reason })
    const fullArgs = { triage_id: options.triageId, ...args }
    emit({ type: 'tool_call', at: at(), turn, tool: name, args: fullArgs })
    const started = Date.now()
    const result = await options.toolbox.call(name, fullArgs)
    emit({ type: 'tool_result', at: at(), turn, tool: name, ms: Date.now() - started, result })
    calls.push({ tool: name, args: fullArgs, result })
    if (isError(result) && result.error === 'BUDGET_EXCEEDED') {
      emit({ type: 'guardrail', at: at(), check: 'circuit breaker', passed: false, detail: result.message })
    }
    return result
  }

  const outcome = options.model === undefined ? await planWithRules(options, call, emit, at) : await planWithModel(options, call, emit, at)
  return { triage_id: options.triageId, planner, calls, ...outcome }
}

type Call = <N extends ToolName>(name: N, args: Record<string, unknown>, reason: string) => Promise<ToolOutcome<N>>
type Outcome = Pick<RunResult, 'verdict' | 'markdown' | 'written' | 'halted' | 'reply'>

/** FL-06 §3, steps 1–4, as code. */
async function planWithRules(options: RunOptions, call: Call, emit: (e: AgentEvent) => void, at: () => string): Promise<Outcome> {
  const request = parseRequest(options.request)
  if (request.redactedKinds.length > 0) {
    emit({ type: 'guardrail', at: at(), check: 'input redaction', passed: true, detail: `Removed ${request.redactedKinds.join(', ')} from your notes before any tool saw them.` })
  }
  const skipped: string[] = []

  // 1. Observe: fetch the advisory, unless this is a pre-release check.
  let fetched: FetchOk | ToolError | null = null
  if (request.mode !== 'pre-release') {
    fetched = await call(
      'fetch_ghsa_advisory',
      request.ghsaId === null ? {} : { ghsa_id: request.ghsaId },
      request.ghsaId === null ? 'No GHSA ID given: fetch the latest reviewed npm advisories.' : `Fetch ${request.ghsaId}.`,
    )
    if (!isError(fetched)) {
      const injected = fetched.advisories.filter((a) => a.injection_suspected).map((a) => a.ghsa_id)
      emit({
        type: 'guardrail',
        at: at(),
        check: 'untrusted advisory text',
        passed: true,
        detail:
          injected.length > 0
            ? `Instruction-shaped text in ${injected.join(', ')}. It stays inside the untrusted tags; verdict and severity come from structured fields and the scan only.`
            : 'Advisory text wrapped as untrusted data. No instruction-shaped text found.',
      })
    }
  }

  // 2a. Scan every affected npm package (up to 10).
  let scanned: ScanOk | ToolError | null = null
  const fetchFailed = fetched !== null && isError(fetched)
  if (!fetchFailed && fetched !== null && !isError(fetched)) {
    const packages = fetched.advisories.flatMap((a) => a.affected)
    if (packages.length > 10) skipped.push(`${packages.length - 10} affected packages beyond the first 10`)
    if (packages.length === 0) skipped.push('the scan: the advisory lists no npm package')
    else scanned = await call('scan_local_repo_exposure', { packages: packages.slice(0, 10) }, `Is any of ${[...new Set(packages.map((p) => p.package))].slice(0, 5).join(', ')} installed in a vulnerable version?`)
  }

  // 2b/2c. Audit only when something is exposed, or before a release.
  const exposed = scanned !== null && !isError(scanned) && scanned.exposed
  let audited: AuditOk | ToolError | null = null
  if (!fetchFailed && (exposed || request.wantsAudit)) {
    audited = await call(
      'audit_centavos_and_idempotency',
      { dir: 'src/features', run_checks: true },
      exposed ? 'Something is exposed: confirm the money invariants still hold.' : 'The request asks for the invariant audit.',
    )
  } else if (!fetchFailed) {
    skipped.push('the invariant audit: nothing was exposed')
  }

  // 3. Verify, then pick the verdict from tool results only.
  const verdict: Verdict =
    fetchFailed || (scanned !== null && isError(scanned)) || (audited !== null && isError(audited))
      ? 'NEEDS_HUMAN'
      : audited !== null && !isError(audited) && audited.verdict === 'FAIL'
        ? 'INVARIANT_FAIL'
        : exposed
          ? 'AFFECTED'
          : request.mode === 'pre-release' || (scanned !== null && !isError(scanned))
            ? 'NOT_AFFECTED'
            : 'NEEDS_HUMAN'

  // 4. Draft.
  const markdown = composeBrief({ verdict, request, fetch: fetched, scan: scanned, audit: audited, skipped, generatedAt: at() })
  const leaks = findLeaks(markdown)
  emit({ type: 'guardrail', at: at(), check: 'output secret scan', passed: leaks.length === 0, detail: leaks.length === 0 ? 'No token, private IP, phone number or wallet signature in the brief.' : `Found ${leaks.join(', ')}: the write tool will refuse it.` })
  const written = await call('write_sanitized_triage_brief', { ghsa_id: request.ghsaId, verdict, markdown }, `Save the ${verdict} brief.`)
  if (isError(written)) {
    emit({ type: 'halt', at: at(), reason: `${written.error}: ${written.message}` })
    return { verdict, markdown, written: null, halted: written.error, reply: `Halted: ${written.error}.` }
  }
  emit({ type: 'final', at: at(), verdict, path: written.path, latest_path: written.latest_path, sha256: written.sha256, markdown })
  return { verdict, markdown, written, halted: null, reply: `${verdict}. Draft: ${written.path}. Decide: ${VERDICT_WHY[verdict]}` }
}

/** The model chooses the tools. The toolbox still enforces the budget and the gates. */
async function planWithModel(options: RunOptions, call: Call, emit: (e: AgentEvent) => void, at: () => string): Promise<Outcome> {
  const model = options.model
  if (model === undefined) throw new Error('planWithModel needs a model')
  let written: WriteOk | null = null
  let verdict: Verdict | null = null
  let markdown: string | null = null
  const tools = Object.fromEntries(
    TOOL_NAMES.map((name) => [
      name,
      tool({
        description: TOOL_SCHEMAS[name].description,
        inputSchema: jsonSchema<Record<string, unknown>>(TOOL_SCHEMAS[name].inputSchema),
        execute: async (input: Record<string, unknown>) => {
          const result = await call(name, input, `The model chose ${name}.`)
          if (name === 'write_sanitized_triage_brief' && !isError(result)) {
            written = result as WriteOk
            verdict = typeof input.verdict === 'string' ? (input.verdict as Verdict) : null
            markdown = typeof input.markdown === 'string' ? input.markdown : null
          }
          return result
        },
      }),
    ]),
  )
  try {
    const result = await generateText({
      model: model.model,
      instructions: `${SYSTEM_PROMPT}\n\nUse triage_id ${options.triageId} on every call.`,
      prompt: redact(options.request),
      tools,
      stopWhen: stepCountIs(MAX_TOOL_CALLS + 1),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(90_000),
    })
    const reply = result.text
    const leaks = findLeaks(reply)
    emit({ type: 'guardrail', at: at(), check: 'chat reply secret scan', passed: leaks.length === 0, detail: leaks.length === 0 ? 'Reply is clean.' : `Reply contained ${leaks.join(', ')}; it was redacted.` })
    const finalWrite: WriteOk | null = written
    if (finalWrite === null) {
      emit({ type: 'halt', at: at(), reason: 'The model stopped without saving a brief.' })
      return { verdict: null, markdown: null, written: null, halted: 'NO_BRIEF', reply: redact(reply) }
    }
    const done: WriteOk = finalWrite
    emit({ type: 'final', at: at(), verdict: verdict ?? 'NEEDS_HUMAN', path: done.path, latest_path: done.latest_path, sha256: done.sha256, markdown: markdown ?? '' })
    return { verdict, markdown, written: done, halted: null, reply: redact(reply) }
  } catch (error) {
    const reason = `Model call failed (${error instanceof Error ? error.name : 'error'}).`
    emit({ type: 'halt', at: at(), reason })
    return { verdict: null, markdown: null, written: null, halted: 'MODEL_FAILED', reply: reason }
  }
}
