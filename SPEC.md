# MicroCredit API — Capstone Specification (FE-04 / FE-05)

> One-page spec for the capstone skeleton. Flagship proof for the FlyRank Frontend AI Engineering
> track. Stack: **Next.js 16 (App Router) · React 19 · TypeScript 7 (strict) · Tailwind CSS v4**, with
> Vitest + Playwright. Claim: *I build loan disbursement flows that cannot pay a borrower twice.*

## Problem & target user

**Who:** Engineering Managers and Lending Operations Leads at Philippine micro-lending teams.

**Pain:** they need (1) explainable **alternative-data underwriting** for unbanked micro-entrepreneurs
(GCash/Maya load cadence, utility bills, supplier invoices), and (2) **race-condition-safe
disbursement** — a nervous admin double-clicking, a phone retrying a POST, or two admins acting at once
must never pay a borrower twice, and every centavo must balance for an auditor.

**How this app answers it:** an `Idempotency-Key` + `If-Match` guard (replay before version check), a
10-state `LoanState` discriminated union that makes illegal transitions a typed `409`, and an integer
`Centavos` double-entry ledger where `Σ debits === Σ credits` on every entry.

## Screen & route architecture (Next.js App Router)

Server Components by default; `'use client'` only on interactive leaves.

| Route | File | Rendering | What it is |
| --- | --- | --- | --- |
| `/` | `src/app/page.tsx` | Server shell + client island (`src/App.tsx`) | Flagship: double-click **idempotent disbursement sandbox** + live double-entry centavo ledger, above the fold |
| `/underwriting` | `src/app/underwriting/page.tsx` | Server header/metrics + client `UnderwritingStandalone` island | Alternative-data trust-score evaluator (`APPLIED → UNDER_REVIEW → APPROVED / REJECTED`); AI Copilot placeholder (FE-06/07) |
| `/ledger` | `src/app/ledger/page.tsx` | Server Component | Immutable double-entry journal (`Σ debits === Σ credits`), repayment split preview, reversal audit explainer |
| `/advisories` | `src/app/advisories/page.tsx` | Server Component | Concurrency + security guardrail monitor (`Idempotency-Key` replay, `409` version checks, sanitized advisory format) |
| `/health` | `src/app/health/page.tsx` + `src/app/api/health/route.ts` | Async Server Component fetches the route handler | Live system / env / ledger-invariant health check |

## Architecture notes

- **Domain stays framework-free.** All business logic and the 248-test suite live in `src/features/`
  (`disbursement`, `scoring`, `health`) and `src/utils/`, imported by both Server and Client components.
  The Next.js migration added routing and a shell; it changed no domain logic and removed no test.
- **Server/client boundary.** Server code imports the *pure* modules directly
  (`ledger.ts`, `scoreEngine.ts`), never the feature barrels, which also re-export `'use client'`
  components.
- **Money:** integer `Centavos` only, entering through `parsePesosToCentavos`; display via `formatPHP`.
- **Design tokens:** Identity Kit (`docs/IDENTITY_KIT.md`) — `#F8FAFC` canvas, `#0F172A` ink, `#1E293B`
  main, `#059669` accent; Plus Jakarta Sans + JetBrains Mono, self-hosted via `next/font/local`.

## AI route plan (FE-06 → Week 8)

| Milestone | Route | Plan |
| --- | --- | --- |
| FE-06 | `POST /api/underwriting/explain` | Stream an explainable rationale + reason codes for a trust score (server-only `ANTHROPIC_API_KEY`). |
| FE-07 | tool-use in the same route | Let the model call the pure `scoreApplicant` / `splitRepayment` functions as tools, so every number it cites is computed, not guessed. |
| Week 8 | `/advisories` live feed | Generate a sanitized advisory draft from verified PoC notes (the FL-02 formatter), rendered server-side. |

Each AI route is server-only, keys never reach the client, and outputs are checked against the domain
functions before display (`CLAUDE.md` §9.2 rule 4).

## Environment & deployment

- `.env.example` documents every variable with safe placeholders; `.env*` is gitignored except the
  example. Only `NEXT_PUBLIC_*` reaches the client.
- Vercel builds with `next build`; `/health` and `/api/health` are dynamic (server-rendered per request).

## Testing

- `npm run typecheck` (tsc strict), `npm run lint` (oxlint), `npm test` (Vitest, 248 tests),
  `npm run build` (next build), `npm run test:e2e` (Playwright: above-the-fold on `/` under the
  worst-case fallback font, plus all 5 routes at 375px and 1280px with zero horizontal overflow).
