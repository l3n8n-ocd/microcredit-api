# Template · Section 4 template, filled, smaller Claude model (raw output)

> Smaller, faster Claude model, fresh subagent, 2026-11-06. Prompt: `docs/fl-02/prompts/prompt-template-filled.txt`. Verbatim; nothing edited.

---

<scratchpad>
Step 1: Sensitive values in the notes, by type and notes line (line 1 = the "## notes" header). Original values are not written here.
- Internal hostname (notes 2): api.example.test
- Internal IP, application host (notes 2, 6, 16, 18, 23, 25): 192.0.2.19
- Internal IP, database host (notes 2, 29): 192.0.2.23
- Bearer JWT in TOKEN variable (notes 5; reused notes 6, 25): <REDACTED_JWT>
- Literal X-Wallet-Signature value, partial (notes 13): <REDACTED_SECRET>
- Wallet webhook secret from staging .env (notes 21): <REDACTED_SECRET>
- Database username (notes 29): <REDACTED_DB_USER>
- Borrower account ID, personal-data linkage (notes 6, 7, 12, 25, 26, 32, 33): <REDACTED_BORROWER_ID>
- Phone number, MSISDN (notes 7): <REDACTED_MSISDN>
- Author initials (notes 1) and a person's first name (notes 58): <REDACTED_NAME>
- Kept, not sensitive: provider event ID (needed for reproduction), commit hash, package version, amounts in centavos, file paths.
- The signed body contains the borrower ID, so the redacted body will not verify. The PoC must use the original captured bytes.

Step 2: Trace. Untrusted input is the HTTP body and X-Wallet-Signature header (code lines 53-55). The HMAC check passes for any copy of a validly signed body. The sink is wallet.credit (code line 60), which takes the amount from the body. The invariant that breaks is "each event_id credits a wallet at most once." The gap is the window between the exists() check (line 56) and insert() (line 62), which spans an await of about 180 ms (notes 54).

Step 3: CVSS v3.1. AV:N (endpoint reached over the network; production reachability is not shown, so this is an assumption). AC:L (20/20 with two parallel requests, notes 36). PR:L (signed deliveries are obtained through a viewer-role merchant account, notes 9-10). UI:N. S:U. C:N (the replay discloses nothing). I:H (balance credited twice, notes 26-27). A:N. Base score: ISS = 0.56, Impact = 6.42 x 0.56 = 3.595, Exploitability = 8.22 x 0.85 x 0.77 x 0.62 x 0.85 = 2.835, sum 6.43, rounded up to 6.5 (Medium). If PR were N, the score would be 7.5 (High). The notes say "prob high", but they show no unauthenticated source for the delivery, so Medium is used.

Step 4: Claim check. Dropped: CVE (not assigned in the notes), the refund handler as a finding (only a guess at notes 58, so it is listed as not assessed), the "high" severity label (not supported by the vector), and any production exposure or deployed-version claim (notes 3 gives the package.json version only). Flagged: the reset step between the sequential and parallel tests (notes 21-22) has no commands in the notes, so the balance and ledger results depend on an undocumented state reset.
</scratchpad>

<advisory>
# Concurrent replay of a signed payout.reversed webhook double-credits a borrower wallet

## 1. Metadata & CVSS v3.1

- **Advisory title:** Concurrent replay of a signed `payout.reversed` webhook double-credits a borrower wallet
- **Affected component:** `handlePayoutStatus` in `src/webhooks/payoutStatus.ts`, route `POST /webhooks/wallet/payout-status` (notes 16, 40-52)
- **Affected versions:** payout-gateway 2.3.1, commit `4be81c2`, version from `package.json` (notes 3). The deployed build was not verified. Other versions were not tested.
- **CWE:** CWE-362 (race condition on a shared resource), CWE-367 (time-of-check to time-of-use), CWE-294 (capture-replay; the signed payload has no timestamp and never expires)
- **CVE:** not assigned
- **CVSS v3.1 vector:** `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N`
- **Base score:** 6.5, Medium

Metric basis:
- AV:N: the endpoint was reached over the network (notes 6, 16). Production exposure is not shown in the notes and is assumed.
- AC:L: the race reproduced 20/20 with two parallel requests and "nothing special" (notes 36).
- PR:L: signed deliveries were obtained through a merchant account with the `viewer` role (notes 9-10).
- S:U, C:N, I:H, A:N: the replay discloses no data. The wallet balance was credited twice (notes 26-27).

Scoring sensitivity: if a signed delivery could be obtained without an account (PR:N), the base score would be 7.5 (High). The notes do not show such a source.

## 2. Executive Summary

In payout-gateway 2.3.1 (per `package.json`), the wallet status webhook credits a borrower wallet for a `payout.reversed` event when two copies of the same signed request arrive at the same time. A sequential replay is rejected with `duplicate_ignored` (notes 16-19). A parallel replay is not. In the reported test, a reversal of 500000 centavos (₱5,000.00) raised the wallet balance to 1000000 centavos (₱10,000.00), and the ledger holds two rows with the same `ref` (notes 25-27, 29-34).

The cause is that the duplicate check, the credit, and the record are separate steps, with a network call of about 180 ms between the check and the record (notes 44-50, 54). The processed-event table has no unique constraint (notes 55), and the signature has no timestamp and never expires (notes 56). Any captured signed body therefore stays replayable.

Fix: claim the `event_id` atomically before crediting, add a unique constraint, make the wallet credit idempotent by reference, and add a signed timestamp with a tolerance window. See section 5.

## 3. Root Cause & Attack Surface

**Root cause.** In `src/webhooks/payoutStatus.ts` (notes 40-52):
- Line 56: `db.processedEvents.exists(evt.event_id)` is the duplicate check (notes 44).
- Line 60: `wallet.credit(...)` is a network call to the wallet service and takes about 180 ms (notes 48, 54).
- Line 62: `db.processedEvents.insert(evt.event_id)` records the event (notes 50).

Two requests with the same `event_id` can both pass line 56 before either reaches line 62. Nothing enforces uniqueness. `processed_events.event_id` has no unique constraint (notes 55). The `wallet_ledger` table holds two rows with the same `ref` (notes 29-34), so it does not enforce uniqueness on `ref` either.

**Trace.**
- Untrusted input: the HTTP body and the `X-Wallet-Signature` header (lines 53-55).
- Check: `verifyHmac` on the raw body (line 54). Any copy of a validly signed body passes.
- Sink: `wallet.credit` (line 60), with the amount taken from the body (`evt.data.amount_centavos`).
- Broken invariant: each `event_id` credits a wallet at most once.

**Replay.** The signature is an HMAC over the raw body. It has no timestamp, no tolerance window, and no expiry (notes 56). A captured body stays valid indefinitely. The duplicate check blocks a sequential replay (notes 16-19). The race defeats the check.

**Attacker prerequisite.** The signed delivery, including the `X-Wallet-Signature` header, can be downloaded from the provider sandbox dashboard by any merchant user with the `viewer` role (notes 9-10). The notes show no other source.

**Not assessed.** `src/webhooks/refundStatus.ts` may have the same pattern (notes 58). It was not checked.

**Out of scope.** The notes show a bearer token used against an `/admin/` endpoint, which returned a phone number (notes 5-7). That is not analyzed here and should be reviewed separately.

## 4. Deterministic PoC Reproduction

The race is reliable in occurrence but not fixed in count. In 20/20 runs with two parallel requests, both returned `ok` (notes 36). In a five-request run the notes record 2 or 3 credits per run (notes 37).

**Preconditions**
- Staging deployment of payout-gateway 2.3.1 (notes 2-3).
- A captured signed delivery with its original raw body bytes (notes 9-13). The redacted body in this advisory will not pass HMAC verification.
- The processed-event record and the wallet balance must be reset before the parallel run. The notes mention a reset (notes 21-22) but do not show the commands. This step is undocumented and must be defined before the test is repeated.

**Steps**

```bash
BASE="https://api.example.test:8443"
SIG="<REDACTED_SECRET>"   # X-Wallet-Signature captured with the delivery
URL="$BASE/webhooks/wallet/payout-status"

# 1. Sequential replay. Expected: "ok", then "duplicate_ignored" (matches notes 16-19).
curl -sk -X POST "$URL" -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery.json
curl -sk -X POST "$URL" -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery.json

# 2. Reset the processed-event record and the wallet balance (not documented in the notes).

# 3. Parallel replay of the same delivery.
for i in 1 2; do curl -sk -X POST "$URL" -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery.json & done; wait

# 4. Check the balance and the ledger rows for the event.
curl -sk -H "Authorization: Bearer <REDACTED_JWT>" "$BASE/admin/wallets/<REDACTED_BORROWER_ID>"
psql -h <REDACTED_DB_HOST> -U <REDACTED_DB_USER> -c "select id, borrower_id, amount_centavos, ref from wallet_ledger where ref='evt_01JB7K2Q8M';"
```

**Expected (fixed) vs observed (2.3.1)**

| Check | Expected after fix | Observed on 2.3.1 (notes) |
| --- | --- | --- |
| Responses to two parallel requests | one `ok`, one `duplicate_ignored` | two `ok` (notes 24) |
| Wallet balance after parallel run | +500000 centavos | 1000000 centavos (notes 25-27) |
| `wallet_ledger` rows for the `ref` | 1 | 2 (notes 30-34) |

The post-test balance of 1000000 equals two credits from zero. That assumes the undocumented reset cleared both the balance and the processed-event record (notes 21-22).

## 5. Unified Remediation Diff

This diff has not been applied or run. No test covers it yet.

```diff
--- a/src/webhooks/payoutStatus.ts
+++ b/src/webhooks/payoutStatus.ts
@@ -56,7 +56,7 @@ export async function handlePayoutStatus(req: Request, res: Response) {
-  if (await db.processedEvents.exists(evt.event_id)) {
-    return res.status(200).json({ status: 'duplicate_ignored' })
-  }
-  if (evt.type === 'payout.reversed') {
-    await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
-  }
-  await db.processedEvents.insert(evt.event_id)
+  const claimed = await db.processedEvents.insertIfAbsent(evt.event_id)
+  if (!claimed) {
+    return res.status(200).json({ status: 'duplicate_ignored' })
+  }
+  if (evt.type === 'payout.reversed') {
+    await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
+  }
```

Follow-up items (none tested):
1. Add a `UNIQUE` constraint on `processed_events(event_id)`. `insertIfAbsent` must use `INSERT ... ON CONFLICT DO NOTHING` and return whether a row was inserted.
2. Trade-off: if `wallet.credit` fails after the claim, the event is marked processed but never credited. Add a compensation path, such as releasing the claim on failure or a status column with retry.
3. The wallet service must also dedupe. `wallet_ledger` accepted two rows with the same `ref` (notes 30-34), so add a unique key on `(ref, entry type)` or make the credit call idempotent by `event_id`.
4. Add a signed timestamp and reject events outside a tolerance window (notes 56).
5. Review `src/webhooks/refundStatus.ts` for the same pattern (notes 58).

## 6. Secret & Factuality Audit Table

| Sensitive value (type) | Notes line(s) | Placeholder used |
| --- | --- | --- |
| Internal hostname | 2 | `api.example.test` |
| Internal IP, application host | 2, 6, 16, 18, 23, 25 | `192.0.2.19` (host shown as `api.example.test` in steps) |
| Internal IP, database host | 2, 29 | `<REDACTED_DB_HOST>` / `192.0.2.23` |
| Bearer JWT | 5 (used 6, 25) | `<REDACTED_JWT>` |
| Signature value (literal, partial) | 13 | `<REDACTED_SECRET>` |
| Wallet webhook secret | 21 | `<REDACTED_SECRET>` (not written in the advisory) |
| Database username | 29 | `<REDACTED_DB_USER>` |
| Borrower account ID (personal-data linkage) | 6, 7, 12, 25, 26, 32, 33 | `<REDACTED_BORROWER_ID>` |
| Phone number (MSISDN) | 7 | `<REDACTED_MSISDN>` |
| Author initials; a person's first name | 1; 58 | `<REDACTED_NAME>` |

Kept, not sensitive: provider event ID `evt_01JB7K2Q8M` (notes 12, 29-34; required for reproduction), commit `4be81c2` and version `2.3.1` (notes 3), amounts in centavos (notes 12, 26, 33).

**Claims and supporting notes lines**

1. payout-gateway version 2.3.1 and commit `4be81c2`: notes 3.
2. Endpoint `POST /webhooks/wallet/payout-status`: notes 16.
3. A sequential replay returns `ok`, then `duplicate_ignored`: notes 16-19.
4. Two parallel requests with the same body both returned `ok`: notes 23-24.
5. The balance after the parallel run is 1000000 centavos for a 500000 reversal: notes 25-27.
6. The ledger holds two rows with the same `ref`: notes 29-34.
7. 20/20 with two parallel requests: notes 36.
8. Five parallel requests gave 2 or 3 credits per run: notes 37.
9. The duplicate check is on line 56, the credit on line 60, and the insert on line 62: notes 44, 48, 50.
10. The `wallet.credit` call takes about 180 ms: notes 54.
11. `processed_events.event_id` has no unique constraint: notes 55.
12. The signature has no timestamp, no tolerance window, and no expiry: notes 56.
13. Signed deliveries, including `X-Wallet-Signature`, are downloadable by a merchant user with the `viewer` role: notes 9-10.
14. The refund webhook was not checked: notes 58.
15. No CVE is assigned: notes 58 (no CVE in the notes).
16. The reset between the sequential and parallel tests occurred, but its commands are not shown: notes 21-22.
17. A bearer token was used against an `/admin/` endpoint, which returned a phone number: notes 5-7.
</advisory>
