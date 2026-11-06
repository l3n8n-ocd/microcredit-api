# Frame It as Cases: Work That Speaks for Itself

> Week 2 · General AI Fluency · Lenon D. Adriano · 2026-11-06
> One Claim: **I build loan disbursement flows that cannot pay a borrower twice.**
> One Person: an Engineering Manager at a seed-to-Series A lending startup.
> Sitemap: [`PORTFOLIO_PATH.md` v2](./PORTFOLIO_PATH.md#revised-sitemap-v2--3-sections) (Hero · Flagship · Act).

---

## 1 · The Standing Voice Card & Anti-Buzzword Rules

> ### 🎙️ "Direct, technical, plainspoken, concrete, zero buzzwords."

These rules are permanent. They live in [`CLAUDE.md` §9.3](../CLAUDE.md#93-standing-voice-card) for
Claude Code, and in the Claude Project's custom instructions, mirrored in
[`FL-01_WORKFLOW_AUDIT.md` §3.1](./FL-01_WORKFLOW_AUDIT.md#31-claude-project-custom-instructions-copy-paste):

<!-- voice-check:off -->
1. **Banned filler:** "results-driven", "passionate", "seamless", "cutting-edge", "leveraged" (any
   form), "synergy", "robust". Rewrite the sentence; don't swap in a synonym.
<!-- voice-check:on -->
2. **Name the real thing.** Every paragraph names at least one actual state transition, HTTP header,
   integer-centavo invariant or file path.
3. **One breath.** Each sentence reads naturally out loud in one breath.
4. **Claims follow evidence.** Only what the code, tests, deployment or a public link shows. Anything
   else is marked TODO.

**Check** (prints nothing when this document follows the rules):

```bash
sed '/voice-check:off/,/voice-check:on/d' docs/FRAME_IT_AS_CASES.md | grep -niwE 'results-driven|passionate|seamless|cutting-edge|leverag(e|ed|es|ing)|synergy|robust'
```

---

## 2 · Interview Extraction Log (before any drafting)

Claude interviewed me one round at a time, and no case prose was written until the answers were in.
Where Claude checked an answer against the repo or public sources, the log says so, and the
**Correction** lines show what the interview stopped me from claiming.

### MicroCredit API

| Round | Question | Answer | Source |
| ----- | -------- | ------ | ------ |
| 1 | Which real failure changed how you build money flows, and what do you do differently now? | "The parser bug changed how I build money flows. Round 1 passed typecheck, lint and all 5 tests, yet it turned `"90071992547409.93"` into `9007199254740992`, past `MAX_SAFE_INTEGER`, with no error. Green CI didn't mean correct money. Now I write the boundary into the spec first (13 whole-peso digits, otherwise `TOO_LARGE`, with a test), and I run a mutation check on every invariant: switching off the replay lookup failed 4 tests, which proves the replay-before-`If-Match` order is actually guarded." | **Drafted by Claude from repo evidence at my request, then approved by me.** Facts checked against [`WORKFLOW.md`](../WORKFLOW.md) and `src/utils/money.ts` (`MAX_WHOLE_PESO_DIGITS = 13`). |
| 2 | The brief says the "Simulate double-click / network retry" control sits right above the fold. Does it? | No. Claude built the app and measured it: at 1280×800 the control starts at 955px, and at 360×740 at 1,523px. **Disburse** is below the first screen on both. | Playwright measurement of `npm run build` + `vite preview`. |

**Correction:** the case says "one scroll below the form", not "above the fold". Moving the control above
the fold is tracked as a TODO (see Case 1).

### Node2Shell (CVE-2026-111497)

| Round | Question | Answer | Source |
| ----- | -------- | ------ | ------ |
| 1 | What is the vulnerable component, where does untrusted input cause harm, and what is your public credit? | I asked Claude to look it up. Public sources: an **out-of-bounds write in the Brotli decoder bundled with Node.js** (Brotli 1.0.3–1.2.0). Attacker-controlled Brotli data, for example Express 5 / body-parser 2 request bodies, `fetch()` responses or direct `node:zlib` use, can corrupt memory and lead to remote code execution. Fixed in Node.js **22.23.4, 24.22.1 and 26.12.1** (Oct 21, 2026). The discovery is credited to other researchers. | [Akamai](https://www.akamai.com/blog/security-research/inside-node2shell-closer-look-cve-2026-111497), [Sysdig](https://www.sysdig.com/blog/node2shell-cve-2026-111497-detecting-the-node-js-brotli-rce), [Aikido](https://www.aikido.dev/blog/node2shell-nodejs-brotli-rce-cve-2026-111497), [Red Hat](https://access.redhat.com/security/cve/cve-2026-111497) |
| 2 | Then what exactly was *your* work on it? | My public write-up: [LinkedIn](https://lnkd.in/p/g_V3bkhS), and the full advisory as a [Google Doc](https://docs.google.com/document/d/1tzEqUoyXrR5_RpeszSFKZX4LhVh_PnoSsjsf9wpNtJo/view). | My answer. Claude couldn't open LinkedIn (blocked by the session's network policy), but read **all 374 lines** of the Google Doc: *"Node2Shell (CVE-2026-111497): Technical Analysis, PoC, and Remediation — VulnTech Research"*, by Exemprium, Oct 26, 2026. Every claim in Case 2 comes from it. |

**Corrections:**
- My first brief called this "an untrusted input sink leading to command execution" closed by "input
  sanitization." It's a decoder memory bug. My own advisory says the **primary fix is upgrading Node**.
  Rejecting `Content-Encoding: br` is only a stopgap, and it doesn't cover `fetch()`.
- I did not discover it, so the case doesn't imply that I did.
- No unverifiable metric ("reproduce it in minutes") is used.

### RoadWatch

| Round | Question | Answer | Source |
| ----- | -------- | ------ | ------ |
| 1 | What was *your* part, as distinct from the team's, and what state is it in today? | "I'm the Project Coordinator, Mobile Front-End Developer, Repo Manager, and it's been deployed and demoed already, it just needs to be published on Play Store and needs to update its QR code in the landing page." | My words. Matches the repo's README: "Lenon Adriano (Project Lead & Mobile): Leads the project and builds the Android app in Flutter; keeps the repository, CI and releases running." Play Store release + QR code is listed as pending. |
| 2 | Which one decision did you push for? | **Role and platform lockdown.** | [`docs/DECISIONS.md`](https://github.com/l3n8n-ocd/roadwatch/blob/main/docs/DECISIONS.md) rows 36, 40 and 45; `api/src/config/constants.js` `ROLE_PLATFORMS` |
| 3 | The brief says reports were scattered across Facebook groups. Is that what you saw? | Use the repo's framing instead. | My answer |

**Corrections:**
- "Lost-item recovery" is not in RoadWatch, so it's cut.
- The backend (Express API, MySQL) was built by teammate Carl Ernest Santos, so I don't claim it.
- The Facebook-groups line is replaced by the problem as the repo states it.

---

## 3 · The Framed Case Studies

### Flagship Case 1 · MicroCredit API: Idempotent Loan Disbursement & Centavo Ledger

**The Problem.** In Philippine micro-lending, a nervous admin double-clicking **Disburse**, or a phone
on a flaky connection retrying the same POST, can send a borrower's GCash or Maya payout twice. Plain
JavaScript money math makes it worse: `19.99 * 100` is `1998.9999999999998`, so a centavo can vanish
between principal and interest.

**What I Did & Decided.**
- I modeled the loan as a TypeScript discriminated union, `APPLIED → UNDER_REVIEW → APPROVED → DISBURSED`
  or `REJECTED`, in `src/features/disbursement/types.ts`.
- A pure `transitionLoan(loan, event)` returns a typed `409 ILLEGAL_TRANSITION` for any jump the
  machine doesn't allow, such as a second `DISBURSE` on a `DISBURSED` loan.
- Money is a branded integer `Centavos` (`₱1.00 = 100`). Typed amounts enter only through
  `parsePesosToCentavos` in `src/utils/money.ts`, which uses string operations and caps input at 13
  whole-peso digits.
- Every payout posts `Dr loans_receivable:<borrower>` / `Cr wallet_clearing:<gcash|maya>`, and
  `buildDisbursementJournal` refuses to build an entry where `Σ debits !== Σ credits`.
- Each Disburse intent carries a UUID v4 `Idempotency-Key` from `createIdempotencyKey()` and an
  `If-Match: "<version>"` header.
- **The decision that matters:** the server looks up the key *before* comparing versions. A
  legitimate retry carries the version from before the first success, so checking the version first
  would bounce a real retry with a false `409`. A mutation check proved it: with the replay lookup
  disabled, 4 tests fail.
- I added a **Simulate double-click / network retry** control with two modes: *Network retry* (same
  key) and *Two admins* (new key, same `If-Match`). An Engineering Manager can try to break the ledger
  themselves.

**What Came of It.**
- The live demo is at [microcredit-api-beta.vercel.app](https://microcredit-api-beta.vercel.app). It
  runs against an in-memory mock API, so state resets on reload.
- A double-click sends exactly one request. A network retry with the same `Idempotency-Key` gets the
  original receipt back. A second admin with a stale `If-Match` gets `409 VERSION_MISMATCH`. The
  ledger posts the payout once.
- Each of those behaviors is a named test in a 101-test Vitest + Testing Library suite. CI runs
  `typecheck`, `lint` (oxlint, zero `any`), `test` and `build` on every push.
- **TODO:** the Simulate control is one scroll below the form (955px on desktop, 1,523px on a phone).
  Move it, with a pre-filled sample loan, above the fold, as PORTFOLIO_PATH v2 revision #1 calls
  for, in a separate `feat:` commit with a Playwright fold test.

> **Why I build this way** (the bio, placed here as PORTFOLIO_PATH v2 asks): see
> [§4 · Bio](#bio-why-i-build-this-way-inside-the-flagship-section).

### Supporting Case 2 · Node2Shell (CVE-2026-111497): Technical Analysis, Safe PoC & Remediation (VulnTech Internship)

**The Problem.** CVE-2026-111497 is an out-of-bounds write in the Brotli decoder that Node.js compiles
into its own binary. Express 5 and body-parser 2.x inflate `Content-Encoding: br` request bodies, and
`fetch()` decompresses Brotli responses automatically. So an unpatched service is exposed even if
nobody calls `zlib` on purpose, and `npm update` can't fix it, because the decoder isn't an npm package.

**What I Did & Decided.**
- **Root cause.** I traced it to `DecodeBlockTypeAndLength()` in `deps/brotli/c/dec/decode.c`. On an
  impossible block switch it reports "need more bytes" instead of a format error (CWE-252), so the
  streaming decoder keeps writing past an 8-byte staging buffer (CWE-787).
- **The fix.** I read the upstream fix, `google/brotli@0ed4268a`. It returns
  `BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH` right away, and it's the patch inside Node.js 22.23.4,
  24.22.1 and 26.12.1.
- **The lab.** I built it on an internal-only Docker network (`docker network create --internal`),
  with a target `server.mjs` that pipes `br` request bodies into `zlib.createBrotliDecompress()`.
- **The decision:** a **sanitized, differential PoC**. It sends the same malformed stream to
  `node:24.22.0` and `node:24.22.1`, with no shellcode or heap grooming, so a team can check its own
  runtime without holding a working exploit.
- **The remediation, in priority order:**
  1. Upgrade the runtime.
  2. As a stopgap, reject `Content-Encoding: br` with a `415` at Nginx or in Express middleware.
     This doesn't cover `fetch()`.
  3. Detect with a Suricata rule for inbound `br` bodies and a Sigma rule for shells spawned by `node`.

**What Came of It.**
- A public technical advisory, published as Exemprium on Oct 26, 2026:
  [Google Doc](https://docs.google.com/document/d/1tzEqUoyXrR5_RpeszSFKZX4LhVh_PnoSsjsf9wpNtJo/view) · [LinkedIn post](https://lnkd.in/p/g_V3bkhS).
- The advisory documents the patched runtime answering the PoC with `HTTP 400`
  (`ERR_BROTLI_DECOMPRESSION_FAILED`) instead of corrupting memory.
- In RoadWatch, the repo I manage, `render.yaml` pins `NODE_VERSION` to `22.23.4` with the CVE named
  in the comment, and `api/package.json` requires `node >= 22.23.4`.

### Supporting Case 3 · RoadWatch: Road Accident Reporting, Verified and Closed by Authorities

**The Problem.** An accident report needs three things a social post or chat message doesn't have:
an exact location, a verification step, and an authority who is accountable for closing it.

**What I Did & Decided.**
- I'm the project lead on a four-person BSIT capstone team at Bulacan State University.
- I build the Flutter Android app for Reporters and Traffic Officers, and I run the repo, CI and
  releases. Pauline Lapuz built the web dashboard and ran QA. Carl Ernest Santos built the Express API
  and MySQL database.
- A report moves `Submitted → Under Review → Verified → Assigned → In Progress → Resolved/Closed`, or
  to `Additional Information Required` or `Rejected`. Only an Administrator can verify it.
- **The decision I pushed for: role and platform lockdown.** The app's sign-up can only create a
  Reporter, with no role dropdown. Through `ROLE_PLATFORMS`, the API lets Reporters sign in only on
  mobile, Administrators only on the web, and Traffic Officers on both.

**What Came of It.**
- RoadWatch is deployed and was demoed: the website at [roadwatch-ph.me](https://www.roadwatch-ph.me),
  the API on Render, and the APK on [GitHub Releases](https://github.com/l3n8n-ocd/roadwatch/releases/latest).
- I called the Oct 30 feature freeze only after a sweep came back clean: API 39/39, `flutter analyze`
  clean, 58 widget tests.
- **Next:** publish on the Google Play Store and update the landing page's QR code.

---

## 4 · Framed Sitemap Copy

Each line was written to be read out loud.

### Hero (`/`)

> **I build loan disbursement flows that cannot pay a borrower twice.**
> Fill in the form, press **Disburse**, then scroll to **Simulate double-click / network retry** and
> watch the second request come back as a replay or a `409`.
>
> **[ Book a 15-min code walkthrough ]** · *View the repo*

### Bio: "Why I build this way" (inside the flagship section)

PORTFOLIO_PATH v2 folded `/about` into the flagship as short notes, because a manager skimming for 30
seconds won't open a philosophy page. Here are those notes, in first person:

> - **I test the guard, not just the feature.** If I delete the replay lookup in
>   `disbursementServer.ts`, four tests go red. That's how I know it's protecting something.
> - **I learned where money breaks from security work.** At VulnTech I reproduce vulnerabilities in a
>   sandbox before I write a word about them, so I check the boundary before I trust the happy path.
> - **I ship with a team.** On RoadWatch, my BSIT capstone, I lead four people, build the Flutter app,
>   and keep CI and releases green.

### Contact / CTA (`/act`)

> **If you run engineering at a lending startup, here's a 15-minute test.**
> Open [microcredit-api-beta.vercel.app](https://microcredit-api-beta.vercel.app), fire **Simulate
> double-click / network retry**, then read `src/features/disbursement/` at
> [github.com/l3n8n-ocd/microcredit-api](https://github.com/l3n8n-ocd/microcredit-api).
> If the second request bounced, book 15 minutes and I'll walk you through the replay-before-`If-Match`
> check line by line.
>
> **[ Book a 15-min walkthrough ]** · email
>
> **TODO:** add the booking link and an email address, plus one line on role, time zone (Philippines,
> UTC+8) and availability. Neither the link nor the availability exists yet.

---

## 5 · Before / After: Generic AI Copy vs. Voice Card Copy

<!-- voice-check:off -->

| # | Generic AI line (Before) | My edited version (After) | Why I cut it |
| - | ------------------------ | ------------------------- | ------------ |
| **⭐ 1 · Portal** | "As a passionate, results-driven full-stack engineer, I leveraged cutting-edge React and TypeScript technologies to architect a robust, seamless fintech platform that optimizes user experience and ensures high reliability." | **"I wired every loan payout with a UUID `Idempotency-Key`, an `If-Match` version check, and integer-centavo journal lines so a double-clicked Disburse button returns the original receipt instead of paying the borrower twice."** | **passionate** and **results-driven** describe me, not the work, so I cut them. **leveraged** became "wired". **cutting-edge** and **robust** are empty, so the real guards (`Idempotency-Key`, `If-Match`, centavo lines) go in their place. **seamless** and "optimizes user experience" became the behavior a manager can test: the double-click gets the original receipt back. |
| 2 · RoadWatch | "Spearheaded a seamless, cutting-edge cross-platform solution, leveraging Flutter to empower communities with robust incident reporting." | "On RoadWatch I built the Flutter Android app and locked sign-up to the Reporter role, so the API refuses an Administrator login from a phone." | **seamless**, **cutting-edge** and **robust** were cut. "Leveraging Flutter" became what I built with it. "Cross-platform solution" claimed work I didn't do (the web app and API are my teammates'). "Empower communities" became the real rule in `ROLE_PLATFORMS`. |
| 3 · Node2Shell | "Passionate, results-driven security researcher with a proven track record of synergy across teams, leveraging robust methodologies to mitigate critical threats." | "I compared `node:24.22.0` and `24.22.1` on an internal-only Docker network with a sanitized PoC, so a team can test its own runtime without a working exploit." | **Passionate**, **results-driven**, **synergy**, **leveraging** and **robust** were all cut. "Proven track record" had nothing behind it, so it's gone. "Mitigate critical threats" became the one decision I made (a sanitized, differential PoC) and why. |

<!-- voice-check:on -->

**One breath:** each "After" line was read aloud in a single breath. Each one names something a
reviewer can check: a header, a file, a role rule, a CVE.
