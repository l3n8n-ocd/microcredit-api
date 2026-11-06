# v3 · + Few-Shot Examples, smaller Claude model (raw output)

> Smaller, faster Claude model, fresh subagent, 2026-11-06. Verbatim; nothing edited.

---

# Security Advisory: Duplicate Credit via Race Condition and Replayable Signed Webhooks in payout-gateway

**Status:** Confirmed in staging. Production impact not verified.
**CVE:** Not assigned. Request pending with the maintainers.
**Severity:** Not formally scored. Researcher's preliminary estimate is High. A CVSS score should be computed before publication.
**Affected component:** `payout-gateway` 2.3.1, commit `4be81c2`, `src/webhooks/payoutStatus.ts`
**Weakness classes:** CWE-362 (race condition in check-then-act), CWE-294 (capture-replay; the signed payload has no timestamp or expiry)

## Summary

The wallet status webhook at `POST /webhooks/wallet/payout-status` is meant to ignore events it has already processed. Its duplicate check and its write are not atomic. When two copies of the same signed `payout.reversed` event arrive concurrently, both pass the duplicate check before either records the event. The borrower's wallet is credited twice.

In a staging test, two parallel deliveries of one event produced two credits in 20 of 20 runs. A five-request parallel test produced three credits in one run and two in others.

## Affected code

`src/webhooks/payoutStatus.ts`, lines 52–64 (`handlePayoutStatus`):

| Line | Operation |
| ---- | --------- |
| 54 | Verifies the HMAC of `req.rawBody` against `WALLET_WEBHOOK_SECRET` |
| 56 | `db.processedEvents.exists(evt.event_id)`: check |
| 60 | `wallet.credit(...)`: effect, about 180 ms in the test, makes a call to the wallet service |
| 62 | `db.processedEvents.insert(evt.event_id)`: record |

Two requests can both pass line 56 during the window before either reaches line 62.

The `processed_events.event_id` column has no unique constraint. The notes say this was checked with `\d processed_events`. A unique constraint alone would not fix the race, but it would make a duplicate insert fail.

## Reproduction (staging)

1. Send a signed `payout.reversed` event for 5,000 PHP (`amount_centavos: 500000`) to the endpoint. Response: `{"status":"ok"}`.
2. Send the same request again. Response: `{"status":"duplicate_ignored"}`. Sequential replay is blocked correctly.
3. Reset the test wallet. Send two copies of the same signed request in parallel. Both responses return `{"status":"ok"}`.
4. Read the wallet balance. Expected 500,000 centavos. Observed 1,000,000 centavos (10,000 PHP).
5. Query the ledger. Two `wallet_ledger` rows exist with the same `ref` (`evt_01JB7K2Q8M`), each for 500,000 centavos.

The notes say no special timing was needed. Two parallel requests were enough.

## Additional findings

- **Replay with no expiry.** The signed payload has no timestamp and no tolerance window. The signature never expires, so a captured valid delivery can be replayed indefinitely.
- **Signed deliveries exposed to a low-privilege role.** The notes say any merchant user with the `viewer` role can download a raw provider delivery, including the `X-Wallet-Signature` header. Those signed deliveries can then be replayed against the endpoint. Whether this exposure exists in production is not verified.
- **Secrets in working notes.** The researcher's notes contained a staging webhook signing secret and an admin bearer token. Both appeared in plain text in the notes. Treat both as exposed and rotate them. Values are not reproduced in this advisory.
- **Related endpoint not checked.** `src/webhooks/refundStatus.ts` may use the same exists-then-act pattern. This has not been tested.

## Recommended fix

Make recording and crediting a single atomic step:

```diff
-    if (await db.processedEvents.exists(evt.event_id)) {
-      return res.status(200).json({ status: 'duplicate_ignored' })
-    }
-    if (evt.type === 'payout.reversed') {
-      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
-    }
-    await db.processedEvents.insert(evt.event_id)
+    const claimed = await db.processedEvents.insertIfAbsent(evt.event_id) // unique constraint on event_id
+    if (!claimed) {
+      return res.status(200).json({ status: 'duplicate_ignored' })
+    }
+    if (evt.type === 'payout.reversed') {
+      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
+    }
```

Recommended steps:

1. Add a unique constraint on `processed_events.event_id`.
2. Claim the event with an insert that fails on conflict. Credit the wallet only after a successful claim. Ideally, claim and credit run in one database transaction. If the wallet service is external, use a compensating step on failure.
3. Reject signed payloads whose timestamp falls outside a short tolerance window, and include the timestamp in the signed input.
4. Restrict who can download signed raw deliveries.
5. Rotate the exposed staging secrets.

## Verification

| Check | Status |
| ----- | ------ |
| Sequential replay is rejected | Observed in staging |
| Parallel replay credits twice | Observed in staging (20/20 at 2 parallel requests) |
| Fix prevents double credit | Not tested |
| Refund webhook has the same flaw | Not tested |
| Production exposure | Not verified |

## Open items

- Obtain a CVE or confirm the request is pending.
- Compute a CVSS score.
- Confirm whether production runs the same code path and whether the `viewer` download exposure applies there.
- Test `refundStatus.ts`.
- Add a regression test that sends concurrent duplicate events and asserts exactly one ledger entry.
