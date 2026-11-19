# FE-11 · Production Deployment and README

- **Production URL:** https://microcredit-api-beta.vercel.app. `GET /api/chat` reports the deployed `commit`, the
  limits, and the engine.
- **Code:**
  - [`src/app/api/chat/route.ts`](../src/app/api/chat/route.ts) and [`src/app/api/agent/route.ts`](../src/app/api/agent/route.ts);
  - [`src/lib/http/request-guard.ts`](../src/lib/http/request-guard.ts): the 32 KB body cap and the `{ error, code }`
    refusals;
  - [`src/lib/ai/rate-limit.ts`](../src/lib/ai/rate-limit.ts): the per-client limits and `CHAT_RATE_LIMIT_*`;
  - [`src/features/ai-copilot/chatReducer.ts`](../src/features/ai-copilot/chatReducer.ts): `toWireHistory` trims to fit.
- **Tests:**
  - [`src/app/api/__tests__/fe11-production-hygiene.test.ts`](../src/app/api/__tests__/fe11-production-hygiene.test.ts)
    (22, Vitest);
  - [`e2e/cross-browser.mjs`](../e2e/cross-browser.mjs) (27 browser checks, `npm run test:e2e:browsers`).
- **README:** [`README.md`](../README.md), upgraded for a reader with no other context: screenshots, run steps,
  environment variables, key decisions, production limits, "How AI tools built this", and the deliverable index.

**How it ties to the One Claim.** The demo's promise is that a payout cannot happen twice. FE-11 makes the public
routes behind it safe to leave open: a stranger can't run up the model bill, flood the function, or hold it open
past 30 s.

---

## 1 · Route hygiene: what each request meets, in order

| Step | `POST /api/chat` (SSE) | `POST /api/agent` (NDJSON) | Refusal |
| --- | --- | --- | --- |
| 1. Per-client rate limit, before the body is read | 20 per 60 s on every request (`CHAT_RATE_LIMIT_MAX`, `CHAT_RATE_LIMIT_WINDOW_MS`) | 6 a minute, 40 a day | `429`, `Retry-After`, `RATE_LIMITED` |
| 2. Body size | 32 KB | 4 KB | `413`, `BODY_TOO_LARGE` |
| 3. JSON | UTF-8 JSON | UTF-8 JSON | `400`, `INVALID_JSON` |
| 4. Content caps | at most 24 messages; 2,000 characters per user turn, 4,000 per echoed assistant turn; last turn from the user | `request` at most 600 characters | `400`, `INVALID_REQUEST` |
| 5. Paid-model limit | 10 a minute, 100 a day, only when a hosted model would answer | (in step 1) | `429`, `RATE_LIMITED` |
| Ceiling | `maxDuration = 30`; the model must start within 15 s and finish within 27 s | `maxDuration = 30`; model planner 24 s, each advisory fetch 5 s | a labelled fallback, an `error` frame, or a `halt` event |

A refusal is always the same JSON shape, `Cache-Control: no-store`, and a fixed sentence:

```json
{ "error": "Too many requests from this network. Try again in 42 seconds.", "code": "RATE_LIMITED", "retryAfterSeconds": 42 }
```

No exception message or stack trace is ever in the response. The test suite checks every refusal's keys and checks
that `error` holds no stack frame, `Error:` or file path.

### Decisions, and why

1. **Two limits, not one.**
   - The brief asked for about 20 requests per 60 s per client. That now covers every POST: the local engine,
     the FE-08 drills and the FE-07 tool retries, which used to bypass the limit.
   - The existing paid-model limit (10 a minute, 100 a day) stays on top, because it is stricter and it guards
     money.
   - The agent keeps its own 6 a minute, 40 a day, which is already stricter than 20.
2. **The limit runs before the body is read.**
   - An over-limit client costs one `Map` lookup.
   - The test sends a 1 MB body from a client that is already over the limit, and gets `429`, not `413`.
3. **The body cap holds even when `Content-Length` lies.**
   - A declared length over 32 KB is refused without reading the body (the test asserts `request.bodyUsed === false`).
   - A body with no `Content-Length` is read in chunks, and the read stops at the cap.
4. **Some caps differ from the brief, on purpose.**
   - The brief suggested 4,000 characters per message. A user turn stays at 2,000, which is stricter and is the
     limit the textarea already enforces.
   - Echoed assistant turns went from 12,000 characters to 4,000.
   - A 32 KB body could not hold 24 turns of 12,000 characters, so `toWireHistory` now drops the oldest turns until
     the history fits. A long real conversation never trips its own `413`, and a test sends roughly 70 KB of history
     through it to prove so.
5. **A 30 s ceiling needs every inner budget under it.**
   - The model timeout was 55 s, which would have let Vercel cut the stream mid-reply. It is now 27 s in total,
     with 15 s allowed before the first output.
   - The live engine, `gemini-3.5-flash-lite`, produced its first text in 4 to 8 s when measured in FE-06.
   - The agent's model planner had 90 s. The web route now passes 24 s through a new `modelTimeoutMs` option, and
     the CLI keeps 90 s. A slow run ends in a `halt` event.
6. **What the limit is not.**
   - It lives in memory, so each Vercel instance counts on its own, and a cold start resets it.
   - It slows a script down; the provider's monthly spend limit is the real cap. A shared store (Redis) would make
     the limit exact, and that is not built.

### Evidence

- **Vitest:** 555/555, including 22 new tests in `fe11-production-hygiene.test.ts`, which cover:
  - `maxDuration === 30` on both routes, and every inner budget under it;
  - `413` from a declared length, from a streamed body, and at exactly 32 KB + 1 byte;
  - `400` codes for each cap;
  - 20 requests allowed, then the 21st refused with `429` and `Retry-After`, while another client stays unaffected;
  - the sliding window reopening;
  - environment variable parsing, including bad values falling back to the defaults;
  - the agent's `413`, `400` and `429`;
  - a long history trimmed under 32 KB and accepted by the server.
- **Mutation checks.** Each guard was removed in turn, and each removal failed at least one test:
  - removing the limiter check: 2 tests failed;
  - removing the streamed byte cap: 3 failed;
  - removing the `Content-Length` check: 1 failed;
  - setting `maxDuration = 60`: 1 failed.
- **No test-only override.** With the new 20/60 s limit in place, Playwright passed 23/23, fold 69/69, FE-08 31/31
  and FE-07 14/14. Those suites send real `/api/chat` requests from one address and stay under the limit.

## 2 · Production promotion checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Production deploys from `main` | ✅ | Vercel imports `l3n8n-ocd/microcredit-api`. Every push to `main` builds and promotes. `GET /api/chat` → `commit` names the live build (`576c59d` before this change). |
| Production availability | ✅ | `https://microcredit-api-beta.vercel.app` answered `200` on `/` and `/shader-hero`, and `/api/chat` reported `commit: "576c59d"`, on 2026-11-19 before this change. |
| Env: model key | ✅ | Production answers with `{"kind":"google","label":"gemini-3.5-flash-lite"}`, so `GOOGLE_GENERATIVE_AI_API_KEY` is set and `ANTHROPIC_API_KEY` is not (Anthropic would be chosen first). |
| Env: `CHAT_RATE_LIMIT_MAX`, `CHAT_RATE_LIMIT_WINDOW_MS` | ✅ unset on purpose | The defaults (20 per 60 s) apply. `GET /api/chat` → `requestLimit.rule` shows what is live. |
| Env: no secret under `NEXT_PUBLIC_` | ✅ | The only `NEXT_PUBLIC_` variables in `src/` are `NEXT_PUBLIC_APP_ENV` and `NEXT_PUBLIC_APP_URL`. Keys are read only in `src/lib/ai/underwriting-model.ts` and `src/lib/sentinel-scout/model.ts` (server-only). |
| `.env.example` has every variable | ✅ | Placeholders for both keys; `CHAT_RATE_LIMIT_*` added, commented out, with their defaults. |
| `maxDuration` set explicitly | ✅ | 30 s on both streaming routes: a ceiling chosen for these routes, with every inner budget under it (§1). |
| Provider spend limit | **TODO (Lenon)** | This is the real cost cap, and it is set in the Google AI Studio / Anthropic console, outside this repo. It has not been confirmed from here. |
| Custom domain | Not used | Production stays on `microcredit-api-beta.vercel.app`. To add one: Vercel project → Settings → Domains → add the name, then create the DNS record Vercel shows, as in [`PF-04_DNS_WALKTHROUGH.md`](./PF-04_DNS_WALKTHROUGH.md) for the portfolio. Then update the README links and `NEXT_PUBLIC_APP_URL`. |
| Live after this commit | **TODO: next commit** | Re-run `BASE_URL=https://microcredit-api-beta.vercel.app npm run test:e2e:browsers`, read `GET /api/chat` → `commit`, `requestLimit`, `limits`, and send one oversized body (`413`). Results go in §2.1. |

### 2.1 Live verification after deploy

TODO: filled in by the follow-up `docs(fe-11)` commit, once Vercel serves this commit.

## 3 · Cross-browser matrix

Run on 2026-11-19 with `node e2e/cross-browser.mjs` against `next start` of this commit's build. The browsers were
Playwright 1.63's builds of Chromium 153, Firefox 155 and WebKit 26.6.

| Check | Chrome (Chromium 153) | Firefox 155 | Desktop Safari (WebKit 26.6) | Mobile Safari (WebKit 26.6, 375×812, touch, 3x) |
| --- | --- | --- | --- | --- |
| 11 routes: HTTP 200, 0 px horizontal overflow | ✅ | ✅ | ✅ | ✅ |
| Simulate double-click: `201 Created`, then `201 Idempotent replay of JE-0001` | ✅ | ✅ | ✅ | ✅ |
| Two admins: `409 Conflict (VERSION_MISMATCH) · no ledger entry` | ✅ | ✅ | ✅ | ✅ |
| Copilot streams over SSE and settles ("Reply complete.") | ✅ | ✅ | ✅ | ✅ |
| Shader hero reports its state | ✅ `running` | ✅ `static-no-webgl` | ✅ `running` | ✅ `running` |
| 0 page errors | ✅ | ✅ | ✅ | ✅ |
| Every visible text control ≥ 16 px (no iOS focus zoom) | | | | ✅ 17 controls measured, all 16 px |
| Viewport meta allows pinch zoom | | | | ✅ `width=device-width, initial-scale=1` |
| `body` is `min-h-dvh` and fills the dynamic viewport | | | | ✅ `min-height: 812px` at 812 px |

**Total: 27/27.**

**What this does and does not prove:**
- **WebKit is not Safari.** Playwright's WebKit is the engine Safari is built on, not Apple's Safari app on macOS or
  iOS. The iPhone row is WebKit at 375×812 with touch and an iPhone user agent. It cannot reproduce iOS's own
  focus zoom, which is why the 16 px font-size check stands in for it. **TODO (Lenon):** one pass on a real iPhone
  and in desktop Safari, using the same steps.
- **Firefox's shader result is the fallback working.** Headless Firefox on this Linux box has no WebGL, so
  `/shader-hero` showed its labelled static gradient (`static-no-webgl`). That is one of its designed paths. A
  desktop Firefox with a GPU should report `running`; that has not been checked.
- **`100dvh`.** The layout uses `min-h-dvh` (`src/app/layout.tsx`) and the copilot uses `100dvh`, so the iOS
  address bar does not hide the bottom of the page. The shader hero's `min-h-[85vh]` is the one `vh` left; it is a
  minimum height, so nothing is clipped.
- **Not in CI.** CI installs Chromium only. This matrix runs on demand.

## 4 · Conventional Commits audit

`git log -n 15 --oneline` before this commit. Each subject was piped through this repo's commitlint
(`@commitlint/config-conventional`, types limited to `feat`, `fix`, `docs`, `chore`, `refactor` and `test` by
`commitlint.config.js`).

| Commit | Subject | Length | commitlint |
| --- | --- | --- | --- |
| `576c59d` | `feat(fe-aa3): add GLSL fullscreen hero shader with DPR cap, tab-pause, and reduced-motion fallback` | 98 | pass |
| `0907b58` | `docs(fl-09-fl-10): add reproducible README, evals, transparency note, master index, retrospective` | 97 | pass |
| `710f37a` | `docs(fe-10): record live Vercel Lighthouse runs after deploy` | 60 | pass |
| `dde0f89` | `fix(fe-10): ship a11y and Web Vitals fixes, keyboard-only E2E pass, and AUDIT.md with screenshots` | 97 | pass |
| `e1ab531` | `docs(fe-aa2): record live Vercel chunk size and load timings` | 60 | pass |
| `7174c2e` | `feat(fe-aa2): ship lazy-loaded 3D POS & GLB configurator at /3d-lab with FE-10 perf telemetry` | 93 | pass |
| `84bc947` | `docs(fl-cap): add next case study runbook, named SentinelScout case, calendar reminder, CLAUDE.md` | 97 | pass |
| `20458f4` | `feat(fe-aa1): build 6-state SmartActionButton motion system and /motion-lab workbench` | 85 | pass |
| `45d10af` | `test(fe-09): add RTL component suite, Playwright primary flow E2E, and blocking GitHub Actions CI` | 97 | pass |
| `ef15da1` | `fix(fe-07): record the first live tool call and stop the model crediting scoreEngine.ts` | 87 | pass |
| `d85759a` | `feat(fe-07): add Zod AI tools, 4-state generative UI cards, SVG score chart, and tool contracts` | 95 | pass |
| `8d6f206` | `feat(fe-08): add error boundaries, mid-stream retry choreography, zero-CLS skeletons, sabotage suite` | 100 | pass |
| `8b65aa8` | `docs(pf-04): add DNS and CNAME walkthrough in microcredit-api and link cloud portfolio` | 86 | pass |
| `a1f5f77` | `docs(fl-07): record the first live GitHub-sourced run on Vercel` | 63 | pass |
| `a9dd389` | `feat(fl-07): build SentinelScout MCP agent, /agent live runner, eval suite, and build log` | 89 | pass |

**What the audit found:**
- 15/15 pass, all authored by Lenon D. Adriano.
- 0 merge commits and 0 co-author trailers.
- `main` was level with `origin/main` and the working tree was clean apart from this change.
- No history was rewritten, and none needs to be.

**`perf(...)` is not used here.** The brief lists `perf(...)`, but `commitlint.config.js` allows only the 6 types
in CLAUDE.md §7. That is why the FE-10 performance work shipped as `fix(fe-10)`. Adding `perf` would be its own
`chore` commit that changes CLAUDE.md §7 as well.

## 5 · Checks on this commit

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | 555/555 |
| `npm run build` | exit 0; `/api/chat` and `/api/agent` are dynamic (`ƒ`) |
| `npm run test:e2e` | 23/23 |
| `npm run test:e2e:fold` | 69/69 |
| `npm run test:e2e:fe08` / `fe07` | 31/31 / 14/14 |
| `npm run test:e2e:browsers` | 27/27 |

## 6 · Not claimed

- A real iPhone or Apple Safari pass: TODO, see §3.
- The provider-side spend limit: TODO, see §2.
- An exact, cross-instance rate limit: not built, see §1, decision 6.
- Live results for this commit: TODO in §2.1, filled in by the follow-up commit.
