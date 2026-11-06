# v4 · + Output Structure (raw output, TRUNCATED)

> Larger Claude model, fresh subagent, 2026-11-06. **The run was terminated partway through by Anthropic's
> safeguards (`[cyber]` flag)**, so the output stops in §4. Everything below is verbatim up to the cut;
> nothing edited, nothing added.

---

<advisory>

## 1. Metadata & CVSS v3.1

| Field | Value |
| --- | --- |
| **Title** | payout-gateway: race condition (TOCTOU) in the payout-status webhook's duplicate check credits a borrower wallet more than once per event |
| **CVE** | CVE: not assigned |
| **Affected component** | `payout-gateway`. Handler `handlePayoutStatus` in `src/webhooks/payoutStatus.ts` (lines 52–64), served at `POST /webhooks/wallet/payout-status` |
| **Affected versions** | `2.3.1` (from `package.json`), tested at commit `4be81c2`. No other versions were tested. |
| **Patched versions** | None at time of writing |
| **Environment tested** | Internal staging deployment, 2026-11-03 |
| **CWE** | CWE-367: Time-of-check Time-of-use (TOCTOU) Race Condition (primary)<br>CWE-837: Improper Enforcement of a Single, Unique Action<br>CWE-294: Authentication Bypass by Capture-replay (contributing: the signed payload has no freshness binding) |
| **CVSS v3.1 vector** | `CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:H/A:N` |
| **Base score / severity** | **5.3 / Medium** |

**Metric rationale**

| Metric | Value | Why |
| --- | --- | --- |
| AV | Network | The webhook endpoint takes HTTP requests. |
| AC | High | The attack only works if the delivery's `event_id` is not yet in `processed_events`. Once an event has been processed, replays are rejected (notes lines 16–19). The attacker does not control that precondition. Inside the window the race itself is reliable (20/20 with 2 parallel requests). |
| PR | Low | The attacker needs a validly signed delivery. The notes report that any merchant user with the `viewer` role on the provider sandbox dashboard can download one, including its `X-Wallet-Signature` header. |
| UI | None | No victim interaction. |
| S | Unchanged | The impact stays in the payout-gateway's wallet and ledger data. |
| C | None | The race does not disclose any data. The balance read in the PoC used a separate admin token and is not part of the attack. |
| I | High | Each extra winning request writes another ledger credit for the full signed amount. That is a direct financial consequence. |
| A | None | No availability impact was observed. |

**Severity note.** The researcher's provisional "probably high" is not adopted, because the observed preconditions do not support it. The score would go up if any of the following were shown (none were tested):
- PR:N, if fresh signed deliveries can be obtained without an account: **5.9**.
- AC:L with PR:L, if exploitation does not depend on catching an unprocessed event: **6.5**.
- AC:L with PR:N: **7.5 (High)**.

## 2. Executive Summary

`POST /webhooks/wallet/payout-status` in payout-gateway `2.3.1` deduplicates provider events in three non-atomic steps:
1. It checks whether `event_id` exists in `processed_events`.
2. It calls the wallet service to credit the borrower.
3. Only then does it insert the `event_id`.

When two copies of the same validly signed `payout.reversed` delivery arrive together, both pass the check before either one inserts, so both credit the wallet.

In staging, one reversal of 500000 centavos (₱5,000.00) produced:
- two `wallet_ledger` rows with the same `ref`;
- a final balance of 1000000 centavos (₱10,000.00) instead of 500000.

The issue reproduced in 20 of 20 attempts with 2 parallel requests. With 5 parallel requests, one attempt produced 3 credits and the others produced 2. The number of 5-request attempts was not recorded.

Sequential replays are correctly rejected with `{"status":"duplicate_ignored"}`. The weakness is limited to concurrent delivery of an event that has not been processed yet.

Two factors widen the exposure, both reported by the researcher and not independently verified:
- `processed_events.event_id` has no unique constraint, so the database does not prevent duplicates either.
- Signed deliveries carry no timestamp, so a captured signature never expires.

**Fix:** claim the `event_id` atomically before any side effect, using `INSERT … ON CONFLICT DO NOTHING` backed by a unique index. See §5.

## 3. Root Cause & Attack Surface

### Root cause

`src/webhooks/payoutStatus.ts` (as recorded in the notes at commit `4be81c2`):

```ts
52  export async function handlePayoutStatus(req: Request, res: Response) {
53    const sig = req.header('X-Wallet-Signature')
54    if (!verifyHmac(req.rawBody, sig, process.env.WALLET_WEBHOOK_SECRET)) return res.status(401).end()
55    const evt = JSON.parse(req.rawBody.toString())
56    if (await db.processedEvents.exists(evt.event_id)) {
57      return res.status(200).json({ status: 'duplicate_ignored' })
58    }
59    if (evt.type === 'payout.reversed') {
60      await wallet.credit(evt.data.borrower_id, evt.data.amount_centavos, { ref: evt.event_id })
61    }
62    await db.processedEvents.insert(evt.event_id)
63    return res.status(200).json({ status: 'ok' })
64  }
```

- **Check (line 56):** `exists(evt.event_id)` is a plain read. It takes no lock and reserves nothing.
- **Act (line 60):** `wallet.credit()` is an awaited call to the separate wallet service. The researcher estimates it takes about 180 ms. That is the race window.
- **Record (line 62):** `insert(evt.event_id)` runs only after the credit. Every request that reached line 56 before the first insert has already passed the check.
- **No database backstop:** the researcher reports that `processed_events.event_id` has no unique constraint (checked with `\d processed_events`; the output is not in the notes). So concurrent inserts also succeed, and any database-level fix needs a migration first.

**Interleaving observed with 2 parallel requests:**

| t | Request A | Request B |
| --- | --- | --- |
| 1 | `verifyHmac` → valid | |
| 2 | `exists(event_id)` → false | `verifyHmac` → valid |
| 3 | `wallet.credit(…, 500000)` (awaiting) | `exists(event_id)` → false |
| 4 | | `wallet.credit(…, 500000)` (awaiting) |
| 5 | `insert(event_id)` → `{"status":"ok"}` | |
| 6 | | `insert(event_id)` → `{"status":"ok"}` |

Result: two ledger rows with the same `ref`, and the balance is credited twice.

### Attack surface

| Element | Detail |
| --- | --- |
| Entry point | `POST /webhooks/wallet/payout-status`. The only authentication is the HMAC check on `X-Wallet-Signature`. |
| Attacker input | One validly signed delivery body plus its signature, sent unmodified several times at once. The amount and borrower cannot be changed because they are covered by the HMAC. |
| How a signed delivery is obtained | The provider sandbox dashboard's "Download raw delivery" feature. The researcher reports that any merchant user with the `viewer` role can download deliveries including the `X-Wallet-Signature` header. Whether the production provider dashboard behaves the same way was not tested. |
| Precondition | The delivery's `event_id` must not be in `processed_events` yet. After a successful insert, later replays return `duplicate_ignored`. |
| Freshness | The payload shown (`event_id`, `type`, `data`) has no timestamp field. The researcher reports that there is no tolerance window. The `verifyHmac` source is not in the notes, so it is unconfirmed whether a timestamp is signed anywhere else. |
| Who gains | The borrower named in the signed event receives the extra credit. The notes do not establish who would trigger this in production. |
| Possibly affected sibling | The researcher suspects `src/webhooks/refundStatus.ts` uses the same pattern. **It was not checked and is not claimed as affected.** See the follow-up in §6. |
| Untested scenario | Overlapping provider retries of the same event could trigger duplicate credits without any attacker. The notes do not show the provider's retry behaviour. |

## 4. Deterministic PoC Reproduction

**Scope:** an authorized staging deployment of payout-gateway `2.3.1` (commit `4be81c2`) only. Do not run this against production.

**Determinism:** with 2 parallel requests the result was the same in 20 of 20 attempts (two `ok` responses and two credits). With 5 parallel requests the credit count varied between 2 and 3.

**Preconditions**
1. A validly signed `payout.reversed` delivery, saved as `delivery_8812.json` with its signature in `delivery_8812.sig`. Use both files byte-for-byte unmodified. The redacted JSON below is for illustration only; editing the real file invalidates the HMAC.
2. The delivery's `event_id` is not present in `processed_events`, and the target wallet balance is known. The starting balance was 0 in this test.
3. Optional, for observation only: an admin token to read the wallet balance, and read-only database access to inspect `wallet_ledger`. Neither one is needed to exploit the issue.

**Step 1: record the starting balance (observation only)**

```bash
export TOKEN=<REDACTED_JWT>
curl -sk -H "Authorization: Bearer $TOKEN" "https://192.0.2.10:8443/admin/wallets/<BORROWER_ID>"
```
Expected:
```json
{"borrower_id":"<BORROWER_ID>","msisdn":"<REDACTED_MSISDN>","balance_centavos":0}
```

**Step 2: load the signed delivery**

```bash
cat delivery_8812.json
SIG=$(cat delivery_8812.sig)   # value: <REDACTED_SIGNATURE>
```

**[Output ends here: the run was terminated by safeguards.]**
