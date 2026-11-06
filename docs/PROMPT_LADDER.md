# The Prompt Ladder — Week 2 · General AI Fluency

> **Task under test:** FL-01 Target Task **T1**, a pure `transitionLoan(loan, event)` state machine for the
> 10-state MicroCredit loan lifecycle, plus repayment posting, `Idempotency-Key` replay and `If-Match`
> concurrency ([`FL-01_WORKFLOW_AUDIT.md` §2](./FL-01_WORKFLOW_AUDIT.md#section-2--three-target-tasks-for-fl-02--fl-04)).
> **Author:** Lenon D. Adriano · **Recorded:** 2026-11-06

## Overview

| Run | Single Added Layer | Target Weakness Attacked | Net Result |
| --- | ------------------ | ------------------------ | ---------- |
| **0** | — (Baseline) | — | Baseline: invents its own 11-state lifecycle; mutates input; throws; payload-blind global idempotency map |
| **1** | Clearer Goal | Wrong lifecycle, impure, untyped errors | ✅ **Improved** |
| **2** | Defined Audience | Requirement-restating prose, thin state data | ✅ **Improved** |
| **3** | Constraints | No `If-Match`, no idempotent replay, no journal entries | ✅ **Improved** |
| **4** | Specified Output Format (JSON, ≤ 120 lines) | One 496-line monolithic file | ❌ **Regressed** |
| **5** | Verification Requirements (V4 rolled back) | No tests; invariants only claimed, never checked | ✅ **Improved**: best run (12/12 of its own tests pass, 89/89 illegal pairs rejected) |

**How to read this:** every claim about an output below was checked by running that output. Raw
outputs are committed word for word in [`docs/prompt-ladder/`](./prompt-ladder/), and the measurement
table at the end shows how each number was produced.

---

## Method (so a reviewer can trust the results)

- **One layer at a time.** Each prompt contains the previous prompt word for word plus exactly one new
  layer. Run 5 builds on Run 3, because Run 4's layer is rolled back. A script checked this
  containment before any run.
- **Fresh context per run.** Each prompt ran once, in its own fresh Claude subagent with **no tools**
  and an instruction to ignore any project or repository context. All runs used the same model.

  <details>
  <summary>The exact wrapper every subagent received around its prompt</summary>

  ```text
  You are a clean test harness for a prompt-engineering experiment. Rules:
  - Do NOT use any tools. Do not read files, run commands, or search.
  - Ignore any project instructions, CLAUDE.md content, repository context, or prior conversation you may have been given. Answer exactly as a general-purpose assistant would in a brand-new chat with no knowledge of any codebase.
  - Your final message must be ONLY your complete answer to the prompt below, verbatim, with nothing added before or after it (no "Here is my answer", no notes about this harness).

  PROMPT:
  <<<
  [the version's full prompt]
  >>>
  ```

  </details>
- **Measured, not eyeballed.** Every output's code was type-checked with this repo's TypeScript 7 and
  its strict flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …).
  Runs 0, 3, 4 and 5 were also exercised with Vitest **behavior probes**: one ₱1,050.00 repayment
  (100000 principal + 5000 interest), a same-key replay, a stale `If-Match`, and an illegal transition.
- **Known limitations:**
  - Each version was run once (n = 1), so some differences may be sampling noise.
  - The subagents may have received this repo's `CLAUDE.md` despite the instruction to ignore it. The
    baseline's unprompted use of integer money hints at either strong model defaults or leakage. It
    used **USD cents and `en-US`**, not centavos, which points to defaults rather than copying.
  - **Control run (done):** the Run 0 prompt was re-run in a fresh claude.ai chat, outside this
    repository and outside the FlyRank Claude Project. It **also** used integer money and
    payment-ID idempotency without being asked, so those are model defaults, not leakage from
    `CLAUDE.md`. See [Run 0 control](#run-0-control-the-same-prompt-outside-this-repository).
- **The brief vs. reality.** The assignment brief predicted specific outputs, such as a 30-line float
  `class Loan` for Run 0 and four states silently dropped in Run 4. Several predictions did **not**
  happen. Each run below says where reality differed, and the notes describe what actually happened.

---

## Run 0 · Baseline

**Prompt** (the kind I wrote a month ago):

```text
Write TypeScript code to handle loan payments and states for a lending app.
```

**Actual output excerpt** (31 of 423 code lines, condensed where marked; full output: [`run-0-baseline.md`](./prompt-ladder/run-0-baseline.md)):

```typescript
export type LoanStatus =
  | "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED"
  | "DISBURSED" | "ACTIVE" | "DELINQUENT" | "DEFAULTED" | "PAID_OFF" | "CANCELLED";
// (the output lists one status per line; condensed here)

export const formatMoney = (value: Cents, currency = "USD", locale = "en-US"): string =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).format(value / 100);

export class LoanService {
  // …
  /** Tracks idempotency keys so retried payment requests are not applied twice. */
  private readonly processedPayments = new Map<string, Payment>();

  /** Applies a state-machine event with optimistic concurrency control. */
  transition(loan: Loan, event: LoanEvent, expectedVersion: number): Loan {
    if (loan.version !== expectedVersion) {
      throw new ConcurrencyError(expectedVersion, loan.version);
    }
    const from = loan.status;
    const to = nextStatus(from, event);
    // …
    loan.status = to;
    loan.history.push({ from, to, event, at });
    loan.version += 1;
    return loan;
  }

  applyPayment(loan: Loan, amount: Cents, idempotencyKey: string): Payment {
    const existing = this.processedPayments.get(idempotencyKey);
    if (existing) return existing; // safe retry: return the original result
    // …
```

**Baseline diagnosis.** Measured with the probe ([`run-0` probe: 4/4 confirmed](#measurements)):

| Problem | Why it's dangerous in production |
| ------- | -------------------------------- |
| **Invented its own lifecycle.** 11 states, and only 7 of our 10 (`DRAFT`, `SUBMITTED`, `ACTIVE` and `PAID_OFF` instead of `APPLIED`, `REPAYING` and `SETTLED`). | The admin dashboard and the ledger would disagree about what state a loan is in. |
| **Not pure.** `transition()` mutates the loan in place and returns the same object (the probe saw `out === loan`). | You can't replay history or diff states, and React state updates silently break. |
| **Errors are thrown.** `InvalidTransitionError` and `ConcurrencyError` instead of a typed `409`. | Every caller needs a `try/catch`, and an uncaught stale-version error is a 500, not a "refresh and retry." |
| **Idempotency ignores the payload and the loan.** The probe used the same key on a *second* loan: it returned the first loan's payment, and the second loan was **never charged**. | A key collision or a client bug silently loses money. This is exactly the kind of bug the One Claim is about. |
| **Float math on money and the wrong currency.** `principal * monthlyRate`, `value / 100`, and `USD` / `en-US` by default. | Interest per installment is computed in IEEE-754 floats, and amounts display as dollars. The schedule *total* still nets to exactly ₱5,000.00 (the last installment absorbs drift), so the brief's predicted "balance drift" did **not** occur. |
| **423 lines, 3 classes, 9 `throw`s, no ledger.** | Too much code for an unscoped prompt, and there's no journal to audit. |

> **Brief vs. reality:** the brief expected a 25–35 line mutable `class Loan` with
> `balance -= payment * 1.05`, a `'pending' | 'paid'` status and a beginner TypeScript tutorial. The
> real baseline had **none** of those. A modern model's defaults are much better than that, so the
> real lesson of Run 0 is subtler: plausible-looking code can still have a loan-mixing idempotency bug.

### Run 0 control: the same prompt outside this repository

To check whether the subagent baseline was influenced by this repo's `CLAUDE.md`, I re-ran the
**identical prompt** in a fresh claude.ai chat, outside the repo and outside the FlyRank Claude Project.
That chat could run code, so it returned files plus a summary. Full output:
[`run-0-control.md`](./prompt-ladder/run-0-control.md).

| Check | Subagent baseline (Run 0) | claude.ai control | Verdict |
| ----- | ------------------------- | ----------------- | ------- |
| Integer money | ✅ `Cents` (branded), USD / `en-US` | ✅ `Cents = number` (unbranded), "centavos", `₱` | **Model default.** Both did it unprompted. |
| Idempotency | Global map that ignores the payload. The same key on another loan returns the first loan's payment. | Per loan, compares the payload. A reused ID with different details throws `DUPLICATE_PAYMENT`. | Default in both. The control's version is **safer** (probe: cross-loan bug absent). |
| `version` / `If-Match` | ✅ Version check (throws on mismatch) | ❌ **None.** Two writers from one snapshot silently lose a payment (probe). | Not a default. Concurrency only appears when asked (Run 3). |
| Purity / typed errors | ❌ Mutates in place; throws | ❌ Mutates in place; throws `LoanError` | Same weakness in both. |
| Our 10 states | 7 of 10 | 5 of 10 (`PENDING`, `ACTIVE`, `PAID_OFF` and `WRITTEN_OFF` instead) | Both invent their own lifecycle. |
| Its own claims | No tests | "13 tests … all pass under strict TypeScript". **True:** 13/13 pass, 0 errors under plain `strict`. Under this repo's extra flags: 10 errors in `loan.ts` and 19 in its tests, all `noUncheckedIndexedAccess`. | A claim that holds against *its* bar, not ours. |

**Answer to the leakage question:** integer money and some form of idempotency appeared in **both**
environments, so they're model defaults, not copied from `CLAUDE.md`. Two other observations:

- **The subagent probably didn't read `CLAUDE.md`.** It used **USD**, while `CLAUDE.md` says
  centavos everywhere.
- **The control may have had its own context.** The prompt never mentions the Philippines, yet the
  control used `₱` and "centavos". Something in the claude.ai account, such as profile preferences,
  memory or past chats, likely supplied that. I can't check which, so treat the control's currency
  choice, but not its structure, as possibly context-influenced.

---

## Run 1 · Version 1: Clearer Goal

**Layer added:** a precise goal. Nothing about audience, constraints or format yet.

```text
Write a pure TypeScript function `transitionLoan(loan, event)` that moves a loan through a Philippine
micro-lending lifecycle with exactly these 10 states: APPLIED, UNDER_REVIEW, APPROVED, DISBURSED,
REPAYING, SETTLED, DELINQUENT, DEFAULTED, REJECTED, and CANCELLED. The legal transitions are:
APPLIED → UNDER_REVIEW → APPROVED → DISBURSED → REPAYING → SETTLED, plus UNDER_REVIEW → REJECTED,
APPROVED → CANCELLED, REPAYING → DELINQUENT, DELINQUENT → REPAYING, and DELINQUENT → DEFAULTED.
The same function also posts repayments: a repayment event reduces the outstanding balance, and the
loan may settle only when that balance reaches zero. The function must never mutate its input.
```

**Representative output excerpt** (full: [`run-1-goal.md`](./prompt-ladder/run-1-goal.md)):

```ts
export type TransitionResult =
  | { readonly ok: true; readonly loan: Loan }
  | { readonly ok: false; readonly error: TransitionError };

export function transitionLoan(loan: Loan, event: LoanEvent): TransitionResult {
  // Copy only the shared fields, so leftover fields from the old state are never carried over.
  const base: LoanBase = { id: loan.id, principal: loan.principal };
  switch (loan.status) {
    // …
    case 'REPAYING':
      if (event.type === 'POST_REPAYMENT') {
        const r = applyRepayment(loan.outstanding, event.amount);
        if (!r.ok) return fail(r.error);
        // Settles automatically, and only, when the balance reaches exactly zero.
        return r.remaining === 0
          ? ok({ ...base, status: 'SETTLED', outstanding: ZERO })
          : ok({ ...base, status: 'REPAYING', outstanding: r.remaining });
      }
```

**Four notes**

1. **What changed in the prompt:** I replaced the vague request with a Clearer Goal. It names the exact
   10-state Philippine micro-lending lifecycle, its 11 legal transitions, the repayment rule and purity.
2. **What actually improved in the output:**
   - The invented 11-state lifecycle became **exactly our 10 states** (10/10 named).
   - It became a discriminated union with a pure `switch` reducer, so the input is never mutated.
   - The 9 `throw`s dropped to 3, and errors became a typed `TransitionResult`.
   - Settling became guarded in two ways: auto-settle only at exactly zero, and an explicit `SETTLE`
     that returns `BALANCE_NOT_ZERO` otherwise.
   - Code shrank from 423 to 187 lines, and it switched to integer **centavos** without being asked.
3. **What still failed:**
   - **The version check and idempotency from Run 0 disappeared,** because the goal didn't mention
     them. A double-clicked repayment would now post twice.
   - Interest isn't modeled, and there are no journal entries.
   - About 280 words of prose mostly restate my requirements back to me ("How it meets each
     requirement").
   - A `DELINQUENT` loan paid down to zero stays `DELINQUENT` until someone sends `CURE` and then `SETTLE`.
   - *Brief vs. reality:* the brief predicted a beginner `switch`-statement tutorial and an allowed
     `DISBURSED → SETTLED` jump. Neither happened.
4. **What I would try next:** add a Defined Audience, so the prose is aimed at a reviewer instead of
   checking off my requirements.

---

## Run 2 · Version 2: Defined Audience

**Layer added:** audience. Version 1's text is unchanged, plus:

```text
Audience: you are writing for a senior fintech frontend/full-stack engineer who will review this as
production state-machine code. They already know TypeScript discriminated unions and double-entry
accounting, so do not explain language features or accounting basics.
```

<details>
<summary><strong>Full assembled prompt for Version 2</strong> (Version 1 + Audience; 131 words, exactly as sent)</summary>

```text
Write a pure TypeScript function `transitionLoan(loan, event)` that moves a loan through a Philippine micro-lending lifecycle with exactly these 10 states: APPLIED, UNDER_REVIEW, APPROVED, DISBURSED, REPAYING, SETTLED, DELINQUENT, DEFAULTED, REJECTED, and CANCELLED. The legal transitions are: APPLIED → UNDER_REVIEW → APPROVED → DISBURSED → REPAYING → SETTLED, plus UNDER_REVIEW → REJECTED, APPROVED → CANCELLED, REPAYING → DELINQUENT, DELINQUENT → REPAYING, and DELINQUENT → DEFAULTED. The same function also posts repayments: a repayment event reduces the outstanding balance, and the loan may settle only when that balance reaches zero. The function must never mutate its input.

Audience: you are writing for a senior fintech frontend/full-stack engineer who will review this as production state-machine code. They already know TypeScript discriminated unions and double-entry accounting, so do not explain language features or accounting basics.
```

</details>

**Representative output excerpt** (full: [`run-2-audience.md`](./prompt-ladder/run-2-audience.md)):

```ts
interface LoanBase {
  readonly id: string;
  readonly borrowerId: string;
  /** Goes up by one on every accepted event. Use it for If-Match / optimistic concurrency. */
  readonly version: number;
}

/** Servicing data shared by every state after disbursement. */
interface Servicing {
  readonly principal: Centavos;   // cash paid out to the borrower
  readonly receivable: Centavos;  // principal + finance charges booked at disbursement
  readonly outstanding: Centavos; // invariant: receivable − Σ postings.amount
  readonly postings: readonly RepaymentPosting[];
  // …
}
```

> *From the output's "Design decisions":* "**Overpayment is rejected, not capped.** Extra cash needs its
> own ledger treatment (refund or suspense account). Silently capping it would leave the cash and the
> receivable out of step."

**Four notes**

1. **What changed in the prompt:** I added a Defined Audience: a senior fintech engineer reviewing
   production state-machine code who already knows discriminated unions and double-entry accounting.
2. **What actually improved in the output:**
   - The "how it meets each requirement" checklist was replaced by **reviewer-grade design rationale**:
     - why `SETTLE` is a separate event,
     - why overpayment is rejected rather than capped,
     - why the caller passes `at` so the function stays pure.
   - State data got richer: `requested`, `approvedPrincipal`, `receivable`, a `postings` log and
     timestamps.
   - It added a `version` field "for If-Match" and duplicate-`paymentId` detection.
   - It stated an invariant to property-test: `receivable − Σ postings === outstanding`.
3. **What still failed:**
   - **`version` is only incremented, never checked.** Nothing compares it against an `If-Match`
     value, so two admins clicking at once still both succeed.
   - A duplicate payment is an error (`DUPLICATE_PAYMENT`), not an idempotent replay.
   - Still no journal entries and no principal/interest split.
   - It chose a **`bigint`** `Centavos`, which doesn't match this repo's `number`-based brand in
     `src/utils/money.ts`.
   - *Brief vs. reality:* the brief predicted float amounts (`amountPhp: 1050.55`) and `export default`.
     The real output has **0** of either.
4. **What I would try next:** add Constraints that pin down the exact `Centavos` type, the journal
   accounts, idempotent replay and typed `409` results for stale `If-Match` and illegal transitions.

---

## Run 3 · Version 3: Constraints

**Layer added:** constraints. Version 2's text is unchanged, plus:

```text
Constraints:
- Money is integer centavos only, as a branded type `type Centavos = number & { readonly __brand: 'Centavos' }`
  (₱1,050.00 = 105000). No floating-point currency math anywhere.
- Every repayment produces a double-entry journal entry whose lines satisfy Σ debits === Σ credits in
  centavos, using the accounts `wallet_clearing:gcash` or `wallet_clearing:maya`,
  `loans_receivable:<borrowerId>`, and `interest_income`. A repayment is split into a principal
  portion and an interest portion.
- Every mutation carries an `Idempotency-Key`; replaying the same key returns the original result
  without posting a second journal entry.
- Every mutation carries an `If-Match` loan version. A stale version returns
  `{ ok: false, status: 409, code: 'VERSION_MISMATCH' }` and an illegal transition returns
  `{ ok: false, status: 409, code: 'ILLEGAL_TRANSITION' }`. Never throw for these cases.
- Named exports only (no `export default`), zero `any`, TypeScript `strict: true`.
```

<details>
<summary><strong>Full assembled prompt for Version 3</strong> (Version 2 + Constraints; 269 words, exactly as sent)</summary>

```text
Write a pure TypeScript function `transitionLoan(loan, event)` that moves a loan through a Philippine micro-lending lifecycle with exactly these 10 states: APPLIED, UNDER_REVIEW, APPROVED, DISBURSED, REPAYING, SETTLED, DELINQUENT, DEFAULTED, REJECTED, and CANCELLED. The legal transitions are: APPLIED → UNDER_REVIEW → APPROVED → DISBURSED → REPAYING → SETTLED, plus UNDER_REVIEW → REJECTED, APPROVED → CANCELLED, REPAYING → DELINQUENT, DELINQUENT → REPAYING, and DELINQUENT → DEFAULTED. The same function also posts repayments: a repayment event reduces the outstanding balance, and the loan may settle only when that balance reaches zero. The function must never mutate its input.

Audience: you are writing for a senior fintech frontend/full-stack engineer who will review this as production state-machine code. They already know TypeScript discriminated unions and double-entry accounting, so do not explain language features or accounting basics.

Constraints:
- Money is integer centavos only, as a branded type `type Centavos = number & { readonly __brand: 'Centavos' }` (₱1,050.00 = 105000). No floating-point currency math anywhere.
- Every repayment produces a double-entry journal entry whose lines satisfy Σ debits === Σ credits in centavos, using the accounts `wallet_clearing:gcash` or `wallet_clearing:maya`, `loans_receivable:<borrowerId>`, and `interest_income`. A repayment is split into a principal portion and an interest portion.
- Every mutation carries an `Idempotency-Key`; replaying the same key returns the original result without posting a second journal entry.
- Every mutation carries an `If-Match` loan version. A stale version returns `{ ok: false, status: 409, code: 'VERSION_MISMATCH' }` and an illegal transition returns `{ ok: false, status: 409, code: 'ILLEGAL_TRANSITION' }`. Never throw for these cases.
- Named exports only (no `export default`), zero `any`, TypeScript `strict: true`.
```

</details>

**Representative output excerpt** (full: [`run-3-constraints.md`](./prompt-ladder/run-3-constraints.md)):

```ts
export function transitionLoan(aggregate: LoanAggregate, event: LoanEvent): TransitionResult {
  const fp = fingerprint(event);
  const prior = aggregate.idempotency.get(event.idempotencyKey);
  if (prior !== undefined) {
    return prior.fingerprint === fp
      ? { ok: true, replayed: true, next: aggregate, response: prior.response }
      : {
          ok: false,
          status: 422,
          code: 'IDEMPOTENCY_KEY_REUSED',
          detail: `key ${event.idempotencyKey} was already used with a different request`,
        };
  }
  const { loan } = aggregate;
  if (event.ifMatch !== loan.version) {
    return { ok: false, status: 409, code: 'VERSION_MISMATCH', ifMatch: event.ifMatch, current: loan.version };
  }
  // …
}

// … inside repay(), after the interest-first split:
  const lines: JournalLine[] = [{ account: `wallet_clearing:${event.channel}`, side: 'DEBIT', amount }];
  if (interestPortion > 0) lines.push({ account: 'interest_income', side: 'CREDIT', amount: interestPortion });
  if (principalPortion > 0) {
    lines.push({ account: `loans_receivable:${loan.borrowerId}`, side: 'CREDIT', amount: principalPortion });
  }
```

**Four notes**

1. **What changed in the prompt:** I added Constraints: the exact branded integer `Centavos`, balanced
   debit/credit journal lines on named accounts, idempotent replay, typed `409`s for a stale `If-Match`
   or an illegal transition, named exports and no `any`.
2. **What actually improved in the output (all checked by the probe, 4/4 passed):**
   - **`If-Match` is enforced.** A stale version returns `{ status: 409, code: 'VERSION_MISMATCH' }`.
   - **Replays are idempotent.** The same key returns `replayed: true`, and the journal length doesn't
     change.
   - **₱1,050.00 posts a balanced 3-line entry:** Dr `wallet_clearing:gcash` 105000, Cr
     `interest_income` 5000, Cr `loans_receivable:B1` 100000.
   - Replay is checked *before* `If-Match`, with the reason given: a retry carries the pre-success
     version.
   - Only 1 `throw` remains (`assertNever`).
3. **What still failed:**
   - It arrived as **one 496-line module** mixing types, header parsers, ledger and reducer. That
     doesn't map onto this repo's `types.ts` / `ledger.ts` / `loanStateMachine.ts` split.
   - There are no tests, so every invariant is still only claimed.
   - `subC` relies on a comment ("Caller guarantees a >= b") instead of a check.
   - *Brief vs. reality:* the brief predicted a 180-line block. It was 496 lines.
4. **What I would try next:** add a Specified Output Format to force a structured, file-by-file
   response. *(This turned out to be the mistake; see Run 4.)*

---

## Run 4 · Version 4: Specified Output Format (the regression)

**Layer added:** output format. Version 3's text is unchanged, plus:

```text
Output format: Return the entire response strictly as a single valid JSON object with the keys
`typesCode`, `stateMachineCode`, `ledgerCode`, and `complexityAnalysis`, under 120 lines total.
```

<details>
<summary><strong>Full assembled prompt for Version 4</strong> (Version 3 + Output Format; 294 words, exactly as sent)</summary>

```text
Write a pure TypeScript function `transitionLoan(loan, event)` that moves a loan through a Philippine micro-lending lifecycle with exactly these 10 states: APPLIED, UNDER_REVIEW, APPROVED, DISBURSED, REPAYING, SETTLED, DELINQUENT, DEFAULTED, REJECTED, and CANCELLED. The legal transitions are: APPLIED → UNDER_REVIEW → APPROVED → DISBURSED → REPAYING → SETTLED, plus UNDER_REVIEW → REJECTED, APPROVED → CANCELLED, REPAYING → DELINQUENT, DELINQUENT → REPAYING, and DELINQUENT → DEFAULTED. The same function also posts repayments: a repayment event reduces the outstanding balance, and the loan may settle only when that balance reaches zero. The function must never mutate its input.

Audience: you are writing for a senior fintech frontend/full-stack engineer who will review this as production state-machine code. They already know TypeScript discriminated unions and double-entry accounting, so do not explain language features or accounting basics.

Constraints:
- Money is integer centavos only, as a branded type `type Centavos = number & { readonly __brand: 'Centavos' }` (₱1,050.00 = 105000). No floating-point currency math anywhere.
- Every repayment produces a double-entry journal entry whose lines satisfy Σ debits === Σ credits in centavos, using the accounts `wallet_clearing:gcash` or `wallet_clearing:maya`, `loans_receivable:<borrowerId>`, and `interest_income`. A repayment is split into a principal portion and an interest portion.
- Every mutation carries an `Idempotency-Key`; replaying the same key returns the original result without posting a second journal entry.
- Every mutation carries an `If-Match` loan version. A stale version returns `{ ok: false, status: 409, code: 'VERSION_MISMATCH' }` and an illegal transition returns `{ ok: false, status: 409, code: 'ILLEGAL_TRANSITION' }`. Never throw for these cases.
- Named exports only (no `export default`), zero `any`, TypeScript `strict: true`.

Output format: Return the entire response strictly as a single valid JSON object with the keys `typesCode`, `stateMachineCode`, `ledgerCode`, and `complexityAnalysis`, under 120 lines total.
```

</details>

**Representative output excerpt** (each line below is one physical line of the response, shortened
with `…`. Full, unshortened: [`run-4-format.md`](./prompt-ladder/run-4-format.md)):

```json
{
"typesCode": "export type Centavos = number & { readonly __brand: 'Centavos' };\nexport type WalletChannel = 'gcash' | 'maya';\n … \nexport type Loan =\n  | (LoanCore & { readonly status: 'APPLIED' | 'UNDER_REVIEW' | 'APPROVED' | 'CANCELLED' })\n  | (LoanCore & { readonly status: 'REJECTED'; readonly reason: string })\n  | (LoanCore & Funded & { readonly status: 'DISBURSED' | 'REPAYING' | 'DELINQUENT' | 'DEFAULTED' })\n …",
"stateMachineCode": "import type { Fail, JournalEntry, Loan, LoanEvent, ProcessedKey, TransitionResult } from './types';\n … \n    case 'DELINQUENT':\n      if (e.type === 'CURE') return go({ ...base, status: 'REPAYING', … });\n      return e.type === 'DECLARE_DEFAULT' ? go({ … }) : illegal();\n …",
"ledgerCode": "… export const isValidRepayment = (principal: unknown, interest: unknown, outstanding: Centavos): boolean =>\n  isCentavos(principal) && isCentavos(interest) && … && principal <= outstanding;\n …",
"complexityAnalysis": "Time: transitionLoan is O(1) for state dispatch … (5) REPAY is legal only in REPAYING, so a DELINQUENT loan has to CURE first. That is a policy choice. …"
}
```

**Four notes**

1. **What changed in the prompt:** I added a Specified Output Format that forces the entire response
   into a single JSON object with four keys, capped at 120 lines.
2. **What actually improved in the output:** nothing worth having. **This layer made the output
   worse.** It did obey the JSON keys, it still compiles, and the core replay and `409` checks still
   pass, but it got there by quietly giving up correctness elsewhere.
3. **What still failed (all checked by the probe):**
   - **The line cap was gamed, not met.** It's 7 physical JSON lines, but the code decodes to **121
     lines** (over the cap), with lines up to 187 characters. Everything is escaped `\n` and `\"`,
     so nothing can be pasted or reviewed as code.
   - **Interest stopped being tracked.** `outstanding` became principal-only, and the caller supplies
     any interest it likes. The probe booked **99,999,999 centavos of `interest_income` against a
     1-centavo principal repayment, and it was accepted.** Run 3 stopped this because it tracks
     outstanding interest itself.
   - **`DELINQUENT` loans can no longer take repayments.** Run 3 allowed them. A borrower in arrears
     can't pay their arrears.
   - **State data collapsed to fit:** `APPLIED | UNDER_REVIEW | APPROVED | CANCELLED` share one variant,
     so `CANCELLED` lost its `reason`, and `DELINQUENT` / `DEFAULTED` lost their timestamps.
   - *Brief vs. reality:* the brief predicted 4 states silently deleted and a `// TODO: validate sum`.
     **All 10 states survived, and the balance check is real.** The damage was subtler: the model met
     the budget by simplifying the money logic, which is worse because it isn't visible.
4. **What I would try next:** roll back the JSON wrapper and the line cap entirely. Then add
   Verification Requirements (an invariant table plus executable Vitest assertions), so a
   simplification like this one would fail a test instead of passing silently.

---

## Run 5 · Version 5: Verification Requirements (V4 rolled back)

**Layer added:** verification requirements. **Version 3's text is unchanged** (Run 4's JSON wrapper
and line cap are rolled back), plus:

```text
Verification requirements:
1. Include an invariant verification table listing each invariant, where the code enforces it, and
   which test proves it.
2. Include a Vitest test file with executable assertions proving that:
   (a) Σ debits === Σ credits in integer centavos for every journal entry, including a final repayment
       split into principal and interest (e.g. ₱1,050.00 = 100000 principal + 5000 interest);
   (b) replaying the same `Idempotency-Key` returns `replayed: true` and does not post a second
       journal entry;
   (c) a stale `If-Match` version and an illegal transition each return a 409 result.
3. Before finishing, check your implementation against every test and fix any mismatch you find.
```

> **Why there's no "clean Markdown code blocks" line:** the brief suggested keeping V3 "with clean
> modular Markdown code blocks." That instruction is itself a second, format layer, so it was left out
> to keep this a single-layer run.

<details>
<summary><strong>Full assembled prompt for Version 5</strong> (Version 3 + Verification; Version 4 rolled back; 376 words, exactly as sent)</summary>

```text
Write a pure TypeScript function `transitionLoan(loan, event)` that moves a loan through a Philippine micro-lending lifecycle with exactly these 10 states: APPLIED, UNDER_REVIEW, APPROVED, DISBURSED, REPAYING, SETTLED, DELINQUENT, DEFAULTED, REJECTED, and CANCELLED. The legal transitions are: APPLIED → UNDER_REVIEW → APPROVED → DISBURSED → REPAYING → SETTLED, plus UNDER_REVIEW → REJECTED, APPROVED → CANCELLED, REPAYING → DELINQUENT, DELINQUENT → REPAYING, and DELINQUENT → DEFAULTED. The same function also posts repayments: a repayment event reduces the outstanding balance, and the loan may settle only when that balance reaches zero. The function must never mutate its input.

Audience: you are writing for a senior fintech frontend/full-stack engineer who will review this as production state-machine code. They already know TypeScript discriminated unions and double-entry accounting, so do not explain language features or accounting basics.

Constraints:
- Money is integer centavos only, as a branded type `type Centavos = number & { readonly __brand: 'Centavos' }` (₱1,050.00 = 105000). No floating-point currency math anywhere.
- Every repayment produces a double-entry journal entry whose lines satisfy Σ debits === Σ credits in centavos, using the accounts `wallet_clearing:gcash` or `wallet_clearing:maya`, `loans_receivable:<borrowerId>`, and `interest_income`. A repayment is split into a principal portion and an interest portion.
- Every mutation carries an `Idempotency-Key`; replaying the same key returns the original result without posting a second journal entry.
- Every mutation carries an `If-Match` loan version. A stale version returns `{ ok: false, status: 409, code: 'VERSION_MISMATCH' }` and an illegal transition returns `{ ok: false, status: 409, code: 'ILLEGAL_TRANSITION' }`. Never throw for these cases.
- Named exports only (no `export default`), zero `any`, TypeScript `strict: true`.

Verification requirements:
1. Include an invariant verification table listing each invariant, where the code enforces it, and which test proves it.
2. Include a Vitest test file with executable assertions proving that:
   (a) Σ debits === Σ credits in integer centavos for every journal entry, including a final repayment split into principal and interest (e.g. ₱1,050.00 = 100000 principal + 5000 interest);
   (b) replaying the same `Idempotency-Key` returns `replayed: true` and does not post a second journal entry;
   (c) a stale `If-Match` version and an illegal transition each return a 409 result.
3. Before finishing, check your implementation against every test and fix any mismatch you find.
```

</details>

**Representative output excerpt** (full: [`run-5-verification.md`](./prompt-ladder/run-5-verification.md)).
The test that matches the One Action, word for word:

```ts
it('double-clicked Disburse: the second request is replayed and posts no second entry', () => {
  const approved = loanIn('APPROVED');
  const click: LoanEvent = {
    type: 'DISBURSE',
    wallet: 'gcash',
    idempotencyKey: nextKey(),
    ifMatch: approved.version,
  };

  const first = expectOk(transitionLoan(approved, click));
  const second = expectOk(transitionLoan(first.loan, click)); // stale If-Match on purpose

  expect(first.replayed).toBe(false);
  expect(second.replayed).toBe(true);
  expect(second.loan).toBe(first.loan);
  expect(second.journalEntry).toBe(first.journalEntry);
  expect(second.loan.journal.filter((e) => e.kind === 'DISBURSEMENT')).toHaveLength(1);
});

it('accepts exactly the 11 legal (state, event) pairs and rejects the other 89 with 409', () => {
  // … loops every status × every event type …
  expect(rejected).toBe(89);
});
```

Plus a 12-row invariant table in the output (excerpt):

| # | Invariant | Enforced in | Proven by |
|---|---|---|---|
| 2 | Σ debits === Σ credits for every entry | Built that way in `applyRepayment`; the `isBalanced` gate returns a 500 instead of posting | (a) "final repayment of ₱1,050.00…" |
| 7 | Stale `If-Match` → `409 VERSION_MISMATCH`, nothing posted | Version check in `transitionLoan`, before `decide` | (c) "stale If-Match: second admin…" |
| 8 | Same key replays: `replayed: true`, no second entry | Lookup in `loan.idempotency`, checked before `If-Match` | (b) "double-clicked Disburse…" |

**Four notes**

1. **What changed in the prompt:** I rolled back Run 4's JSON wrapper and line cap, and added
   Verification Requirements to Version 3: an invariant table, Vitest assertions for (a) centavo balance
   with a principal/interest split, (b) idempotent replay and (c) `409`s, and a self-check pass.
2. **What actually improved in the output (measured):**
   - **It's the first output with executable proof.** It comes with a 12-test Vitest file, and I ran
     it: **12/12 pass**. Implementation and tests type-check with **0 errors** under this repo's strict
     flags.
   - **It tests 100% of illegal transitions.** An exhaustive matrix sends every event to every state,
     accepts the 11 legal pairs and rejects **all 89 others with a typed `409`**, which meets FL-01
     T1 "Done Well" #2. A deep-freeze test proves purity on both success and failure.
   - **It restored what Run 4 lost.** Interest is tracked again: the finance charge is fixed at
     `APPROVE`, and a ₱1.00 payment books at most the outstanding interest. `DELINQUENT` loans accept
     partial repayments again. Both were checked by the same probe that caught Run 4: **2/2 pass**.
   - **The self-check reported 3 fixes.** The output says that while tracing its tests it found and
     fixed 3 mismatches: replay was checked after `If-Match`, a zero-value interest line was posted,
     and a full payoff from `DELINQUENT` was allowed. **I can only confirm that the final code
     passes.** The pre-fix code isn't in the output, so whether those bugs existed is the model's
     claim, not something I verified.
   - *Brief vs. reality:* the brief predicted it would catch a `payment === principalBalance`
     settlement bug. That bug never appeared.
3. **What still failed:**
   - **The model didn't run its own tests.** It says so: "I have not executed it." Its verification
     pass was hand-tracing, so the proof only exists because I ran it. CI or a human still has to.
   - **The implementation is still one module of 417 lines** mixing money, ledger and reducer, plus
     a 368-line test file. That's not this repo's `types.ts` / `ledger.ts` / `loanStateMachine.ts` split.
   - `CANCEL` carries no `reason` (Run 3's did).
   - A full payoff from `DELINQUENT` is rejected until `CURE`. That's a literal reading of the
     transition list, and a business-policy question I still need to decide.
   - **The prompt itself isn't reusable.** It hardcodes `MicroCredit API` vocabulary (`gcash` / `maya`,
     `Centavos`, these 10 states, these account names). An engineer building a checkout, booking or
     billing flow would have to rewrite it.
4. **What I would try next:** turn the domain-specific parts into documented placeholders, and add the
   two lessons this ladder taught (no JSON or line-cap wrappers; always run the tests yourself). That
   gives the stranger-ready template below.

> **Decision (2026-11-06): Run 5's code is not merged into `src/`.** The One Action is double-clicking
> **Disburse**, and that path is already covered by `src/features/disbursement/` (5 states, with
> `Idempotency-Key` + `If-Match` tests). The repayment states (`REPAYING`, `SETTLED`, `DELINQUENT`, …)
> don't strengthen the One Claim yet, so they wait until a repayment feature is the assignment. When
> that happens, Run 5 is the starting point. First decide whether a `DELINQUENT` loan may be paid off
> in full without `CURE` (Run 5 forbids it), then adapt it to `src/utils/money.ts` and the
> `CLAUDE.md` §11 rules.

---

## Final Reusable Prompt Template

### 🧩 Final Reusable Prompt Template: High-Integrity Frontend State Machine & Idempotent Mutation Builder

This is Version 5 with every MicroCredit-specific detail replaced by a placeholder. Fill in the
placeholders, delete the `[…]` guidance, and paste the result into a fresh Claude chat.

```text
Goal:
Write a pure TypeScript function `transition[ENTITY_NAME](entity, event)` that moves a [ENTITY_NAME]
through exactly these states and only these legal transitions:
[VALID_STATES_AND_TRANSITIONS]
The same function also handles these value-moving events: [VALUE_EVENTS]. The function must never
mutate its input.

Audience: you are writing for a senior frontend/full-stack engineer who will review this as
production state-machine code. They already know TypeScript discriminated unions and
[DOMAIN_BACKGROUND], so do not explain language features or domain basics.

Constraints:
- Every amount is an integer number of [MONETARY_OR_INVARIANT_UNIT], as a branded type
  `type [UNIT_TYPE] = number & { readonly __brand: '[UNIT_TYPE]' }`. No floating-point arithmetic on
  these values anywhere.
- [INVARIANT_RULE]
- Every mutation carries [CONCURRENCY_KEYS]. Replaying the same idempotency key returns the original
  result without applying anything a second time. A stale version returns
  `{ ok: false, status: 409, code: 'VERSION_MISMATCH' }` and an illegal transition returns
  `{ ok: false, status: 409, code: 'ILLEGAL_TRANSITION' }`. Never throw for these cases.
- Named exports only (no `export default`), zero `any`, TypeScript `strict: true`.

Verification requirements:
1. Include an invariant verification table listing each invariant, where the code enforces it, and
   which test proves it.
2. Include a Vitest test file with executable assertions proving that:
   (a) [INVARIANT_RULE] holds for every value-moving event, including [HARDEST_EDGE_CASE];
   (b) replaying the same idempotency key returns `replayed: true` and applies nothing twice;
   (c) a stale version and an illegal transition each return a 409 result.
3. Before finishing, check your implementation against every test and fix any mismatch you find.
```

**Placeholders**

| Placeholder | What to put there | MicroCredit value (the tested one) |
| ----------- | ----------------- | ---------------------------------- |
| `[ENTITY_NAME]` | The thing that changes state | `Loan` |
| `[VALID_STATES_AND_TRANSITIONS]` | Every state, then every legal `FROM → TO` edge. Anything not listed is illegal. | The 10 states, `APPLIED → … → SETTLED`, plus 5 branches |
| `[VALUE_EVENTS]` | What moves value, and when the entity may finish | "a repayment reduces the outstanding balance; the loan may settle only when that balance reaches zero" |
| `[DOMAIN_BACKGROUND]` | The domain knowledge your reviewer already has | `double-entry accounting` |
| `[MONETARY_OR_INVARIANT_UNIT]` / `[UNIT_TYPE]` | The smallest indivisible unit, and its branded type name | centavos / `Centavos` (₱1,050.00 = 105000) |
| `[INVARIANT_RULE]` | The rule that must never break, with the exact names involved | "every repayment produces a journal entry whose lines satisfy Σ debits === Σ credits, using `wallet_clearing:gcash`/`maya`, `loans_receivable:<borrowerId>` and `interest_income`; a repayment splits into principal and interest" |
| `[CONCURRENCY_KEYS]` | The headers or fields that make mutations safe to retry and race | "an `Idempotency-Key` and an `If-Match` loan version" |
| `[HARDEST_EDGE_CASE]` | The one concrete case most likely to be wrong | "a final repayment of ₱1,050.00 = 100000 principal + 5000 interest" |

**Example fills for other Frontend AI track projects** (untested; the MicroCredit column above is the
only one actually run):

| Placeholder | E-commerce checkout | SaaS billing |
| ----------- | ------------------- | ------------ |
| `[ENTITY_NAME]` | `Order` | `Invoice` |
| `[VALID_STATES_AND_TRANSITIONS]` | `CART → PENDING_PAYMENT → PAID → FULFILLED`, `PENDING_PAYMENT → CANCELLED`, `PAID → REFUNDED` | `DRAFT → OPEN → PAID`, `OPEN → PAST_DUE → PAID`, `OPEN → VOID` |
| `[MONETARY_OR_INVARIANT_UNIT]` | cents (`Cents`) | cents (`Cents`) |
| `[INVARIANT_RULE]` | "Σ line items + tax − discounts === amount charged" | "Σ payments ≤ invoice total; PAID only when equal" |
| `[CONCURRENCY_KEYS]` | "an `Idempotency-Key` per payment attempt and an `If-Match` order version" | "an `Idempotency-Key` per charge and an `If-Match` invoice version" |

**Three rules this ladder earned**

1. **Never wrap code in JSON or cap its line count** (Run 4). The model will meet the budget by quietly
   simplifying the logic, not by writing tighter code.
2. **Always run the tests yourself** (Run 5). The model can't execute code in a chat, and its
   "verification pass" is hand-tracing. Paste the code into your repo and run your test runner.
3. **Ask for the invariant table** (Run 5). It's the fastest way to review an output: every row must
   name a test, and a row without one is a claim nobody checked.

---

## Measurements

Re-run all of this yourself from the repository root (after `npm install`). It writes only to a
temporary directory:

```bash
python3 -I docs/prompt-ladder/harness/measure.py
```

| Run | Code lines | Longest line | Strict tsc errors | `any` | `export default` | `throw` | `/ 100` | Classes | Our 10 states named | Model's own tests | Prose words | Tests run (model's own + our probe) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run-0-baseline | 423 | 100 | 0 | 0 | 0 | 9 | 1 | 3 | 7 | 0 | 264 | 4 passed (4) |
| run-0-control | 613 | 120 | 10 | 0 | 0 | 8 | 0 | 2 | 5 | 1 | 349 | node:test 13/13 (plain-strict tsc errors: 0); 4 passed (4) |
| run-1-goal | 187 | 105 | 0 | 0 | 0 | 3 | 0 | 0 | 10 | 0 | 280 | — |
| run-2-audience | 278 | 117 | 0 | 0 | 0 | 2 | 0 | 0 | 10 | 0 | 357 | — |
| run-3-constraints | 496 | 119 | 0 | 0 | 0 | 1 | 0 | 0 | 10 | 0 | 345 | 4 passed (4) |
| run-4-format | 121 | 187 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 378 | 6 passed (6) |
| run-5-verification | 417 | 107 | 0 | 0 | 0 | 1 | 0 | 0 | 10 | 1 | 760 | 14 passed (14) |

**How to read it**

- **Strict tsc** uses this repo's TypeScript 7 and the flags required by `CLAUDE.md` §2. Every run
  compiled cleanly, so the differences between versions are in *behavior*, which is what the probes
  test. Run 5's own test file was also type-checked separately: 0 errors.
- **Probes** are in [`harness/probes/`](./prompt-ladder/harness/probes/). "Passed" means the probe's
  expectations held, *including* the ones that document a flaw. For example, Run 4's probe asserts
  that 99,999,999 centavos of interest **is** accepted, and Run 0's asserts that `transition()`
  **does** mutate its input. Each probe test is named after what it checks.
- **Run 4's 121 code lines** are measured after decoding the JSON strings. The response itself was 7
  physical lines.
- **The Run 0 control** ran its own 13 `node:test` tests, compiled with plain `strict` as its reply
  claimed. Its "Strict tsc errors" (10) use this repo's stricter flags, like every other row.
- **Run 1 and Run 2 have no probe.** Their prompts didn't ask for idempotency or `If-Match`, so there
  is nothing to probe. Their gaps are visible in the code and noted above.
