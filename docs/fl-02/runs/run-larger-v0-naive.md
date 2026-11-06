# v0 · Naive one-line prompt (raw output)

> Larger Claude model, fresh subagent, 2026-11-06. Verbatim; nothing edited.

---

> **Before you share this:** your raw notes contain live-looking secrets and personal data: a bearer JWT, the staging `WALLET_WEBHOOK_SECRET`, internal IPs and hostnames, a borrower phone number (MSISDN), and a partial HMAC signature. I have redacted all of them below. Treat the staging webhook secret as exposed and rotate it, since it now sits in plain-text notes.

---

# Security Vulnerability Report

## Race Condition in Payout-Status Webhook Allows Duplicate Wallet Credits

| Field | Value |
|---|---|
| **Report ID** | TBD (internal tracking ID) |
| **CVE** | None assigned. See "Open Questions" |
| **Date found** | 2026-11-03 |
| **Reporter** | JL |
| **Environment** | Staging (`payouts-stg.<redacted>`) |
| **Affected component** | `payout-gateway` v2.3.1, commit `4be81c2` |
| **Affected file** | `src/webhooks/payoutStatus.ts`, `handlePayoutStatus()` (lines 52–64) |
| **Vulnerability class** | CWE-367 Time-of-Check Time-of-Use (TOCTOU) race condition; CWE-294 Authentication Bypass by Capture-Replay |
| **Proposed severity** | **High** (business impact). CVSS v3.1 base score 6.5 (see Severity) |
| **Status** | Confirmed in staging. Not yet tested in production |

---

## 1. Summary

The wallet payout-status webhook checks whether an event was already processed. It then credits the borrower's wallet, and only after that records the event as processed. The credit call takes about 180 ms. Concurrent requests carrying the same signed event therefore all pass the duplicate check before any of them records the event. Each request then credits the wallet.

Replaying one captured `payout.reversed` delivery with 2 parallel requests credited the wallet twice in **20 out of 20** attempts. A ₱5,000.00 reversal produced a ₱10,000.00 balance. With 5 parallel requests, up to 3 credits were applied.

Three other weaknesses make this worse:
- `processed_events.event_id` has no unique constraint.
- Signed payloads have no timestamp, so a signature never expires.
- Any merchant user with the `viewer` role can download validly signed raw deliveries, including the signature header, from the provider's sandbox dashboard.

---

## 2. Technical Details

### 2.1 Vulnerable code

`src/webhooks/payoutStatus.ts`, lines 52–64:

```ts
export async function handlePayoutStatus(req: Request, res: Response) {
  const sig = req.header('X-Wallet-Signature')
  if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
  const evt = JSON.parse(req.rawBody.toString())
  if (await db.processedEvents.exists(evt.event_id)) {          // (1) CHECK
    return res.status(200).json({ status: 'duplicate_ignored' })
  }
  if (evt.type === 'payout.reversed') {
    await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id }) // (2) ACT, ~180 ms
  }
  await db.processedEvents.insert(evt.event_id)                   // (3) RECORD, too late
  return res.status(200).json({ status: 'ok' })
}
```

### 2.2 Root cause

1. **Non-atomic check-then-act.** The duplicate check (1) and the record step (3) are separate, unlocked operations, and a slow external call (2) sits between them. Request A and request B can both run step (1) before either reaches step (3).
2. **No database-level uniqueness.** `processed_events.event_id` has no `UNIQUE` constraint, confirmed with `\d processed_events`. Even the late `insert()` in step (3) succeeds for every racing request instead of failing for all but one.
3. **No idempotency on the ledger or wallet credit.** `wallet_ledger` accepted two rows with the same `ref` (`evt_01JB7K2Q8M`). This suggests there is no uniqueness on `ref` and that the wallet service does not dedupe by reference. Inferred from evidence, not checked against the schema.
4. **Replayable signatures.** The HMAC covers only the body. There is no signed timestamp or tolerance window, so a captured delivery stays valid forever.
5. **Signed deliveries are exposed.** The provider sandbox dashboard ("Download raw delivery") lets low-privilege `viewer` users download the payload and its `X-Wallet-Signature`.

---

## 3. Steps to Reproduce (staging)

**Preconditions:** a validly signed `payout.reversed` delivery, for example one downloaded from the provider sandbox dashboard. Its `event_id` must not yet be present in `processed_events`. See Open Question 1.

1. Record the target wallet's starting balance:
   ```bash
   curl -sk -H "Authorization: Bearer <REDACTED_ADMIN_TOKEN>" \
     https://<STAGING_HOST>/admin/wallets/brw_4471
   # {"borrower_id":"brw_4471","msisdn":"<REDACTED>","balance_centavos":0}
   ```
2. Confirm that sequential replay is blocked. This is the control case:
   ```bash
   curl -sk -X POST https://<STAGING_HOST>/webhooks/wallet/payout-status \
     -H "X-Wallet-Signature: <REDACTED_SIG>" -H "Content-Type: application/json" \
     --data-binary @delivery_8812.json        # {"status":"ok"}
   # repeat                                   # {"status":"duplicate_ignored"}
   ```
3. Reset the wallet and processed-event state for the test.
4. Send the same delivery twice in parallel:
   ```bash
   for i in 1 2; do
     curl -sk -X POST https://<STAGING_HOST>/webhooks/wallet/payout-status \
       -H "X-Wallet-Signature: <REDACTED_SIG>" -H "Content-Type: application/json" \
       --data-binary @delivery_8812.json &
   done; wait
   # {"status":"ok"}{"status":"ok"}
   ```
5. Check the balance again:
   ```bash
   # {"borrower_id":"brw_4471","msisdn":"<REDACTED>","balance_centavos":1000000}
   ```

**Payload used** (`delivery_8812.json`):
```json
{"event_id":"evt_01JB7K2Q8M","type":"payout.reversed","data":{"borrower_id":"brw_4471","amount_centavos":500000}}
```

---

## 4. Evidence

**Wallet balance:** `0` → `1000000` centavos (₱10,000.00) from one ₱5,000.00 (`500000` centavos) reversal.

**Ledger** (read-only `psql` query on the staging DB):
```
  id   | borrower_id | amount_centavos |      ref
-------+-------------+-----------------+---------------
 90311 | brw_4471    |          500000 | evt_01JB7K2Q8M
 90312 | brw_4471    |          500000 | evt_01JB7K2Q8M
(2 rows)
```

**Reproduction rate:**

| Parallel requests | Result |
|---|---|
| 2 | Double credit in 20/20 attempts |
| 5 | 3 credits once, 2 credits in the other attempts (total attempts not recorded) |

---

## 5. Impact

- **Direct financial loss.** Each successful race credits the full reversal amount again. Loss grows with concurrency and with the reversal amount.
- **Ledger integrity.** Duplicate ledger rows share one external reference. Reconciliation with the wallet provider will fail, and balances can no longer be trusted.
- **Possible to trigger with no attacker.** Payment providers often retry webhooks on timeout or send them at-least-once. Two overlapping legitimate deliveries of one event would produce the same double credit. *Not tested. It depends on the provider's retry behaviour.*
- **Low attacker privilege.** The signed delivery needed for the attack is available to any merchant `viewer` on the provider dashboard. No webhook secret is needed.

---

## 6. Severity

**Proposed: High** for internal prioritization, because this causes direct and repeatable monetary loss in a payout system.

**CVSS v3.1 base score (estimated): 6.5 Medium**
`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N`

| Metric | Value | Rationale |
|---|---|---|
| Attack Vector | Network | Webhook endpoint is reachable over HTTPS |
| Attack Complexity | Low | 20/20 with two simple parallel requests |
| Privileges Required | Low | Needs a provider dashboard `viewer` account to get a signed delivery |
| User Interaction | None | |
| Scope | Unchanged | |
| Confidentiality | None | |
| Integrity | High | Unauthorized changes to wallet balances and the ledger |
| Availability | None | |

**Caveat:** if exploitation in practice requires beating the provider's own first delivery (Open Question 1), Attack Complexity becomes High and the score drops to **5.3**. The score does not capture financial impact well. That is why the business severity is set higher.

---

## 7. Recommended Remediation

### 7.1 Make the dedupe atomic. Claim the event *before* acting (critical)

Add a unique constraint and claim the event with one atomic insert:

```sql
-- First remove any existing duplicates, then:
ALTER TABLE processed_events
  ADD CONSTRAINT processed_events_event_id_key UNIQUE (event_id);
```

```ts
export async function handlePayoutStatus(req: Request, res: Response) {
  const sig = req.header('X-Wallet-Signature')
  if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
  const evt = JSON.parse(req.rawBody.toString())

  // INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING event_id
  const claimed = await db.processedEvents.claim(evt.event_id) // returns false if the row already exists
  if (!claimed) return res.status(200).json({ status: 'duplicate_ignored' })

  try {
    if (evt.type === 'payout.reversed') {
      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, {
        ref: evt.event_id,
        idempotencyKey: evt.event_id, // see 7.2
      })
    }
    await db.processedEvents.markDone(evt.event_id)
    return res.status(200).json({ status: 'ok' })
  } catch (err) {
    await db.processedEvents.markFailed(evt.event_id) // allow a safe retry; see 7.2
    return res.status(500).end()
  }
}
```

Use a status column on the claim row (`processing` / `done` / `failed`). A crash between claim and credit then leaves a record that can be retried, rather than an event that is silently dropped.

### 7.2 Add idempotency at the ledger and wallet layer (critical, defence in depth)

- Add a unique constraint on `wallet_ledger (ref, entry_type)` or the equivalent, so the database rejects a second credit for the same event.
- Have the wallet service treat `ref`/`event_id` as an idempotency key and return the original result on repeat calls.

### 7.3 Add replay protection to signatures (high)

- Include a timestamp in the signed content, for example `HMAC(secret, timestamp + "." + rawBody)`, and reject requests outside a short window such as 5 minutes. This requires provider support. Check their signature scheme.
- Verify `X-Wallet-Signature` with a constant-time comparison. Confirm `verifyHmac` already does this.

### 7.4 Reduce exposure of signed deliveries (medium)

- Restrict raw-delivery downloads on the provider dashboard to admin roles, or ask the provider to strip signature headers from downloads.
- Review which merchant users hold `viewer` access.

### 7.5 Clean-up and hardening

- Validate the parsed webhook body against a schema (event type, integer `amount_centavos`, borrower ID format) before acting on it.
- Rotate the staging `WALLET_WEBHOOK_SECRET`, which was exposed in the test notes.

---

## 8. Detection and Follow-up Actions

1. **Audit production for past exploitation or accidental duplicates:**
   ```sql
   SELECT ref, borrower_id, COUNT(*) AS credits, SUM(amount_centavos) AS total_centavos
   FROM wallet_ledger
   GROUP BY ref, borrower_id
   HAVING COUNT(*) > 1;
   ```
2. **Check `src/webhooks/refundStatus.ts`** for the same check-then-act pattern. *Not yet examined.* Check every other webhook handler too.
3. **Add a regression test.** Fire N concurrent identical deliveries and assert exactly one ledger entry and one balance change.
4. **Verify the fix in staging** with the same 2-way and 5-way parallel replays.

---

## 9. Open Questions

1. **Realistic exploit window.** The parallel test ran after state was reset, with an event not yet in `processed_events`. In production, can a `viewer` download a signed delivery *before* the provider's own delivery is processed? If not, can the attacker otherwise beat it? The answer sets Attack Complexity, see Section 6.
2. **Provider retry behaviour.** Does the provider ever send overlapping or concurrent retries of the same event? If so, this bug can cause losses without any attacker.
3. **Production exposure.** Is `payout-gateway` v2.3.1 / `4be81c2`, or any version with this handler, deployed to production? Since when?
4. **CVE applicability.** CVEs are normally assigned to software distributed to third parties. If `payout-gateway` is internal only, an internal tracking ID is enough. Confirm with Kim.
5. **5-way test counts.** Record the total number of 5-way attempts so the reproduction rate is complete.

---

## 10. Timeline

| Date | Event |
|---|---|
| 2026-11-03 | Found and reproduced in staging (JL) |
| TBD | Reported to service owner |
| TBD | Fix deployed |
| TBD | Fix verified |
