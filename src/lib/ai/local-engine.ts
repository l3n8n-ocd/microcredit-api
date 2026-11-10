/**
 * Local rule engine: the reply source for `/api/chat` when no model key is set.
 *
 * This is NOT a language model and the UI says so. It routes the last user
 * message to one of four topics by keyword, then builds a Markdown answer by
 * calling the same pure domain functions the app uses. No number in a reply is
 * typed by hand: scores come from `scoreApplicant`, legal moves from
 * `LEGAL_TRANSITIONS` + `transitionLoan`, journal lines from
 * `buildDisbursementJournal`, and the idempotency outcomes from really running
 * three requests through `createDisbursementServer`.
 *
 * Multi-turn: a follow-up with no topic keyword ("and for Liza?", "what about
 * ₱12,500?") inherits the topic, and the borrower, of the nearest earlier turn.
 *
 * Imports are the pure modules, never a feature barrel (`features/x/index.ts`),
 * because the barrels re-export `'use client'` components.
 */
import type { WireMessage } from '../../features/ai-copilot/chatProtocol.ts'
import { createDisbursementServer, formatIfMatch } from '../../features/disbursement/disbursementServer.ts'
import { buildDisbursementJournal, buildRepaymentJournal, journalTotals } from '../../features/disbursement/ledger.ts'
import { LEGAL_TRANSITIONS, transitionLoan } from '../../features/disbursement/loanStateMachine.ts'
import { SEED_LOANS } from '../../features/disbursement/seedLoans.ts'
import type { JournalEntry, LoanEvent, LoanOf, LoanState, LoanStatus } from '../../features/disbursement/types.ts'
import { APPLICANT_PROFILES, type ApplicantProfile } from '../../features/scoring/applicants.ts'
import {
  INTEREST_RATE_BPS,
  MAX_SCORE,
  REASON_TEXT,
  formatBps,
  scoreApplicant,
  splitRepayment,
} from '../../features/scoring/scoreEngine.ts'
import { createIdempotencyKey } from '../../utils/idempotency.ts'
import { formatPHP, parsePesosToCentavos, toCentavos, type Centavos, type PesoParseError } from '../../utils/money.ts'

export type LocalTopic = 'score' | 'lifecycle' | 'ledger' | 'idempotency'

/** First match wins, so the narrow topics (concurrency, ledger) sit above the broad one (score). */
const TOPIC_PATTERNS: readonly { readonly topic: LocalTopic; readonly pattern: RegExp }[] = [
  {
    topic: 'idempotency',
    pattern: /idempoten|if-match|double[- ]?(click|pay)|retry|retries|replay|duplicate|concurren|\brace\b|two admins|stale|etag|\b409\b|pay(s|ing)? .*twice/i,
  },
  {
    topic: 'ledger',
    pattern: /ledger|journal|debit|\bcredits?\b(?!\s+(scor|decision|limit|risk))|centavo|double[- ]entry|invariant|repay(ments?|s)?\b|interest|\bsplit|revers|rounding|float/i,
  },
  {
    topic: 'lifecycle',
    pattern: /\bstates?\b|transition|lifecycle|state machine|applied|under[_ ]review|approved|rejected|cancel|disbursed|repaying|settled|delinquent|defaulted|illegal/i,
  },
  {
    topic: 'score',
    pattern: /scor(e|ing)|trust|alt[- ]data|alternative data|utility|meralco|water bill|supplier|invoice|gcash|maya|\bload\b|cadence|\blimit|\bband\b|risk|reason code|underwrit|borrower|applicant/i,
  },
]

/** How a visitor might name each demo borrower: first name, business type, or loan ID. */
const BORROWER_ALIASES: Readonly<Record<string, RegExp>> = {
  'borrower-42': /nena|sari-?sari|borrower-42|l-1042/i,
  'borrower-17': /\bben\b|carinderia|borrower-17|l-1043/i,
  'borrower-08': /liza|bigasan|borrower-08|l-1044/i,
  'borrower-05': /tonyo|tricycle|toda|borrower-05|l-1045/i,
  'borrower-31': /rosa|palengke|fish|borrower-31|l-1046/i,
}

const STATUSES = Object.keys(LEGAL_TRANSITIONS) as LoanStatus[]

export function detectTopic(text: string): LocalTopic | null {
  return TOPIC_PATTERNS.find((entry) => entry.pattern.test(text))?.topic ?? null
}

function mentionedBorrowers(text: string): readonly ApplicantProfile[] {
  return APPLICANT_PROFILES.filter((profile) => BORROWER_ALIASES[profile.borrowerId]?.test(text) === true)
}

function mentionedStatuses(text: string): readonly LoanStatus[] {
  const upper = text.toUpperCase().replaceAll('UNDER REVIEW', 'UNDER_REVIEW')
  return STATUSES.map((status) => ({ status, at: upper.search(new RegExp(`\\b${status}\\b`)) }))
    .filter((hit) => hit.at !== -1)
    .sort((a, b) => a.at - b.at)
    .map((hit) => hit.status)
}

type AmountMention =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly value: Centavos }
  | { readonly kind: 'rejected'; readonly raw: string; readonly error: PesoParseError }

/** Finds "₱5,000.00", "PHP 1050" or "1,050 pesos" and parses it the only allowed way (CLAUDE.md §11 rule 2). */
function mentionedAmount(text: string): AmountMention {
  const match =
    /(?:₱|php)\s*([\d,]*\d(?:\.\d+)?)/i.exec(text) ?? /([\d,]*\d(?:\.\d+)?)\s*pesos/i.exec(text)
  const raw = match?.[1]
  if (raw === undefined) return { kind: 'none' }
  const parsed = parsePesosToCentavos(raw)
  if (!parsed.ok) return { kind: 'rejected', raw, error: parsed.error }
  return parsed.value > 0 ? { kind: 'ok', value: parsed.value } : { kind: 'none' }
}

const PARSE_ERROR_TEXT: Readonly<Record<PesoParseError, string>> = {
  EMPTY: 'it is empty',
  FORMAT: 'it is not a plain peso amount (no signs, exponents or misplaced commas)',
  PRECISION: 'it has more than two decimals, and guessing a rounding would invent centavos',
  TOO_LARGE: 'it is past the largest amount the parser accepts',
}

// ── Topic: trust score ──────────────────────────────────────────────────────

function scoreSection(profile: ApplicantProfile): string {
  const result = scoreApplicant(profile.signals)
  const { utility, supplier, load } = profile.signals
  const evidence: Readonly<Record<string, string>> = {
    utility: `${utility.monthsOnTime} of ${utility.monthsObserved} ${utility.provider} bills on time`,
    supplier: `${supplier.invoicesPaid} of ${supplier.invoicesTotal} invoices paid, ${supplier.avgDaysLate} days late on average`,
    load: `${load.topUpsPerMonth} top-ups a month, ${load.monthsActive} months active`,
  }
  const factors = result.factors
    .map((factor) => `- **${factor.label}:** \`${factor.points} / ${factor.maxPoints}\` (${evidence[factor.id] ?? ''})`)
    .join('\n')
  const reasons =
    result.reasonCodes.length === 0
      ? 'No adverse reason codes.'
      : `Reason codes:\n${result.reasonCodes.map((code) => `- \`${code}\`: ${REASON_TEXT[code]}`).join('\n')}`
  const offer =
    result.recommendedLimit > 0
      ? `Recommended limit: **${formatPHP(result.recommendedLimit)}** (\`${result.recommendedLimit}\` centavos).`
      : 'Recommended limit: **no offer**. A score under 400 is band `DECLINE`.'
  return [
    `### ${profile.name} (\`${profile.borrowerId}\`)`,
    `Trust score **${result.score} / ${MAX_SCORE}**, band \`${result.band}\`.`,
    factors,
    reasons,
    offer,
  ].join('\n\n')
}

/** Names the factor that separates the first two borrowers the most, from their real points. */
function largestGap(profiles: readonly ApplicantProfile[]): string {
  const [a, b] = profiles
  if (a === undefined || b === undefined) return ''
  const left = scoreApplicant(a.signals).factors
  const right = scoreApplicant(b.signals).factors
  const gaps = left.map((factor, index) => ({ factor, other: right[index]?.points ?? 0 }))
  const widest = gaps.reduce((best, gap) =>
    Math.abs(gap.factor.points - gap.other) > Math.abs(best.factor.points - best.other) ? gap : best,
  )
  return `The widest gap between ${a.name} and ${b.name} is the ${widest.factor.id} factor: \`${widest.factor.points}\` against \`${widest.other}\` points.`
}

function scoreReply(profiles: readonly ApplicantProfile[]): string {
  const chosen = profiles.length > 0 ? profiles : APPLICANT_PROFILES.slice(0, 1)
  const intro =
    profiles.length > 0
      ? 'Computed by `scoreApplicant` in `src/features/scoring/scoreEngine.ts`. Every division is floored, so points are integers.'
      : 'You did not name a borrower, so here is the first demo applicant. The score is the sum of three integer factors (350 + 350 + 300), computed by `scoreApplicant` in `src/features/scoring/scoreEngine.ts`.'
  const outro =
    chosen.length > 1
      ? largestGap(chosen)
      : 'Ask about another borrower (Ben, Liza, Tonyo, Rosa) or say "compare Nena and Rosa". Demo data only: these stores are fictional.'
  return [intro, ...chosen.map(scoreSection), outro].join('\n\n')
}

// ── Topic: loan lifecycle ───────────────────────────────────────────────────

const SAMPLE_BASE = { id: 'L-DEMO', borrowerId: 'borrower-42', version: 1 } as const
const SAMPLE_FUNDED = { disbursedAmount: toCentavos(500_000), provider: 'gcash', journalEntryId: 'JE-0001' } as const
const SAMPLE_OWING = { ...SAMPLE_BASE, ...SAMPLE_FUNDED, outstandingPrincipal: toCentavos(400_000) } as const

/** One loan per state, used only to ask the real `transitionLoan` where each event leads. */
const SAMPLE_LOANS: Readonly<Record<LoanStatus, LoanState>> = {
  APPLIED: { ...SAMPLE_BASE, status: 'APPLIED' },
  UNDER_REVIEW: { ...SAMPLE_BASE, status: 'UNDER_REVIEW' },
  APPROVED: { ...SAMPLE_BASE, status: 'APPROVED' },
  REJECTED: { ...SAMPLE_BASE, status: 'REJECTED', reason: 'demo' },
  CANCELLED: { ...SAMPLE_BASE, status: 'CANCELLED', reason: 'demo' },
  DISBURSED: { ...SAMPLE_BASE, ...SAMPLE_FUNDED, status: 'DISBURSED' },
  REPAYING: { ...SAMPLE_OWING, status: 'REPAYING' },
  SETTLED: { ...SAMPLE_BASE, ...SAMPLE_FUNDED, status: 'SETTLED' },
  DELINQUENT: { ...SAMPLE_OWING, status: 'DELINQUENT' },
  DEFAULTED: { ...SAMPLE_OWING, status: 'DEFAULTED' },
}

/** Two repayments on purpose: a part payment keeps the loan REPAYING, the last one settles it. */
const SAMPLE_EVENTS: readonly LoanEvent[] = [
  { type: 'START_REVIEW' },
  { type: 'APPROVE' },
  { type: 'REJECT', reason: 'demo' },
  { type: 'DISBURSE', amount: toCentavos(500_000), provider: 'gcash', journalEntryId: 'JE-0001' },
  { type: 'CANCEL', reason: 'demo' },
  { type: 'POST_REPAYMENT', principal: toCentavos(100_000) },
  { type: 'POST_REPAYMENT', principal: toCentavos(400_000) },
  { type: 'POST_REPAYMENT', principal: toCentavos(500_000) },
  { type: 'REVERSE_REPAYMENT', principal: toCentavos(100_000) },
  { type: 'MARK_DELINQUENT' },
  { type: 'CURE' },
  { type: 'MARK_DEFAULTED' },
]

interface Edge {
  readonly from: LoanStatus
  readonly event: LoanEvent['type']
  readonly to: LoanStatus
}

/** Every (from, event, to) the state machine really allows, found by running it. */
export function lifecycleEdges(): readonly Edge[] {
  const edges: Edge[] = []
  for (const from of STATUSES) {
    for (const event of SAMPLE_EVENTS) {
      const result = transitionLoan(SAMPLE_LOANS[from], event)
      if (!result.ok) continue
      const to = result.loan.status
      if (!edges.some((edge) => edge.from === from && edge.event === event.type && edge.to === to)) {
        edges.push({ from, event: event.type, to })
      }
    }
  }
  return edges
}

function lifecycleReply(text: string): string {
  const edges = lifecycleEdges()
  // "Walk me through all 10 states from APPLIED to SETTLED" names two states but wants the map.
  const wantsOverview = /\b(all|every|10|ten|walk|list|overview|lifecycle|happy path)\b/i.test(text)
  const [from, to] = wantsOverview ? [] : mentionedStatuses(text)

  if (from !== undefined && to !== undefined && from !== to) {
    const direct = edges.filter((edge) => edge.from === from && edge.to === to)
    const allowed = LEGAL_TRANSITIONS[from]
    if (direct.length > 0) {
      return [
        `Yes. \`${from} → ${to}\` is legal through ${direct.map((edge) => `\`${edge.event}\``).join(' or ')}.`,
        'A successful transition returns a new loan with `version + 1`, so the next request must send the new `If-Match`.',
      ].join('\n\n')
    }
    return [
      `No. There is no single event that moves a loan \`${from} → ${to}\`.`,
      allowed.length === 0
        ? `\`${from}\` is terminal: \`LEGAL_TRANSITIONS.${from}\` is an empty list, so every event returns a typed \`409 ILLEGAL_TRANSITION\`.`
        : `From \`${from}\` the only legal events are ${allowed.map((event) => `\`${event}\``).join(', ')}. Anything else returns a typed \`409 ILLEGAL_TRANSITION\` and the ledger is not touched.`,
      'The UI reads the same table, so it never offers the illegal button in the first place (`src/features/disbursement/loanStateMachine.ts`).',
    ].join('\n\n')
  }

  if (from !== undefined) {
    const out = edges.filter((edge) => edge.from === from)
    return out.length === 0
      ? `\`${from}\` is a terminal state. No event leaves it; all 10 event types return \`409 ILLEGAL_TRANSITION\`.`
      : [`From \`${from}\`:`, out.map((edge) => `- \`${edge.event}\` → \`${edge.to}\``).join('\n')].join('\n\n')
  }

  const lines = STATUSES.map((status) => {
    const out = edges.filter((edge) => edge.from === status)
    return out.length === 0
      ? `- \`${status}\`: terminal`
      : `- \`${status}\`: ${out.map((edge) => `\`${edge.event}\` → \`${edge.to}\``).join(', ')}`
  }).join('\n')
  const legalPairs = STATUSES.reduce((total, status) => total + LEGAL_TRANSITIONS[status].length, 0)
  const eventTypes = new Set(SAMPLE_EVENTS.map((event) => event.type)).size
  return [
    `The loan is a discriminated union of ${STATUSES.length} states. The happy path is \`APPLIED → UNDER_REVIEW → APPROVED → DISBURSED → REPAYING → SETTLED\`.`,
    lines,
    `That is ${legalPairs} legal (state, event) pairs out of ${STATUSES.length * eventTypes}. The other ${STATUSES.length * eventTypes - legalPairs} return a typed \`409 ILLEGAL_TRANSITION\`.`,
    'Ask "can a REJECTED loan be DISBURSED?" to test one pair.',
  ].join('\n\n')
}

// ── Topic: ledger ───────────────────────────────────────────────────────────

function journalBlock(entry: JournalEntry): string {
  const totals = journalTotals(entry.lines)
  const rows = entry.lines.map(
    (line) => `${line.side.padEnd(6)} ${line.account.padEnd(30)} ${String(line.amount).padStart(9)}`,
  )
  return [
    '```text',
    `${entry.kind} ${entry.id}  (amounts in integer centavos)`,
    ...rows,
    `Σ debits  = ${totals.debits}`,
    `Σ credits = ${totals.credits}`,
    `balanced  = ${String(totals.balanced)}`,
    '```',
  ].join('\n')
}

const APPROVED_SAMPLE: LoanOf<'APPROVED'> = { id: 'L-1042', borrowerId: 'borrower-42', version: 3, status: 'APPROVED' }

function ledgerReply(text: string, amount: AmountMention): string {
  const wantsRepayment = /repay|interest|\bsplit|principal/i.test(text)
  const rejected =
    amount.kind === 'rejected'
      ? `I did not use "${amount.raw}": ${PARSE_ERROR_TEXT[amount.error]}. \`parsePesosToCentavos\` rejects it instead of rounding. Showing the default amount.`
      : null

  if (wantsRepayment) {
    const total = amount.kind === 'ok' ? amount.value : toCentavos(105_000)
    const split = splitRepayment(total)
    const loan: LoanOf<'DISBURSED'> = {
      id: 'L-1042',
      borrowerId: 'borrower-42',
      version: 4,
      status: 'DISBURSED',
      disbursedAmount: toCentavos(500_000),
      provider: 'gcash',
      journalEntryId: 'JE-0001',
    }
    const body =
      split.principal > 0
        ? journalBlock(buildRepaymentJournal({ id: 'JE-0002', loan, split, idempotencyKey: 'demo' }))
        : 'A payment this small is all interest after flooring, so there is no principal line to post.'
    return [
      rejected,
      `A repayment of **${formatPHP(total)}** at ${formatBps(INTEREST_RATE_BPS)} flat interest splits into principal \`${split.principal}\` and interest \`${split.interest}\` centavos.`,
      `The interest share is \`total × ${INTEREST_RATE_BPS} / ${10_000 + INTEREST_RATE_BPS}\`, computed in \`BigInt\` and floored. Principal takes the remainder, so \`principal + interest === total\` with no second rounding (\`splitRepayment\` in \`src/features/scoring/scoreEngine.ts\`).`,
      body,
    ]
      .filter((part) => part !== null)
      .join('\n\n')
  }

  const value = amount.kind === 'ok' ? amount.value : toCentavos(500_000)
  const entry = buildDisbursementJournal({
    id: 'JE-0001',
    loan: APPROVED_SAMPLE,
    amount: value,
    provider: 'gcash',
    idempotencyKey: 'demo',
  })
  return [
    rejected,
    `A **${formatPHP(value)}** GCash payout is stored as \`${value}\` centavos (₱1.00 = \`100\`). It posts one balanced entry:`,
    journalBlock(entry),
    '`buildDisbursementJournal` in `src/features/disbursement/ledger.ts` throws if `Σ debits !== Σ credits`, so an unbalanced entry cannot be saved. Entries are append-only: a mistake is fixed by a `REVERSAL` entry that mirrors every line, never by an edit.',
    'Money never passes through a float. `0.1 + 0.2 !== 0.3` in IEEE-754, and `19.99 × 100` is `1998.9999999999998`; the parser builds `1999` from the digits instead.',
  ]
    .filter((part) => part !== null)
    .join('\n\n')
}

// ── Topic: idempotency + optimistic concurrency ─────────────────────────────

async function idempotencyReply(): Promise<string> {
  // Three real requests against a fresh in-memory server. Nothing below is scripted.
  const server = createDisbursementServer(SEED_LOANS)
  const body = {
    loanId: 'L-1042',
    provider: 'gcash',
    recipientMobile: '09171234567',
    amount: toCentavos(500_000),
    referenceNote: 'Sari-sari store restock',
  } as const
  const staleEtag = formatIfMatch(3)
  const keyA = createIdempotencyKey()
  const keyB = createIdempotencyKey()

  const first = await server.disburse({ headers: { 'Idempotency-Key': keyA, 'If-Match': staleEtag }, body })
  const retry = await server.disburse({ headers: { 'Idempotency-Key': keyA, 'If-Match': staleEtag }, body })
  const second = await server.disburse({ headers: { 'Idempotency-Key': keyB, 'If-Match': staleEtag }, body })
  const describe = (response: typeof first): string =>
    'code' in response ? `${response.status} ${response.kind} ${response.code}` : `${response.status} ${response.kind}`

  return [
    'I just ran three `POST /disburse` requests for loan `L-1042` against a fresh in-memory server (`src/features/disbursement/disbursementServer.ts`):',
    [
      '```text',
      `1. Idempotency-Key A, If-Match "3"  → ${describe(first)}`,
      `2. Idempotency-Key A, If-Match "3"  → ${describe(retry)}   (double-click / network retry)`,
      `3. Idempotency-Key B, If-Match "3"  → ${describe(second)}   (second admin, stale screen)`,
      `ledger entries posted: ${server.getLedger().length}`,
      '```',
    ].join('\n'),
    '**`Idempotency-Key`** names one user intent. The server looks the key up BEFORE it compares versions, so a retry gets the stored `201` back and nothing new is posted. If it checked the version first, the retry would see version 4 and return a confusing `409` for a payout that worked.',
    '**`If-Match`** carries the loan version the admin saw. Request 3 is a different intent with a new key, but the loan moved `APPROVED → DISBURSED` and is now version 4, so `"3"` is stale and it bounces with `409`. That is optimistic concurrency: no lock, just a version check at commit.',
    'Together: same intent twice pays once, and two admins at once pay once. Try it on the home page with **Simulate double-click / network retry**.',
  ].join('\n\n')
}

// ── Fallback ────────────────────────────────────────────────────────────────

const HELP_REPLY = [
  'I can answer four kinds of question about this demo:',
  [
    '- **Trust scores:** "Explain Liza\'s score" or "compare Nena and Rosa"',
    '- **Loan lifecycle:** "Can a REJECTED loan be DISBURSED?"',
    '- **Ledger:** "Show the journal for a ₱12,500.00 payout" or "split a ₱1,050.00 repayment"',
    '- **Concurrency:** "What do `Idempotency-Key` and `If-Match` do on a double-click?"',
  ].join('\n'),
  'Right now you are talking to the local rule engine, not a language model: no API key is set on this deployment. It matches keywords and computes every number from the app\'s own TypeScript functions, so it cannot answer open questions.',
].join('\n\n')

/**
 * Builds the full reply for a conversation. Async only because the idempotency
 * answer awaits the in-memory server.
 */
export async function buildLocalReply(messages: readonly WireMessage[]): Promise<string> {
  const userTurns = messages.filter((message) => message.role === 'user').map((message) => message.content)
  const latest = userTurns.at(-1) ?? ''
  const earlier = userTurns.slice(0, -1).reverse()

  const direct = detectTopic(latest)
  const borrowersNow = mentionedBorrowers(latest)
  const amountNow = mentionedAmount(latest)

  // Follow-up resolution: a named borrower implies a score question, a bare
  // amount implies the ledger, and anything else inherits the nearest topic.
  const inherited = earlier.map(detectTopic).find((topic) => topic !== null) ?? null
  const topic: LocalTopic | null =
    direct ??
    (borrowersNow.length > 0 ? 'score' : null) ??
    (amountNow.kind !== 'none' ? 'ledger' : null) ??
    (earlier.length > 0 && /^(and|what about|how about|why|same|again|more|go on|continue)\b/i.test(latest.trim())
      ? inherited
      : null)

  const carried = direct === null && topic !== null && inherited === topic && earlier.length > 0
  const prefix = carried ? `Continuing the ${topic} thread from earlier in this conversation.\n\n` : ''

  switch (topic) {
    case 'score': {
      const borrowers =
        borrowersNow.length > 0
          ? borrowersNow
          : (earlier.map(mentionedBorrowers).find((found) => found.length > 0) ?? [])
      return prefix + scoreReply(borrowers)
    }
    case 'lifecycle':
      return prefix + lifecycleReply(latest)
    case 'ledger':
      return prefix + ledgerReply(latest, amountNow)
    case 'idempotency':
      return prefix + (await idempotencyReply())
    default:
      return HELP_REPLY
  }
}

/**
 * Splits a reply into small chunks so it streams like model output: words are
 * kept with their trailing whitespace, and long words are cut into 4-character
 * pieces. Joining the chunks gives back the exact input.
 */
export function tokenize(text: string): readonly string[] {
  const words = text.match(/\S+\s*|\s+/g) ?? []
  return words.flatMap((word) => (word.trimEnd().length > 6 ? (word.match(/[\s\S]{1,4}/g) ?? [word]) : [word]))
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export interface LocalStreamOptions {
  readonly signal: AbortSignal
  /** Pause before each token. ~22 ms in production; 0 in unit tests. */
  readonly tokenDelayMs: number
  /** Pause before the first token, so the "thinking" state is visible. */
  readonly firstTokenDelayMs: number
}

/**
 * Yields the reply one token at a time. The abort signal is checked before
 * every token and also cuts the current sleep short, so a Stop lands within
 * one tick instead of after the remaining text.
 */
export async function* streamLocalReply(
  messages: readonly WireMessage[],
  options: LocalStreamOptions,
): AsyncGenerator<string, void, void> {
  const reply = await buildLocalReply(messages)
  await sleep(options.firstTokenDelayMs, options.signal)
  for (const token of tokenize(reply)) {
    if (options.signal.aborted) return
    yield token
    await sleep(options.tokenDelayMs, options.signal)
  }
}
