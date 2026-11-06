# v4 · + Output Structure, smaller Claude model (raw output)

> Smaller, faster Claude model, fresh subagent, 2026-11-06. Verbatim; nothing edited.

---

<advisory>

## 1. Metadata & CVSS v3.1

**Advisory title:** Race condition in payout-status webhook allows duplicate wallet credit on replayed `payout.reversed` delivery

**Affected component:** `payout-gateway` webhook handler `src/webhooks/payoutStatus.ts` (`handlePayoutStatus`), route `POST /webhooks/wallet/payout-status`

**Affected versions:** `payout-gateway@2.3.1`, commit `4be81c2` (verified on staging only; other versions and production not tested)

**CWE identifiers:**
- CWE-362: Concurrent Execution using Shared Resource with Improper Synchronization (race condition, check-then-act)
- CWE-294: Authentication Bypass by Capture-replay (contributing: signed payload carries no timestamp or expiry)

**CVE:** not assigned

**CVSS v3.1 vector:** `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N`

**Base score:** 6.5, **Severity:** Medium

**Scoring rationale:**
- AV:N: the endpoint is reached over the network (staging host).
- AC:L: two concurrent requests reproduced the double credit 20 of 20 times in the notes.
- PR:L: the notes state that any merchant user with the `viewer` role can download a signed delivery, including the `X-Wallet-Signature` header. A valid signature is required to pass the HMAC check.
- UI:N: no victim interaction.
- S:U: impact stays inside the payout-gateway wallet ledger.
- C:N, I:H, A:N: the wallet balance is inflated (integrity). No confidentiality or availability impact was shown.

The researcher's note "severity: bad ... prob high" was not used. The score above is derived from the vector.

## 2. Executive Summary

The payout-gateway webhook handler for wallet status events checks whether an event was already processed, credits the wallet, and only then records the event as processed. The check and the record are not atomic, and the database has no unique constraint on the processed-event ID. When two identical deliveries of a `payout.reversed` event arrive at the same time, both pass the check and both credit the wallet.

In the staging test, a 500000-centavo (5000 PHP) reversal credited a borrower wallet twice, raising the balance from 0 to 1000000 centavos (10000 PHP). The ledger contains two rows with the same event reference. Sequential replay was correctly rejected with `duplicate_ignored`. Only concurrent replay succeeded.

The signed payload has no timestamp or expiry, so a captured delivery can be replayed indefinitely while its signature remains valid.

Scope of evidence: staging only. No production impact was tested or shown. The same pattern may exist in the refund webhook (`src/webhooks/refundStatus.ts`); this was not checked.

## 3. Root Cause & Attack Surface

**Root cause:** check-then-act race in `src/webhooks/payoutStatus.ts`:

- Line 56: `db.processedEvents.exists(evt.event_id)` checks for a prior run.
- Line 60: `wallet.credit(...)` runs the side effect. The notes show this call takes about 180 ms because it calls the wallet service.
- Line 62: `db.processedEvents.insert(evt.event_id)` records the event only after the credit.

Two requests that both run line 56 before either reaches line 62 both pass the check. The `processed_events.event_id` column has no unique constraint, so the database does not stop the second insert either.

**Attack surface:**
- The HMAC check (line 54) verifies the body, not freshness. The same bytes with the same signature are accepted again.
- The signed delivery is obtainable by a low-privilege merchant user (`viewer` role) through the provider sandbox dashboard, per the notes.
- No nonce, timestamp, or tolerance window is checked.

## 4. Deterministic PoC Reproduction

The race is timing-dependent. The notes report 20 of 20 double credits with two concurrent requests. Five concurrent requests produced three credits in one run and two credits in other runs. The steps below use placeholders for all sensitive values (see Section 6).

**Preconditions (staging only):**
- A captured signed delivery saved as `delivery.json`, with its signature in `SIG`.
- The wallet balance for the affected borrower is known before the test (0 in the notes).

**Step 1: sequential replay (expected: second request rejected)**

```bash
SIG=<REDACTED_SIGNATURE>
curl -sk -X POST "https://192.0.2.10:8443/webhooks/wallet/payout-status" -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery.json
# expected: {"status":"ok"}
curl -sk -X POST "https://192.0.2.10:8443/webhooks/wallet/payout-status" -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery.json
# expected: {"status":"duplicate_ignored"}
```

**Step 2: concurrent replay (observed: both credited)**

Reset the wallet to the starting balance before this step. Then run:

```bash
SIG=<REDACTED_SIGNATURE>
for i in 1 2; do curl -sk -X POST "https://192.0.2.10:8443/webhooks/wallet/payout-status" -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery.json & done; wait
# observed: {"status":"ok"}{"status":"ok"}
```

**Step 3: verify the balance**

```bash
curl -sk -H "Authorization: Bearer <REDACTED_JWT>" "https://192.0.2.10:8443/admin/wallets/<BORROWER_ID>"
# observed: balance_centavos 1000000 (expected 500000)
```

**Step 4: verify the ledger**

```sql
select id, borrower_id, amount_centavos, ref from wallet_ledger where ref = '<EVENT_ID>';
-- observed: 2 rows, each amount_centavos 500000
```

**Making the test deterministic (TODO, not run):** inject a fixed delay into `wallet.credit` in a test environment, or use a test that pauses one request between the `exists()` call and the `insert()` call. Neither was done in the notes. Add this as a failing test before the fix (see Section 5).

## 5. Unified Remediation Diff

This diff is proposed, not applied or tested. It assumes `db.processedEvents.insertIfAbsent` is available (returns `true` only when the row was inserted). Confirm the method name and the database API before merging.

```diff
--- a/src/webhooks/payoutStatus.ts
+++ b/src/webhooks/payoutStatus.ts
@@ export async function handlePayoutStatus(req: Request, res: Response) {
   const sig = req.header('X-Wallet-Signature')
   if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
   const evt = JSON.parse(req.rawBody.toString())
-  if (await db.processedEvents.exists(evt.event_id)) {
+  // Claim the event atomically before any side effect. The UNIQUE constraint
+  // makes exactly one concurrent request win the claim.
+  const claimed = await db.processedEvents.insertIfAbsent(evt.event_id)
+  if (!claimed) {
     return res.status(200).json({ status: 'duplicate_ignored' })
   }
   if (evt.type === 'payout.reversed') {
-    await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
+    try {
+      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
+    } catch (err) {
+      // Release the claim so the provider's retry can credit again.
+      await db.processedEvents.delete(evt.event_id)
+      throw err
+    }
   }
-  await db.processedEvents.insert(evt.event_id)
   return res.status(200).json({ status: 'ok' })
 }
```

Required migration (not in the diff):

```sql
ALTER TABLE processed_events ADD CONSTRAINT processed_events_event_id_key UNIQUE (event_id);
```

**Known gaps in this fix:**
- A crash after the claim and before the credit leaves the event marked as processed with no credit. Closing this gap requires the wallet service to reject a second credit for the same `ref` (for example, a unique constraint on `wallet_ledger` for `ref` and entry type). This was not verified.
- Signed payloads have no timestamp. Adding a timestamp inside the signed body and a tolerance window needs a change on the provider side. This is a separate fix.
- Rotate `WALLET_WEBHOOK_SECRET` on staging, because its value appeared in the source notes.
- Check `src/webhooks/refundStatus.ts` for the same check-then-act pattern. Not checked.

**Failing-first test (TODO):** a concurrency test that sends two identical deliveries at once with a delayed `wallet.credit` stub, and asserts one ledger row. It must fail on the current code and pass after the change.

## 6. Secret & Factuality Audit Table

**Sensitive values found in the notes and how they were redacted:**

| Value in notes | Type | Redaction in advisory |
| --- | --- | --- |
| Bearer JWT (`export TOKEN=...`) | Credential | `<REDACTED_JWT>` |
| JWT payload fields (service account subject, environment, role) | Internal identity | Omitted |
| `payouts-stg.int.lending.local` | Internal hostname | `api.example.test` (used as host in examples; the advisory uses the IP form below for the curl commands) |
| `10.42.0.19:8443` (gateway, 3 occurrences) | Internal IP | `192.0.2.10:8443` (RFC 5737) |
| `10.42.0.23` (database host) | Internal IP | Omitted; not needed for the PoC |
| `payouts_ro` (database user) | Database account | Omitted |
| `WALLET_WEBHOOK_SECRET=stg_whk_...` | Secret | Omitted; rotation recommended |
| `09175550142` (`msisdn`) | Personal data (phone number) | Omitted |
| `brw_4471` (`borrower_id`) | Borrower identifier | `<BORROWER_ID>` |
| `sha256=3c1f0b...` and `$SIG` value | Request signature | `<REDACTED_SIGNATURE>` |
| `evt_01JB7K2Q8M` (`event_id`) | Provider event reference | `<EVENT_ID>` |
| Ledger row IDs `90311`, `90312` | Internal record IDs | Omitted |
| Reviewer initials and a named person in the notes | Personal data | Omitted |
| `delivery_8812.json` file name | Internal artifact name | Omitted |

**Claims in the advisory and their support in the notes:**

| Claim | Support in notes | Status |
| --- | --- | --- |
| Affected version `payout-gateway@2.3.1`, commit `4be81c2` | Header: "version: payout-gateway@2.3.1 (package.json), commit 4be81c2" | Supported |
| Staging environment only | Header: "(staging)" and staging hostname | Supported |
| Sequential replay returns `duplicate_ignored` | Second sequential curl output | Supported |
| Concurrent replay credits twice; balance 0 to 1000000 centavos | Parallel curl output and balance check | Supported |
| Two ledger rows with the same `ref` | `psql` output, 2 rows | Supported |
| 20 of 20 double credits with two concurrent requests | "repro rate: 20/20 with 2 parallel curls" | Supported (staging only, single run series) |
| Five concurrent requests produced 3 credits in one run and 2 in others | "with 5 parallel -> got 3 credits once, 2 credits other times" | Supported as written; exact counts not re-run |
| Check at line 56, credit at line 60, insert at line 62 in `src/webhooks/payoutStatus.ts` | `sed -n '52,64p'` output | Supported |
| `processed_events.event_id` has no unique constraint | "checked \d processed_events" | Supported |
| No timestamp or tolerance; signature never expires | "no timestamp in the signed payload / no tolerance window" | Supported |
| A `viewer`-role merchant user can download signed deliveries including the signature header | "any merchant user w/ 'viewer' role can download these, incl the X-Wallet-Signature header" | Supported as stated by the researcher; not re-tested |
| Credit call takes about 180 ms | "await ~180ms, calls wallet svc" | Supported as stated; not measured here |
| Refund webhook has the same pattern | "prob has same pattern?? didnt check" | Not supported; listed as unverified |
| Production impact | None in notes | Not claimed |
| CVE identifier | "CVE?? ask kim" | Not assigned; "CVE: not assigned" used |
| Severity 6.5 Medium | Computed from the CVSS vector in Section 1 | Derived, not from notes |
| Remediation diff correctness | None in notes | Proposed, untested |

</advisory>
