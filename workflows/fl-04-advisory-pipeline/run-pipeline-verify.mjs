#!/usr/bin/env node
/**
 * FL-04 · Automated Critic & Redaction Gate (Step 4 of the advisory pipeline), made executable.
 *
 * Zero dependencies. Run:  node workflows/fl-04-advisory-pipeline/run-pipeline-verify.mjs
 *
 * The LLM steps (1 Source-Ground, 2 Synthesize, 3 Draft) are documented as prompts in
 * docs/FL-04_AUTOMATION_WORKFLOW.md. This runner is the DETERMINISTIC Step 4: it validates each run's
 * synthesis handoff schema, then runs the publication gate on the final advisory:
 *   - redaction: no raw JWT, RFC1918 IP, Bearer token, secret prefix, sha256 HMAC, or MSISDN leaks;
 *   - completeness: all 6 required advisory sections present;
 *   - CVSS: the stated base score equals the score recomputed from the vector (CVSS v3.1 spec);
 *   - remediation: a unified diff with - and + lines;
 *   - invariant: where a run declares one (e.g. centavo split), parts sum to the total.
 * It also self-tests that the redaction gate CATCHES a deliberately leaky sample.
 * Any failure prints the reason and exits non-zero (usable as a CI gate).
 *
 * Every secret in the fixtures is SYNTHETIC (RFC 5737 / obviously-fake), never a real credential.
 */

// ─── CVSS v3.1 base score (spec, Appendix A) ─────────────────────────────────
const W = { AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }, AC: { L: 0.77, H: 0.44 }, UI: { N: 0.85, R: 0.62 }, CIA: { H: 0.56, L: 0.22, N: 0 } }
const PR = { U: { N: 0.85, L: 0.62, H: 0.27 }, C: { N: 0.85, L: 0.68, H: 0.5 } }
const roundup = (v) => { const i = Math.round(v * 100000); return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10 }
function cvssBaseScore(vector) {
  const m = Object.fromEntries(vector.split('/').slice(1).map((p) => p.split(':')))
  const iss = 1 - (1 - W.CIA[m.C]) * (1 - W.CIA[m.I]) * (1 - W.CIA[m.A])
  const impact = m.S === 'U' ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
  const exploit = 8.22 * W.AV[m.AV] * W.AC[m.AC] * PR[m.S][m.PR] * W.UI[m.UI]
  if (impact <= 0) return 0
  return m.S === 'U' ? roundup(Math.min(impact + exploit, 10)) : roundup(Math.min(1.08 * (impact + exploit), 10))
}
const VECTOR_RE = /CVSS:3\.1\/AV:[NALP]\/AC:[LH]\/PR:[NLH]\/UI:[NR]\/S:[UC]\/C:[NLH]\/I:[NLH]\/A:[NLH]/

// ─── Redaction scanners (the leak patterns the gate forbids in a final advisory) ──
const LEAK_PATTERNS = [
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/ },
  { name: 'RFC1918 IP', re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/ },
  { name: 'Bearer token', re: /Bearer\s+[A-Za-z0-9._-]{10,}/i },
  { name: 'Secret prefix', re: /\b(?:sk-ant-|sk_live_|whsec_|stg_whk_)[A-Za-z0-9_-]{6,}/ },
  { name: 'SHA-256 HMAC', re: /\b[0-9a-f]{64}\b/ },
  { name: 'MSISDN', re: /\b09\d{9}\b/ },
]
function scanLeaks(text) {
  return LEAK_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name)
}

// ─── Advisory completeness gate ──────────────────────────────────────────────
const SECTION_RES = [
  { label: '1 Metadata & CVSS', re: /## 1\. Metadata & CVSS v3\.1/ },
  { label: '2 Executive Summary', re: /## 2\. Executive Summary/ },
  { label: '3 Root Cause', re: /## 3\. Root Cause & Attack Surface/ },
  { label: '4 PoC/Reproduction', re: /## 4\. (?:Proof-of-Concept|PoC).*Reproduction/i },
  { label: '5 Remediation Diff', re: /## 5\. Remediation Diff/ },
  { label: '6 Audit', re: /## 6\. Secret & Factuality Audit/ },
]
function checkSections(md) {
  return SECTION_RES.filter((s) => !s.re.test(md)).map((s) => s.label)
}
function checkDiff(md) {
  const block = md.match(/```diff\n([\s\S]*?)```/)
  if (!block) return 'no ```diff block'
  const body = block[1]
  if (!/\n-/.test('\n' + body) || !/\n\+/.test('\n' + body)) return 'diff has no - / + lines'
  return null
}
function checkCvss(md) {
  const v = md.match(VECTOR_RE)
  if (!v) return 'no valid CVSS:3.1 vector'
  const stated = md.match(/Base score:\*\*\s*([0-9]+(?:\.[0-9])?)/)
  if (!stated) return 'no stated base score'
  const computed = cvssBaseScore(v[0])
  if (Number(stated[1]) !== computed) return `stated ${stated[1]} ≠ computed ${computed} for ${v[0]}`
  return null
}

const HANDOFF_KEYS = ['untrusted_source', 'vulnerable_sink', 'broken_invariant', 'secret_inventory', 'cvss_evidence']
function checkHandoff(h) {
  const missing = HANDOFF_KEYS.filter((k) => h[k] === undefined || h[k] === '')
  if (missing.length) return `missing handoff keys: ${missing.join(', ')}`
  if (!Array.isArray(h.secret_inventory)) return 'secret_inventory must be an array'
  return null
}

// ─── Fixtures: 5 runs. Raw inputs carry SYNTHETIC secrets; final advisories are redacted. ──
import { RUNS, LEAKY_SELF_TEST } from './runs.mjs'

function verifyRun(run) {
  const errors = []
  const h = checkHandoff(run.handoff)
  if (h) errors.push(`handoff: ${h}`)
  const leaks = scanLeaks(run.advisory)
  if (leaks.length) errors.push(`redaction: leaked ${leaks.join(', ')}`)
  const missing = checkSections(run.advisory)
  if (missing.length) errors.push(`sections missing: ${missing.join(', ')}`)
  const diff = checkDiff(run.advisory)
  if (diff) errors.push(`diff: ${diff}`)
  const cvss = checkCvss(run.advisory)
  if (cvss) errors.push(`cvss: ${cvss}`)
  if (run.invariant) {
    const sum = run.invariant.parts.reduce((a, b) => a + b, 0)
    if (sum !== run.invariant.total) errors.push(`invariant: parts sum ${sum} ≠ total ${run.invariant.total}`)
  }
  return errors
}

function main() {
  let failed = false
  console.log('FL-04 · Advisory pipeline verification (Step 4 gate)\n' + '─'.repeat(64))

  // Negative self-test: the gate must catch a planted leak, or it is a no-op.
  const caught = scanLeaks(LEAKY_SELF_TEST)
  console.log(`self-test · redaction gate on a leaky sample: caught [${caught.join(', ')}] (expected ≥1) ${caught.length >= 1 ? '✓' : '✗ GATE IS A NO-OP'}`)
  if (caught.length < 1) failed = true
  console.log('─'.repeat(64))

  for (const run of RUNS) {
    const errors = verifyRun(run)
    const ok = errors.length === 0
    failed ||= !ok
    console.log(`${ok ? '✓ PASS' : '✗ FAIL'}  ${run.id}  ${run.score} ${run.severity} · ${run.title}`)
    for (const e of errors) console.log(`        - ${e}`)
  }

  console.log('─'.repeat(64))
  const passes = RUNS.filter((r) => verifyRun(r).length === 0).length
  console.log(`${passes}/${RUNS.length} runs pass the redaction + completeness + CVSS gate.`)
  if (failed) {
    console.error('\nGATE FAILED — not publication-ready.')
    process.exit(1)
  }
  console.log('All runs are publication-ready (deterministic gate only; a human still signs off — see §5).')
}

main()
