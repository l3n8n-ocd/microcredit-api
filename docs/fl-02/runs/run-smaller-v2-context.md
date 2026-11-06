# v2 · + Context and Motivation, smaller Claude model (raw output)

> Smaller, faster Claude model, fresh subagent, 2026-11-06. Verbatim; nothing edited.

---

# Security Advisory: Duplicate wallet credit from concurrent replay of a `payout.reversed` webhook

**Status:** Draft, pending maintainer confirmation
**Component:** payout-gateway, webhook handler `handlePayoutStatus` in `src/webhooks/payoutStatus.ts`
**Affected version:** payout-gateway 2.3.1 (commit `4be81c2`), as observed in staging
**CVE:** None assigned at time of writing
**Severity:** Preliminary assessment is High. Not yet scored by maintainers.
**Source:** Internal staging test, 2026-11-03

## Summary

The payout status webhook checks whether an event was already processed, credits the borrower wallet, then records the event as processed. The check and the record are not atomic, and `processed_events.event_id` has no unique constraint. When two deliveries of the same signed `payout.reversed` event arrive concurrently, both pass the check and both credit the wallet.

In staging, one 500,000-centavo (5,000 PHP) reversal was credited twice. The test wallet balance went from 0 to 1,000,000 centavos (10,000 PHP).

## Impact

- A wallet can be credited more than once for a single reversal event.
- Reproduced 20 of 20 times with two parallel requests.
- With five parallel requests, the observed credit count was 3 once and 2 on other attempts.
- Sequential replay of the same delivery was rejected with `duplicate_ignored`. The defect is in concurrent processing.
- Production impact has not been tested.

## Preconditions

- According to the notes, merchant users with the `viewer` role can download raw signed deliveries from the provider sandbox dashboard. The download includes the `X-Wallet-Signature` header. Access to these downloads should be reviewed.
- The signature covers no timestamp, and verification applies no tolerance window. A captured delivery does not expire.
- Replaying an existing signed delivery does not need the signing secret. Producing a new signed event with a new `event_id` does need it. The researcher used the staging secret for that step.

## Root cause

From code reading (`src/webhooks/payoutStatus.ts`, lines 56 to 62), the handler:

1. Checks `db.processedEvents.exists(evt.event_id)`.
2. Awaits `wallet.credit(...)`, which takes about 180 ms in the staging notes and calls the wallet service.
3. Calls `db.processedEvents.insert(evt.event_id)`.

Two requests that both reach step 1 before either reaches step 3 both credit the wallet. The schema has no unique constraint on `processed_events.event_id`, so the second insert does not fail. The database showed two `wallet_ledger` rows with the same `ref` (the event ID), each for 500,000 centavos.

## Reproduction (staging)

1. Obtain one signed `payout.reversed` delivery (body and `X-Wallet-Signature`).
2. Send it once. Response: `{"status":"ok"}`.
3. Send it again sequentially. Response: `{"status":"duplicate_ignored"}`.
4. Reset the staging wallet and processed-event state (the notes do not record the exact reset steps). Send two copies in parallel. Both return `{"status":"ok"}`, and the balance rises by 1,000,000 centavos.

## Remediation (recommended, not yet verified)

- Make deduplication atomic. Insert the `event_id` under a unique constraint in the same database transaction as the ledger write. Treat a unique-constraint violation as a duplicate and do not credit.
- Add a unique constraint on `processed_events.event_id`.
- Make wallet ledger writes idempotent on `ref` as a second layer of defense.
- Include a timestamp in the signed payload and enforce a tolerance window.
- Restrict access to raw signed deliveries, or remove the signature header from downloads.
- Add a regression test that sends two concurrent requests with the same `event_id` and asserts exactly one ledger entry.

## Related code not checked

- `src/webhooks/refundStatus.ts` may use the same check-then-credit pattern. The researcher did not check it.

## Disclosure handling

The staging notes contained a bearer token, a webhook signing secret, internal IP addresses and hostnames, a database account name, and a personal phone number. All of these are omitted here. Treat the staging bearer token and webhook signing secret as exposed, and rotate them.

## Open items

- CVE: not requested or assigned.
- Severity: unscored. The "High" rating is the researcher's preliminary view.
- Affected versions: only 2.3.1 at commit `4be81c2` has been observed. Other versions and branches are unknown.
- Refund webhook: not checked (see above).
- Admin wallet endpoint: the notes show a staging bearer token returning a phone number field in the response. This was not analyzed further and may need its own review.
