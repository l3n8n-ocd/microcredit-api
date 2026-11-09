/**
 * FL-04 pipeline fixtures: 5 documented runs + a leaky self-test sample.
 *
 * Each run carries the raw input (with SYNTHETIC secrets to be scrubbed), the Step 2 synthesis handoff,
 * and the Step 3/4 final advisory (redacted). run-pipeline-verify.mjs asserts every advisory passes the
 * redaction + 6-section + CVSS + diff gate. Nothing here is a real credential.
 */

/** A deliberately leaky string: the redaction gate must catch every one of these. */
export const LEAKY_SELF_TEST = [
  'export TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzdmMtb3BzIn0.U1lOVEhFVElDLU5PVC1SRUFM',
  'curl -H "Authorization: Bearer stg_live_abc123def456ghi" https://10.42.0.19:8443/admin',
  'x-maya-sig: 3c1f0b9d8e2a4c6f1b0d8e2a4c6f1b0d8e2a4c6f1b0d8e2a4c6f1b0d8e2a4c6f',
  'msisdn 09175550142, secret whsec_9f2c4e71b8d03a56',
].join('\n')

export const RUNS = [
  {
    id: 'RUN-1',
    title: 'Node2Shell (CVE-2026-111497) — Brotli decoder out-of-bounds write',
    score: '8.1',
    severity: 'High',
    vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H',
    raw: '# container repro, node:24.22.0\n$ curl -H "Content-Encoding: br" --data-binary @payload.br https://10.42.0.23:3000/upload\nSegmentation fault (core dumped)\n# deps/brotli/c/dec/decode.c DecodeBlockTypeAndLength() returns "need more bytes" on impossible block switch',
    handoff: {
      untrusted_source: 'Attacker-controlled Brotli stream (Content-Encoding: br request body, or fetch() response)',
      vulnerable_sink: 'DecodeBlockTypeAndLength() in deps/brotli/c/dec/decode.c — write past an 8-byte staging buffer',
      broken_invariant: 'A malformed block switch must be a format error, not "need more bytes" (CWE-252 → CWE-787)',
      secret_inventory: [{ type: 'internal IP', notesLine: 2, placeholder: '<REDACTED_IP>' }],
      cvss_evidence: 'AV:N (br bodies reach the decoder), AC:H (crafted stream + heap state), C/I/A:H (memory corruption → RCE)',
    },
    advisory: `# Node2Shell: Brotli decoder out-of-bounds write (CVE-2026-111497)

## 1. Metadata & CVSS v3.1
- **Affected:** the Brotli decoder compiled into Node.js (< 22.23.4 / 24.22.1 / 26.12.1).
- **CWE:** CWE-787 (out-of-bounds write), CWE-252 (unchecked return value).
- **CVSS v3.1 vector:** \`CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H\`
- **Base score:** 8.1 (High). Discovery credit is other researchers'; this is an analysis advisory.

## 2. Executive Summary
Attacker-controlled Brotli data (an \`Content-Encoding: br\` request body, or a \`fetch()\` response) can
corrupt memory in the decoder Node.js bundles, so \`npm update\` cannot fix it. On \`node:24.22.0\` the
staging host (<REDACTED_IP>) crashed with a segfault.

## 3. Root Cause & Attack Surface
\`DecodeBlockTypeAndLength()\` reports "need more bytes" on an impossible block switch instead of a format
error, so the streaming decoder writes past an 8-byte staging buffer. Express 5 / body-parser 2 inflate
\`br\` bodies automatically, widening the surface.

## 4. Proof-of-Concept / Reproduction
Differential, sanitized: send the same malformed stream to \`node:24.22.0\` and \`node:24.22.1\`. The
patched runtime answers \`HTTP 400 (ERR_BROTLI_DECOMPRESSION_FAILED)\`; the unpatched one segfaults. No
shellcode, run on an internal-only Docker network.

## 5. Remediation Diff
\`\`\`diff
- // decode.c: impossible block switch
- return BROTLI_DECODER_NEEDS_MORE_INPUT;
+ return BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH;
\`\`\`
Primary fix: upgrade the runtime (22.23.4 / 24.22.1 / 26.12.1). Stopgap: reject \`Content-Encoding: br\`.

## 6. Secret & Factuality Audit
| Value in notes | Type | Redaction |
| --- | --- | --- |
| staging host IP | internal IP | \`<REDACTED_IP>\` |
Claims traced to the upstream fix \`google/brotli@0ed4268a\`. No CVE details invented.`,
  },
  {
    id: 'RUN-2',
    title: 'MicroCredit API — missing Idempotency-Key replay lock on concurrent disbursement',
    score: '6.5',
    severity: 'Medium',
    vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N',
    raw: '$ for i in 1 2; do curl -H "Authorization: Bearer stg_whk_9f2c4e71b8" -H "If-Match: \\"3\\"" https://10.42.0.19:8443/loans/brw_4471/disbursements & done; wait\n{"status":"ok"}{"status":"ok"}  # credited twice, brw 09175550142',
    handoff: {
      untrusted_source: 'Two concurrent same-key POSTs to /loans/:id/disbursements',
      vulnerable_sink: 'wallet.credit() runs between a non-atomic exists() check and insert()',
      broken_invariant: 'Each Idempotency-Key credits a wallet at most once',
      secret_inventory: [
        { type: 'bearer token', notesLine: 1, placeholder: '<REDACTED_JWT>' },
        { type: 'internal IP', notesLine: 1, placeholder: '<REDACTED_IP>' },
        { type: 'MSISDN', notesLine: 2, placeholder: '<BORROWER_ID>' },
      ],
      cvss_evidence: 'AC:L (two parallel curls reproduce it), PR:L (authenticated), I:H (double credit)',
    },
    advisory: `# Concurrent disbursement double-credit (MicroCredit API)

## 1. Metadata & CVSS v3.1
- **Affected:** disbursement handler, \`POST /loans/:id/disbursements\`.
- **CWE:** CWE-362 (race, check-then-act).
- **CVSS v3.1 vector:** \`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N\`
- **Base score:** 6.5 (Medium).

## 2. Executive Summary
Two concurrent same-key POSTs both passed the duplicate check and both credited the wallet. On staging,
<REDACTED_IP> credited borrower <BORROWER_ID> twice.

## 3. Root Cause & Attack Surface
\`wallet.credit()\` runs between a non-atomic \`exists()\` and \`insert()\`; \`processed_events.event_id\` has
no unique constraint. The bearer token (<REDACTED_JWT>) was a low-privilege staging credential.

## 4. Proof-of-Concept / Reproduction
Fire two identical POSTs in parallel with the same Idempotency-Key; both return \`ok\` and the ledger shows
two rows for one event. Sequential replay is correctly \`duplicate_ignored\`.

## 5. Remediation Diff
\`\`\`diff
- if (await db.processedEvents.exists(evt.event_id)) return duplicate()
- await wallet.credit(...)
- await db.processedEvents.insert(evt.event_id)
+ const claimed = await db.processedEvents.insertIfAbsent(evt.event_id) // UNIQUE(event_id)
+ if (!claimed) return duplicate()
+ await wallet.credit(...)
\`\`\`

## 6. Secret & Factuality Audit
| Value | Type | Redaction |
| --- | --- | --- |
| bearer token | credential | \`<REDACTED_JWT>\` |
| gateway IP | internal IP | \`<REDACTED_IP>\` |
| msisdn | PII | \`<BORROWER_ID>\` |
Matches \`src/features/disbursement/disbursementServer.ts\` replay-before-If-Match design.`,
  },
  {
    id: 'RUN-3',
    title: 'MicroCredit API — IEEE 754 centavo drift on a 3-way repayment split',
    score: '4.3',
    severity: 'Medium',
    vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N',
    raw: '> splitThree(100000)  // ₱1,000.00 across 3\n[33333, 33333, 33333]  // sum 99999 — 1 centavo lost; naive Math.floor(100000/3)*3',
    invariant: { total: 100000, parts: [33334, 33333, 33333] },
    handoff: {
      untrusted_source: 'Operator-entered repayment amount split 3 ways',
      vulnerable_sink: 'Math.floor(total/3) applied per share with no remainder allocation',
      broken_invariant: 'Σ parts === total (integer Centavos); 33333*3 = 99999 ≠ 100000',
      secret_inventory: [],
      cvss_evidence: 'I:L (one-centavo ledger drift, no confidentiality/availability impact)',
    },
    advisory: `# Centavo drift on a 3-way repayment split (MicroCredit API)

## 1. Metadata & CVSS v3.1
- **Affected:** repayment split utility (pre-remainder-allocation).
- **CWE:** CWE-682 (incorrect calculation).
- **CVSS v3.1 vector:** \`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N\`
- **Base score:** 4.3 (Medium).

## 2. Executive Summary
Splitting ₱1,000.00 (100000 centavos) three ways with \`Math.floor(100000/3)\` yields 33333×3 = 99999, so
the ledger loses one centavo and \`Σ debits === Σ credits\` fails.

## 3. Root Cause & Attack Surface
Floating-point / independent flooring per share with no remainder allocation. No secrets involved; the
input is operator-entered and the impact is data integrity only.

## 4. Proof-of-Concept / Reproduction
\`splitThree(100000)\` returns \`[33333, 33333, 33333]\` (sum 99999). The fix returns \`[33334, 33333, 33333]\`
(sum 100000), allocating the remainder to the first share.

## 5. Remediation Diff
\`\`\`diff
- return [0,1,2].map(() => Math.floor(total / 3))
+ const base = Math.floor(total / 3)
+ const rem = total - base * 3
+ return [0, 1, 2].map((i) => (i < rem ? base + 1 : base))
\`\`\`

## 6. Secret & Factuality Audit
No secrets in the input. Invariant checked by the runner: parts [33334, 33333, 33333] sum to 100000.`,
  },
  {
    id: 'RUN-4',
    title: 'MicroCredit API — stale If-Match bypass on UNDER_REVIEW → APPROVED',
    score: '5.3',
    severity: 'Medium',
    vector: 'CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:H/A:N',
    raw: '# two officers, both loaded v2\nofficerA: PUT /loans/L-1044 If-Match:"2" {APPROVE}   -> 200 v3\nofficerB: PUT /loans/L-1044 If-Match:"2" {REJECT}    -> 200 v3  # should be 409\n# token: Bearer stg_whk_9f2c4e71, host 10.42.0.19',
    handoff: {
      untrusted_source: 'Two officers acting on the same loan version within the race window',
      vulnerable_sink: 'State transition commits without re-reading the current version under lock',
      broken_invariant: 'A stale If-Match must be rejected with 409 VERSION_MISMATCH, no write',
      secret_inventory: [
        { type: 'bearer token', notesLine: 4, placeholder: '<REDACTED_JWT>' },
        { type: 'internal IP', notesLine: 4, placeholder: '<REDACTED_IP>' },
      ],
      cvss_evidence: 'AC:H (sub-50ms window), PR:L (officer role), I:H (conflicting terminal state)',
    },
    advisory: `# Stale If-Match concurrency bypass on underwriting (MicroCredit API)

## 1. Metadata & CVSS v3.1
- **Affected:** loan state-transition endpoint, \`PUT /loans/:id\`.
- **CWE:** CWE-367 (TOCTOU).
- **CVSS v3.1 vector:** \`CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:H/A:N\`
- **Base score:** 5.3 (Medium).

## 2. Executive Summary
Two officers who both loaded version 2 could APPROVE and REJECT the same loan; both committed to version
3 instead of the second receiving \`409\`. Reproduced via <REDACTED_IP> with token <REDACTED_JWT>.

## 3. Root Cause & Attack Surface
The transition commits without re-reading the version under a lock, so a stale \`If-Match: "2"\` wins
inside a narrow (< 50 ms) window — hence AC:H.

## 4. Proof-of-Concept / Reproduction
Issue two PUTs with the same \`If-Match: "2"\` within the window; both return \`200\`. Expected: one \`200\`,
one \`409 VERSION_MISMATCH\`.

## 5. Remediation Diff
\`\`\`diff
- const loan = await db.loans.get(id)
- if (ifMatch !== loan.version) return conflict()
- await db.loans.put(next)
+ await db.tx(async (t) => {
+   const loan = await t.loans.getForUpdate(id)
+   if (ifMatch !== loan.version) throw conflict()
+   await t.loans.put(next)
+ })
\`\`\`

## 6. Secret & Factuality Audit
| Value | Type | Redaction |
| --- | --- | --- |
| bearer token | credential | \`<REDACTED_JWT>\` |
| host IP | internal IP | \`<REDACTED_IP>\` |`,
  },
  {
    id: 'RUN-5',
    title: 'Payment callback — unverified webhook HMAC + timestamp replay (brand-new input)',
    score: '7.5',
    severity: 'High',
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N',
    raw: '$ curl -X POST https://10.42.0.19:8443/webhooks/payment \\\n  -H "x-maya-sig: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" \\\n  -H "x-maya-ts: 1699999999" --data @old_callback.json\n{"status":"accepted"}  # replayed a 3-day-old signed callback; signature never verified server-side',
    handoff: {
      untrusted_source: 'Replayed signed payment callback (captured x-maya-sig + old timestamp)',
      vulnerable_sink: 'Callback handler marks the payment settled without verifying the HMAC or the timestamp window',
      broken_invariant: 'A callback is accepted only with a valid HMAC over the body AND a timestamp inside tolerance',
      secret_inventory: [
        { type: 'HMAC signature (hex)', notesLine: 2, placeholder: '<REDACTED_SIG>' },
        { type: 'internal IP', notesLine: 1, placeholder: '<REDACTED_IP>' },
      ],
      cvss_evidence: 'AV:N, AC:L (replay the captured bytes), PR:N (no auth needed to POST), I:H (forged settlement)',
    },
    advisory: `# Unverified webhook HMAC + timestamp replay in the payment callback

## 1. Metadata & CVSS v3.1
- **Affected:** payment callback handler, \`POST /webhooks/payment\`.
- **CWE:** CWE-345 (insufficient verification of data authenticity), CWE-294 (capture-replay).
- **CVSS v3.1 vector:** \`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N\`
- **Base score:** 7.5 (High).

## 2. Executive Summary
A 3-day-old signed callback, replayed to <REDACTED_IP>, was accepted and marked a payment settled: the
handler never verified the HMAC (<REDACTED_SIG>) or the timestamp window.

## 3. Root Cause & Attack Surface
The handler trusts \`x-maya-sig\` without recomputing the HMAC over the raw body, and ignores \`x-maya-ts\`,
so any captured callback replays indefinitely. No authentication is needed to POST — hence PR:N.

## 4. Proof-of-Concept / Reproduction
Re-POST a captured signed callback with its original \`x-maya-sig\` and an old \`x-maya-ts\`; the handler
returns \`accepted\`. Expected: \`401\` (bad signature) or \`409\` (stale timestamp).

## 5. Remediation Diff
\`\`\`diff
- // trusts the header
- markSettled(body.paymentId)
+ const expected = hmacSha256(rawBody, process.env.WEBHOOK_HMAC_SECRET)
+ if (!timingSafeEqual(header('x-maya-sig'), expected)) return res.status(401).end()
+ if (Math.abs(now - Number(header('x-maya-ts'))) > TOLERANCE_S) return res.status(409).end()
+ markSettled(body.paymentId)
\`\`\`

## 6. Secret & Factuality Audit
| Value in notes | Type | Redaction |
| --- | --- | --- |
| x-maya-sig | HMAC signature | \`<REDACTED_SIG>\` |
| host IP | internal IP | \`<REDACTED_IP>\` |
The raw hex signature first read as a commit hash; the Step 4 rule now flags 64-hex HMACs (see §5).`,
  },
]
