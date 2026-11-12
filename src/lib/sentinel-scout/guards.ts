/**
 * SentinelScout guardrails that are code, not prompt (FL-06 §5).
 *
 * Shared by the MCP server, the CLI runner and the /api/agent route, so every
 * host enforces the same rules. Pure: no I/O.
 */

/** The FL-04 leak patterns, plus wallet-signature headers (GCash/Maya mocks). */
export const LEAK_PATTERNS: readonly { readonly kind: string; readonly re: RegExp }[] = [
  { kind: 'JWT', re: /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/g },
  { kind: 'BEARER', re: /Bearer\s+[A-Za-z0-9._-]{10,}/gi },
  { kind: 'SECRET', re: /\b(?:sk-ant-|sk_live_|whsec_|stg_whk_)[A-Za-z0-9_-]{6,}/g },
  { kind: 'WALLET-SIG', re: /x-(?:maya|gcash)-sig(?:nature)?\s*[:=]\s*[0-9a-f]{16,}/gi },
  { kind: 'HMAC', re: /\b[0-9a-f]{64}\b/g },
  { kind: 'IP', re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g },
  { kind: 'MSISDN', re: /\b09\d{9}\b/g },
]

/** Which kinds of secret appear in `text`. Kinds only: never the values. */
export function findLeaks(text: string): string[] {
  return LEAK_PATTERNS.filter(({ re }) => new RegExp(re.source, re.flags).test(text)).map(({ kind }) => kind)
}

/** Replaces every secret with `[REDACTED-<KIND>]`. Earlier patterns win, so a Bearer JWT reads `[REDACTED-JWT]`. */
export function redact(text: string): string {
  return LEAK_PATTERNS.reduce((out, { kind, re }) => out.replace(new RegExp(re.source, re.flags), `[REDACTED-${kind}]`), text)
}

/** Text written by a stranger (an advisory author) is wrapped so no host mistakes it for instructions. */
export const UNTRUSTED_OPEN = '<untrusted_external_advisory_data>'
export const UNTRUSTED_CLOSE = '</untrusted_external_advisory_data>'

export function wrapUntrusted(text: string, maxChars = 1500): string {
  // Strip any closing tag inside the text, so it cannot end the wrapper early.
  const clean = text.replaceAll(UNTRUSTED_CLOSE, '').replaceAll(UNTRUSTED_OPEN, '')
  const capped = clean.length > maxChars ? `${clean.slice(0, maxChars)}…` : clean
  return `${UNTRUSTED_OPEN}${capped}${UNTRUSTED_CLOSE}`
}

/** Instruction-shaped text inside advisory data. Detection only: it decides nothing, it is reported. */
const INJECTION = /ignore (?:all |any )?(?:previous|prior|above) instructions|^\s*system\s*:|\bread \.env\b|\bgit push\b|\bnpm publish\b|\bmark (?:this|all|every)\b/im

export function looksLikeInjection(text: string): boolean {
  return INJECTION.test(text)
}

/** FL-06 §3: every brief has these five sections, in this order. */
export const BRIEF_SECTIONS = ['## 1. Verdict', '## 2. Advisory', '## 3. Exposure', '## 4. Invariants', '## 5. For Lenon'] as const

export function missingSections(markdown: string): string[] {
  return BRIEF_SECTIONS.filter((heading) => !markdown.includes(heading))
}

/** FL-06 hard limit: four tool calls per triage, counted per triage_id, failures included. */
export const MAX_TOOL_CALLS = 4

export interface CallBudget {
  /** Counts the call. Returns false when this would be call 5 or later. */
  readonly take: (triageId: string) => boolean
  readonly used: (triageId: string) => number
}

export function createCallBudget(max = MAX_TOOL_CALLS): CallBudget {
  const counts = new Map<string, number>()
  return {
    take(triageId) {
      const next = (counts.get(triageId) ?? 0) + 1
      if (next > max) return false
      counts.set(triageId, next)
      return true
    },
    used: (triageId) => counts.get(triageId) ?? 0,
  }
}

export const TRIAGE_ID = /^T-[0-9]{8}-[0-9]{2}$/
export const GHSA_ID = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/
