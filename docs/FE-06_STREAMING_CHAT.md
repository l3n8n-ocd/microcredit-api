# FE-06 · Streaming AI Chat Interface

> Week 4 · Frontend AI Engineering · Lenon D. Adriano · 2026-11-10
> Live: <https://microcredit-api-beta.vercel.app/underwriting#copilot>

The **AI Underwriting & Ledger Risk Copilot** is a multi-turn streaming chat on `/underwriting`. It
answers questions about trust scores, the 10 loan states, the `Σ debits === Σ credits` invariant, and
what `Idempotency-Key` and `If-Match` do when **Disburse** is clicked twice.

## The three files a reviewer asked for

| What | File | GitHub |
| --- | --- | --- |
| Route handler | [`src/app/api/chat/route.ts`](../src/app/api/chat/route.ts) | <https://github.com/l3n8n-ocd/microcredit-api/blob/main/src/app/api/chat/route.ts> |
| Chat component | [`src/features/ai-copilot/StreamingUnderwritingChat.tsx`](../src/features/ai-copilot/StreamingUnderwritingChat.tsx) | <https://github.com/l3n8n-ocd/microcredit-api/blob/main/src/features/ai-copilot/StreamingUnderwritingChat.tsx> |
| Model config + system prompt | [`src/lib/ai/underwriting-model.ts`](../src/lib/ai/underwriting-model.ts) | <https://github.com/l3n8n-ocd/microcredit-api/blob/main/src/lib/ai/underwriting-model.ts> |

## 1 · What is real and what is not

Read this first. It is the honest scope of the deliverable (`CLAUDE.md` §9.2 rule 4).

| Claim | Evidence | Status |
| --- | --- | --- |
| Tokens stream one by one over SSE from `/api/chat` | `npm run test:e2e`: 12 distinct text lengths in 12 samples, in Chromium, at 375px and 1280px | ✅ Verified |
| Stop aborts the HTTP request and keeps the partial reply | e2e: `net::ERR_ABORTED` on `/api/chat`, text length unchanged 400 ms later | ✅ Verified |
| "Stop, then send again" works for any number of turns | Component test loops stop → send 5 times; e2e sends a follow-up right after Stop | ✅ Verified |
| Multi-turn context is sent and used | Component test asserts the full history on request 2; e2e: "and for Liza?" resolves to Liza's score | ✅ Verified |
| The hosted-model path calls the AI SDK's `streamText` | Route test drives the real `streamText` with the SDK's `MockLanguageModelV4` | ✅ Verified against a mock |
| A real model answers on the live URL | `gemini-3.5-flash-lite` (Google free tier) on 2026-11-11, in Chromium: first text after 4.4 s, text length grew across 10 samples, and a follow-up ("Which of those states are terminal?") was answered from the earlier turn: `REJECTED`, `CANCELLED`, `SETTLED`, `DEFAULTED`. No Claude model has been run | ✅ Verified for Gemini; ⏳ Claude untested |
| Stop cancels the model call on the server, on Vercel | Live URL, 2026-11-11, real model, read from `GET /api/chat`. Through the Stop button in Chromium: the page sent `POST` then `DELETE`, and the server recorded `outcome: aborted` after 14 chunks at 5,921 ms (Stop was clicked at 5,943 ms). By script: `DELETE` answered `{"cancelled":true}`, server recorded `aborted` after 6 chunks. The same prompt left alone ran to 40 and 44 chunks. No `done` followed either cancel | ✅ Verified (explicit cancel) |
| Closing the connection alone cancels the model call | Not observed. A request dropped by the client 4.2 s in, after 11 chunks, was recorded as `done` with 40 chunks and 2,106 output tokens; the same with `supportsCancellation` on. The test client reaches Vercel through a proxy, so this may be the proxy and not Vercel | ⚠️ Not shown; this is why Stop sends an explicit cancel |
| Rate limiting on `/api/chat` | Live URL, 2026-11-11: 12 requests from one client over 77 s. 11 were allowed as the 60-second window slid, the 12th got `429` with `Retry-After: 8`, which is exactly what the rule gives for those arrival times. `GET /api/chat` then showed `rateLimited: 1`. Also: route test, 10 replies then `429` and the model is not called | ✅ Verified for one client on one instance; not a spend guarantee (§6) |

The live URL currently answers with `gemini-3.5-flash-lite`. That depends on a free-tier key and its
daily quota: when the quota runs out, or the key is removed, replies come from the local rule engine and
the label under each reply says so.

**With no key set, the reply does not come from a language model.** It comes from a local rule engine,
[`src/lib/ai/local-engine.ts`](../src/lib/ai/local-engine.ts), and the UI says so under every reply:
`local rule engine (no API key set)`. The streaming, cancellation and rendering are the same code either
way. That is the part FE-06 grades.

## 2 · Architecture

```text
Browser ('use client')                              Server (Node runtime)
──────────────────────────────────────────          ─────────────────────────────────────────────
StreamingUnderwritingChat.tsx
  chatReducer.ts      state machine                 src/app/api/chat/route.ts
  chatTransport.ts    fetch + AbortController  ───▶   1. parseChatRequest(unknown)  → 400 or messages
  chatProtocol.ts     SSE parser               ◀───   2. resolveChatEngine()        reads the API keys
  StreamingMarkdown.tsx                               3. streamText(...)  or  streamLocalReply(...)
  conversationStore.ts  localStorage                  4. SSE frames: meta → token × N → done | error

                                                    src/lib/ai/underwriting-model.ts   (server-only)
                                                      MODEL_CONFIG · STARTER_PROMPTS
                                                      buildSystemPrompt() · resolveChatEngine()
                                                    src/lib/ai/local-engine.ts
                                                      rule engine over the app's own pure functions
```

**One wire format for two engines.** Both the hosted model and the local engine are turned into the same
four SSE frames, defined once in [`chatProtocol.ts`](../src/features/ai-copilot/chatProtocol.ts):

```text
data: {"type":"meta","engine":{"kind":"local","label":"local rule engine (no API key set)"}}
data: {"type":"token","text":"Σ debits "}
data: {"type":"done","finishReason":"stop"}
data: {"type":"error","message":"..."}
```

The client has one code path and never knows which engine ran, except for the label it prints.

**Why a hand-written SSE protocol instead of the AI SDK's `useChat`.** `useChat` would hide the four
things this assignment asks to be engineered: the abort, the scroll pin, the thinking handoff and the
Markdown repair. The server still uses `streamText`. The trade-off is about 150 lines of protocol and
reducer code that the SDK would otherwise own.

**Keys stay on the server.** `underwriting-model.ts` starts with `import 'server-only'`, so `next build`
fails if a Client Component imports it. `ANTHROPIC_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` are read
from `process.env` in that file and nowhere else, and neither has a `NEXT_PUBLIC_` prefix. The server
page passes two plain props to the chat: the starter prompts and the engine **label**.

**The system prompt is generated, not typed.** `buildSystemPrompt()` computes the applicant list with
`scoreApplicant` and the transition table by running `transitionLoan` over every state. A test asserts
each applicant's score in the prompt equals what the engine computes, so the prompt cannot drift from
the code.

## 3 · The four Mentor Tips

### Tip 1 · Smart auto-scroll

*Problem.* A chat that scrolls to the bottom on every token drags the reader down while they read
something above. A chat that never scrolls makes them chase the reply.

*What I built.* The log follows the stream only while the reader is within **48 px** of the bottom.

```ts
const gapBefore = previous.scrollHeight - element.scrollTop
const distanceBefore = Math.min(gapBefore - previous.clientHeight, gapBefore - element.clientHeight)
if (forceFollowRef.current || distanceBefore <= PIN_THRESHOLD_PX) element.scrollTop = element.scrollHeight
```

- It runs in `useLayoutEffect`, so the token and the new scroll position paint in the same frame.
- Scrolling up more than 48 px releases the pin. A floating **↓ Jump to latest (streaming…)** pill appears.
- Sending a message or pressing the pill pins again.

*The bug the browser test caught.* My first version kept an `isPinned` flag set by `onScroll`. All 29
jsdom tests passed. In Chromium the pill never appeared. The browser delivers a scroll event one frame
after the scroll, and tokens land every ~22 ms: a token committed in that gap read the stale flag and
snapped the view back down. The fix reads the live `scrollTop` against the height recorded at the
previous commit, so there is no flag to go stale. The regression test sets `scrollTop` **without**
firing a scroll event and asserts the view does not move.

### Tip 2 · Stop as a state machine

*Problem.* Two booleans (`isLoading`, `isStreaming`) can disagree, and a token from an aborted request
can land in the next reply.

*What I built.* One reducer, [`chatReducer.ts`](../src/features/ai-copilot/chatReducer.ts), with five
states:

```text
idle ──send──▶ submitted ──first token──▶ streaming ──done──▶ idle
                   │                          │
                   └────────── stop ──────────┴──▶ stopped ──send──▶ submitted
                   └────────── fail ──────────┴──▶ error   ──send──▶ submitted
```

Stop does three things, in this order, with no waiting on the network:

1. `abortRef.current.abort()` cancels the `fetch`. Each request gets its own `AbortController`. The same
   abort makes the transport send `DELETE /api/chat?requestId=…`, which tells the server to cancel the
   model call (below).
2. `dispatch({ type: 'STOP' })` moves to `stopped`. The partial text stays and gets a
   `[Stopped mid-stream]` badge. Send is back in the same render.
3. Focus returns to the input.

**Stopping the server too.** Aborting a `fetch` only closes the browser's end. The first live
measurement showed the server generating the whole reply after the client had gone: 11 chunks received,
40 produced. A server learns about a closed connection only if every hop passes it on, so Stop no
longer relies on that. The browser makes a UUID per request and sends it with the `POST`. The server
keeps each running request's `AbortController` in a registry
([`active-requests.ts`](../src/lib/ai/active-requests.ts)); the `DELETE` aborts the named one, which
cancels the provider call. A reply that ended on its own sends no `DELETE`.

Every stream event carries the ID of the assistant message it belongs to. After Stop the reducer's
`activeId` is `null`, so a late token is dropped. After "send again" `activeId` is the new message, so a
late token from run 1 still cannot reach run 2.

Send and Stop are **one** `<button type="submit">`. Its `type` never changes. Swapping a button from
`button` to `submit` inside its own click handler lets the same click submit the form a moment later.

The input stays editable while a reply streams, so a follow-up can be typed ahead. Enter does not send
until the reply is done or stopped.

### Tip 3 · Flicker-free thinking → first token

*Problem.* A separate "typing…" row that is removed when the first token arrives makes the list jump by
one row.

*What I built.* The assistant bubble is created on send, empty. Its body is one container:

```tsx
<div className="min-h-6" data-testid="assistant-body">
  {text === '' && pending ? <ThinkingIndicator /> : <StreamingMarkdown text={text} streaming={...} />}
</div>
```

The thinking indicator is `h-6`, the same height as one `leading-6` line of text. The first token
replaces it inside the same DOM node, at the same height. The test keeps a reference to that node before
the first token and asserts it is the identical node after.

### Tip 4 · Streaming-safe Markdown

*Problem.* Mid-stream, Markdown is always broken: a code fence is open, `**` has no partner. A normal
renderer shows raw symbols for a few frames, then re-flows the message when the closer lands.

*What I built.* [`streamingMarkdownParser.ts`](../src/features/ai-copilot/streamingMarkdownParser.ts)
treats "not closed yet" as a normal state:

| Mid-stream text | Rendered as |
| --- | --- |
| ` ```ts ` + code, no closing fence | A code block (`open: true`) from its first line |
| `pay **onc` | "pay **onc**": bold up to the end of the text |
| ``send `If-Mat`` | Inline code up to the end of the text |
| A trailing `` ` ``, ` `` `, `*`, `#` or `-` | Held back until the next token decides what it is |
| ` ```t ` | A code block with no language tag yet, so `t` never flashes before `ts` |

Blocks are keyed by position and a stream only appends, so React patches text inside existing nodes. One
test parses **every prefix** of a reply and asserts the block count never goes down and no `**` or
backtick ever reaches the output. Output is React text nodes only. There is no
`dangerouslySetInnerHTML`, so model output cannot inject markup (`CLAUDE.md` §8).

A stopped reply keeps the tolerant parsing permanently, because it was cut mid-construct. The first
screenshot pass showed a stopped reply ending in a raw `**` and a backtick; that is now a test.

## 4 · Stretch goals

| Goal | How |
| --- | --- |
| Persistence | `localStorage` key `microcredit_ai_copilot_v1`. Read as `unknown` and rebuilt field by field; corrupt data gives an empty chat, not a crash. Saved at rest and on send, not per token. |
| Hydration | `useSyncExternalStore` reports "not in a browser" during SSR and hydration, then the session remounts once with the stored messages. No hydration warning, no `setState` in an effect. |
| Clear / Reset | **Clear conversation** aborts any request, empties the list and removes the storage key. |
| Starter chips | 4 chips from `STARTER_PROMPTS`, one per topic. Each also works on the local engine. |
| Motion | Message entry and the Send ⇄ Stop colour swap: 150 ms `ease-out` (`cubic-bezier(0, 0, 0.2, 1)`), off under `prefers-reduced-motion`. The thinking dots are the app's one looping animation (`CLAUDE.md` §12 rule 4 exception) and are static under reduced motion. |
| 375px | The composer is the last child of a fixed-height flex column, so it stays in view while the log scrolls. Targets are `min-h-11` (44 px). Code blocks scroll inside themselves: e2e measures 0 px page overflow with a journal block on screen. |
| Accessibility | The log is `role="log"` with `aria-live="off"`, so a screen reader is not read every token; a `role="status"` line announces thinking, replying, stopped and complete. The field has `<label htmlFor>`, `aria-invalid` and `aria-describedby` (`CLAUDE.md` §11 rule 1). |

## 5 · The local rule engine

When no key is set, [`local-engine.ts`](../src/lib/ai/local-engine.ts) routes the last user message to
one of four topics by keyword and builds the answer from the app's own functions:

| Topic | Numbers come from |
| --- | --- |
| Trust score | `scoreApplicant` on the seed profile |
| Lifecycle | `LEGAL_TRANSITIONS`, plus `transitionLoan` run over every state to find where each event leads |
| Ledger | `buildDisbursementJournal`, `splitRepayment`, `journalTotals`; amounts through `parsePesosToCentavos` only |
| Concurrency | Three real requests against a fresh `createDisbursementServer`: `201 CREATED`, `201 REPLAYED`, `409 CONFLICT VERSION_MISMATCH`, ledger entries posted: 1 |

A follow-up with no topic keyword inherits the earlier topic ("and for Liza?", "what about ₱12,500?").
`₱10.005` is refused, not rounded. Anything it cannot route gets a reply that says it is a rule engine
and lists what it can answer. If a hosted model fails before its first token (bad key, rate limit), the
route falls back to this engine and relabels the reply `local rule engine (model call failed)`.

## 6 · Running it with a paid key

`/api/chat` has no authentication, so three things bound what a key can cost.

**1. A per-client rate limit** ([`src/lib/ai/rate-limit.ts`](../src/lib/ai/rate-limit.ts)). A request
that would reach a hosted model first passes a sliding-window log: **10 a minute and 100 a day** per
client IP. Over the limit, the route returns `429` with `Retry-After` before any stream opens, and the
chat shows "Too many requests from this network. Try again in 50 seconds." The local engine is free, so
it is not limited.

- *Sliding window, not fixed window.* A fixed-window counter resets on the clock minute, so 10 requests
  at 0:59 and 10 more at 1:01 both pass. The log measures back from "now", so that burst is refused.
- *Rejected requests are not counted.* Hammering a full window does not push the retry time out.
- *What it does not guarantee.* The log lives in one server instance's memory. Vercel can run several
  instances and a cold start empties the log, so the real ceiling is the limit times the number of warm
  instances. It slows a script down. It is not a spend guarantee. A shared store (Upstash Redis) would
  make it exact; that is not built.

**2. Per-request caps.** At most 24 messages and 2,000 characters per user message (`CHAT_LIMITS`,
enforced on both sides), `maxOutputTokens: 4096`, `maxRetries: 1`.

**3. The provider spend limit.** This is the guarantee, and it is set outside this repo: a dedicated key
in its own workspace with a low monthly limit. For a public demo, also set
`ANTHROPIC_MODEL=claude-haiku-5-5`; the default is `claude-opus-5-5`.

### Checking the key took effect

`GET /api/health` reports `ANTHROPIC_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` as `true` only for a
real value. An empty value or a `.env.example` placeholder reads `false`, and the chat stays on the local
engine ([`src/utils/env.ts`](../src/utils/env.ts)). Env changes on Vercel apply to new deployments only.

### When the provider misbehaves

The chat never dead-ends. If the model has sent no text yet, the route answers from the local engine and
the label under the reply says why. Only the HTTP status and part-type counts are read from a failure;
the provider's message is never logged or shown.

| What happened | After | Label under the reply |
| --- | --- | --- |
| Provider returned an error status (bad key, unknown model, quota) | At once; `maxRetries: 0` | `local rule engine (model call failed: HTTP 404)` |
| Provider accepted the request and sent nothing | 20 s (`modelFirstResponseMs`, own `AbortController`) | `local rule engine (model call timed out: no response)` |
| Response started, then no chunk | 25 s (`firstChunkMs` / `chunkMs`) | `… (model call timed out while thinking)` or `… (model call timed out: no text)` |
| Reply finished with no text | At once | `local rule engine (model returned no text)` |
| Failure after text was already shown | At once | The partial reply stays; the chat shows an error |

Each of these was hit on the live URL or reproduced in a test.
[`googleProvider.test.ts`](../src/lib/ai/__tests__/googleProvider.test.ts) runs the real
`@ai-sdk/google` provider through the route against a local server that speaks Gemini's SSE format,
including the case where the server accepts the request and never answers.

Production runs Node 22 (`"engines": { "node": "22.x" }`), the same major version as CI and `.nvmrc`.
With `">=22"` Vercel had picked Node 26, which no check in this repo ran on.

### What the live runs showed about the limiter

- **One client is limited.** Twelve requests over one connection: eleven allowed across 77 s as the
  window slid, the twelfth refused with `429` and `Retry-After: 8`.
- **A burst from many addresses is not.** Thirteen simultaneous requests all returned `200`. The
  counters explain it: from the test machine each new connection arrives from a different IP
  (`trackedClients` rose by one per connection), so the limiter saw thirteen clients, not one.
- **Per instance.** Two server instances were seen within a minute of each other. Each has its own log,
  so the real ceiling is the limit times the number of warm instances.

With a free-tier key the cost exposure is zero: the provider quota is the cap, and when it runs out the
chat falls back to the local engine (`HTTP 429` in the label). **Before a paid key goes on this URL, the
limiter needs a shared store.**

### Reading what the server did: `GET /api/chat`

The `chat.model` log line is only visible in the host's log viewer and expires. `GET /api/chat` returns
the same facts from memory, as counters. No prompt, reply, IP or key.

```json
{
  "engine": { "kind": "google", "label": "gemini-3.5-flash-lite" },
  "commit": "e475ec2",
  "instance": "ab87c41b",
  "outcomes": { "done": 10, "aborted": 2, "error": 0, "fallback": 1 },
  "rateLimited": 1,
  "cancels": { "received": 2, "matched": 2 },
  "last": { "outcome": "aborted", "deltas": 14, "outputTokens": null, "ms": 5921, "status": null }
}
```

That is a real reading from the live URL after the runs above (trimmed). To repeat the cancellation
measurement: ask for a long answer, press Stop, then open `/api/chat`.

| Reading | Meaning |
| --- | --- |
| `aborted` went up; `last.ms` is near the moment Stop was pressed; `cancels.matched` went up | The server cancelled the model call when Stop was pressed. |
| `done` went up with a full-length `deltas` | The model call ran to the end. Stop only saved the reader's time. |
| `instance` differs between two readings | A different server instance answered. The counters are per instance, so the two readings cannot be compared. |

## 7 · How to run and verify

```bash
npm run dev            # http://localhost:3000/underwriting#copilot — local engine, no key needed
npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e
```

To use a hosted model, copy `.env.example` to `.env.local` and set **one** real key. The placeholder
values are treated as "no key".

| Check | Result on this commit |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 warnings |
| `npm test` | 344 passed in 15 files (248 before FE-06; 96 new) |
| `npm run build` | `/api/chat` and `/underwriting` are dynamic (`ƒ`) |
| `npm run test:e2e` | 46 checks passed: the 18 existing fold and overflow checks, plus 14 Copilot checks at each of 375px and 1280px |

New tests:
[`StreamingUnderwritingChat.test.tsx`](../src/features/ai-copilot/__tests__/StreamingUnderwritingChat.test.tsx)
(11, component),
[`chatCore.test.ts`](../src/features/ai-copilot/__tests__/chatCore.test.ts) (20: reducer, SSE parser,
Markdown parser, fetch transport), [`chatRoute.test.ts`](../src/lib/ai/__tests__/chatRoute.test.ts)
(48: route, explicit cancel, status counters, rate limit, log line, timeouts, engine resolution, system prompt, local engine),
[`rateLimit.test.ts`](../src/lib/ai/__tests__/rateLimit.test.ts) (9),
[`googleProvider.test.ts`](../src/lib/ai/__tests__/googleProvider.test.ts) (3: the real Google provider
over HTTP) and [`env.test.ts`](../src/utils/env.test.ts) (3).

**Mutation checks.** Each of these one-line changes was applied, the suite was run, and at least one
test failed: always auto-scroll; threshold 48 → 60 and 48 → 30; pin decided by the scroll-event flag;
Stop without `abort()`; reducer accepting late events; Stop discarding the partial text; thinking
indicator outside the body container; no `localStorage` write; local generator ignoring the abort
signal; `abortSignal` not passed to `streamText`; history truncated to the last message; route skipping
the limiter; limiter applied to the local engine; rejected requests counted; fixed window instead of
sliding; no daily rule; no key eviction; an abort logged as `done`; a placeholder accepted as a key.

## 8 · Screenshots

Real captures from `next start` (local engine), 2× scale.

| Thinking, inside the bubble (1280px) | Streaming (1280px) |
| --- | --- |
| ![The assistant bubble shows three dots and "Thinking…" under the user's question](./assets/fe-06/fe-06-thinking-desktop-1280.png) | ![The reply streams: a code block with 201 CREATED, 201 REPLAYED and 409 CONFLICT VERSION_MISMATCH](./assets/fe-06/fe-06-streaming-desktop-1280.png) |

| Scrolled up mid-stream: "Jump to latest" (1280px) | Stopped mid-stream, follow-up typed (375px) | Empty state with starter chips (375px) |
| --- | --- | --- |
| ![The log is scrolled to the top while a reply streams; a pill reads "Jump to latest (streaming…)"](./assets/fe-06/fe-06-jump-desktop-1280.png) | ![A partial reply ends with a "[Stopped mid-stream]" badge; the input holds the next question and Send is available](./assets/fe-06/fe-06-stopped-mobile-375.png) | ![Four starter prompt chips above the message field on a 375px screen](./assets/fe-06/fe-06-empty-mobile-375.png) |

### Live, with a hosted model

![The live chat with engine gemini-3.5-flash-lite: a reply about the 10 loan states cut off mid-sentence with a "[Stopped mid-stream]" badge, and the cursor back in the message field](./assets/fe-06/fe-06-live-model-stopped-1280.png)

Captured from <https://microcredit-api-beta.vercel.app/underwriting#copilot> on 2026-11-11. The model
is named in the header and under the reply. Stop was pressed 4.9 s after send.

## 9 · Does this serve the One Claim?

The claim is "I build loan disbursement flows that cannot pay a borrower twice." A chat is not that
claim, so it is kept out of its way:

- It sits on `/underwriting`. On `/` it is a nav pill and a card **below** the demo. Nothing was added
  above **Disburse**: the fold check still reads 712 px of 740 px at 360px wide.
- The line it does draw: an Engineering Manager double-clicks **Disburse**, watches the second request
  bounce, and can ask why. The answer runs the same three requests on a fresh server and prints
  `201 CREATED`, `201 REPLAYED`, `409` and "ledger entries posted: 1".

What FE-06 adds to the proof is narrower than "AI": request cancellation, a state machine that cannot
leak a stale token, and a race found by a browser test that unit tests missed.

## 10 · Ready for FE-07 (tools)

- `ChatMessage.parts` is a typed list. FE-07 adds `tool-call` and `tool-result` parts beside `text`.
- `ChatStreamEvent` is a discriminated union. A `tool` frame is one more member.
- `buildSystemPrompt()` hands the model a static snapshot of all five applicants. A `score_applicant`
  tool replaces it, so the model asks for one borrower at call time.
- `route.ts` marks where `tools` and `stopWhen` go in the `streamText` call.
