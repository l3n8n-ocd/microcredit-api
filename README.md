# MicroCredit API

[![CI](https://github.com/l3n8n-ocd/microcredit-api/actions/workflows/ci.yml/badge.svg)](https://github.com/l3n8n-ocd/microcredit-api/actions/workflows/ci.yml)

> Alternative Credit Scoring & Micro-Lending Portal

**Live demo: [microcredit-api-beta.vercel.app](https://microcredit-api-beta.vercel.app)**.
The demo opens on a pre-filled sample payout. Double-click **Disburse** and only one request is
sent. Then use **Simulate
double-click / network retry** to send the same request twice: the second one is
replayed (same `Idempotency-Key`) or rejected with `409` (stale `If-Match`), and the
ledger posts the payout once. The demo runs against an in-memory mock API, so
state resets when you reload the page.

## Problem Statement

Millions of Filipino micro-entrepreneurs — sari-sari store owners, market
vendors, tricycle operators — are "unbanked": they have no formal credit history,
so banks turn them away. Many end up borrowing from informal **"5-6" lenders**,
who charge roughly 20% interest per month (lend ₱5, collect ₱6) and often use
aggressive collection practices.

**MicroCredit API** helps these borrowers get fair credit by scoring them on
**alternative data** they already have — utility bills, supplier invoices, and
mobile load usage — and producing an explainable trust score that lenders can
act on.

## Tech Stack

| Layer      | Tool                                               |
| ---------- | -------------------------------------------------- |
| UI         | React 19 (functional components, named exports)    |
| Language   | TypeScript 7, `strict` plus the extra flags in [`CLAUDE.md`](./CLAUDE.md#2-tech-stack) |
| Build      | Vite 8                                             |
| Styling    | Tailwind CSS 4 (via `@tailwindcss/vite`)           |
| Lint       | oxlint: no `any`, no default exports, hooks rules  |
| Tests      | Vitest 5 + jsdom + Testing Library                 |
| Git hooks  | husky + lint-staged + commitlint (Conventional Commits) |
| CI         | GitHub Actions: typecheck → lint → test → build    |
| Runtime    | Node.js 22 LTS (pinned in `.nvmrc`)                |

## Project Status

| Area | Status |
| ---- | ------ |
| Toolchain, lint, tests, git hooks, CI | ✅ In place |
| Next.js App Router skeleton (5 routed screens) | ✅ Built: `/`, `/underwriting`, `/ledger`, `/advisories`, `/health` (see [`SPEC.md`](./SPEC.md)) |
| `Disburse` flow with `Idempotency-Key` + `If-Match` | ✅ Built and tested in [`src/features/disbursement/`](./src/features/disbursement/), against an in-memory mock API (no real backend or wallet yet) |
| Loan state machine | ✅ Built and tested: all 10 states below as one discriminated union in [`loanStateMachine.ts`](./src/features/disbursement/loanStateMachine.ts); 100 `(state, event)` pairs tested, 88 illegal ones rejected as a typed `409` |
| Double-entry ledger | ✅ Built and tested: disbursement, repayment (principal + interest) and compensating-reversal entries in [`ledger.ts`](./src/features/disbursement/ledger.ts), each checked for `Σ debits === Σ credits`; in-memory mock API |
| Credit scoring | ✅ Built and tested: 3-signal trust score (0–1000) with reason codes and a limit in `Centavos`, in [`src/features/scoring/`](./src/features/scoring/); demo profiles only, no real borrower data |
| AI Underwriting & Ledger Risk Copilot (FE-06) | ✅ Built and tested: streaming chat on [`/underwriting#copilot`](https://microcredit-api-beta.vercel.app/underwriting#copilot) over `POST /api/chat`, with Stop, smart auto-scroll and `localStorage` history. Hosted-model requests pass an in-memory rate limit (10 a minute, 100 a day per client). The live URL answers with `gemini-3.5-flash-lite` on a free-tier Google key; without a key, or when its quota runs out, it answers from a local rule engine (labelled as such), not a language model ([`docs/FE-06_STREAMING_CHAT.md`](./docs/FE-06_STREAMING_CHAT.md) §1) |
| Deployed demo | ✅ [microcredit-api-beta.vercel.app](https://microcredit-api-beta.vercel.app) (Vercel, imported from `main`; mock API, no real wallet payouts) |

## Loan Lifecycle State Machine

Every loan is a finite state machine. Only the transitions below are legal; the
Lender Admin Dashboard renders actions **only** for the current state's allowed
transitions, and the API rejects anything else with `409 Conflict`.

```mermaid
stateDiagram-v2
    [*] --> APPLIED: Borrower submits application
    APPLIED --> UNDER_REVIEW: Alt-data docs uploaded
    UNDER_REVIEW --> APPROVED: Trust score ≥ threshold
    UNDER_REVIEW --> REJECTED: Score below threshold / failed KYC
    APPROVED --> DISBURSED: Wallet payout confirmed (idempotent)
    APPROVED --> CANCELLED: Borrower declines / offer expires
    DISBURSED --> REPAYING: First repayment posted
    DISBURSED --> SETTLED: One repayment clears all principal
    REPAYING --> REPAYING: Partial repayment posted / reversed
    REPAYING --> SETTLED: Outstanding balance = 0
    REPAYING --> DELINQUENT: Payment > 30 days past due
    DELINQUENT --> REPAYING: Arrears cured
    DELINQUENT --> DELINQUENT: Repayment reversed
    DELINQUENT --> DEFAULTED: Payment > 90 days past due
    REJECTED --> [*]
    CANCELLED --> [*]
    SETTLED --> [*]
    DEFAULTED --> [*]
```

| State          | Meaning                                          | Terminal |
| -------------- | ------------------------------------------------ | :------: |
| `APPLIED`      | Application created, awaiting documents          |          |
| `UNDER_REVIEW` | Alternative data being scored                    |          |
| `APPROVED`     | Offer issued; funds reserved, not yet sent       |          |
| `REJECTED`     | Application declined (reason codes shown)        |    ✅    |
| `CANCELLED`    | Approved offer declined or expired               |    ✅    |
| `DISBURSED`    | Funds sent to borrower's GCash/Maya wallet       |          |
| `REPAYING`     | At least one repayment posted, balance > 0       |          |
| `DELINQUENT`   | Past due > 30 days (counts toward PAR 30/60/90)  |          |
| `SETTLED`      | Fully repaid                                     |    ✅    |
| `DEFAULTED`    | Past due > 90 days; written off                  |    ✅    |

On the frontend, states are modelled as a TypeScript **discriminated union**,
and transitions go through a single pure `transition(loan, event)` function, so
illegal transitions fail at compile time where possible and at runtime otherwise.

## Double-Entry Ledger & Concurrency Architecture

### Ledger principles

1. **Every money movement is a balanced journal entry.** Each transaction posts
   at least one debit and one credit, and `Σ debits = Σ credits` must hold.
2. **Immutable, append-only.** Ledger rows are never updated or deleted. Errors
   are corrected by posting a *compensating (reversal) entry* that references
   the original.
3. **Integer centavos only.** All amounts are stored and computed as integer
   centavos (₱1.00 = `100`). Floating-point currency math is forbidden; pesos are
   formatted only at the display boundary via a shared `formatPHP()` utility.
4. **Balances are derived, not stored.** An account balance is the sum of its
   entries, so the ledger is the single source of truth.

### Example: ₱5,000.00 disbursement + ₱1,050.00 repayment

| Txn  | Account                        | Debit (centavos) | Credit (centavos) |
| ---- | ------------------------------ | ---------------: | ----------------: |
| T-01 | `loans_receivable:borrower-42` |        `500000`  |                   |
| T-01 | `wallet_clearing:gcash`        |                  |         `500000`  |
| T-02 | `wallet_clearing:gcash`        |        `105000`  |                   |
| T-02 | `loans_receivable:borrower-42` |                  |         `100000`  |
| T-02 | `interest_income`              |                  |           `5000`  |

### Concurrency & idempotency

| Risk                                   | Mitigation                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Double disbursement on network retry   | Every disbursement/payment mutation carries an `Idempotency-Key` (UUID v4) generated once per user intent and reused on retries; the server replays the original response for duplicate keys. |
| Two admins acting on the same loan     | Optimistic concurrency: each loan has a `version`; mutations send `If-Match: <version>` and receive `409 Conflict` if it's stale. The UI then refetches and shows the new state. |
| Partial writes (ledger posted, state not updated) | State transition and its journal entries commit in **one ACID database transaction**: all or nothing. |
| Webhook replay from wallet provider    | Webhooks are verified by HMAC signature (secret from env vars) and de-duplicated by provider event ID. |
| Double-click on "Disburse" / "Pay"     | Submit buttons are disabled while a request is in flight, and the idempotency key covers anything that still gets through. |

## Getting Started

Requires Node.js 22 LTS (`nvm use` reads `.nvmrc`).

```bash
git clone https://github.com/l3n8n-ocd/microcredit-api.git
cd microcredit-api
npm install
cp .env.example .env
npm run dev
```

| Script              | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Start the Next.js dev server (App Router)            |
| `npm run build`     | Production build (`next build`)                      |
| `npm run start`     | Serve the production build locally (`next start`)    |
| `npm run typecheck` | Run the TypeScript compiler in strict mode           |
| `npm run lint`      | Run oxlint; warnings fail the run                    |
| `npm test`          | Run the Vitest suite once (473 tests)                |
| `npm run agent:run` | FL-07: run SentinelScout once over MCP stdio; writes `docs/drafts/latest-triage-brief.md` |
| `npm run agent:eval` | FL-07: the 6 FL-06 eval cases; exits 1 unless 6/6 pass |
| `npm run test:e2e:fe08` | After `build`: FE-08 sabotage drill, 32 browser checks and the 4 Checkpoint 1 screenshots |
| `npm run test:e2e:fe07` | After `build`: FE-07 tool cards, 14 browser checks and the 6 tool-state screenshots |
| `npm run test:e2e`  | After `build`: the Playwright primary flow (`e2e/primary-flow.spec.ts`): Disburse replay, then the copilot with a tool card, mocked `/api/chat` |
| `npm run test:e2e:fold` | After `build`: above-the-fold on `/`, all routes at 375px/1280px with no overflow, and the AI Copilot streaming checks |

Every commit runs lint-staged and a typecheck, and commit messages must follow
Conventional Commits (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`).

## Portfolio & AI Fluency Proof

This repository is the flagship proof in my portfolio. The proof statement,
lean portfolio sitemap, and the pressure-test critique with its revisions are
documented in [`docs/PORTFOLIO_PATH.md`](./docs/PORTFOLIO_PATH.md).

- **What this repo proves:** [`docs/WHAT_ARE_YOU_PROVING.md`](./docs/WHAT_ARE_YOU_PROVING.md)
  has the sharpened proof statement, the one-line why, and the narrowing log.

## 🛠️ FE-07: AI Tool Contracts & Generative UI

The copilot on [`/underwriting`](https://microcredit-api-beta.vercel.app/underwriting) calls three typed tools.
Contracts live in [`src/lib/ai/tools.ts`](./src/lib/ai/tools.ts), and each call is drawn by
[`ToolInvocationCard.tsx`](./src/features/ai-copilot/ToolInvocationCard.tsx). Full write-up:
[`docs/FE-07_TOOL_UI.md`](./docs/FE-07_TOOL_UI.md).

| Tool | Zod input | Returns | Drawn as |
| --- | --- | --- | --- |
| `evaluateBorrowerTrustScore` | `borrowerName`, `businessType` (4 kinds), `monthlyUtilityOnTimeRatio` 0–100, `supplierInvoiceCount` 0–50, `gcashLoadWeeklyCadence` 0–30, optional `requestedCentavos` 50000–5000000 | `score` 0–1000, `riskTier`, 3 `pillars`, `recommendedLimitCentavos`, `requested` (`null` when omitted), `reasonCodes` | score card + SVG 3-bar chart; "Fallback" badge when no amount was requested |
| `verifyLedgerAndIdempotency` | `loanId`, `disbursementCentavos`, `walletProvider` GCash/Maya, `idempotencyKey` (UUID v4), `expectedVersion` (`If-Match`) | first attempt and same-key retry (`201 CREATED` → `201 REPLAYED`), journal lines in centavos, `Σ debits === Σ credits`, `idempotencyStatus` | double-entry findings table |
| `proposeDisbursementExecution` | `loanId` (must be `APPROVED`), `disbursementCentavos`, `walletProvider`, `expectedVersion` | `AWAITING_CONFIRMATION` proposal with `If-Match`, `Idempotency-Key`, journal preview. **Posts nothing.** | confirm widget: **Approve & Execute Payout** pays once (double-click safe), **Cancel Action** sends nothing |

**4 states per call:**
- `input-streaming`: "Choosing tool", the rationale, and argument pills filling in.
- `input-available`: the inputs locked, in plain words.
- `output-available`: the component for that tool.
- `output-error`: the error code, the preserved inputs, and **Retry Tool Call with Sanitized Inputs**.

A state inspector on each card pins any state the call reached. The `tool-error` drill (toolbar button
or chip) reaches `output-error` on demand.

**Error codes:** `ERR_TOOL_SCHEMA_BOUNDS`, `ERR_LEDGER_LOAN_NOT_FOUND`, `ERR_ILLEGAL_TRANSITION`,
`ERR_STALE_IF_MATCH`, `ERR_TOOL_EXECUTION`. Each one's retry fix is listed in the doc.

## 🎓 FlyRank Internship Deliverables

![Week 1 milestone: FE-01 toolchain, proof statement, portfolio sitemap, and FL-01 workflow audit](./docs/assets/week-01/week1-milestone.png)

- **FL-01 · AI Workflow Audit and Tool Setup:** [`docs/FL-01_WORKFLOW_AUDIT.md`](./docs/FL-01_WORKFLOW_AUDIT.md)
  covers the 12-task weekly audit, the three target tasks for FL-02 → FL-04 with
  measurable "Done Well" criteria, and the Claude Project custom instructions.
- **FE-03 / FE-04 · AI-Assisted Workflow Drill:** [`WORKFLOW.md`](./WORKFLOW.md)
  compares a vague prompt against a precise spec for the same Disburse form.
  Both rounds are kept as branches:
  - Round 1 (vague): [`feat/disburse-form-vague`](https://github.com/l3n8n-ocd/microcredit-api/tree/feat/disburse-form-vague)
  - Round 2 (precise, merged to `main`): [`feat/disburse-form-precise`](https://github.com/l3n8n-ocd/microcredit-api/tree/feat/disburse-form-precise)

  The rules learned from the drill are in [`CLAUDE.md` §11](./CLAUDE.md#11-learned-rules-from-fe-03fe-04-workflow-drill).
- **The Prompt Ladder (Week 2 · General AI Fluency):** [`docs/PROMPT_LADDER.md`](./docs/PROMPT_LADDER.md)
  records 6 real runs (a baseline plus 5 single-layer versions) of the FL-01 T1 state-machine prompt,
  each type-checked and behavior-probed. It includes an honest regression (the JSON output format) and
  a reusable, placeholder-based prompt template. Raw outputs and the measurement harness are in
  [`docs/prompt-ladder/`](./docs/prompt-ladder/).
- **Frame It as Cases: Work That Speaks for Itself (Week 2 · General AI Fluency):**
  [`docs/FRAME_IT_AS_CASES.md`](./docs/FRAME_IT_AS_CASES.md) has the standing Voice Card, the interview
  log that came before any drafting, three framed cases (MicroCredit API, Node2Shell, RoadWatch), the
  sitemap copy, and a before/after edit table.
- **FL-02 · Prompting Fundamentals on Real Tasks v2:** [`docs/FL-02_PROMPTING_FUNDAMENTALS.md`](./docs/FL-02_PROMPTING_FUNDAMENTALS.md)
  turns synthetic security notes into an advisory across 6 prompt versions (naive, then Role, Context,
  Few-Shot, Output Structure, Step Decomposition). It covers 11 real runs on two Claude models, each
  measured for leaked secrets, sections and CVSS, plus a reusable template and 1 verification run of
  that template (0/8 leaks). Evidence is in [`docs/fl-02/`](./docs/fl-02/).
- **Week 3 · React App Development with AI:** [`docs/WEEK3_REACT_AI_DEVELOPMENT.md`](./docs/WEEK3_REACT_AI_DEVELOPMENT.md)
  - **Built:** an alt-data underwriting workbench (`UNDER_REVIEW → APPROVED` feeds the Disburse form), a
    repayment and compensating-reversal panel, and the full 10-state `LoanState` union. All of it sits
    under the Disburse demo in [`src/App.tsx`](./src/App.tsx).
  - **Prompts:** one brief, kept verbatim, plus the 5 steps it was worked in and a derived 5-prompt
    sequence (labelled "not run").
  - **AI assistance:** Claude Code wrote both commits. The doc lists 5 problems the brief did not
    predict, for example a live-sync that broke the stale-`If-Match` test.
  - **4 refactors**, each with a before/after diff and a mutation check that fails when it is undone:
    1. a centavo split that lost ₱0.01 on ₱1,000.00, now `principal + interest === total`;
    2. a pure `scoreEngine.ts` and a memoized `useUnderwritingQueue.ts`;
    3. a reversal guard with `Idempotency-Key` + `If-Match`;
    4. labelled controls, `aria-live` regions and focus moves.
  - **Commits:** AI first pass [`4d2e502`](https://github.com/l3n8n-ocd/microcredit-api/commit/4d2e502),
    code-review refactor [`f24c143`](https://github.com/l3n8n-ocd/microcredit-api/commit/f24c143).
    The first-pass flaws were seeded by the brief, and the doc says so.
- **Consistency, Not Talent (and Frame, Not Upstage) · Week 3 General AI Fluency:**
  [`docs/PORTFOLIO_DESIGN_SYSTEM.md`](./docs/PORTFOLIO_DESIGN_SYSTEM.md)
  - **3 rules:** Plus Jakarta Sans + Inter + JetBrains Mono; 9 colour tokens with one meaning each
    (`#10B981` only for a passed check such as `Σ debits === Σ credits`); a `max-w-4xl` column with no
    decoration.
  - **Framing:** the live Disburse/Simulate demo is the hero, not an image.
  - **Image log:** what was rejected, what was chosen, and the 16/16 commit hashes checked in the Week 1
    milestone card.
  - **Tailwind v4 `@theme` block:** compiled against this repo, with measured WCAG contrast ratios.
    The visual rule for AI-generated components is in [`CLAUDE.md` §12](./CLAUDE.md#12-visual-constraints-portfolio-design-system).
- **Decide Once: Build Your Identity Kit · Week 3 General AI Fluency:** [`docs/IDENTITY_KIT.md`](./docs/IDENTITY_KIT.md)
  - **2 fonts:** Plus Jakarta Sans and JetBrains Mono.
  - **4 colours:** `#F8FAFC`, `#0F172A`, `#1E293B` and `#059669`, with measured contrast ratios.
  - **Favicon:** the `LA.` monogram, outlined from Plus Jakarta Sans Bold, at [`public/favicon.svg`](./public/favicon.svg).
  - **Style note:** two lines, also in [`CLAUDE.md` §9.4](./CLAUDE.md#94-identity-kit-style-note).
- **Kill Your Darlings: Curate Your Images · Week 3 General AI Fluency:** [`docs/CURATE_YOUR_IMAGES.md`](./docs/CURATE_YOUR_IMAGES.md) · images in [`docs/assets/curated/`](./docs/assets/curated/)
  - **Real captures:** 4 Playwright captures of the real app and test run: the `Idempotency-Key` / `If-Match`
    preview, a `201 Idempotent replay` and a `409 VERSION_MISMATCH` over a balanced ledger, the trust score
    and repayment split, and `248 passed`.
  - **Generated connective tissue:** 4 line-art SVGs, held to one style by a checker script (Iteration 2
    drafts: 35 violations; keepers: 0).
  - **Killed darling:** the Week 1 neon isometric illustration. It inverts the light palette and fakes
    the evidence it decorates.
  - **Bio slot:** reserved for a real photo (TODO).
- **The Through-Line: Map Content & CTAs · Week 3 General AI Fluency:** [`docs/THE_THROUGH_LINE.md`](./docs/THE_THROUGH_LINE.md)
  - **One-line claim:** "I build loan disbursement flows that cannot pay a borrower twice" — the sharpened
    winner of 10 candidates; the brief's "frontend and full-stack" draft is shown being cut for the "and"
    trap and an unearned "full-stack".
  - **Content map:** 4 sections (Hero sandbox → flagship cases strongest-first → bio → act), each with a
    named CTA.
  - **CTA ladder:** every micro-CTA funnels to the One Action — test the live double-click sandbox, then
    book a 15-minute walkthrough.
  - **Honest gather list:** what is ready now vs. still needed, each with a build-week fallback.
- **FE-04 / FE-05 · Capstone Skeleton, Deployed (Week 3 Frontend AI Engineering):** [`SPEC.md`](./SPEC.md)
  - **Migrated to Next.js 16 (App Router)** — Server Components by default, `'use client'` only on the
    interactive Disbursement & Underwriting islands; the 248 Vitest tests it had at the time and the
    above-the-fold Playwright check still passed.
  - **5 routed screens:** [`/`](https://microcredit-api-beta.vercel.app/) (idempotent disburse sandbox),
    `/underwriting`, `/ledger`, `/advisories`, and `/health` (async Server Component + `/api/health`).
  - **Identity Kit design tokens** in `src/app/globals.css`, fonts self-hosted via `next/font/local`.
  - **Zero-secrets env structure:** [`.env.example`](./.env.example) with placeholders; `.env*`
    gitignored.
- **Empty but Live: Ship a Blank Page · Week 4 General AI Fluency:** [`docs/EMPTY_BUT_LIVE.md`](./docs/EMPTY_BUT_LIVE.md) · route [`/portfolio`](https://microcredit-api-beta.vercel.app/portfolio)
  - **Near-blank, live portfolio shell:** name, `LA.` monogram, the canonical one-line claim, and the 4
    content-map frames (hero → flagship-proof → about → act) as a Server Component in the Identity Kit theme.
  - **Verified** at 375×812 and 1280×800 with zero horizontal overflow; screenshots in `docs/assets/curated/`.
  - **Claude Project context pack:** Identity Kit + framed cases + content map consolidated into one
    Master Context Block, indexed in [`CLAUDE.md` §13](./CLAUDE.md#13-week-4-build-context-index).
- **Three Roads: Choose Your Stack with AI · Week 4 General AI Fluency:** [`docs/THREE_ROADS_STACK_RATIONALE.md`](./docs/THREE_ROADS_STACK_RATIONALE.md)
  - **4 real constraints** (free-only, honest skill level, the 4-section sitemap, display + backend needs)
    given to AI.
  - **3 genuine stacks, simplest to most powerful:** static HTML on GitHub Pages, Next.js on Vercel
    (chosen), full-stack + Postgres + CMS.
  - **Pressure-tested** against what breaks, what to maintain, two-week feasibility, and whether it shows
    the work — plus a first-person rationale and the honest "not yet" on a backend.
- **FL-04 · Ship an Automation Workflow v2 (Week 4 General AI Fluency):** [`docs/FL-04_AUTOMATION_WORKFLOW.md`](./docs/FL-04_AUTOMATION_WORKFLOW.md) · artifacts in [`workflows/fl-04-advisory-pipeline/`](./workflows/fl-04-advisory-pipeline/)
  - **4-step advisory pipeline** (Gather → Synthesize → Draft → Critic & Redaction Gate) with defined
    handoff schemas, an importable **n8n workflow JSON**, and a zero-dependency runner.
  - **5 documented runs** (Node2Shell, idempotency replay, centavo drift, stale If-Match, a brand-new
    webhook-HMAC-replay input) all pass the deterministic gate: `node workflows/fl-04-advisory-pipeline/run-pipeline-verify.mjs`.
  - **Honest time accounting** (break-even at Run #4) and 4 named failure points with the human-in-the-loop checklist.
- **FL-05 · Agent Concepts and MCP Basics (Week 4 General AI Fluency):** [`docs/FL-05_AGENTS_AND_MCP.md`](./docs/FL-05_AGENTS_AND_MCP.md) · [`.mcp.json`](./.mcp.json) · [`mcp/microcredit-mcp-server.mjs`](./mcp/microcredit-mcp-server.mjs)
  - **707-word explainer:** workflow vs. agent (FL-04 is a deterministic prompt-chain-with-gate, not an
    agent), MCP's three primitives (Tools/Resources/Prompts), and the one agent upgrade FL-04 would need.
  - **Working MCP server** (JSON-RPC 2.0 over stdio): 3 tools, 2 resources, 1 prompt, grounded in this repo.
  - **3 real tool calls** chat alone can't do — local file audit, live `/api/health` telemetry, and a
    cross-file redaction+CVSS audit that writes an artifact to disk — with screenshots in `docs/assets/curated/`.
- **FE-06 · Streaming AI Chat Interface (Week 4 Frontend AI Engineering):** [`docs/FE-06_STREAMING_CHAT.md`](./docs/FE-06_STREAMING_CHAT.md) · live at [`/underwriting#copilot`](https://microcredit-api-beta.vercel.app/underwriting#copilot)
  - **Route handler:** [`src/app/api/chat/route.ts`](./src/app/api/chat/route.ts) — SSE over `POST /api/chat`; the AI SDK's
    `streamText` when a server-only key is set, a local rule engine (one token every ~22 ms) otherwise;
    `req.signal` cancels either.
  - **Chat component:** [`src/features/ai-copilot/StreamingUnderwritingChat.tsx`](./src/features/ai-copilot/StreamingUnderwritingChat.tsx) —
    Stop as a 5-state reducer with one `AbortController` per request, auto-scroll pinned only within
    48 px of the bottom, thinking → first token in one DOM node, and a Markdown renderer that never shows
    an unclosed fence or a dangling `**`.
  - **Model config:** [`src/lib/ai/underwriting-model.ts`](./src/lib/ai/underwriting-model.ts) — `server-only`; system prompt
    generated from `scoreApplicant` and `transitionLoan`, guardrails (integer `Centavos`, 10 states,
    no invented borrowers), 4 starter prompts.
  - **Rate limit:** [`src/lib/ai/rate-limit.ts`](./src/lib/ai/rate-limit.ts) — in-memory sliding window, 10 a minute and
    100 a day per client, `429` + `Retry-After`, applied only when a paid model would be called.
  - **Evidence:** 96 new Vitest tests (344 total) and 14 Chromium checks per width against the real
    route. The browser run caught a scroll race that jsdom missed. On the live URL `gemini-3.5-flash-lite`
    (Google free tier) streamed replies and answered a follow-up in context. Stop cancelled the model
    call on the server: `GET /api/chat` recorded `aborted` at 5,921 ms for a Stop clicked at 5,943 ms.
    The rate limit refused the 12th request from one client with `429` and `Retry-After: 8`.
    **Not yet shown:** a Claude model, and a rate limit that holds across server instances or many
    addresses (it is in-memory; it needs a shared store before a paid key).
- **FE-03 / FE-05 · Accessible Component Fundamentals (Week 4 Frontend AI Engineering):** [`playground/`](./playground/) · [`NOTES.md`](./NOTES.md) · [`src/components/ui/`](./src/components/ui/) · live at [`/playground`](https://microcredit-api-beta.vercel.app/playground)
  - **Hand-built, no component library:** [`ModalDialog.tsx`](./playground/ModalDialog.tsx) (`role="dialog"`,
    `aria-modal`, Tab / Shift+Tab trap, Escape, focus back to the trigger), [`Tabs.tsx`](./playground/Tabs.tsx)
    (roving `tabIndex`, ArrowRight / ArrowLeft wrap, Home / End) and [`Disclosure.tsx`](./playground/Disclosure.tsx)
    (`aria-expanded` + `aria-controls`), each against its W3C APG pattern.
  - **shadcn/ui next to them:** [`dialog.tsx`](./src/components/ui/dialog.tsx) and [`tabs.tsx`](./src/components/ui/tabs.tsx)
    from the `new-york-v4` registry on `@radix-ui/react-dialog` and `@radix-ui/react-tabs`, re-tokened to the
    Identity Kit. Both versions run the same form and panels on `/playground`.
  - **[`NOTES.md`](./NOTES.md):** five gaps with file and line references into the Radix source: no
    `aria-hidden` on the page behind, no portal or scroll lock, no outside-press or layer handling, no
    `dir="rtl"` / disabled / manual tabs, no `asChild` composition or exit animation. It also records three
    corrections to the brief and one focus-ring gap in the generated shadcn file.
  - **Evidence:** [40 keyboard-only tests](./playground/__tests__/playground.test.tsx) with `user-event`
    (384 total), one test per gap, 16 mutation checks, and 11 keyboard checks in Chromium on the built app.
- **Explain It Like You Built It (Week 5/6 General AI Fluency):** [`docs/EXPLAIN_IT_LIKE_YOU_BUILT_IT.md`](./docs/EXPLAIN_IT_LIKE_YOU_BUILT_IT.md)
  - **The piece:** how [`src/app/page.tsx`](./src/app/page.tsx) hands off to the `'use client'` island in
    [`src/App.tsx`](./src/App.tsx), and how `Idempotency-Key` and `If-Match` stop a double payout in
    [`disbursementServer.ts`](./src/features/disbursement/disbursementServer.ts).
  - **A 297-word plain-words explanation** and verbatim, line-numbered code with a plain-English note on each part.
  - **An honest Tutor Mode log:** every quiz answer as picked, right or wrong, with the correction. One
    point is still open and says so.
  - **Two real bugs found and fixed:** a hydration mismatch on `/` and `/underwriting` (React #418, a
    random key made during render), and the chat history wipe it had been hiding. Each fix has a test
    that fails when it is reverted.
- **FL-06 · Design Your Personal Agent (Week 5 General AI Fluency):** [`docs/FL-06_PERSONAL_AGENT_SPEC.md`](./docs/FL-06_PERSONAL_AGENT_SPEC.md)
  - **SentinelScout, one job:** given a GHSA ID, say whether `microcredit-api` is exposed, re-check
    the `Σ debits === Σ credits` and `Idempotency-Key` / `If-Match` invariants, and save a redacted
    draft brief for my sign-off. 3–4 times a week; a 10-hour build table.
  - **4 typed tools** added to [`mcp/microcredit-mcp-server.mjs`](./mcp/microcredit-mcp-server.mjs), each with a
    $0 data source (GitHub advisories, OSV.dev, the local lockfile and `src/`), a fallback, and errors
    that tell the model what to do next. The 4-call limit is enforced by the server, not only the prompt.
  - **A full system prompt, 6 eval cases written before the build** (injection and secret-leak cases
    block shipping), and three guardrail tiers mapped to OpenAI's guide. The red lines hold because
    the agent has no tool for them.
  - **Status: built in FL-07** (next entry). The spec is kept as written; what changed is in the FL-07 log.
- **FL-07 · Build the Agent (Week 5 General AI Fluency):** [`docs/FL-07_BUILD_LOG.md`](./docs/FL-07_BUILD_LOG.md) · [`agents/sentinel-scout/run-agent.mjs`](./agents/sentinel-scout/run-agent.mjs) · [`docs/drafts/latest-triage-brief.md`](./docs/drafts/latest-triage-brief.md) · live runner: [`/agent`](https://microcredit-api-beta.vercel.app/agent)
  - **One command:** `npm run agent:run` starts the MCP server and calls `fetch_ghsa_advisory` →
    `scan_local_repo_exposure` → `audit_centavos_and_idempotency` → `write_sanitized_triage_brief`
    as JSON-RPC `tools/call`s over stdio, then writes the brief and its SHA-256. No step is manual.
  - **Gates in code, not only the prompt:** the server refuses call 5 of a triage, advisory text is
    wrapped as untrusted data, and the writer refuses a brief with a JWT, bearer token, RFC 1918 IP or
    `x-maya-sig` header in it.
  - **`npm run agent:eval`: 6/6** FL-06 cases, both blockers included, and each of cases 2–5 was
    shown to fail under a deliberate break. The build breaks E1–E10 and 8 deviations from the spec are in the log.
  - **Recording:** [`docs/assets/curated/fl-07-agent-run.webm`](./docs/assets/curated/fl-07-agent-run.webm),
    one unedited run on `/agent`. Locally the fetch is answered by OSV.dev because GitHub's advisory API
    is blocked from the build machine; the model planner is tested against a mock model only.
- **PF-04 · Personal Website Live on the FlyRank Domain & DNS Walkthrough (Week 5 General AI Fluency):** [`docs/PF-04_DNS_WALKTHROUGH.md`](./docs/PF-04_DNS_WALKTHROUGH.md) · live portfolio: [l3n8n-ocd.github.io/portfolio](https://l3n8n-ocd.github.io/portfolio/)
  - **The real lookup:** `l3n8n-ocd.github.io` answers with four `A` records (`185.199.108.153`–`111.153`,
    `TTL` 3600) from `github.io`'s NS1 and Route 53 nameservers. Then `GET /portfolio/` returns `HTTP/2 200`
    from `server: GitHub.com`.
  - **`CNAME` explained, not claimed:** the portfolio has no custom domain yet, so the walkthrough shows
    the `www.<domain>  CNAME  l3n8n-ocd.github.io` record it would need and marks it TODO.
  - **File map** of the deployed React + Vite + Tailwind v4 repo, from `vite.config.js`
    (`base: '/portfolio/'`) to `.github/workflows/deploy.yml`.
- **FE-08 · Error States, Empty States, Edge Cases (Checkpoint 1):** [`docs/FE-08_ERROR_AND_EDGE_CASES.md`](./docs/FE-08_ERROR_AND_EDGE_CASES.md) · [`src/app/error.tsx`](./src/app/error.tsx) · [`src/features/ai-copilot/StreamingUnderwritingChat.tsx`](./src/features/ai-copilot/StreamingUnderwritingChat.tsx)
  - **7 failure modes, each one click away:** the copilot's drill toolbar sends `x-sabotage-mode`
    (`mid-stream-error`, `rate-limit-429`, `malformed-tool-json`, `slow-3s`) to `/api/chat`; `network-drop` fails
    before `fetch`. Every banner has a code (`ERR_MID_STREAM`, `HTTP_429`, `ERR_MALFORMED_FRAME`, `ERR_OFFLINE`).
  - **Retry names the failed prompt and re-sends only that turn.** A double-click sends one request: `abortRef`
    locks before the first `await`. Proven in Vitest (two clicks in one `act()`) and in the browser (`dblclick`).
  - **Skeletons share their size constants with the real boxes:** `score-card` 82 px = real stat card,
    `ledger-row` 29 px = real `/health` row, and 0 layout shift at the first token. Measuring found and fixed a
    3 px jump in FE-06's thinking indicator.
  - `npm test` 429/429, `npm run test:e2e:fe08` 32/32 ([`e2e/fe08.mjs`](./e2e/fe08.mjs)); route boundaries
    `src/app/error.tsx`, `src/app/underwriting/error.tsx`, `src/app/not-found.tsx`.
- **FE-07 · Tool Results and Structured Output in the UI:** [`docs/FE-07_TOOL_UI.md`](./docs/FE-07_TOOL_UI.md) · [`src/lib/ai/tools.ts`](./src/lib/ai/tools.ts) · [`src/features/ai-copilot/ToolInvocationCard.tsx`](./src/features/ai-copilot/ToolInvocationCard.tsx)
  - **3 Zod tools, 4 card states, never raw JSON:** a trust-score SVG chart, a double-entry findings table in
    centavos, and a confirm widget. Every result is validated against its output schema before it is drawn.
  - **The confirm widget proves the One Claim in the copilot:** Approve sends `Idempotency-Key` + `If-Match`.
    A double-click pays once, and the replay test returns `201 REPLAYED` with 1 ledger entry.
  - `npm test` 461/461 (32 new), `npm run test:e2e:fe07` 14/14 ([`e2e/fe07.mjs`](./e2e/fe07.mjs)). On the live
    site, one hosted-model call (Gemini) streamed all four tool states: one call, not a success rate.
- **FE-09 · Testing Pass (Vitest + RTL + Playwright + CI):** [`docs/FE-09_TESTING_PASS.md`](./docs/FE-09_TESTING_PASS.md) · [`src/features/__tests__/fe09-testing-pass.test.tsx`](./src/features/__tests__/fe09-testing-pass.test.tsx) · [`e2e/primary-flow.spec.ts`](./e2e/primary-flow.spec.ts) · [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
  - **12 component tests on the three riskiest UIs:** chat pending, streaming (open code fence + tool part),
    mid-stream error and `429` with Retry, and Stop; Disburse bounds, `500000` debits = `500000` credits, and the
    `Idempotency-Key` replay; the 4-state tool card and the Approve-only payout. `/api/chat` is mocked with
    `vi.spyOn(globalThis, 'fetch')`, and any other request fails the test.
  - **Role, label and text queries only:** every `data-testid` is gone from the components (34) and the
    tests (49 queries). `npm test` 473/473.
  - **`npm run test:e2e`** walks `/` → replay → `/underwriting` → tool card with zero console errors. CI runs
    typecheck, lint, Vitest, build, then Playwright on every push and pull request to `main`.

## License

[MIT](./LICENSE) © 2026 Lenon D. Adriano
