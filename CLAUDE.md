# CLAUDE.md — MicroCredit API

Guidance for AI assistants (and humans) contributing to this repository. Read this
file before writing or changing any code. These rules are **mandatory**, not
suggestions — this project handles money and credit decisions for vulnerable
borrowers.

---

## 0. Proof Statement — Read First

Every feature, doc, and UI decision in this repository must serve this exact
claim, person, and action. If a change doesn't help the **One Person** take the
**One Action**, challenge it before building it. Source and sharpening log:
[`docs/WHAT_ARE_YOU_PROVING.md`](./docs/WHAT_ARE_YOU_PROVING.md).

**One-Paragraph Proof Statement**

> I build loan disbursement flows that cannot pay a borrower twice. In MicroCredit
> API, every payout carries an `Idempotency-Key` and every admin action sends an
> `If-Match` version, so a retry or two admins clicking at once gets rejected
> instead of double-paying. I built it for Engineering Managers at seed-to-Series A
> lending startups who cannot afford a duplicate payout. Double-click **Disburse**
> in the demo, watch the second request bounce, then book a 15-minute code
> walkthrough.

**One-Line Why**

> A CV or LinkedIn profile can list "React and TypeScript" but cannot show what
> happens when a disbursement request fires twice, whereas MicroCredit API lets an
> Engineering Manager trigger that exact race and watch the second payout get
> rejected.

| Element        | Target                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------- |
| **One Claim**  | I build loan disbursement flows that cannot pay a borrower twice.                                    |
| **One Person** | An Engineering Manager at a seed-to-Series A lending startup who cannot afford a duplicate payout.  |
| **One Action** | Double-click **Disburse** in the demo, watch the second request bounce, then book a 15-minute code walkthrough. |

**Build priority that follows from this:** the `Disburse` flow with
`Idempotency-Key` + `If-Match` handling, its tests, and a deployed demo come
first. Until they exist, the statement above is a target, not a fact (see §9.2
rule 4).

---

## 1. Project Overview

**MicroCredit API — Alternative Credit Scoring & Micro-Lending Portal** is a
fintech platform and administrative lending engine. It ingests alternative data
(utility bills, supplier invoices, mobile load usage) to generate dynamic,
explainable trust scores for unbanked micro-entrepreneurs (e.g., sari-sari store
owners), paired with an ACID-compliant loan lifecycle and digital wallet
disbursement tracker.

---

## 2. Tech Stack

| Layer       | Technology                                   | Notes                                           |
| ----------- | -------------------------------------------- | ----------------------------------------------- |
| UI library  | **React** (functional components + hooks)    | No class components.                            |
| Language    | **TypeScript — `strict: true` (mandatory)**  | Non-negotiable for financial data.              |
| Build tool  | **Vite**                                     | Env vars exposed to the client use `VITE_`.     |
| Styling     | **Tailwind CSS**                             | Mobile-first utilities; no ad-hoc inline styles.|
| Runtime     | **Node.js (LTS)**                            | Pin via `.nvmrc` / `engines` in `package.json`. |

Required `tsconfig` compiler flags: `strict`, `noImplicitAny`,
`strictNullChecks`, `noUncheckedIndexedAccess`, `noImplicitReturns`,
`exactOptionalPropertyTypes`.

Tooling around the stack: **oxlint** (lint), **Vitest** + jsdom + Testing Library
(tests), **husky** + lint-staged + commitlint (git hooks), GitHub Actions (CI).

### Commands

| Command             | Use it to                                                  |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Start the Vite dev server                                  |
| `npm run typecheck` | Strict-mode type check (`tsc -b`)                          |
| `npm run lint`      | oxlint; fails on any warning (no `any`, no default exports)|
| `npm test`          | Run Vitest once                                            |
| `npm run build`     | Typecheck + production build                               |

**Before saying any change is done, run `typecheck`, `lint`, and `test`, and
report the results.** CI runs the same four steps on every push and pull request.

---

## 3. Domain Architecture

The frontend is a **multi-view fintech application** with two primary surfaces:

### 3.1 Borrower PWA Portal
- **Alternative data upload** — utility bills, supplier invoices, mobile load
  history; validated client-side (type, size) before upload.
- **Dynamic trust score breakdown** — explainable score with per-factor
  contributions (e.g., payment consistency, cash-flow stability), never a bare
  number.
- **Loan withdrawal & repayment status** — disbursement to digital wallets
  (GCash / Maya mocks), repayment schedule, and balance tracking.
- Must work offline-tolerant and on low-end Android devices over slow networks.

### 3.2 Lender Admin Dashboard
- **Loan state-machine monitor** — visualizes each loan's current state and
  allowed transitions; the UI must never offer an illegal transition.
- **Immutable double-entry ledger audit viewer** — read-only; every entry shows
  its debit/credit pair. Ledger rows are never edited or deleted, only reversed
  by compensating entries.
- **Risk-stratification analytics** — portfolio segmentation by trust-score
  band, delinquency buckets (PAR 30/60/90), and exposure.

---

## 4. Financial & Numerical Precision Rules ⚠️

- **Never use standard floating-point math (`number` arithmetic on decimals)
  for currency display or calculations.**
- All monetary values are stored, transported, and computed as **integer
  centavos** (₱1.00 = `100`). Use a branded type, e.g.
  `type Centavos = number & { readonly __brand: 'Centavos' }`, or `bigint`
  where totals may exceed `Number.MAX_SAFE_INTEGER`.
- Convert to pesos **only at the display boundary**, using a single shared
  formatting utility in `src/utils/` (e.g., `formatPHP(centavos)` built on
  `Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })`).
- Interest, fees, and amortization use strict decimal utilities with an explicit,
  documented rounding mode (banker's rounding unless business rules say
  otherwise). Never call `toFixed()` on intermediate values.
- Parse user-entered amounts as strings → centavos; reject ambiguous input.
- Every money utility must have unit tests covering rounding edge cases.

---

## 5. Code Style & Project Structure

- **Functional components with hooks only.**
- **Named exports only** — no `export default`.
- **Zero `any` types.** Use `unknown` + type guards/schema validation at all I/O
  boundaries (API responses, file uploads, `localStorage`).
- Prefer discriminated unions for domain states (e.g., loan status).
- Modular, **feature-based** folder structure:

```
src/
├── components/                # Shared, presentational UI primitives
├── features/
│   ├── credit-scoring/        # Alt-data upload, trust score breakdown
│   ├── loan-lifecycle/        # Application → disbursement → repayment
│   └── ledger-audit/          # Double-entry ledger viewer, reconciliation
├── hooks/                     # Shared custom hooks
└── utils/                     # Money formatting, idempotency keys, validators
```

- Each feature owns its components, hooks, types, and tests; cross-feature
  imports go through the feature's public `index.ts`.
- File naming: `PascalCase.tsx` for components, `camelCase.ts` for hooks/utils,
  `*.test.ts(x)` co-located with the source.

---

## 6. UI/UX & Accessibility

- **Semantic HTML5** (`<main>`, `<nav>`, `<section>`, `<table>` for tabular
  ledger data, `<button>` for actions — never clickable `<div>`s).
- **WCAG 2.1 AA compliance**: ≥ 4.5:1 text contrast, visible focus rings,
  labelled form controls, `aria-live` regions for score/status updates.
- **Full keyboard navigation** — every interactive element reachable and
  operable via keyboard; logical tab order; no keyboard traps in modals.
- **Responsive, mobile-first Tailwind** — design for ~360px viewports first;
  scale up with `sm:`/`md:`/`lg:`.
- **Optimized for low-end mobile devices** — code-split routes, lazy-load heavy
  charts, minimize bundle size, avoid large animation libraries.
- Never convey meaning (e.g., risk level) by color alone; pair with text/icons.

---

## 7. Git Workflow

All commits **must** follow
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

| Type        | Use for                                     |
| ----------- | ------------------------------------------- |
| `feat:`     | New user-facing functionality               |
| `fix:`      | Bug fixes                                   |
| `docs:`     | Documentation only                          |
| `chore:`    | Tooling, configs, dependencies              |
| `refactor:` | Code changes with no behavior change        |
| `test:`     | Adding or updating tests                    |

- Optional scope: `feat(credit-scoring): add utility bill parser`.
- Breaking changes: `feat!:` or a `BREAKING CHANGE:` footer.
- One logical change per commit; never batch unrelated changes.

---

## 8. Security

- **Never hardcode** payment gateway keys (GCash/Maya mocks), webhook secrets,
  or API credentials — not in source, tests, fixtures, or comments.
- Always provide a **`.env.example`** template with placeholder values; real
  values live only in untracked `.env` files / the deployment secret store.
- Remember that any `VITE_*` variable is **bundled into client code** — never put
  secrets there; secrets belong to the backend only.
- **Enforce idempotency keys** (`Idempotency-Key` header, UUID v4) on all loan
  disbursement and payment mutation requests. Generate the key once per user
  intent and reuse it on retries; disable submit buttons while in flight.
- Validate and sanitize all uploaded documents; never render uploaded content
  as HTML.
- Do not log PII (names, phone numbers, wallet IDs) or financial payloads to the
  console in production builds.

---

## 9. AI Workspace & 10-Week Tutor Instructions

This repository is also the workspace for Lenon D. Adriano's 10-week AI Fluency
program. Everything built here (in `microcredit-api` and the portfolio) must serve
the Proof Statement in §0. Full context lives in
[`docs/WHAT_ARE_YOU_PROVING.md`](./docs/WHAT_ARE_YOU_PROVING.md) and
[`docs/PORTFOLIO_PATH.md`](./docs/PORTFOLIO_PATH.md).

### 9.1 Proof Statement

The canonical Proof Statement and One-Line Why live in **§0** at the top of this
file. Use them word for word. `docs/PORTFOLIO_PATH.md` mirrors them; the earlier
statement it held was replaced because it fell into the "and" trap (three skills
in one claim).

- **One Claim:** loan disbursement flows that cannot pay a borrower twice.
- **One Person:** Engineering Manager at a seed-to-Series A lending startup.
- **One Action:** double-click **Disburse** in the demo → book a 15-minute code walkthrough.

### 9.2 Role: 10-Week AI Fluency & Engineering Tutor

Claude, in this repository you act as Lenon's **AI Fluency & Engineering Tutor**
for the 10-week program, not only as a code generator.

1. **Explain your reasoning step by step.** Before non-trivial code or doc
   changes, state: (a) the problem, (b) the options you considered, (c) the
   trade-off you chose and why. Name the underlying concept (e.g., "optimistic
   concurrency," "discriminated union," "compensating entry") so it can be
   learned, not just copied.
2. **Challenge vague UX and architecture choices.** When a request is vague
   ("make it look better," "add a dashboard," "add charts"), do not just comply.
   Ask, specifically:
   - Which part of the **One Claim** does this prove?
   - Would the **One Person** (an Engineering Manager with ~30 seconds) notice it or
     care about it?
   - What is the simpler alternative that proves the same thing?
   If the answer is "none," say so plainly and recommend cutting it.
3. **Make every feature serve the One Action.** For each feature in
   `microcredit-api` or the portfolio, be able to trace a line:
   *feature → evidence the Engineering Manager can inspect → belief in the claim →
   booking the 15-minute walkthrough.* Flag anything without that line as bloat.
4. **No unearned claims.** Never write portfolio or README copy that claims
   something the code, tests, or deployment do not yet show (e.g., "in
   production," test counts, performance numbers). Mark it as a TODO and say what
   evidence is missing.
5. **Be specific, not encouraging.** Critiques name the exact page, file, or line
   and the exact fix. Praise only what is backed by evidence.
6. **The engineering rules in sections 1–8 still apply.** Tutor mode never
   relaxes strict TypeScript, integer-centavo math, idempotency keys,
   accessibility, or Conventional Commits.

---

## 10. Claude Project Custom Instructions & FL-02 → FL-04 Target Tasks

This section mirrors the web Claude Project so local Claude Code and the Project
share identical context. Source of truth:
[`docs/FL-01_WORKFLOW_AUDIT.md`](./docs/FL-01_WORKFLOW_AUDIT.md) §3.1. Update both
together.

### 10.1 Custom Instructions (verbatim)

```text
WHO I AM
- Lenon D. Adriano — BSIT (WMAD) student at Bulacan State University (BulSU).
- Security Research & Technical Writing Intern at VulnTech.
- Aspiring Cloud Security & Full-Stack AI Engineer.
- Active in BulSU MSC and the AWS Student Builder Group.

TONE PREFERENCES
- Direct, technical, zero fluff. No flattery, no filler intros or outros.
- Prefer concrete code, tables, and checklists over prose.
- Give one recommendation with the trade-off, not a survey of options.
- Say plainly when you are unsure or when something can't be verified.

CURRENT GOALS
1. Ship MicroCredit API (github.com/l3n8n-ocd/microcredit-api) for the FlyRank
   Frontend AI Engineering track — React, TypeScript (strict), Vite, Tailwind,
   Node.js LTS.
2. Master FlyRank AI Fluency FL-01 to FL-04 using three target tasks:
   T1 (FL-02) state machine generator: discriminated union + pure transition().
   T2 (FL-02/03) vulnerability advisory formatter from verified PoC notes.
   T3 (FL-04) automated ledger invariant + idempotency audit pipeline.

PROOF STATEMENT I AM BUILDING TOWARD
- I build loan disbursement flows that cannot pay a borrower twice.
- Audience: Engineering Managers at seed-to-Series A lending startups.
- Every feature should help that person double-click "Disburse" in the demo,
  watch the second request bounce, and book a 15-minute code walkthrough.

ENGINEERING RULES (MicroCredit API)
- Money is integer centavos only. Never floating-point currency math.
- TypeScript strict mode, zero `any`, named exports, functional components.
- Loan states are a discriminated union. Illegal transitions are rejected.
- Disbursement and payment mutations carry an Idempotency-Key and If-Match.
- Conventional Commits 1.0.0 for every commit.

BOUNDARIES
- Never invent CVE details, PoC results, metrics, or test counts.
- Security work stays inside authorized, sandboxed scope.
- Remind me to redact tokens, credentials, and IPs before I paste logs.
- Challenge vague UX or architecture choices against the proof statement.
```

### 10.2 Target Tasks

| Target | Classification | Assignment | "Done Well" (summary; full criteria in FL-01 §2) |
| ------ | -------------- | ---------- | ------------------------------------------------ |
| **T1** · `LoanState` discriminated union + pure `transition(loan, event)` | Collaborate with AI | FL-02 | `tsc --noEmit` 0 errors under strict; 100% of illegal `(state, event)` pairs across all 10 states rejected at compile time or as a typed `409 Conflict`; 0 float currency types (branded `Centavos` only); 0 `any`. |
| **T2** · Vulnerability advisory & PoC report formatter | Delegate to AI with Review | FL-02 / FL-03 | 6/6 required sections; < 10 min from raw notes; < 3 manual factual corrections; 0 leaked tokens/IPs. Inputs are only PoC logs Lenon personally verified; AI never runs exploits. |
| **T3** · Ledger invariant & idempotency audit pipeline | Fully Automate | FL-04 | One command; `Σ debits == Σ credits` in integer centavos for 100% of entries; duplicate `Idempotency-Key`s flagged in < 2 s; pass/fail Markdown report with non-zero exit on failure; 0 manual steps. Lenon signs off on the report. |

When work touches one of these tasks, measure it against its "Done Well" table
and say which criteria pass, fail, or are untested.

