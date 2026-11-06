# v0 · Naive one-line prompt, smaller Claude model (raw output)

> Smaller, faster Claude model, fresh subagent, 2026-11-06. Verbatim; nothing edited.

---

# Security Report: Duplicate wallet credit via race in payout-status webhook

**Status:** Confirmed on staging (observed 2026-11-03). Not yet verified in production.
**Component:** payout-gateway, `src/webhooks/payoutStatus.ts` (`handlePayoutStatus`, lines 52-64)
**Version:** payout-gateway@2.3.1, commit `4be81c2`
**Reporter:** jl
**CVE:** None assigned. Do not file one until Kim confirms whether this path is internet-facing or shipped to customers. Internal findings are normally tracked as issues.

**Redactions in this report:** the admin bearer token, the webhook signing secret, the staging and database host IP addresses, the borrower phone number, and the webhook signature value. The source notes contain all of these. Treat them as exposed (see Finding 3).

## Summary

The payout-status webhook checks whether an event has already been processed, then credits the wallet, then records the event as processed. The check and the record are separated by an async call of about 180 ms, and `processed_events.event_id` has no unique constraint. When the same signed delivery arrives concurrently, every request passes the check before any request records the event, so the wallet is credited once per request.

Observed on staging: a `payout.reversed` event for 500,000 centavos (₱5,000) was credited twice, raising the wallet balance from 0 to 1,000,000 centavos (₱10,000). The ledger holds two rows with the same `ref`. With five parallel requests, the author recorded three credits in one run and two in others.

## Severity

**High** (author's estimate: "prob high"; this report agrees). Reasons:
- Direct monetary impact: each replay credits a full payout amount.
- Reproduces with two concurrent HTTP requests (author reports 20/20 at two parallel requests).
- The attacker needs only the viewer role. Per the notes, any merchant user with `viewer` can download a raw delivery, including the `X-Wallet-Signature` header.

No CVSS score has been calculated. Calculate one before external disclosure.

## Impact

- Any wallet can be credited multiple times for a single reversal, and the excess is not caught by the system.
- Replay protection depends entirely on the racy check, so it fails under concurrency.
- Scope on production is unknown (see Open Items).

## Steps to Reproduce (staging)

1. Obtain a signed `payout.reversed` delivery (for example, "Download raw delivery" in the provider sandbox dashboard).
2. Send the delivery once. Response: `{"status":"ok"}`.
3. Send the same delivery again. Response: `{"status":"duplicate_ignored"}`. Sequential replay is correctly blocked.
4. Reset the test wallet (see Evidence Gap below), then send the same delivery twice in parallel:
   `for i in 1 2; do curl -X POST <staging>/webhooks/wallet/payout-status -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" --data-binary @delivery.json & done; wait`
5. Both responses return `{"status":"ok"}`. Wallet balance is 1,000,000 centavos.

## Evidence

- `GET /admin/wallets/<id>` after parallel replay: `balance_centavos: 1000000` (expected 500000).
- `wallet_ledger` query for `ref = evt_01JB7K2Q8M`: two rows, ids 90311 and 90312, each 500,000 centavos.
- Source, `src/webhooks/payoutStatus.ts`:
  - Line 56: `if (await db.processedEvents.exists(evt.event_id))`
  - Line 60: `await wallet.credit(...)`, about 180 ms, network call to the wallet service
  - Line 62: `await db.processedEvents.insert(evt.event_id)`
- `processed_events.event_id` has no unique constraint (`\d processed_events`).

## Root Cause

Check-then-act race (time-of-check to time-of-use). The dedupe check at line 56 and the record at line 62 are not atomic, and the side effect at line 60 runs between them. Two requests can both see "not processed" and both credit.

Contributing factors:
1. **No unique constraint** on `processed_events.event_id`, so the database cannot reject the second insert.
2. **`wallet.credit` does not enforce uniqueness on `ref`.** The ledger accepted two entries with the same `ref`. Dedupe is therefore only enforced in the webhook handler, not in the ledger.
3. **Signed payload has no timestamp or nonce, and no tolerance window.** A captured, validly signed delivery never expires.

## Additional Findings

**Finding 2: Replay possible by any viewer-role user.** The raw delivery download exposes the valid `X-Wallet-Signature` to `viewer`. Because the signature is valid for the payload, a viewer needs no secret to replay it. Combined with Finding 1, this gives a low-privilege user a path to credit a wallet. Scope: viewer-role users on staging (production unknown).

**Finding 3: Secrets exposed in terminal notes.** The notes contain a staging admin bearer token (service identity `svc-ops-console`, role `payout_admin`) and the `WALLET_WEBHOOK_SECRET` value. Both are in plain text. Treat as compromised:
- Rotate `WALLET_WEBHOOK_SECRET`.
- Revoke and rotate the `svc-ops-console` token.
- Scrub the notes and any shared logs. Redact before pasting logs in future.

**Finding 4: PII in admin API response.** `GET /admin/wallets/<id>` returns the borrower's full phone number (`msisdn`) in plain text. Check whether the admin view needs this field. If not, remove it. If yes, mask it.

**Finding 5: Refund webhook may share the pattern (unverified).** `src/webhooks/refundStatus.ts` may use the same exists-credit-insert sequence. Not checked. Audit before closing this report.

**Test-method note (not a service finding):** the author used `curl -k`, which skips TLS certificate verification. Certificate validity on staging was not checked. Rerun with verification on before relying on the results.

## Remediation

1. **Make dedupe atomic (primary fix).** Insert into `processed_events` before the side effect, using `INSERT ... ON CONFLICT (event_id) DO NOTHING` and checking the affected row count. If the row count is 0, return `duplicate_ignored`. Do the credit and the record in the same transaction where possible.
2. **Add database constraints.**
   - `UNIQUE (event_id)` on `processed_events`.
   - A unique key that makes a double ledger entry for the same reversal impossible, for example on `wallet_ledger` (`ref`, plus whatever identifies the entry type). The ledger rules in CLAUDE.md §3.2 (immutable, reversal by compensating entry only) still apply.
3. **Add replay protection to the signature.** Require a timestamp in the signed payload and reject deliveries outside a tolerance window (for example, 5 minutes). This needs coordination with the provider, because the signed content changes.
4. **Restrict the raw delivery download.** Hide `X-Wallet-Signature` from non-admin roles, or restrict the download to admins.
5. **Rotate and clean up** as listed in Finding 3.
6. **Audit `refundStatus.ts`** for the same pattern and fix it in the same change if present.
7. **Audit for past duplicates.** On staging, and on production if affected:
   `SELECT ref, borrower_id, COUNT(*) FROM wallet_ledger GROUP BY ref, borrower_id HAVING COUNT(*) > 1;`
   Correct affected balances with compensating entries. Do not edit or delete ledger rows.

## Verification Plan

- **Regression test (required):** fire N identical signed deliveries concurrently (for example, N = 5 and N = 20) at the handler. Assert exactly one `wallet_ledger` entry and one `processed_events` row. Run it against the database, not a mock, so the race is actually exercised.
- **Mutation check:** revert the fix to the exists-then-insert order. The regression test must fail. Restore the fix and confirm it passes.
- **Staging retest:** repeat the reproduction steps above. Expected: one `ok`, the rest `duplicate_ignored`, balance 500,000 centavos.
- **Replay test:** send a delivery with a timestamp older than the tolerance window. Expected: rejected.

## Open Items (TODO)

- **Evidence gap:** the notes say "reset wallet" before the parallel run, but no reset command is shown. The ledger has only two rows for this `ref`, which would mean the earlier sequential credit row was removed by that reset. Record the exact reset steps and retake the evidence.
- **Repro counts:** "20/20" and the 5-parallel results come from notes only. Attach raw curl output and timestamps.
- **Production scope:** confirm whether production runs this code and whether duplicate credits exist there. Not yet checked.
- **Refund webhook:** Finding 5 is unverified.
- **Severity and CVE:** calculate CVSS, and get Kim's decision on CVE assignment and disclosure path.
- **Provider signature design:** confirm with the provider whether a timestamp can be added to the signed content.
