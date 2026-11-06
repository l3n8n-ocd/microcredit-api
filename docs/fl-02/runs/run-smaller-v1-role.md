# v1 · + Role Assignment, smaller Claude model (raw output)

> Smaller, faster Claude model, fresh subagent, 2026-11-06. Verbatim; nothing edited.

---

# Security Advisory: Double Credit of Wallet Reversals via Race in Payout-Status Webhook

**Component:** payout-gateway, `POST /webhooks/wallet/payout-status` (`src/webhooks/payoutStatus.ts`, `handlePayoutStatus`)
**Affected version:** payout-gateway 2.3.1, commit `4be81c2`
**Environment:** staging
**Severity:** High (provisional; not yet scored)
**CVE:** None assigned. Not requested yet.
**Status:** Unpatched as of 2026-11-03

## Summary

The webhook handler deduplicates events with a non-atomic check-then-act sequence. It checks whether an `event_id` was already processed, credits the borrower's wallet, and only then records the event. Two concurrent deliveries of the same signed event both pass the check before either records it, so both credit the wallet.

In staging, a `payout.reversed` event for 500000 centavos (PHP 5,000) credited the wallet twice, raising the balance from 0 to 1000000 centavos (PHP 10,000).

## Verified Behavior

| Test | Result |
| --- | --- |
| Sequential replay of the same signed delivery | Second request returns `duplicate_ignored`. Blocked. |
| Two parallel replays of the same signed delivery | Both return `ok`. Credited twice. Reproduced 20 of 20 times. |
| Five parallel replays | 3 credits in one run, 2 credits in others. Not deterministic, but reproducible. |
| `wallet_ledger` for the `ref` | Two rows, ids 90311 and 90312, each `amount_centavos = 500000`, same `ref` (`event_id`). |

## Root Cause

`src/webhooks/payoutStatus.ts`, lines 56 to 62:

1. Line 56: `db.processedEvents.exists(evt.event_id)` runs as a read.
2. Line 60: `wallet.credit(...)` runs and awaits the wallet service, about 180 ms in staging. This widens the race window.
3. Line 62: `db.processedEvents.insert(evt.event_id)` runs last.

Two requests can both pass step 1 before either reaches step 3. The database does not stop the second write:

- `processed_events.event_id` has no unique constraint.
- `wallet_ledger` has no unique constraint on `ref`, so the duplicate ledger row is accepted.

## Related Weaknesses

These came from the same investigation. They are not yet verified in the way the core issue is.

1. **No replay window.** The HMAC covers only the raw body. The signed payload has no timestamp, nonce, or tolerance window, so a captured signed delivery stays valid indefinitely.
2. **Signed deliveries are downloadable by low-privilege users.** The notes say any merchant user with the `viewer` role can download a raw delivery in the provider sandbox dashboard, and that the download includes the `X-Wallet-Signature` header. If confirmed, a read-only role can obtain a valid signature for any event it can see. This needs confirmation against the dashboard's role permissions.
3. **Refund webhook may share the pattern.** `src/webhooks/refundStatus.ts` was not checked. It is likely to have the same check-then-act structure.
4. **Admin wallet endpoint returns a phone number.** `GET /admin/wallets/:id` returned the borrower's MSISDN. This is PII exposure through an admin API and should be reviewed separately.

## Credential Exposure in Source Notes

The source notes contain a live-format admin bearer token and the staging `WALLET_WEBHOOK_SECRET` in plaintext. Both must be treated as compromised:

- Rotate `WALLET_WEBHOOK_SECRET` in the staging `.env` and the secret store.
- Revoke the admin token used against `/admin/wallets/`.
- Redact both values from any shared copy of these notes. This advisory omits them.

## Impact

- **Financial:** Any party that can get a valid signed delivery and send two concurrent requests can credit a wallet more than once. Each extra credit equals the original event amount.
- **Integrity:** The ledger records two entries for one event. Ledger totals no longer match the provider's events.
- **Exploitability:** Sequential replay is blocked. The attack needs concurrency, which is trivial to produce. Exploitation also needs a valid signed delivery, which the viewer-role issue may make easier to obtain.

## Reproduction (redacted)

1. Obtain a signed `payout.reversed` delivery for a borrower.
2. Send the same request body and `X-Wallet-Signature` header twice, at the same time:
   ```
   for i in 1 2; do curl -sk -X POST "$WEBHOOK_URL/webhooks/wallet/payout-status" \
     -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" \
     --data-binary @delivery.json & done; wait
   ```
3. Check the wallet balance. It increases by two times the event amount.
4. Check `wallet_ledger` for the `event_id` ref. Two rows appear.

Values in angle brackets or variables are placeholders. Use staging-only values in a private environment.

## Recommended Fix

1. **Make dedupe atomic with the credit.** Insert into `processed_events` before crediting, inside the same database transaction as the ledger write. Add a unique constraint on `processed_events.event_id`. On a unique-violation, return `duplicate_ignored` and do not credit.
2. **Constrain the ledger.** Add a unique constraint on `wallet_ledger` for the `(ref, entry_type)` pair, or the equivalent for reversal entries, so the database rejects a second credit even if application code fails.
3. **Add a replay window.** Include a timestamp in the signed payload, verify it against a tolerance window (for example 5 minutes), and include it in the HMAC input.
4. **Audit the refund webhook** for the same pattern and apply the same fix.
5. **Restrict delivery downloads.** Limit raw delivery and signature access to roles that need it, or redact the signature header in the dashboard.
6. **Add a regression test.** Send two concurrent requests with the same `event_id` and assert exactly one ledger entry. Confirm the test fails when the fix is reverted.

## Verification Status

- **Verified:** The parallel double credit and the two ledger rows, reproduced in staging.
- **Not verified:** Production exposure, the refund webhook, the viewer-role download claim, and the MSISDN exposure beyond the single response shown in the notes.
- **Open:** CVE assignment and final CVSS score. Ask the security contact before requesting a CVE.
