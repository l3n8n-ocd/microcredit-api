# v5 · + Step Decomposition, smaller Claude model (raw output)

> Smaller, faster Claude model, fresh subagent, 2026-11-06. Same prompt as v5. Verbatim; nothing edited.

---

<scratchpad>
Step 1 (secrets and identifiers): bearer token (L43), webhook signing secret (L59), signature value (L51), staging hostname and two internal IPs (L40-41, L44), DB user (L67), MSISDN (L45), borrower ID (L44, L50, L63), event ID (L50), ledger row IDs (L70-71), staff initials and a first name (L39, L96). Redacted per the rules: token and secret to placeholders, hostname to api.example.test, IPs to 192.0.2.x, DB user and borrower ID to placeholders, MSISDN removed, event ID to an example value. The signing secret was exposed in the notes and should be rotated.

Step 2 (trace): untrusted input is the X-Wallet-Signature header plus raw body (L53-54 of the code excerpt). The sink is wallet.credit (L60). The invariant that breaks is "each event_id is credited at most once." The check (L56) and the record (L62) are separated by a ~180 ms await (L60), and processed_events.event_id has no unique constraint (L93). Check-then-act race.

Step 3 (CVSS): AV:N (webhook over HTTP). AC:L (20/20 with two parallel requests, L74). PR:L (a valid HMAC is required; L47-48 show a viewer-role merchant user can download a signed delivery). UI:N. S:U. C:N (no data disclosed). I:H (duplicate ledger credit, L65-72). A:N. Base score 6.5 (Medium). If the signed delivery were obtainable without an account, PR:N gives 7.5.

Step 4 (claim check): every claim below maps to a notes line. Dropped: refundStatus.ts having the same pattern (L95, not checked), the CVE (L96, not assigned), and "severity: bad" (L96, replaced by the computed score).
</scratchpad>

<advisory>

## 1. Metadata & CVSS v3.1

- **Advisory title:** Payout-gateway wallet webhook credits a payout reversal twice under concurrent delivery (check-then-act race and no replay freshness check)
- **Affected component:** payout-gateway, webhook handler `handlePayoutStatus` in `src/webhooks/payoutStatus.ts`, route `POST /webhooks/wallet/payout-status`
- **Affected versions:** payout-gateway 2.3.1 (commit `4be81c2`), observed on staging. Other versions and production: not tested.
- **CWE:** CWE-367 (Time-of-check Time-of-use race condition), CWE-294 (Authentication Bypass by Capture-replay, as it applies to the missing timestamp and tolerance window)
- **CVE:** CVE: not assigned
- **CVSS v3.1 vector:** `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N`
- **Base score:** 6.5, Medium
- **Metric basis:**
  - AV:N: the webhook endpoint is reached over the network.
  - AC:L: duplicate credit reproduced 20/20 with two parallel requests (notes L74).
  - PR:L: a valid `X-Wallet-Signature` is required. The notes show a viewer-role merchant user can download signed deliveries, including that header (L47-48). If no account is needed to obtain one, use PR:N, which gives 7.5 High.
  - UI:N, S:U: no user interaction; impact stays inside the payout gateway.
  - C:N: no data disclosure is shown.
  - I:H: the same payout reversal is credited twice to a wallet (L65, L67-72).
  - A:N: no availability impact is shown.

## 2. Executive Summary

In staging, sending the same signed `payout.reversed` delivery twice at the same time credited the borrower's wallet twice. A reversal of ₱5,000 (`500000` centavos) produced a balance of ₱10,000 (`1000000` centavos). The ledger holds two rows with the same `ref`. Sending the same delivery sequentially is rejected with `duplicate_ignored`, so the defect is a race, not a missing check.

The handler checks whether the event was processed, credits the wallet (an await of about 180 ms), and only then records the event. Two requests can both pass the check before either records it. Nothing in the database enforces uniqueness.

Replay protection also has no freshness check. The signed payload has no timestamp and no tolerance window, and the signature never expires (L94).

Production impact is not verified.

## 3. Root Cause & Attack Surface

**Input:** the `X-Wallet-Signature` header and the raw request body. The HMAC over the raw body is verified (`payoutStatus.ts`, line 54). The signature is valid for the body it was computed on.

**Sink:** `wallet.credit(...)` (`payoutStatus.ts`, line 60).

**Invariant that breaks:** each `event_id` is credited at most once.

**Trace (`src/webhooks/payoutStatus.ts`):**

| Line | Action | Notes |
|---|---|---|
| 56 | `db.processedEvents.exists(evt.event_id)` (check) | Both requests can see "not processed." |
| 60 | `wallet.credit(...)` (act), awaits about 180 ms, calls the wallet service | Window for the second request. |
| 62 | `db.processedEvents.insert(evt.event_id)` (record) | Too late to stop the second credit. |

No unique constraint on `processed_events.event_id` (L93), so the database does not reject the second insert either.

**Attack surface:** any party holding a valid signed delivery for a `payout.reversed` event. The notes show such deliveries are downloadable by a viewer-role merchant user from a provider sandbox dashboard (L47-48). Whether the same is true in production is not shown.

**Secondary observation (hardening, not part of the score):** the signed payload has no timestamp and no tolerance window, and the signature does not expire (L94). After the processed record exists, a captured delivery is blocked on sequential replay (L53-57). The notes do not show what happens if the processed record is removed or never written. Treat that as an open question.

## 4. Deterministic PoC Reproduction

**Prerequisites**

- A staging environment running payout-gateway 2.3.1.
- A captured signed delivery body in `delivery.json`, and its signature in `$SIG`. Neither is reproduced here.
- A known starting balance for the test borrower, and a method to reset it. The notes do not document the reset method (L59-61), so this step is unverified.
- Read access to the wallet ledger.

**Step 1: confirm the sequential baseline (expected: second call is rejected)**

```bash
curl -sk -X POST "https://api.example.test:8443/webhooks/wallet/payout-status" \
  -H "X-Wallet-Signature: $SIG" \
  -H "Content-Type: application/json" \
  --data-binary @delivery.json
# expected: {"status":"ok"}

curl -sk -X POST "https://api.example.test:8443/webhooks/wallet/payout-status" \
  -H "X-Wallet-Signature: $SIG" \
  -H "Content-Type: application/json" \
  --data-binary @delivery.json
# expected: {"status":"duplicate_ignored"}
```

**Step 2: reset the test borrower to a known state, then send two parallel requests with the same body and signature**

```bash
for i in 1 2; do
  curl -sk -X POST "https://api.example.test:8443/webhooks/wallet/payout-status" \
    -H "X-Wallet-Signature: $SIG" \
    -H "Content-Type: application/json" \
    --data-binary @delivery.json &
done; wait
# observed (L61-62): {"status":"ok"}{"status":"ok"}
```

**Step 3: check the balance**

```bash
curl -sk -H "Authorization: Bearer <REDACTED_JWT>" \
  "https://api.example.test:8443/admin/wallets/<BORROWER_ID>"
# observed (L64): "balance_centavos":1000000 for a 500000 reversal
```

**Step 4: check the ledger**

```bash
psql -h 192.0.2.11 -U <REDACTED_DB_USER> -c \
  "select id, borrower_id, amount_centavos, ref from wallet_ledger where ref='evt_EXAMPLE';"
# observed (L68-72): two rows, both amount_centavos 500000, same ref
```

**Observed rate:** 20/20 with two parallel requests (L74). With five parallel requests, the notes record three credits once and two credits in other runs (L75).

**Caveat:** the notes show a secret was used to re-sign payloads with new event IDs (L59). The parallel run in Step 2 reuses the original signature, so the notes do not show whether a secret is needed to reproduce the race. Test this before relying on the claim.

## 5. Unified Remediation Diff

Proposed fix, not yet tested. The claim and the credit must be separated so that a failed credit does not leave the event marked as processed.

```diff
-    if (await db.processedEvents.exists(evt.event_id)) {
-      return res.status(200).json({ status: 'duplicate_ignored' })
-    }
-    if (evt.type === 'payout.reversed') {
-      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
-    }
-    await db.processedEvents.insert(evt.event_id)
-    return res.status(200).json({ status: 'ok' })
+    // Claim the event atomically. Requires a UNIQUE constraint on processed_events.event_id.
+    const claimed = await db.processedEvents.insertIfAbsent(evt.event_id)
+    if (!claimed) {
+      return res.status(200).json({ status: 'duplicate_ignored' })
+    }
+    try {
+      if (evt.type === 'payout.reversed') {
+        // Wallet credit must also be idempotent on evt.event_id (for example, a UNIQUE constraint on wallet_ledger.ref).
+        await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
+      }
+    } catch (err) {
+      await db.processedEvents.delete(evt.event_id) // release the claim so the provider retry can succeed
+      throw err
+    }
+    return res.status(200).json({ status: 'ok' })
```

**Additional steps (not yet implemented):**

1. Add a UNIQUE constraint on `processed_events.event_id`.
2. Add a UNIQUE constraint on `wallet_ledger.ref`, or confirm the wallet service dedupes on `event_id`.
3. Rotate `WALLET_WEBHOOK_SECRET`. It was written in plain text in the notes (L59).
4. Add a timestamp to the signed payload and reject deliveries outside a tolerance window.
5. Add a test that sends two requests with the same `event_id` concurrently and asserts exactly one ledger row. Confirm it fails on the current code (mutation check).
6. Review `src/webhooks/refundStatus.ts` for the same pattern. The notes raise this (L95) but do not show it was checked.

## 6. Secret & Factuality Audit Table

**Sensitive values and redaction**

| Value (notes line) | Redaction |
|---|---|
| Bearer token (L43) | `<REDACTED_JWT>` |
| Webhook signing secret (L59) | Removed. Rotation recommended. |
| Signature value (L51) | `$SIG` (not reproduced) |
| Staging hostname (L40, L44) | `api.example.test` |
| Gateway IP `10.42.0.19` (L40, L44, L54, L63) | `192.0.2.10` |
| DB IP `10.42.0.23` (L40, L67) | `192.0.2.11` |
| DB user `payouts_ro` (L67) | `<REDACTED_DB_USER>` |
| Borrower ID `brw_4471` (L44, L50, L63) | `<BORROWER_ID>` |
| Borrower phone number (L45) | Removed (personal data) |
| Event ID `evt_01JB7K2Q8M` (L50, L67, L70-71) | `evt_EXAMPLE` |
| Ledger row IDs (L70-71) | Removed |
| Staff initials and first name (L39, L96) | Removed |

**Claims and supporting notes lines**

| Claim in advisory | Notes line |
|---|---|
| Duplicate credit in staging, ₱5,000 reversal to ₱10,000 balance | L63-65 |
| Two ledger rows, same `ref` | L67-72 |
| Sequential replay returns `duplicate_ignored` | L53-57 |
| Parallel requests reproduce the race, 20/20 | L61-62, L74 |
| Five parallel requests give variable credits | L75 |
| Check, credit (about 180 ms), then insert ordering | L92, code L56-62 |
| No unique constraint on `processed_events.event_id` | L93 |
| No timestamp or tolerance window; signature never expires | L94 |
| Viewer-role users can download signed deliveries | L47-48 |
| Affected version payout-gateway 2.3.1, commit `4be81c2` | L41 |
| Staging environment | L39-40 |
| Re-signing with a secret used during test setup | L59 |

**Excluded (not shown in the notes):** production impact; any other endpoint; `refundStatus.ts` (L95); CVE assignment (L96, "ask kim," so "CVE: not assigned"); the reset method (L59-61); whether a secret is required to reproduce (L59 vs. L61).

</advisory>
