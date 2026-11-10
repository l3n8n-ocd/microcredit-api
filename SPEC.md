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
| `/underwriting` | `src/app/underwriting/page.tsx` | Server header/metrics (dynamic) + two client islands: `StreamingUnderwritingChat` and `UnderwritingStandalone` | ✅ **AI Underwriting & Ledger Risk Copilot** (FE-06, streaming chat at `#copilot`) + alternative-data trust-score evaluator (`APPLIED → UNDER_REVIEW → APPROVED / REJECTED`) |
| `/ledger` | `src/app/ledger/page.tsx` | Server Component | Immutable double-entry journal (`Σ debits === Σ credits`), repayment split preview, reversal audit explainer |
| `/advisories` | `src/app/advisories/page.tsx` | Server Component | Concurrency + security guardrail monitor (`Idempotency-Key` replay, `409` version checks, sanitized advisory format) |
| `/health` | `src/app/health/page.tsx` + `src/app/api/health/route.ts` | Async Server Component fetches the route handler | Live system / env / ledger-invariant health check |
| `POST /api/chat` | `src/app/api/chat/route.ts` | Route handler, Node runtime, Server-Sent Events | ✅ FE-06 streaming endpoint: AI SDK `streamText` when a server-only key is set, local rule engine otherwise |

## Architecture notes

- **Domain stays framework-free.** All business logic lives in `src/features/` (`disbursement`,
  `scoring`, `health`) and `src/utils/`, imported by both Server and Client components. The suite is
  308 tests: 248 on the domain and UI, 60 on the FE-06 chat (`src/features/ai-copilot/`, `src/lib/ai/`).
  The Next.js migration added routing and a shell; it changed no domain logic and removed no test.
- **Server/client boundary.** Server code imports the *pure* modules directly
  (`ledger.ts`, `scoreEngine.ts`), never the feature barrels, which also re-export `'use client'`
  components.
- **Money:** integer `Centavos` only, entering through `parsePesosToCentavos`; display via `formatPHP`.
- **Design tokens:** Identity Kit (`docs/IDENTITY_KIT.md`) — `#F8FAFC` canvas, `#0F172A` ink, `#1E293B`
  main, `#059669` accent; Plus Jakarta Sans + JetBrains Mono, self-hosted via `next/font/local`.

## AI route plan (FE-06 → Week 8)

| Milestone | Route | Status / plan |
| --- | --- | --- |
| FE-06 | `POST /api/chat` | ✅ **Complete.** Multi-turn streaming chat with Stop recovery, smart auto-scroll, a flicker-free thinking handoff and streaming-safe Markdown. Write-up: [`docs/FE-06_STREAMING_CHAT.md`](./docs/FE-06_STREAMING_CHAT.md). (Planned as `/api/underwriting/explain`; built as one general chat route so FE-07 tools attach to it.) |
| FE-07 | tool-use in the same route | Let the model call the pure `scoreApplicant` / `splitRepayment` functions as tools, so every number it cites is computed, not guessed. The seam is marked in `route.ts` and `underwriting-model.ts`. |
| Week 8 | `/advisories` live feed | Generate a sanitized advisory draft from verified PoC notes (the FL-02 formatter), rendered server-side. |

### FE-06 files

| Layer | File |
| --- | --- |
| Route handler (SSE, abort, validation) | [`src/app/api/chat/route.ts`](./src/app/api/chat/route.ts) |
| Model config, system prompt, starter prompts, key handling (`server-only`) | [`src/lib/ai/underwriting-model.ts`](./src/lib/ai/underwriting-model.ts) |
| Local rule engine (no-key fallback, computed from domain functions) | [`src/lib/ai/local-engine.ts`](./src/lib/ai/local-engine.ts) |
| Chat UI (`'use client'`) | [`src/features/ai-copilot/StreamingUnderwritingChat.tsx`](./src/features/ai-copilot/StreamingUnderwritingChat.tsx) |
| Streaming-safe Markdown | [`StreamingMarkdown.tsx`](./src/features/ai-copilot/StreamingMarkdown.tsx) + [`streamingMarkdownParser.ts`](./src/features/ai-copilot/streamingMarkdownParser.ts) |
| State machine, wire protocol, transport, persistence | [`chatReducer.ts`](./src/features/ai-copilot/chatReducer.ts), [`chatProtocol.ts`](./src/features/ai-copilot/chatProtocol.ts), [`chatTransport.ts`](./src/features/ai-copilot/chatTransport.ts), [`conversationStore.ts`](./src/features/ai-copilot/conversationStore.ts) |

**Not yet shown:** a hosted model answering on the live URL (no key is set there), and any rate limit
on `/api/chat`. With no key the reply comes from the local rule engine and is labelled as such.

Each AI route is server-only and keys never reach the client. The local engine computes every number
from the domain functions; the hosted-model path is constrained by a system prompt generated from the
same functions, and FE-07 tools will replace that snapshot (`CLAUDE.md` §9.2 rule 4).

## Environment & deployment

- `.env.example` documents every variable with safe placeholders; `.env*` is gitignored except the
  example. Only `NEXT_PUBLIC_*` reaches the client.
- `ANTHROPIC_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` are optional and server-only. They are read in
  one file, `src/lib/ai/underwriting-model.ts`, which imports `server-only`.
- Vercel builds with `next build`; `/health`, `/api/health`, `/underwriting` and `/api/chat` are dynamic
  (server-rendered per request).

## Testing

- `npm run typecheck` (tsc strict), `npm run lint` (oxlint), `npm test` (Vitest, 308 tests),
  `npm run build` (next build), `npm run test:e2e` (Playwright: above-the-fold on `/` under the
  worst-case fallback font, all 5 routes at 375px and 1280px with zero horizontal overflow, and 13 AI
  Copilot checks per width against the real `/api/chat`: token-by-token streaming, Stop, send-again,
  auto-scroll release, persistence).
