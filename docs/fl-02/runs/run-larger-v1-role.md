# v1 · + Role Assignment (raw output)

> Larger Claude model, fresh subagent, 2026-11-06. Verbatim; nothing edited.

---

**Before you share this, read the redaction note.** Your notes contain live-looking secrets and personal data. I left them out of the report below:

| Removed from notes | Why | Action |
|---|---|---|
| Bearer JWT (`sub: svc-ops-console`, `role: payout_admin`) | Credential | Revoke or rotate if it was ever valid |
| `WALLET_WEBHOOK_SECRET` value (`stg_whk_…`) | HMAC signing secret | **Rotate it.** It is now in plaintext notes and in this chat |
| `X-Wallet-Signature` value | Replayable credential for this delivery | None needed once the fix ships and the secret is rotated |
| Internal hostname, `10.42.0.19`, `10.42.0.23` | Infrastructure details | Keep these in the internal ticket only |
| MSISDN `0917…` | Borrower PII (phone number) | Don't include it in any advisory |
| Borrower ID | Personal identifier | Replaced with `<BORROWER_ID>` |

---

# Security Advisory: Race Condition in Payout-Status Webhook Lets One Signed Delivery Credit a Wallet More Than Once

**Advisory ID:** TBD (internal) · **CVE:** Not assigned. Whether one applies is pending PSIRT/CNA review. This looks like an internal service, so a CVE may not apply.
**Status:** Confirmed in staging. Not fixed.
**Reported:** 2026-11-03 · **Reporter:** jl (internal)

## 1. Summary

`handlePayoutStatus` in `src/webhooks/payoutStatus.ts` uses a check-then-act pattern to deduplicate events. It checks whether `event_id` was already processed. It then credits the wallet (an awaited call to the wallet service, about 180 ms). Only after that does it record the event as processed. The `processed_events.event_id` column also has no unique constraint.

So two or more concurrent requests with the same validly signed delivery can all pass the duplicate check, and each one credits the borrower's wallet. In testing, one `payout.reversed` event for ₱5,000.00 (`500000` centavos) credited **₱10,000.00** and wrote two ledger rows with the same `ref`.

## 2. Severity (preliminary, needs maintainer confirmation)

| Item | Value |
|---|---|
| Proposed internal rating | **High**. It causes direct, repeatable financial loss and corrupts the ledger. |
| CVSS v3.1 (conservative) | `CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:H/A:N`, **5.3 (Medium)** |
| CVSS v3.1 (if the precondition is easy to meet) | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N`, **6.5 (Medium)** |

**Why the score is a range.** Exploitation needs a signed delivery whose `event_id` has **not** yet been recorded in `processed_events`. In the PoC that condition was created by resetting staging state (see §5). The score depends on how easily an attacker can meet it in production. Two open questions decide that:

- Can they race the provider's own first delivery?
- Can they catch a delivery whose first attempt failed and is waiting for retry?

The 20/20 repro rate shows the race itself is reliable once that condition is met.

Business impact is higher than the CVSS base score suggests. The same flaw can double-credit **without any attacker**: the provider may retry concurrently, or a network retry can overlap the original request.

## 3. Affected Versions

| Component | Affected | Patched |
|---|---|---|
| `payout-gateway` | `2.3.1` (commit `4be81c2`) confirmed. Other versions not tested. | None yet |
| `src/webhooks/refundStatus.ts` | **Suspected** to share the pattern. **Not verified.** | — |

Environment tested: staging only. Production exposure has not been checked.

## 4. Weaknesses

- **CWE-367**: Time-of-check Time-of-use (TOCTOU) race condition (primary)
- **CWE-362**: Concurrent execution using a shared resource with improper synchronization
- **CWE-294**: Authentication bypass by capture-replay. This is a contributing factor: there is no signed timestamp or tolerance window.

## 5. Technical Details

### Vulnerable code (`src/webhooks/payoutStatus.ts`, lines 52–64)

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
  await db.processedEvents.insert(evt.event_id)                 // (3) RECORD, too late
  return res.status(200).json({ status: 'ok' })
}
```

### Root cause

1. **Non-atomic deduplication.** Steps (1) and (3) are separate operations with a slow side effect (2) between them. Every request that reaches (1) before any request reaches (3) goes on to credit the wallet.
2. **No database guarantee.** `processed_events.event_id` has no `UNIQUE` constraint, confirmed with `\d processed_events`. Even the late inserts at (3) all succeed, so nothing fails loudly.
3. **No idempotency key on the downstream credit.** `wallet.credit` gets `ref: evt.event_id` but evidently doesn't enforce uniqueness on it: two ledger rows share the same `ref`.
4. **Contributing factor: signatures never expire.** The signed payload has no timestamp and no tolerance window. A captured delivery stays valid indefinitely. `event_id` deduplication is the only replay defense, and it is the part that fails.
5. **Contributing factor (third party, reported but not independently verified):** the provider's sandbox dashboard lets any merchant user with the `viewer` role download raw deliveries, including the `X-Wallet-Signature` header. That is how an attacker would get a validly signed request body.

### Secondary defect, same root cause (inferred from the code, not tested)

Suppose `wallet.credit` succeeds but `processedEvents.insert` throws, or the process crashes between them. The event is never recorded, so the provider's normal retry credits the wallet again.

## 6. Proof of Concept (redacted)

**Preconditions:**
- A validly signed delivery, downloaded from the provider sandbox dashboard
- Its `event_id` is absent from `processed_events`

**Step 1: A sequential replay is correctly rejected**

```console
$ curl -sk -X POST https://<PAYOUT_GW>/webhooks/wallet/payout-status \
    -H "X-Wallet-Signature: <REDACTED>" -H "Content-Type: application/json" \
    --data-binary @delivery_8812.json
{"status":"ok"}
$ # same request again
{"status":"duplicate_ignored"}
```

**Step 2: Reset test state**

The wallet and the event's processing record were reset. The exact reset commands were **not captured** in the notes and should be added before publication.

**Step 3: A parallel replay of the same delivery succeeds twice**

```console
$ for i in 1 2; do curl -sk -X POST https://<PAYOUT_GW>/webhooks/wallet/payout-status \
    -H "X-Wallet-Signature: <REDACTED>" -H "Content-Type: application/json" \
    --data-binary @delivery_8812.json & done; wait
{"status":"ok"}{"status":"ok"}
```

Payload (`delivery_8812.json`):

```json
{"event_id":"evt_01JB7K2Q8M","type":"payout.reversed","data":{"borrower_id":"<BORROWER_ID>","amount_centavos":500000}}
```

**Step 4: Confirm the double credit**

```console
$ curl -sk -H "Authorization: Bearer <REDACTED>" https://<PAYOUT_GW>/admin/wallets/<BORROWER_ID>
{"borrower_id":"<BORROWER_ID>","msisdn":"<REDACTED>","balance_centavos":1000000}

$ psql -h <DB_HOST> -U payouts_ro -c "select id, borrower_id, amount_centavos, ref from wallet_ledger where ref='evt_01JB7K2Q8M';"
  id   | borrower_id   | amount_centavos | ref
-------+---------------+-----------------+---------------
 90311 | <BORROWER_ID> |          500000 | evt_01JB7K2Q8M
 90312 | <BORROWER_ID> |          500000 | evt_01JB7K2Q8M
(2 rows)
```

**Reproducibility, as reported:**
- **2 parallel requests:** 20/20 attempts produced a double credit.
- **5 parallel requests:** some attempts produced 3 credits and others 2. The total number of attempts wasn't recorded.

**Note on the signing secret:** the PoC replays the **original** captured signature. The race needs no access to `WALLET_WEBHOOK_SECRET`. The secret was used only to re-sign test payloads during state resets.

## 7. Impact

- **Financial loss.** One reversal event can credit a borrower wallet N times. In testing that meant up to 3× with 5 concurrent requests. Funds credited in error may be withdrawn before anyone notices.
- **Ledger integrity.** `wallet_ledger` holds duplicate rows for one external event, so reconciliation against the provider will not balance.
- **Can happen without an attacker.** Concurrent provider retries or overlapping network retries can set it off by accident.
- **Who can exploit it:** anyone who can get a signed, not-yet-processed delivery. Per §5, that may include any provider-dashboard `viewer`.

## 8. Remediation

### 8.1 Primary fix: claim the event atomically before any side effect

```sql
-- Find existing duplicates first; the constraint will fail if any exist.
SELECT event_id, count(*) FROM processed_events GROUP BY event_id HAVING count(*) > 1;

ALTER TABLE processed_events
  ADD COLUMN status text NOT NULL DEFAULT 'done',      -- 'processing' | 'done'
  ADD CONSTRAINT processed_events_event_id_key UNIQUE (event_id);
```

```ts
export async function handlePayoutStatus(req: Request, res: Response) {
  const sig = req.header('X-Wallet-Signature')
  if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
  const evt = parseAndValidatePayoutEvent(req.rawBody) // schema-validate; don't trust raw JSON.parse

  // INSERT ... (event_id, status) VALUES ($1, 'processing') ON CONFLICT (event_id) DO NOTHING RETURNING event_id
  const claimed = await db.processedEvents.claim(evt.event_id)
  if (!claimed) return res.status(200).json({ status: 'duplicate_ignored' })

  try {
    if (evt.type === 'payout.reversed') {
      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, {
        ref: evt.event_id,
        idempotencyKey: evt.event_id, // wallet service must enforce this (see 8.2)
      })
    }
    await db.processedEvents.markDone(evt.event_id)
    return res.status(200).json({ status: 'ok' })
  } catch (err) {
    await db.processedEvents.release(evt.event_id) // let the provider's retry try again
    return res.status(500).end()
  }
}
```

**Trade-off.** If the process crashes after `claim` but before `release` or `markDone`, the row is stuck in `processing`. Handle it with a sweeper that releases stale `processing` rows. This is only safe because `wallet.credit` is idempotent on `event_id` (8.2). If the wallet ledger and `processed_events` live in the same database, the simpler fix is one transaction that does both the claim and the ledger insert.

### 8.2 Defense in depth: enforce uniqueness at the ledger

- The wallet service should treat `idempotencyKey` / `ref` as unique per credit operation and return the original result on a repeat.
- Add a unique constraint on `wallet_ledger` matching the posting model, e.g. `UNIQUE (ref, borrower_id, entry_type)`. Check first whether one `ref` can legitimately produce several rows, for example both sides of a double entry.

### 8.3 Hardening

- **Expiring signatures.** Ask the provider whether they support a signed timestamp (e.g. a `t=` field covered by the HMAC). If they do, reject deliveries outside a tolerance window such as 5 minutes.
- **Review sibling handlers.** Audit `src/webhooks/refundStatus.ts` and every other webhook or money-moving handler for the same check-then-act pattern.
- **Rotate the leaked secrets.** Rotate `WALLET_WEBHOOK_SECRET` (staging, and production if it is shared or derived) and revoke the bearer token from the notes.
- **Provider report.** Report to the provider that `viewer` users can download raw signed deliveries.

### 8.4 Regression test for the fix

Send N (≥ 5) concurrent requests carrying the same signed delivery. Expect:
- exactly **one** `ok`
- N−1 `duplicate_ignored`
- exactly **one** `wallet_ledger` row for the `ref`
- a balance change equal to one `amount_centavos`

Repeat for at least 50 iterations.

## 9. Workarounds (until the fix ships)

- Add the `UNIQUE (event_id)` constraint now. On its own it doesn't stop the credit, because the insert runs last. But it makes a race show up as an error instead of passing silently.
- If the wallet service supports idempotency keys, pass `event_id` as the key right away.
- Serialize webhook processing per `event_id`, e.g. with a Postgres advisory lock `pg_advisory_xact_lock(hashtext(event_id))` around check → credit → insert.

## 10. Detection: check for past exploitation

Run this in each environment, **including production**, read-only:

```sql
SELECT ref, borrower_id, count(*) AS credits, sum(amount_centavos) AS total_centavos
FROM wallet_ledger
WHERE ref LIKE 'evt_%'
GROUP BY ref, borrower_id
HAVING count(*) > 1
ORDER BY total_centavos DESC;
```

Any rows returned mean duplicate credits. Reconcile them against provider records, and recover funds through compensating entries rather than deleting rows.

## 11. Open Items (not verified; resolve before publishing)

1. Exact reset steps used before the parallel replay. They should be in the PoC.
2. Whether an attacker can get an *unprocessed* signed delivery in production. This sets the final CVSS AC/PR values.
3. Whether `refundStatus.ts` or other handlers are affected.
4. Whether the provider-dashboard `viewer` download behavior was tested directly or only assumed.
5. Total attempts in the 5-parallel test.
6. Whether production runs 2.3.1 or other affected versions, and whether §10 returns any rows there.
7. Whether a CVE applies: internal service vs. distributed software. The final severity rating goes to the reviewer.

## 12. Timeline

| Date | Event |
|---|---|
| 2026-11-03 | Issue found and reproduced in staging |
| TBD | Severity confirmed, fix developed |
| TBD | Fix deployed, regression test passing |
| TBD | Production audit (§10) completed |
| TBD | Advisory published |

## 13. Credits

Found and reproduced by jl (internal security testing, staging environment).
