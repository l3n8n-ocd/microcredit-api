# Ship It · Frontend AI Engineering Capstone: MicroCredit API

| | |
| --- | --- |
| Live app | https://microcredit-api-beta.vercel.app |
| AI copilot | https://microcredit-api-beta.vercel.app/underwriting |
| Repository | https://github.com/l3n8n-ocd/microcredit-api |
| README | https://github.com/l3n8n-ocd/microcredit-api#readme |
| Verified build | `fbc894f`, checked on 2026-11-19 (`GET /api/chat` → `"commit":"fbc894f"`) |
| Summary image | [`docs/assets/curated/ship-it-capstone-summary.png`](./assets/curated/ship-it-capstone-summary.png) |

Every number below was measured on 2026-11-19 against `fbc894f`, either live or from the run named next to it.
Where nothing measured a claim, it says TODO.

---

## 1 · Project Brief

MicroCredit API is a micro-lending demo for Philippine sari-sari store owners, with an AI underwriting copilot
beside it, and it stops three failures that cost a lender real money. A double-click, a network retry or two
admins clicking at once cannot post a second payout: every payout carries an `Idempotency-Key`, every admin action
sends an `If-Match` version, and a stale version gets `409 Conflict` with no ledger entry. Money is integer
`Centavos` (`₱1.00 = 100`), so no float rounding reaches the double-entry ledger, where `Σ debits === Σ credits`
holds on every entry. The copilot cannot act alone: its three Zod-typed tools validate every input, and a payout it
proposes waits for a person to press **Approve & Execute Payout**. It is for micro-lending officers, risk and
underwriting reviewers, and the fintech engineers who build for them. I chose it because a ledger invariant is a
claim anyone can test: double-click **Disburse** and watch the second request bounce.

## 2 · Live, Deployed Application

- **App:** https://microcredit-api-beta.vercel.app. The Disburse form, request log, loan table and ledger.
- **Copilot:** https://microcredit-api-beta.vercel.app/underwriting. A streaming chat, the 4-state tool cards and
  the underwriting workbench.

**It is live and it runs.** It is not a static mockup:
- **The One Action works in the browser.** Simulate double-click / network retry gives `201 Created · posted
  JE-0001`, then `201 Idempotent replay of JE-0001 · no new ledger entry`. Two admins (same `If-Match`) gives
  `409 Conflict (VERSION_MISMATCH) · no ledger entry`. Chromium, WebKit desktop and WebKit at 375×812 passed this on
  the live URL ([`e2e/cross-browser.mjs`](../e2e/cross-browser.mjs)).
- **The copilot calls a real model.** `POST /api/chat` streams Server-Sent Events from `gemini-3.5-flash-lite`.
  Without a key, or when the model fails, the reply comes from a local rule engine, and the label says so.
- **Health checks pass.** `GET /api/health` answers `"status":"healthy"`, `"debitsEqualCredits":true` and
  `"supportedStates":10`.
- **One honest limit.** The Disburse demo runs its server code (`src/features/disbursement/disbursementServer.ts`)
  in the browser tab, against an in-memory ledger. Reloading resets it, and no real wallet is paid.

**Accessibility, measured live on `fbc894f`:**
- **axe-core: 0 violations and 0 contrast errors** on 6 routes (`/`, `/underwriting`, `/playground`, `/motion-lab`,
  `/3d-lab`, `/shader-hero`) at 375 px. The WCAG 2.0, 2.1 and 2.2 A and AA rule tags plus best practices were used.
- **Lighthouse Accessibility 100** on `/` and `/underwriting`, in 10 of 10 runs.
- **The primary flow works by keyboard alone,** with a visible focus indicator at every stop
  ([`e2e/keyboard-a11y-flow.spec.ts`](../e2e/keyboard-a11y-flow.spec.ts)).
- **What this is not.** It is not a formal WCAG conformance audit. WAVE was not run; TODO in
  [`AUDIT.md`](../AUDIT.md).

## 3 · Repository with Complete README

- **Repository:** https://github.com/l3n8n-ocd/microcredit-api.
- **README:** https://github.com/l3n8n-ocd/microcredit-api#readme.

| Requirement | Where in the README | Checked |
| --- | --- | --- |
| One-command setup | "Quick start: from a fresh clone" | A fresh `git clone` of `fbc894f`, then `npm install && npm run dev`, on Node 22.23.4 with no keys set. Install exited 0 in 21 s, `/` and `/underwriting` returned 200, and the chat streamed from the local engine. The README uses `npm ci` for an exact lockfile install. |
| Architecture overview | "Architecture", "Key engineering decisions", "Production limits on the AI routes" | An ASCII diagram of browser → route handlers → engines, and a table of the 7 key decisions. |
| Meaningful AI integration | "Architecture", FE-06 / FE-07 sections | See the table below. |
| Known limitations and future work | "SentinelScout: eval results and honest limitations", and §3 here | See the lists below. |

**The AI integration:**

| Piece | What it does | File |
| --- | --- | --- |
| Streaming chat | Server-Sent Events: `meta`, then `token` × N, then `done`. Stop aborts the model call on the server too, not just the fetch. | [`src/app/api/chat/route.ts`](../src/app/api/chat/route.ts) |
| `evaluateBorrowerTrustScore` | A trust score from 0 to 1000 with three pillar bars, and a limit in `Centavos`. | [`src/lib/ai/tools.ts`](../src/lib/ai/tools.ts) |
| `verifyLedgerAndIdempotency` | Checks `Σ debits === Σ credits` and the `Idempotency-Key` / `If-Match` rules for a loan. | same |
| `proposeDisbursementExecution` | Builds an `APPROVED → DISBURSED` proposal and posts nothing. A person must press **Approve & Execute Payout**, which pays once even when double-clicked. | same, [`ToolInvocationCard.tsx`](../src/features/ai-copilot/ToolInvocationCard.tsx) |
| Guardrails | Zod validates every tool input before `execute`. The copilot falls back to a labelled local rule engine. A per-client limit returns `429` + `Retry-After`. Bodies are capped at 32 KB, requests at 24 messages, and functions at `maxDuration = 30`. | [`docs/FE-11_PRODUCTION_DEPLOY.md`](./FE-11_PRODUCTION_DEPLOY.md) |

**Known limitations:**
- The ledger is in memory, so the payout guarantee does not survive a restart, and "full-stack" stays off the
  headline.
- The rate limiter is per server instance; the provider's spend limit is the real cost cap.
- The 30 s ceiling can end a slow, long answer early. The reply then shows "[Ended early: time-limit]" and keeps
  its text.
- These were not run: WAVE, an INP measurement, a real iPhone or Apple Safari, and a `429` seen live from one
  address.

**Future improvements:**
- Postgres with a unique index on `Idempotency-Key`, so the guarantee survives a restart.
- A shared store (Redis) for an exact rate limit across instances.
- Sandboxed patch checks for the SentinelScout agent.

## 4 · Testing Evidence

**Vitest + React Testing Library: 558/558 in 32 files.** Run on `fbc894f`, and again in CI on every push.

| File | Tests | What it proves |
| --- | --- | --- |
| [`DisbursementForm.test.tsx`](../src/features/disbursement/__tests__/DisbursementForm.test.tsx) | 35 | Every field labelled with `aria-invalid`; a double-click sends one request; a stale `If-Match` gets `409` |
| [`loanStateMachine.test.ts`](../src/features/disbursement/loanStateMachine.test.ts) | 108 | All 100 `(state, event)` pairs; the 88 illegal ones are a typed `409` |
| [`money.test.ts`](../src/utils/money.test.ts) | 29 | `"19.99"` → `1999`; `"1e3"` refused; a value past `Number.MAX_SAFE_INTEGER` is `TOO_LARGE` |
| [`StreamingUnderwritingChat.test.tsx`](../src/features/ai-copilot/__tests__/StreamingUnderwritingChat.test.tsx) (+ hydration) | 11 + 1 | Tokens stream into one bubble; Stop keeps the partial reply; history survives a remount; Enter sends, Shift+Enter does not |
| [`ToolInvocationCard.test.tsx`](../src/features/ai-copilot/__tests__/ToolInvocationCard.test.tsx) | 25 | The 4 states; **Approve & Execute Payout** pays once when double-clicked |
| [`StreamingErrorSabotage.test.tsx`](../src/features/ai-copilot/__tests__/StreamingErrorSabotage.test.tsx) | 16 | Offline, mid-stream error, `429` countdown, malformed JSON, skeleton, empty states |
| [`chatRoute.test.ts`](../src/lib/ai/__tests__/chatRoute.test.ts) | 50 | The real route handler: SSE, abort, fallback, rate limit, the `time-limit` ending |
| [`fe11-production-hygiene.test.ts`](../src/app/api/__tests__/fe11-production-hygiene.test.ts) | 23 | `maxDuration = 30`, `413` / `400` caps, `429` + `Retry-After`, a fallback that ends inside 30 s |

Each guard in FE-11 was mutation-checked: when a guard was removed, at least one test failed.

**Playwright end-to-end (`npm run test:e2e`): 23 checks, green in CI on `fbc894f`.**
- [`e2e/primary-flow.spec.ts`](../e2e/primary-flow.spec.ts) (1): pay once, see the replay bounce, then the copilot
  answers with a tool card, with 0 console errors.
- [`e2e/keyboard-a11y-flow.spec.ts`](../e2e/keyboard-a11y-flow.spec.ts) (7): the keyboard-only primary flow, plus
  axe-core on 6 routes.
- `/motion-lab` (5), `/3d-lab` (6) and `/shader-hero` (4).

**Other browser checks:**
- `npm run test:e2e:fold`: 69 checks (above the fold, 375 px and 1280 px on every route).
- `e2e/cross-browser.mjs`: 27/27 on Chromium, Firefox, WebKit and WebKit at 375×812, run on `next start`.

**Screenshots:**
- [`fe-09-test-suite-green.png`](./assets/curated/fe-09-test-suite-green.png);
- [`fe-08-3-mid-stream-error-retry.png`](./assets/curated/fe-08-3-mid-stream-error-retry.png);
- [`fe-10-wave-and-keyboard-audit.png`](./assets/curated/fe-10-wave-and-keyboard-audit.png).

CI: https://github.com/l3n8n-ocd/microcredit-api/actions/workflows/ci.yml.

## 5 · Performance & Accessibility Audit

**Lighthouse 13.6.0, mobile (375×812 at 3x, simulated slow 4G and 4× CPU), live `fbc894f`, 5 runs per route:**

| Route | Performance (median, range) | Accessibility | Best Practices | SEO | LCP | CLS |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | **99** [98–100] | 100 (5/5) | 100 (5/5) | 100 (5/5) | 0.9–1.0 s | 0 |
| `/underwriting` | **99** [98–100] | 100 (5/5) | 100 (5/5) | 100 (5/5) | 1.0 s | 0 |

**axe-core 4.14, live:** 0 violations and 0 contrast errors on 6 routes. WAVE was not run (TODO).

**One concrete improvement from the audit (FE-10, [`AUDIT.md`](../AUDIT.md)).**

The streamed reply was hard to follow by screen reader. Two choices make it workable:
- **The transcript stays silent.** It is `role="log"` with `aria-live="off"`. A polite live transcript would queue
  an announcement for every token, and VoiceOver ignores `aria-busy`.
- **One `role="status"` line speaks instead.** It is `aria-live="polite"`. It says "Copilot is replying.", then
  "Reply complete." with the reply's first sentence.

Stopping a reply is just as reachable:
- **Stop** is the next Tab stop after the prompt, named "Stop generating AI response".
- It has `aria-keyshortcuts="Escape"`, and Escape stops the reply and puts focus back in the prompt.
- 8 Vitest tests and the Playwright keyboard flow cover it.

The same audit fixed two load problems:
- **LCP on `/underwriting`.** It reached about 3.2 s in 3 of 7 runs, because a `loading.tsx` skeleton was swapped in
  late on a dynamic page. It is now 0.76 s in 7 of 7.
- **Layout shift on `/`.** CLS went from 0.010 to 0.

Fonts are self-hosted through `next/font/local` with `display: 'swap'` (`src/app/layout.tsx`).

## 6 · Deployment & Operation

### 6.1 Deployment checklist (builds on [FE-11](./FE-11_PRODUCTION_DEPLOY.md))

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `main` deploys to Vercel production | ✅ | `GET /api/chat` → `"commit":"fbc894f"`, which is `origin/main` |
| 2 | CI green on the deployed commit | ✅ | typecheck, lint, 558 tests, `next build`, Playwright 23, fold 69 ([CI](https://github.com/l3n8n-ocd/microcredit-api/actions/workflows/ci.yml)) |
| 3 | Model key set server-side; no secret in `NEXT_PUBLIC_` | ✅ | `/api/health` → `GOOGLE_GENERATIVE_AI_API_KEY: true`; the only `NEXT_PUBLIC_` vars are `APP_ENV` and `APP_URL` |
| 4 | `maxDuration = 30` on `/api/chat` and `/api/agent` | ✅ | `GET /api/chat` → `limits.maxDurationSeconds: 30` |
| 5 | Input caps live | ✅ | 33 KB body → `413 BODY_TOO_LARGE`; 25 messages → `400 INVALID_REQUEST` (FE-11 §2.1) |
| 6 | Rate limit `429` + `Retry-After` | ✅ / TODO | Request 21 on `next start` → `429`, `Retry-After: 60`. Not seen live from this machine, because its egress rotates IP addresses. TODO: 21 requests from one home connection |
| 7 | Lighthouse ≥ 98 and axe 0 on the live build | ✅ | §5 above |
| 8 | Fresh clone runs with no keys | ✅ | §3 above |
| 9 | Provider spend limit set | **TODO (Lenon)** | This is set in the Google AI Studio console, outside the repo |
| 10 | Real iPhone and Apple Safari pass | **TODO (Lenon)** | WebKit passed at 375×812; WebKit is not the Safari app |

**Sign-off.** Machine checks prepared and verified on 2026-11-19 against `fbc894f`.
- [ ] Lenon D. Adriano: I read this checklist, confirmed the two TODO items myself, and approve this build for
  production.

### 6.2 How it fails safely

| Failure | What the user sees | Proof |
| --- | --- | --- |
| Network offline | "No connection. Nothing was sent." (`ERR_OFFLINE`); the question stays; **Retry** | FE-08 #1 |
| Error mid-stream | The partial reply is kept and marked `[Reply failed]` (`ERR_MID_STREAM`); **Retry failed prompt: "…"** re-sends that turn | FE-08 #2 |
| `429` rate limit | "Rate limit reached (HTTP 429)", with a live `Retry-After` countdown. Retry stays disabled until it reaches 0 | FE-08 #3, FE-11 |
| Malformed tool JSON | Reading stops at the broken frame and the text so far stays (`ERR_MALFORMED_FRAME`); Retry | FE-08 #4 |
| A slow first token (over 1.5 s) | "Thinking" becomes a 4-line skeleton in the same box, so CLS stays 0 | FE-08 #7, CLS 0 live |
| Empty chat or empty queue | Onboarding with 4 one-click prompts; **Reset filters & show all loans (5)** | FE-08 #6, #7 |
| The user presses Stop | `AbortController` cancels the fetch; `DELETE /api/chat?requestId=…` cancels the model call on the server | FE-06, `chatRoute.test.ts` |
| The model fails before its first token | The local rule engine answers, labelled with the reason (for example "model call failed: HTTP 429") | FE-06 |
| The model is still streaming at 27 s | The reply ends as "[Ended early: time-limit]" with its text kept, not a false error | FE-11 §2.1 |
| A late hand-over to the local engine | It streams with no pacing, so it ends inside the 30 s `maxDuration` | FE-11 §2.1 |
| A stale `If-Match` on a payout | `409 Conflict (VERSION_MISMATCH) · no ledger entry` | `disbursementServer.test.ts` |
| A render error | A route error boundary (`src/app/error.tsx`, `src/app/underwriting/error.tsx`) | FE-08 |

### 6.3 Rollback & monitoring plan

**Rollback.** The known-good build is `fbc894f`.
1. **Fastest.** In the Vercel dashboard, open Deployments, pick the last good production deployment, and promote it
   to production. Nothing is rebuilt.
2. **In code.** Run `git revert <bad-sha>` on `main` and push. CI runs, Vercel redeploys, and history is never
   rewritten or force-pushed.
3. **Verify.** `GET /api/chat` must show the expected `commit`, and `GET /api/health` must answer `"healthy"`. Then
   double-click **Disburse** once.

**Monitoring.** It runs on what the app already exposes. No prompt, reply, IP address or key is ever logged.

| Signal | Where | Act when |
| --- | --- | --- |
| `GET /api/chat` | `outcomes` (done, aborted, error, fallback), `rateLimited`, `last.status`, `requestLimit`, `limits`, `commit`, `instance` | `fallback` or `error` keeps rising. `last.status` 401/403 means the key was rejected; 404 means the model ID was retired (override it with `GOOGLE_GENERATIVE_AI_MODEL`); 429 means quota |
| `GET /api/health` | `status`, the domain invariants, and the key-present booleans | Anything other than `"healthy"`, or a key reads `false` |
| Vercel function logs | One `chat.model` JSON line per model request: `outcome`, `deltas`, `ms`, `status` | Lines with `ms` close to 27,000 or "time-limit" endings recur. Then decide whether `maxDuration` should go back to 60 |
| CI on every push | typecheck, lint, tests, build, Playwright, fold | Any red run blocks the deploy decision |

## 7 · Reflection

**What was hardest, and why.** It was keeping a claim true once the real platform ran it. A 30 s `maxDuration`
looked like one line of config. Tests passed, CI passed, and the first live run still broke. Gemini was still
streaming a long answer when my new 27 s budget stopped it, and the card told the user "the model stopped
responding". That was false, because my own timer did it. I fixed the wording, then ran it again and again. One run
failed a different way, and the timings pointed to the cause. A model that "thinks" clears the first-response
watchdog, so the hand-over to the local engine starts at 27 s. A paced reply then needs about 6 s more, which is
past the 30 s ceiling. No unit test would have
found either problem. Both came from the gap between one fast local run and the spread of live response times.

**What I would do differently.** I would measure the live system before I set a budget, not after. I would pass
one request deadline through the whole handler from the start, so every timer reads from it. Today the budgets are
separate numbers that I proved fit together afterwards. I would also write down early what this machine cannot
prove. My test traffic left through rotating IP addresses, so the live `429` could not be shown from here. That
belongs on a checklist as a TODO, not as a surprise during sign-off.

**One thing that surprised me.** Making a streaming chat accessible meant announcing *less*, not more. My first
instinct was a polite live region on the transcript. That would have read every token aloud, and VoiceOver ignores
`aria-busy`, so nothing would have stopped it. The fix was silence plus one status line: "Copilot is replying.",
then "Reply complete." with the first sentence. The best accessibility change in this project was deciding what
not to say.
