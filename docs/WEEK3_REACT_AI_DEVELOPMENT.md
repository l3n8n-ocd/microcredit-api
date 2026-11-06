# Week 3 · React App Development with AI

FlyRank Frontend AI Engineering, Week 3. The task: build React features with AI, record the prompts,
explain how AI helped, and show the manual corrections in two commits (AI first pass, then code-review
refactor).

| Commit | Hash | What it is |
| --- | --- | --- |
| 1 · AI first pass | `4d2e502` | `feat(scoring): add initial AI-generated alt-data credit scoring and repayment workbench` |
| 2 · Code-review refactor | `f24c143` | `refactor(scoring): extract pure score engine, fix centavo split invariant, and add WCAG live regions` |
| 3 · This document | see `git log` | `docs(week3): document React AI development prompts, workflow assistance, and manual refactors` |

> **Read this first: who did what.** Claude Code (an AI agent) wrote all the code in **both** commits.
> Lenon wrote the brief, which named the first-pass flaws and the four refactor targets in advance.
> So the Commit 1 flaws were **seeded on request, not discovered**. Commit 2 is Claude Code working
> through Lenon's review checklist, not a hand-written refactor. Both commits carry Lenon's name
> because he asked for that authorship. Section 3 lists what review found that the brief did *not*
> predict. **TODO (Lenon):** read the Commit 2 diff yourself and sign off below. Until then, "human
> code review" means a human-written checklist, not a human reading every line.

---

## Section 1 · Completed Application Overview & Live Demo Flow

Everything is in one screen, under the existing Disburse form, in [`src/App.tsx`](../src/App.tsx). Both
panels share one in-memory mock API: [`createDisbursementServer`](../src/features/disbursement/disbursementServer.ts).
There is no real backend, wallet or borrower data. The five businesses in
[`src/features/scoring/applicants.ts`](../src/features/scoring/applicants.ts) are fictional.

| Feature | Files | What it does |
| --- | --- | --- |
| Underwriting workbench | `src/features/scoring/UnderwritingWorkbench.tsx`, `scoreEngine.ts` | Scores 3 alt-data signals out of 1000: utility bills (Meralco / water) 350, supplier invoices 350, load top-ups 300. Shows each factor, its reason codes and a recommended limit in `Centavos`. Offers only the legal action: `APPLIED → UNDER_REVIEW`, then `UNDER_REVIEW → APPROVED` or `→ REJECTED` with the reason codes. |
| Queue filter and search | `useUnderwritingQueue.ts` | Filters by `ALL`, `APPLIED`, `UNDER_REVIEW`, `APPROVED`, `DISBURSED`, `REPAYING`, `SETTLED` or `REJECTED`. Searches by business name, loan ID or borrower ID, debounced by 250 ms. |
| Repayment and reversal panel | `RepaymentPanel.tsx`, `src/features/disbursement/ledger.ts` | Posts a repayment as DEBIT `wallet_clearing:gcash`, CREDIT `loans_receivable:<borrower>` and CREDIT `interest_income`. Posts a compensating reversal that names the original entry in `reversesEntryId`. |
| 10-state lifecycle | `src/features/disbursement/types.ts`, `loanStateMachine.ts` | `LoanState` is a discriminated union of all 10 states. `transitionLoan` returns a typed `409` for an illegal pair and a typed `422` for a bad amount. |
| Loan commands API | `disbursementServer.ts` → `command()` | Every review decision, repayment and reversal sends `Idempotency-Key` and `If-Match`. A known key is replayed **before** the version is compared, the same order `disburse` uses. |

**Demo flow** (run on the built app in Chromium at 360×740, on Commit 2):

1. Open the page. Disburse and "Simulate double-click / network retry" are still above the fold:
   `npm run test:e2e` passes 6/6, with Simulate's bottom edge at 717 px of 740.
2. Scroll to **Underwriting workbench**. Press **Review** on `L-1044` (Liza's Bigasan & Load). Focus
   moves to the detail heading: *"L-1044 · Liza's Bigasan & Load · UNDER_REVIEW"*.
3. Read the score: 702 / 1000, `LOW` risk, ₱25,000.00 limit, reason code `UTIL_LATE_PAYMENTS`.
4. Press **Approve offer**. The live region says *"L-1044 is now APPROVED (v3). It is now in the
   Disburse form."* `L-1044` appears in the Disburse form's loan list.
5. Disburse ₱5,000.00 to `L-1044` with the form above.
6. In **Post a repayment**, choose `L-1044` and enter `1,000.00`. The preview shows principal
   ₱952.39 and interest ₱47.61. Post it. Ledger: `Σ (balanced) ₱6,000.00 ₱6,000.00`.
7. In **Reverse a repayment**, choose `JE-0002` and post. Ledger: `Σ (balanced) ₱7,000.00 ₱7,000.00`.
   `JE-0002` is no longer offered for reversal.

The same steps on **Commit 1** end at step 6 with `Σ (UNBALANCED) ₱6,000.00 ₱5,999.99`: one centavo
gone. Section 4, diff 1 shows why.

**Deployment, verified 2026-11-06:** the [deployed demo](https://microcredit-api-beta.vercel.app) builds
from `main` on Vercel.
- It serves `assets/index-CNnzWv_L.js`, the same content hash as a local `npm run build` of `main` at `2a52c9e`.
- Steps 2–7 above were run in Chromium against the live URL. Focus went to the L-1044 heading.
- After the repayment the ledger read `Σ (balanced) ₱6,000.00 ₱6,000.00`, and after the reversal
  `Σ (balanced) ₱7,000.00 ₱7,000.00`.
- The page did not scroll sideways at 360 px.
- `e2e/fold.mjs`, pointed at the live URL, passed 6/6 (Simulate's bottom edge at 717 px of 740).
- CI run #15 on `2a52c9e` passed.

---

## Section 2 · Exact Prompts Used During Development

### 2.1 The prompt that was actually sent

There was **one** prompt, Lenon's brief, sent to Claude Code in this repository. It is reproduced
verbatim below. Its first sentence asked for an unrelated FL-02 template run, which is documented in
[`FL-02_PROMPTING_FUNDAMENTALS.md`](./FL-02_PROMPTING_FUNDAMENTALS.md#template-verification-run).

<details>
<summary>Full prompt (verbatim)</summary>

````text
run one more test of the final template. also, we are completing the FlyRank Week 3 Frontend AI Engineering assignment ("React app development with AI") directly inside our unified `microcredit-api` repository (`https://github.com/l3n8n-ocd/microcredit-api`) so that our entire internship stays in one cohesive system and repo.

First, read `CLAUDE.md`, `README.md`, `package.json`, `.oxlintrc.json`, `src/App.tsx`, and `src/features/disbursement/` so you respect all existing architecture rules, branded `Centavos` invariants, named exports, and `oxlint` / Playwright / Vitest checks. Do NOT delete or overwrite any existing Week 1 or Week 2 documentation or tests.

The assignment requires 4 core deliverables:
1. The completed React application/features live in our app.
2. The exact prompts used during development.
3. A short explanation of how AI assisted throughout the implementation.
4. Concrete examples of manual improvements, corrections, or refactoring performed after reviewing AI-generated code (backed by two distinct Git commits showing the AI First Pass vs. Human Code-Review Refactor).

Please execute the following workflow step-by-step on `main`:

Step 1: AI First-Pass Feature Build (Commit 1)
Expand `microcredit-api` by building the Alternative Credit Scoring & Full 10-State Lifecycle Workbench (`src/features/scoring/` and updating `src/features/disbursement/`) and integrating it alongside the Disbursement view in `src/App.tsx` (while keeping the pre-filled Disbursement demo and "Simulate double-click / network retry" controls visible above the fold so our existing Playwright `test:e2e` check continues to pass!):
- What to build in `src/features/scoring/`:
1. Alternative-Data Trust Score Underwriting Workbench (`APPLIED` → `UNDER_REVIEW` → `APPROVED` / `REJECTED`):
- Interactive evaluator for unbanked Filipino micro-entrepreneurs (sari-sari store owners, market vendors, tricycle operators) scoring 3 alternative data signals: Utility Bill Consistency (Meralco/Water), Supplier Invoice History, and Telco/GCash Load Top-Up Cadence.
- Computes an explainable Trust Score (0–1000) with reason codes, recommended credit limit in integer `Centavos`, and one-click underwriting state transitions (`Approve Offer` or `Reject with Reason Codes`) that feed directly into the Disbursement queue.
2. Repayment & Compensating Reversal Ledger Panel (`DISBURSED` → `REPAYING` → `SETTLED` / `DELINQUENT` / `DEFAULTED`):
- Allows posting a borrower repayment in PHP (splitting principal vs. interest in integer `Centavos`, e.g., `debit wallet_clearing:gcash`, `credit loans_receivable`, `credit interest_income`) or posting an immutable compensating reversal entry referencing a prior transaction ID.
3. Borrower Queue Filter & Search Bar: Filter loans by lifecycle state (`ALL`, `APPLIED`, `UNDER_REVIEW`, `APPROVED`, `DISBURSED`, `REPAYING`, `SETTLED`, `REJECTED`) and search by borrower name/ID.
- Intentional "First-Pass AI" Imperfections in Commit 1 (while still passing `typecheck` and `lint`):
- Keep the trust-score calculation, filter state, and UI rendering tightly coupled inside a single component (`src/features/scoring/UnderwritingWorkbench.tsx`) without memoization or extracted custom hooks.
- Omit centavo remainder handling on odd principal/interest percentage splits (or use a naive split before refactoring).
- Leave minor accessibility/UX gaps (e.g., missing `aria-live="polite"` announcement when the Trust Score recalculates, and missing keyboard shortcut/focus management when switching tabs/panels).
- Verify `npm run typecheck`, `npm run lint`, and `npm test` pass, then commit Commit 1 with:
`feat(scoring): add initial AI-generated alt-data credit scoring and repayment workbench`

Step 2: Human Code-Review Corrections & Refactors (Commit 2)
Now perform the manual engineering review and refactor the Commit 1 code to fix 4 real-world issues in AI-generated React + Fintech code:
1. Refactor 1 — Pure Domain Extraction & Deterministic Centavo Remainder Allocation (`src/features/scoring/scoreEngine.ts`):
- Extract the Trust Score math and repayment principal/interest split out of the React component into pure, deterministic domain functions using branded integer `Centavos`, ensuring any odd-centavo rounding remainder is explicitly allocated so `principalCentavos + interestCentavos === totalPaymentCentavos` (`Σ debits === Σ credits`) never drifts by 1 centavo.
2. Refactor 2 — Custom Hook Extraction & Memoized Filtering (`src/features/scoring/useUnderwritingQueue.ts`):
- Extract queue filtering, search debouncing, and state-transition dispatch into a dedicated custom hook with `useMemo` and `useCallback` to prevent unnecessary re-renders across the ledger table.
3. Refactor 3 — Complete 10-State Discriminated Union & Compensating Reversal Guard (`src/features/disbursement/types.ts` & `ledger.ts`):
- Ensure all 10 loan states (`APPLIED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `CANCELLED`, `DISBURSED`, `REPAYING`, `DELINQUENT`, `SETTLED`, `DEFAULTED`) and immutable compensating reversal entries enforce `Idempotency-Key` + `If-Match` version checks.
4. Refactor 4 — WCAG AA Accessibility & Live Telemetry (`src/features/scoring/UnderwritingWorkbench.tsx`):
- Add explicit `<label htmlFor>`, `aria-describedby`, `aria-live="polite"` announcements on Trust Score updates and ledger balance assertions, and full keyboard navigation.
- Add comprehensive Vitest + Testing Library tests in `src/features/scoring/__tests__/UnderwritingWorkbench.test.tsx` covering the explainable Trust Score computation, `UNDER_REVIEW` → `APPROVED` transition, balanced repayment/reversal journal entries, and accessibility bindings.
- Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` to confirm both the unit tests and the above-the-fold Playwright check pass 100%.
- Commit Commit 2 with:
`refactor(scoring): extract pure score engine, fix centavo split invariant, and add WCAG live regions`

Step 3: Package the Week 3 Deliverable Documentation (Commit 3)
1. Create `docs/WEEK3_REACT_AI_DEVELOPMENT.md` containing a thorough, standalone breakdown of all 4 required assignment deliverables:
- Section 1: Completed Application Overview & Live Demo Flow (How the new Alternative Credit Scoring Workbench, 10-State Loan Lifecycle, and Repayment/Reversal Ledger integrate into `microcredit-api-beta.vercel.app`).
- Section 2: Exact Prompts Used During Development (Document the 5 sequential prompts used to design the domain types, build the alt-data scoring UI, wire the double-entry repayment/reversal ledger, audit accessibility/edge cases, and generate the Vitest suite).
- Section 3: How AI Assisted Throughout the Implementation (Concrete breakdown of how Claude Code accelerated React 19 component layout, Tailwind v4 styling, discriminated union scaffolding, and test boilerplate vs. where human architectural judgment was required).
- Section 4: Manual Improvements, Corrections & Refactoring Performed After Reviewing AI Code (4 side-by-side Before [Commit 1] vs. After [Commit 2] code diffs with file paths and commit hashes explaining why each manual correction was needed).
2. Update `README.md`:
- Update the ` Project Status` table so `Loan state machine`, `Double-entry ledger`, and `Credit scoring` reflect the newly shipped features (`✅ Built and tested`).
- Add a dedicated section under ` 🎓 FlyRank Internship Deliverables` for Week 3 · React App Development with AI containing a concise summary of the prompts used, how AI assisted, the 4 manual refactors, and a direct link to `docs/WEEK3_REACT_AI_DEVELOPMENT.md`.
3. Stage `docs/WEEK3_REACT_AI_DEVELOPMENT.md` and `README.md`, then commit with:
`docs(week3): document React AI development prompts, workflow assistance, and manual refactors`
4. Push `main` to `origin` and print the commit hashes for Commit 1, Commit 2, and Commit 3 along with the test results in the terminal.
````

</details>

### 2.2 How Claude Code worked through it, in 5 steps

The assignment asks for "5 sequential prompts". These 5 steps were **not separate prompts**. They are
the order Claude Code worked in after the one prompt above, recorded so the work can be checked.

| # | Step | Input it used | Output |
| --- | --- | --- | --- |
| 1 | Design the domain types | `CLAUDE.md`, `README.md` lifecycle table, `src/features/disbursement/types.ts` | Commit 1 kept 5 states and added `interest_income`. Commit 2 made the 10-state union, `JournalEntry.kind`, `RepaymentSplit` and the `LoanCommand` API. |
| 2 | Build the alt-data scoring UI | Brief items 1 and 3, `SEED_LOANS` | Commit 1: one coupled `UnderwritingWorkbench.tsx`. Commit 2: `scoreEngine.ts`, `applicants.ts`, `useUnderwritingQueue.ts`. |
| 3 | Wire the double-entry repayment / reversal ledger | Brief item 2, README "Example: ₱5,000.00 disbursement + ₱1,050.00 repayment" | Commit 2: `buildRepaymentJournal`, `buildReversalJournal` and `server.command()`. |
| 4 | Audit accessibility and edge cases | `CLAUDE.md` §6 and §11 rule 1, a real Chromium run | Labels, `aria-invalid`, `aria-describedby`, live regions and focus moves. Overpayment and terminal-state guards. |
| 5 | Generate the Vitest suite | §11 rules 3 and 4 | 144 new or extended tests, plus 4 mutation checks (Section 4). |

### 2.3 Reusable 5-prompt sequence (derived, not run)

To repeat this with a fresh AI chat, split the brief into these prompts and send them in order. **Not
run as written.** They are the brief, reorganised.

<details>
<summary>The 5 prompts</summary>

````text
1 · Domain types
Read src/features/disbursement/types.ts and the README lifecycle table. Extend LoanState to a
discriminated union of exactly these 10 states: APPLIED, UNDER_REVIEW, APPROVED, REJECTED,
CANCELLED, DISBURSED, REPAYING, SETTLED, DELINQUENT, DEFAULTED. Each state carries only the data
that exists in it. Money is branded integer Centavos. Add LoanCommand request/response types that
require the Idempotency-Key and If-Match headers. No `any`, named exports only.

2 · Scoring UI
Write a pure scoreEngine.ts: 3 alt-data signals (utility bills 350, supplier invoices 350, load
top-ups 300) to a 0–1000 integer score, reason codes, a band, and a limit table in Centavos within
₱500 – ₱50,000 in ₱100 steps. Then a React 19 workbench that lists the queue, filters by state,
searches by name or ID (debounced), and offers only the legal review action per state.

3 · Ledger
Add buildRepaymentJournal (DEBIT wallet_clearing = CREDIT loans_receivable + CREDIT interest_income)
and buildReversalJournal (mirror every line, name the original, reverse only a REPAYMENT, only once).
Split repayments so principal + interest === total for every total: floor the interest, give the
remainder to principal. Add a server command endpoint that replays a known Idempotency-Key before
comparing If-Match.

4 · Accessibility and edge cases
Audit against CLAUDE.md §6 and §11 rule 1: <label htmlFor>, aria-invalid on every control,
aria-describedby to hint and error, one role="alert" summary and focus on the first invalid field,
aria-live="polite" for results, the trust score and the ledger balance. List edge cases: overpayment,
double reversal, reversing a disbursement, a reversal on a SETTLED loan, a stale If-Match.

5 · Tests
Write Vitest + Testing Library tests for each invariant and each control. For each money or
concurrency invariant, revert the fix and show the test fails (mutation check).
````

</details>

---

## Section 3 · How AI Assisted Throughout the Implementation

**Where Claude Code saved time**

| Area | What it produced | Evidence |
| --- | --- | --- |
| React 19 layout | Both panels, `useId`-based IDs, the render-time "adjust state when a prop changes" pattern for `revision` | `UnderwritingWorkbench.tsx`, `RepaymentPanel.tsx` |
| Tailwind v4 styling | Mobile-first classes matching the existing form, `peer-checked:` radio chips, `sr-only` captions | No horizontal scroll at 360 px: `scrollWidth` 360 in the Chromium run |
| Discriminated unions | 10 `LoanState` variants from shared `Funded` / `Outstanding` parts, `JournalEntry` split by `kind` | `tsc -b` 0 errors under `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` |
| Test boilerplate | Fixtures, deterministic UUID v4 key factories, table-driven pairs | 247 tests in 8 files (was 103 in 5) |

**Where judgment was needed: problems the brief did not predict**

| # | Problem | How it showed up | Fix |
| --- | --- | --- | --- |
| 1 | Live-syncing the Disburse form broke an existing test | Commit 1's first draft subscribed the form to every server change. Then the "stale second admin screen" test could not go stale: its screen refreshed itself, so it got a client-side error instead of `409 VERSION_MISMATCH`. | Panels on **one** screen pass a `revision` counter through `App.tsx`. A second screen does not share it, so its `If-Match` stays stale, as in real life. The existing test is unchanged and passes. |
| 2 | Commit 1's reversal could reverse a disbursement | The reversal list offered every entry, `JE-0001` included. Reversing it posts money that never moved. | `buildReversalJournal` refuses any entry whose `kind` is not `REPAYMENT` (`NOT_REVERSIBLE`). |
| 3 | jsdom computed "ReviewL-1044" as a button name | A visually hidden `<span>` gave real browsers "Review L-1044", but jsdom joined it with no space, so 5 tests could not find the button. | `aria-label="Review L-1044"`. It contains the visible word "Review", so it meets WCAG 2.5.3 (label in name). |
| 4 | The money grep check caught `INTEREST_RATE_BPS / 100` | The `CLAUDE.md` §11 rule 2 check flags `/ 100`, even for a label. | `formatBps(500)` → `"5.00%"` with string operations only. |
| 5 | Two wrong expectations in AI-written tests | A pair count of 110 (it is 10 × **10** = 100), and a reason-code list including `LOAD_SHORT_HISTORY` (Liza has 10 months, above the 6-month line). | Fixed in the tests, not the code. The code was right both times. |

**Brief vs. reality**

| The brief said | What happened |
| --- | --- |
| "5 sequential prompts used" | One prompt (2.1). The 5 steps (2.2) and the 5 prompts (2.3) are labelled for what they are. |
| "Human Code-Review Refactor" | Claude Code applied Lenon's 4-point checklist. Lenon's own line-by-line review is a TODO. |
| Commit 1 passes typecheck, lint and test | It did: 103/103 tests. Build and `test:e2e` (6/6) passed too. |
| Commit 1 on `main` | Both code commits were made locally and pushed **together**, so CI and the Vercel deploy never built the Commit 1 centavo bug on its own. |
| 10 states enforcing `Idempotency-Key` + `If-Match` | Done for loan commands. Two edges were added beyond the README diagram: `DISBURSED → SETTLED` (one full repayment), and reversal self-loops on `REPAYING` / `DELINQUENT`. The README diagram is updated. A reversal on a `SETTLED` loan is refused (`409`), because `SETTLED` is terminal. |
| Existing Week 1 / 2 tests untouched | Every existing test case still runs and passes. One file was **extended**: `loanStateMachine.test.ts`'s fixture grew from 5 to 10 states, and its count test from 20 to 100 pairs. That was required, because the old 5-key fixture no longer type-checks against 10 states. No case was deleted. `DisbursementForm.tsx` gained two optional props (`revision`, `onServerChange`). |

---

## Section 4 · Manual Improvements, Corrections & Refactoring

Each diff shows the Commit 1 code, then the Commit 2 code, with the file and hash. Each fix has a
**mutation check**: its guard was switched off again, and the test run had to fail. All 4 failed, and
all 247 tests passed once each guard was restored.

| Mutant (guard switched off) | Result |
| --- | --- |
| 1 · Commit 1's float split put back in `splitRepayment` | 7 tests failed |
| 2 · `ALREADY_REVERSED` check skipped | 2 tests failed |
| 3 · `If-Match` compared before the replay lookup | 3 tests failed |
| 4 · Overpayment allowed (`principal > owed` check removed) | 2 tests failed |

### Diff 1 · Centavo split: two floors drop a centavo → remainder allocation

**Before**, [`src/features/scoring/UnderwritingWorkbench.tsx`](https://github.com/l3n8n-ocd/microcredit-api/blob/4d2e502/src/features/scoring/UnderwritingWorkbench.tsx) at `4d2e502`, lines 146–172:

```tsx
function postRepayment() {
  if (repayLoan === undefined || repayLoan.status !== 'DISBURSED') return
  const parsed = parsePesosToCentavos(repayAmount)
  if (!parsed.ok) {
    setMessage('Invalid amount')
    return
  }
  const total = parsed.value
  const principal = toCentavos(Math.floor(total / (1 + INTEREST_RATE)))
  const interest = toCentavos(Math.floor((total * INTEREST_RATE) / (1 + INTEREST_RATE)))
  const outstanding = repayments[repayLoan.id]?.outstanding ?? repayLoan.disbursedAmount
  const id = `JE-${String(ledger.length + 1).padStart(4, '0')}`
  server.appendEntry({
    id,
    loanId: repayLoan.id,
    idempotencyKey: crypto.randomUUID(),
    lines: [
      { account: `wallet_clearing:${repayLoan.provider}`, side: 'DEBIT', amount: total },
      { account: `loans_receivable:${repayLoan.borrowerId}`, side: 'CREDIT', amount: principal },
      { account: 'interest_income', side: 'CREDIT', amount: interest },
    ],
  })
  refresh()
  const left = outstanding - principal
  setRepayments({ ...repayments, [repayLoan.id]: { status: left <= 0 ? 'SETTLED' : 'REPAYING', outstanding: left } })
  setMessage(`Posted ${id}: principal ${formatPHP(principal)}, interest ${formatPHP(interest)}.`)
}
```

**After**, [`src/features/scoring/scoreEngine.ts`](https://github.com/l3n8n-ocd/microcredit-api/blob/f24c143/src/features/scoring/scoreEngine.ts) at `f24c143`, lines 142–159:

```ts
/**
 * Splits a repayment `total` into principal and interest with remainder allocation.
 *
 * A payment of P × (1 + r) covers principal P plus interest P × r, so the interest
 * share of any payment is total × r / (1 + r). That share is computed in BigInt
 * and floored (the borrower is never over-charged a fraction of a centavo), and
 * principal takes the remainder. So `principal + interest === total`, always,
 * with no rounding of two halves independently.
 *
 * Example (README): ₱1,050.00 = 105000 → interest 5000, principal 100000.
 */
export function splitRepayment(total: Centavos, rateBps: number = INTEREST_RATE_BPS): RepaymentSplit {
  if (total <= 0) throw new RangeError('Repayment total must be positive')
  if (!Number.isSafeInteger(rateBps) || rateBps < 0) throw new RangeError('Rate must be whole basis points ≥ 0')
  const interest = (BigInt(total) * BigInt(rateBps)) / BigInt(BPS_PER_UNIT + rateBps)
  const interestCentavos = toCentavos(Number(interest))
  return { principal: toCentavos(total - interestCentavos), interest: interestCentavos }
}
```

**Why.** With `INTEREST_RATE = 0.05`, a ₱1,000.00 payment is `floor(95238.09…) + floor(4761.90…)` =
`95238 + 4761` = `99999`. The DEBIT line used `total` (`100000`), so the entry was off by 1 centavo, and
the ledger footer read `UNBALANCED`. Flooring two parts on their own can drop the remainder. Flooring one
part and giving the rest to the other cannot. Integer BigInt math also stays exact past
`Number.MAX_SAFE_INTEGER`, which a test covers. `buildRepaymentJournal` now sets the DEBIT to
`sumCentavos([principal, interest])` and throws if Σ debits !== Σ credits.

*Tests:* `scoreEngine.test.ts` checks `principal + interest === total` for all 100,000 totals from 1 to
100,000 centavos, plus `100000 → 95239 + 4761`.

### Diff 2 · Coupled component → pure engine plus a memoized hook

**Before**, `UnderwritingWorkbench.tsx` at `4d2e502`, lines 117–127 and 252–259:

```tsx
const rows = loans
  .filter((loan) => filter === 'ALL' || statusOf(loan) === filter)
  .filter((loan) => {
    const applicant = APPLICANTS.find((a) => a.borrowerId === loan.borrowerId)
    const q = search.toLowerCase()
    return (
      loan.id.toLowerCase().includes(q) ||
      loan.borrowerId.toLowerCase().includes(q) ||
      (applicant?.name.toLowerCase().includes(q) ?? false)
    )
  })
```

```tsx
<p className="text-3xl font-semibold">{score(selectedApplicant).total} / 1000</p>
<ul className="text-sm text-slate-300">
  <li>Utility bill consistency ({selectedApplicant.utility.provider}): {score(selectedApplicant).utilityPoints} / 350</li>
  <li>Supplier invoice history: {score(selectedApplicant).supplierPoints} / 350</li>
  <li>Telco / GCash load top-up cadence: {score(selectedApplicant).loadPoints} / 300</li>
</ul>
<p className="text-sm">Reason codes: {score(selectedApplicant).codes.join(', ') || 'none'}</p>
<p className="text-sm">Recommended limit: {formatPHP(score(selectedApplicant).limit)}</p>
```

**After**, [`src/features/scoring/useUnderwritingQueue.ts`](https://github.com/l3n8n-ocd/microcredit-api/blob/f24c143/src/features/scoring/useUnderwritingQueue.ts) at `f24c143`, lines 93–107:

```ts
// Scores depend only on the profiles, so they are computed once, not per render or per row.
const scores = useMemo(
  () => new Map(profiles.map((profile) => [profile.borrowerId, scoreApplicant(profile.signals)])),
  [profiles],
)
const rows = useMemo<readonly QueueRow[]>(
  () =>
    loans.map((loan) => ({
      loan,
      profile: profiles.find((profile) => profile.borrowerId === loan.borrowerId) ?? null,
      score: scores.get(loan.borrowerId) ?? null,
    })),
  [loans, profiles, scores],
)
const visibleRows = useMemo(() => filterQueue(rows, filter, debouncedQuery), [rows, filter, debouncedQuery])
```

**Why.** Commit 1 called `score()` 6 times for the selected borrower and once per queue row, on
every render and every keystroke. It also kept `REPAYING` / `SETTLED` in a component-local
`repayments` map, so the server's `LoanState` still said `DISBURSED`. The scoring rules now live in a
pure module that tests can call without React. The hook scores each profile once (`useMemo` on
`profiles`), filters on a debounced query, and exposes one `send()` with a ref guard against a
double click. Loan state now lives only on the server.

### Diff 3 · Unguarded reversal without headers → guarded, idempotent command

**Before**, `UnderwritingWorkbench.tsx` at `4d2e502`, lines 174–194:

```tsx
function postReversal() {
  const original = ledger.find((entry) => entry.id === reverseId)
  if (original === undefined) return
  const id = `REV-${original.id}`
  server.appendEntry({
    id,
    loanId: original.loanId,
    idempotencyKey: crypto.randomUUID(),
    lines: original.lines.map((line) => ({ ...line, side: line.side === 'DEBIT' ? 'CREDIT' : 'DEBIT' })),
  })
  refresh()
  const principalLine = original.lines.find((line) => line.account.startsWith('loans_receivable'))
  const current = repayments[original.loanId]
  if (current !== undefined && principalLine !== undefined) {
    setRepayments({
      ...repayments,
      [original.loanId]: { status: 'REPAYING', outstanding: current.outstanding + principalLine.amount },
    })
  }
  setMessage(`Posted ${id} reversing ${original.id}.`)
}
```

**After**, [`src/features/disbursement/ledger.ts`](https://github.com/l3n8n-ocd/microcredit-api/blob/f24c143/src/features/disbursement/ledger.ts) at `f24c143`, lines 100–110, and
[`disbursementServer.ts`](https://github.com/l3n8n-ocd/microcredit-api/blob/f24c143/src/features/disbursement/disbursementServer.ts), lines 200–212:

```ts
export function buildReversalJournal(input: ReversalJournalInput): ReversalResult {
  const original = input.ledger.find((entry) => entry.id === input.reversesEntryId)
  if (original === undefined) {
    return { ok: false, code: 'ENTRY_NOT_FOUND', message: `No journal entry ${input.reversesEntryId}.` }
  }
  if (original.kind !== 'REPAYMENT') {
    return { ok: false, code: 'NOT_REVERSIBLE', message: `${original.id} is a ${original.kind}; only repayments can be reversed.` }
  }
  if (isReversed(input.ledger, original.id)) {
    return { ok: false, code: 'ALREADY_REVERSED', message: `${original.id} has already been reversed.` }
  }
```

```ts
// 1. Idempotent replay, before If-Match (a retry carries the pre-commit version).
const stored = commandResults.get(key)
if (stored !== undefined) {
  if (stored.fingerprint !== print) {
    return {
      kind: 'UNPROCESSABLE',
      status: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This Idempotency-Key was already used with a different payload.',
    }
  }
  return { kind: 'REPLAYED', status: 200, loan: stored.loan, journalEntry: stored.journalEntry }
}
```

**Why.** Commit 1 had four faults in the reversal:
- It linked the reversal only by a naming convention (`REV-JE-0002`).
- Pressing reverse twice posted two entries with the same ID.
- It could reverse the disbursement itself.
- It sent a fresh random key and no `If-Match`, so a retry or a second admin posted again.

Now a `REVERSAL` entry names its original in `reversesEntryId`. Only a `REPAYMENT` can be reversed,
and only once. Every command carries both headers, and a known key replays before the version check,
so a legitimate retry is never a false `409`.

*Tests:* `repayment.test.ts` covers two concurrent same-key repayments (one entry plus a `REPLAYED`),
a new key with a stale `If-Match` (`409`, no entry), a double reversal (`ALREADY_REVERSED`), and a
reversal of a disbursement (`NOT_REVERSIBLE`).

### Diff 4 · Placeholder-only inputs and a silent message → labelled controls and live regions

**Before**, `UnderwritingWorkbench.tsx` at `4d2e502`, lines 212–217 and 314:

```tsx
<input
  value={search}
  onChange={(e) => setSearch(e.target.value)}
  placeholder="Search borrower name or ID"
  className="w-full rounded bg-slate-900 px-3 py-2 text-slate-100"
/>
{message && <p className="text-sm text-slate-300">{message}</p>}
```

**After**, [`UnderwritingWorkbench.tsx`](https://github.com/l3n8n-ocd/microcredit-api/blob/f24c143/src/features/scoring/UnderwritingWorkbench.tsx) at `f24c143`, lines 38–46, 89–96 and 142–161:

```tsx
const detailHeadingRef = useRef<HTMLHeadingElement>(null)
const searchRef = useRef<HTMLInputElement>(null)
const focusDetail = useRef(false)
useEffect(() => {
  if (focusDetail.current) {
    focusDetail.current = false
    detailHeadingRef.current?.focus()
  }
})
```

```tsx
<div role="status" aria-live="polite" className="text-sm">
  {announcement?.tone === 'success' && (
    <p className="rounded-md border border-emerald-400 bg-emerald-950 p-3 text-emerald-100">
      <span aria-hidden="true">✓ </span>
      {announcement.text}
    </p>
  )}
</div>
```

```tsx
<div className="space-y-1">
  <label htmlFor={searchId} className="block text-sm font-medium">
    Search borrower name or loan ID
  </label>
  <input
    ref={searchRef}
    id={searchId}
    type="search"
    value={queue.query}
    onChange={(event) => {
      queue.setQuery(event.target.value)
    }}
    aria-invalid="false"
    aria-describedby={`${searchHintId} ${countId}`}
    className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 focus:ring-2 focus:ring-emerald-400 focus:outline-none"
  />
  <p id={searchHintId} className="text-xs text-slate-300">
    e.g. Liza or L-1044. The list updates when you stop typing.
  </p>
</div>
```

**Why.** A placeholder is not a label: it disappears as you type, and screen readers may skip it.
Commit 1's result line was a plain `<p>`, so a screen-reader user heard nothing after Approve or
Post. Its filter was a row of plain buttons with no selected state, and its rows were clickable
`<tr>`s with no keyboard access. Now:
- every control has a `<label htmlFor>`, an `aria-invalid`, and an `aria-describedby` pointing to its hint;
- results go to a `role="status"` region and failures to a `role="alert"` region;
- the trust score and the ledger balance (`Σ debits === Σ credits`) are `aria-live="polite"`;
- the filter is a native radio group, so arrow keys move between states;
- **Review** is a real `<button>`, and focus moves to the detail heading after a choice or an action;
- a failed repayment focuses the first invalid field under one alert summary (`CLAUDE.md` §11 rule 1).

*Tests:* `UnderwritingWorkbench.test.tsx` runs `getByLabelText` and checks `aria-invalid` and
`aria-describedby` on all 12 controls. It also checks focus after Review, Approve and a failed
submit, the live regions, and `disabled` + `aria-busy` while a request is in flight.

---

## Checks run on Commit 2

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` (oxlint, `--deny-warnings`) | exit 0 |
| `npm test` | 247 passed, 8 files |
| `npm run build` | exit 0 |
| `npm run test:e2e` | 6/6: Disburse and Simulate above the fold at 360×740 and 1280×800; Simulate → 1 created, 1 replayed |
| `CLAUDE.md` §11 rule 2 money grep | no lines |
| 4 mutation checks | 4/4 failed as expected; 247/247 after restore |

**Sign-off (TODO, Lenon):** ☐ I read the Commit 2 diff and agree with the four corrections.
