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
| Framework   | **Next.js (App Router)**                     | Server Components by default; `'use client'` only on interactive leaves. `next build`. |
| Styling     | **Tailwind CSS v4**                          | Mobile-first utilities; Identity Kit tokens in `src/app/globals.css`. |
| Runtime     | **Node.js (LTS)**                            | Pin via `.nvmrc` / `engines` in `package.json`. |

Required `tsconfig` compiler flags: `strict`, `noImplicitAny`,
`strictNullChecks`, `noUncheckedIndexedAccess`, `noImplicitReturns`,
`exactOptionalPropertyTypes`.

Tooling around the stack: **oxlint** (lint), **Vitest** + jsdom + Testing Library
(tests; Vite is kept only as the Vitest engine via `vite.config.ts`), **husky** +
lint-staged + commitlint (git hooks), GitHub Actions (CI). Capstone spec: [`SPEC.md`](./SPEC.md).

### Commands

| Command             | Use it to                                                  |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Start the Next.js dev server (App Router)                  |
| `npm run typecheck` | Strict-mode type check (`tsc --noEmit`)                    |
| `npm run lint`      | oxlint; fails on any warning (no `any`, no default exports except Next route files)|
| `npm test`          | Run Vitest once (497 tests in `src/`, `playground/`, `agents/`) |
| `npm run build`     | Production build (`next build`)                            |
| `npm run agent:run` | FL-07: run SentinelScout once over MCP stdio; writes `docs/drafts/latest-triage-brief.md` |
| `npm run agent:eval` | FL-07: the 6 FL-06 eval cases; exits 1 unless 6/6 pass |
| `npm run test:e2e:fe08` | FE-08: after `build`, the sabotage drill (32 browser checks) and the 4 Checkpoint 1 screenshots |
| `npm run test:e2e:fe07` | FE-07: after `build`, the tool cards (14 browser checks) and the 6 tool-state screenshots |
| `npm run test:e2e`  | After `build`: Playwright `e2e/*.spec.ts`, the primary flow and `/motion-lab` (`playwright test`, `next start`, mocked `/api/chat`) |
| `npm run test:e2e:fold` | After `build`: above-the-fold on `/`, all routes responsive at 375px/1280px, the AI Copilot streaming / Stop / scroll checks, and keyboard-only checks on `/playground` |

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

### 9.3 Standing Voice Card

> **Voice Card:** "Direct, technical, plainspoken, concrete, zero buzzwords."

This applies to every portfolio paragraph, case study, README blurb and sitemap line, in this repo
and in the Claude Project.

<!-- voice-check:off -->
1. **Banned filler:** "results-driven", "passionate", "seamless", "cutting-edge", "leveraged" (any
   form of "leverage"), "synergy", "robust". Rewrite the sentence; don't swap in a synonym.
<!-- voice-check:on -->
2. **Name the real thing.** Every paragraph names at least one actual state transition
   (`APPROVED → DISBURSED`), HTTP header (`Idempotency-Key`, `If-Match`), integer-centavo invariant
   (`Σ debits === Σ credits`, `₱1.00 = 100`) or concrete file path (`src/utils/money.ts`).
3. **One breath.** Read each sentence out loud. If you can't say it in one breath, split it or cut it.
4. **Claims follow evidence** (§9.2 rule 4). Copy states only what the code, tests, deployment or a
   public link shows. Anything else is marked TODO.

*Check:* this prints nothing. Lines that quote the banned words on purpose (the rule above, the
"Before" column in `docs/FRAME_IT_AS_CASES.md`) sit between `voice-check:off` / `voice-check:on`
markers:

```bash
sed '/voice-check:off/,/voice-check:on/d' docs/FRAME_IT_AS_CASES.md | grep -niwE 'results-driven|passionate|seamless|cutting-edge|leverag(e|ed|es|ing)|synergy|robust'
```

### 9.4 Identity Kit Style Note

Source: [`docs/IDENTITY_KIT.md`](./docs/IDENTITY_KIT.md). Use exactly these 2 fonts and 4 hex codes for
the whole 10-week build. Paste the same two lines into the Claude Project's instructions.

> **Line 1 (Fonts & Hex Palette):** Heading & UI in Plus Jakarta Sans (`600`/`700`), technical/ledger data in JetBrains Mono (`400`/`500`); Palette: Near-White Background `F8FAFC`, Near-Black Text `0F172A`, Main Brand Slate `1E293B`, and Single Emerald Accent `059669`.
>
> **Line 2 (The Mood):** A calm, high-contrast ledger-sheet aesthetic with generous whitespace and zero decorative gradients, ensuring the interactive state machines, centavo accounting invariants, and security diffs remain the loudest things on the page.

Accent `059669` is never text on `F8FAFC` (3.60:1 fails AA). Use it as a fill under `0F172A` text
(4.74:1), a border, a dot, or a focus ring.

### 9.5 One-Line Claim (portfolio headline)

Source: [`docs/THE_THROUGH_LINE.md`](./docs/THE_THROUGH_LINE.md). The portfolio headline is the §0 One
Claim, word for word:

> **"I build loan disbursement flows that cannot pay a borrower twice."**

Do not reopen the "and" trap. The variant "frontend **and** full-stack payment flows" is rejected: it
lists two overlapping roles, and "full-stack" is unearned while MicroCredit API is a frontend on an
in-memory mock server (`src/features/disbursement/disbursementServer.ts`). Every section's call to action
ladders to the One Action: test the live double-click sandbox, then book a 15-minute walkthrough.

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

VOICE CARD (portfolio and case-study copy)
- "Direct, technical, plainspoken, concrete, zero buzzwords."
- Never write: results-driven, passionate, seamless, cutting-edge, leveraged, synergy, robust.
- Every paragraph names a real state transition, HTTP header, centavo invariant or file path.
- Every sentence must read naturally out loud in one breath.

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


---

## 11. Learned Rules from FE-03/FE-04 Workflow Drill

Source: [`WORKFLOW.md`](./WORKFLOW.md). Round 1 (`feat/disburse-form-vague`) passed
CI while violating each rule below; Round 2 (`feat/disburse-form-precise`) is the
reference implementation. A PR that breaks any rule is rejected.

1. **Every form control is bound and tested.** Each `<input>`, `<select>` and
   `<textarea>` has a `<label htmlFor>` equal to its `id`, renders
   `aria-invalid="true"|"false"` (never omitted), and has `aria-describedby`
   pointing at its hint, plus its `-error` element whenever an error is shown.
   A failed submit renders one `role="alert"` summary and moves focus to the
   first invalid field. *Check:* the feature's test file has a
   `getByLabelText(...)` + `aria-invalid` assertion for every field. A new field
   without one fails review.
2. **Money enters only through `parsePesosToCentavos`.** User-typed amounts are
   parsed string → `Centavos` by `src/utils/money.ts` and nowhere else; no
   `as Centavos` casts. Display goes through `formatPHP`. *Check:* this returns
   no lines:
   `grep -rnE "parseFloat|toFixed|\* ?100\b|/ ?100\b|as Centavos" src --include=*.ts --include=*.tsx | grep -v '\.test\.' | grep -vE ':[0-9]+:\s*(\*|//|/\*)'`.
   Parsers have tests for float drift (`"19.99"` → `1999`), more than 2 decimals,
   exponents (`"1e3"`), and a value past `Number.MAX_SAFE_INTEGER`.
3. **Money mutations carry `Idempotency-Key` + `If-Match`, replay first.** The
   request type declares both headers as required (non-optional) strings. The
   key comes from `createIdempotencyKey()` and changes only when the payload
   changes. The handler checks for a stored key *before* comparing versions.
   Submit is `disabled` and `aria-busy="true"` while in flight. *Check:* tests
   prove that (a) two concurrent same-key requests leave exactly one ledger
   entry, and (b) a new key with a stale `If-Match` returns `409` with no entry.
4. **Four green checks before every commit, plus a failing-first test for
   invariants.** `npm run typecheck`, `npm run lint`, `npm test` and
   `npm run build` all exit 0, and the results are reported. Vitest alone is not
   enough: an unused import passed Vitest but failed `tsc` in Round 2. A change
   to a money or concurrency invariant ships with a test in the same commit,
   and that test fails when the change is reverted (a mutation check).

---

## 12. Visual Constraints (Portfolio Design System)

Sources: [`docs/IDENTITY_KIT.md`](./docs/IDENTITY_KIT.md) for fonts and colours (it replaces the dark
palette and Inter from the design system doc), and
[`docs/PORTFOLIO_DESIGN_SYSTEM.md`](./docs/PORTFOLIO_DESIGN_SYSTEM.md) for framing rules. These apply to
every component an AI generates, in `src/` and on the portfolio site. The design frames the proof; it never
upstages it.

1. **Approved colours only.** Portfolio: the 4 Identity Kit colours (`#F8FAFC`, `#0F172A`, `#1E293B`,
   `#059669`) via the CSS variables in `docs/IDENTITY_KIT.md` §5. Demo app in `src/`: the Tailwind families already in use, `slate`,
   `emerald` (success), `rose` (409 / 422 / errors) and `amber` (Simulate / replay), plus `sky` for links
   and `white`. No other hue family, and no raw hex such as `text-[#ff00aa]`.
2. **Each colour keeps its one meaning.** Green only next to something that passed (`201`,
   `Σ debits === Σ credits`), red only next to a bounce. Never colour alone (§6).
3. **Two font families, everywhere.** Plus Jakarta Sans (headings, body, UI) and JetBrains Mono (code,
   headers, amounts, paths), self-hosted via `next/font/local` in `src/app/layout.tsx` and set as
   `--font-sans` / `--font-mono` in `src/app/globals.css`. No third family.
4. **No decorative clutter.** No gradients, `animate-*`, parallax, stock photos, abstract AI art or
   illustrations in the hero. Motion is at most a 150 ms transition and respects
   `prefers-reduced-motion`. *One exception:* the AI Copilot's "thinking" dots (`.copilot-dot` in
   `src/app/globals.css`) loop while a request is in flight. They report a state, they are not
   decoration, and they are static under `prefers-reduced-motion`. No second looping animation.
   *Scoped duration exception (FE-AA1):* `SmartActionButton` (`src/components/ui/SmartActionButton.tsx`)
   only: press 100 ms, label swap 220 ms, success spring 240 ms, error shake 320 ms (one shot, never
   loops), success hold 1400 ms. Transform and opacity only. Under reduced motion it drops to a 120 ms
   opacity crossfade with no translate, scale or shake. The shared `.smart-press` class may reuse the
   100 ms press transform on other primary buttons; colour still transitions at 150 ms. Nothing else
   goes past 150 ms. Tokens and reasons: `docs/PORTFOLIO_DESIGN_SYSTEM.md` "Motion: SmartActionButton".
5. **A new token, font or hue needs a reason in the design system doc first**, in the same commit.

*Check:* this prints nothing.

```bash
grep -rnoE "\b(bg|text|border|ring|outline|fill|stroke|from|via|to|shadow|divide|accent|caret|decoration)-(red|orange|yellow|lime|green|teal|cyan|blue|indigo|violet|purple|fuchsia|pink|gray|zinc|neutral|stone)-[0-9]{2,3}\b|-\[#[0-9a-fA-F]{3,8}\]|bg-gradient|bg-linear|animate-|font-serif|font-\[" src --include=*.tsx --include=*.ts --include=*.css
```

---

## 13. Week 4 Build Context Index

Load these three artifacts every session; they are the portfolio build's single source of truth.

| Artifact | File | What it fixes |
| --- | --- | --- |
| Identity Kit | [`docs/IDENTITY_KIT.md`](./docs/IDENTITY_KIT.md) | 2 fonts, 4 hex codes, the 2-line style note (§9.4) |
| Framed Case Studies | [`docs/FRAME_IT_AS_CASES.md`](./docs/FRAME_IT_AS_CASES.md) | 3-beat write-ups for MicroCredit API, Node2Shell, RoadWatch; the Voice Card (§9.3) |
| Content Map & CTA Ladder | [`docs/THE_THROUGH_LINE.md`](./docs/THE_THROUGH_LINE.md) | the 4 ordered sections and the single One Action (§9.5) |

- **Live shell:** [`/portfolio`](./src/app/portfolio/page.tsx) (https://microcredit-api-beta.vercel.app/portfolio)
  is the near-blank page these artifacts fill during build week.
- **Consolidated pack:** [`docs/EMPTY_BUT_LIVE.md`](./docs/EMPTY_BUT_LIVE.md) §2 has all three combined as
  one copy-paste Master Context Block for the Claude Project.
- The portfolio headline is the §9.5 canonical claim; contact is GitHub-only (no email).

---

## 14. Keep the Habit (FL-CAP): adding the next portfolio case

Source of truth: [`CLAUDE.md` in `l3n8n-ocd/portfolio`](https://github.com/l3n8n-ocd/portfolio/blob/main/CLAUDE.md)
and [`docs/FL-CAP_KEEP_THE_HABIT.md`](./docs/FL-CAP_KEEP_THE_HABIT.md) (a synced copy; the portfolio copy
wins).

- **Where cases live:** `CASES: CaseStudy[]` in the portfolio's `src/components/CapstoneAndProjects.tsx`.
  `impact` is the plain-English outcome line and is shown first. `facts` holds Beat 1, Beat 2 (1–2 items)
  and Beat 3.
- **Rules:**
  - MicroCredit API stays case `01`.
  - At most 4 cases in the main grid.
  - One primary button on the page: emerald "Book a 15-min walkthrough".
  - Every number on a card points to evidence here. No evidence means a TODO (§9.2 rule 4).
- **Next case:** Case 04, SentinelScout (FL-06 / FL-07, [`docs/FL-07_BUILD_LOG.md`](./docs/FL-07_BUILD_LOG.md)),
  is drafted in the FL-CAP doc §2. Queued: Case 05, an AWS IAM / VPC / KMS lab series, not built yet.
- **The portfolio is not on the Identity Kit (§9.4).**
  - It runs `#050816` dark / `#edf2ff` light, a violet `--primary`, Inter + JetBrains Mono, and an emerald
    `#10b981` CTA under `#022c22` text.
  - Moving it onto the Identity Kit is a separate design change. Do not slip it into a case-study commit.
- **Reminder:** the last Sunday of every month, 8:00 PM PHT, starting Nov 29, 2026, from the portfolio's
  `docs/reminders/add-next-case-study.ics`.
- **Next-case prompt:** the 6-line prompt in the portfolio `CLAUDE.md` §6. Run it in the portfolio repo,
  not here.
