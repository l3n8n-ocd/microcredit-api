# CLAUDE.md — MicroCredit API

Guidance for AI assistants (and humans) contributing to this repository. Read this
file before writing or changing any code. These rules are **mandatory**, not
suggestions — this project handles money and credit decisions for vulnerable
borrowers.

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
