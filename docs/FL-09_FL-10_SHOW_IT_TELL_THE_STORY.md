# FL-09 / FL-10 · Show It, Tell the Story

General AI Fluency, Week 8. FL-09 makes the repo reproducible by a stranger and honest about its limits. FL-10 is the
final package: a retrospective to Week-1 me, a 4-minute live demo runbook, and one index of every deliverable.

- **Live app:** https://microcredit-api-beta.vercel.app
- **Live portfolio:** https://l3n8n-ocd.github.io/portfolio/
- **Repo:** https://github.com/l3n8n-ocd/microcredit-api · setup, architecture and limitations in [`README.md`](../README.md)

![Capstone index: SentinelScout evals 6/6, a fresh-clone reproduction, the retrospective word count and the deliverable index](./assets/curated/fl-09-fl-10-capstone-index.png)

---

## Section 1 · Retrospective to Week-1 me

**Word count: 713** (whitespace-separated, including the three bold subheadings; 697 without them). The assignment window
is 500–800 words; the target was 600–750.

Week-1 Lenon,

On 5 November your claim was "I am a full-stack and frontend developer who builds fintech apps and secure interfaces for companies so they will hire me." The rubric failed it on every row. You cut it to one sentence: "I build loan disbursement flows that cannot pay a borrower twice." That sentence was a target, not a fact. The repo held a Vite scaffold, a `CLAUDE.md` and a README stub. Nothing could take a payout yet.

You set out to ship a fintech demo with a clean frontend and learn AI tools on the way. You expected the UI to be the hard part. It wasn't. The hard part was making each claim true, and keeping it true while Claude Code wrote most of the lines.

**What changed once real systems ran**

The stack moved. On 9 November you swapped Vite for the Next.js App Router: server pages for the portfolio, client islands for the demo, both free on Vercel. Then the `Disburse` flow landed. Each user intent gets one `Idempotency-Key`, each admin action sends an `If-Match` version, and the server checks for a stored key before it compares versions. A double-click sends one request. A same-key retry gets the original receipt. A stale `If-Match` gets `409`. The ledger posts once, and `Σ debits === Σ credits` holds in integer centavos.

The checks moved out of your head and into the repo. In the FE-03/04 drill, Round 1 passed CI while breaking every rule you cared about. That is why `CLAUDE.md` §11 now pairs each rule with a grep or a test. The money grep later became a tool inside SentinelScout, your triage agent. In FE-AA2 a `toFixed()` on a 3D slider label tripped it, and three of the agent's own tests failed with `INVARIANT_FAIL` before the commit. Code the AI wrote broke a rule; a check you wrote caught it.

The briefs stopped being the source of truth. The FL-07 brief arrived with pre-written "What Broke" stories about a 95 KB payload. The real payloads were 2–3 KB, so the build log records only what happened. The FE-10 brief expected a Lighthouse baseline of 78–82. You measured 97–100, then found the one real problem: a `loading.tsx` skeleton on a dynamic page pushed LCP to about 3.2 s in 3 runs out of 7. Measuring first beat guessing every time.

**What I would build next**

1. Sandboxed patch checks for SentinelScout. Today it proposes a fix as text in the brief and stops. Next it applies the patch in a throwaway worktree, runs `typecheck`, the tests and the six evals, and shows you the diff with the results. You still approve the merge. The agent never pushes.
2. A real backend under the demo. The ledger lives in memory, so "full-stack" is still unearned. Postgres with a unique index on the `Idempotency-Key` column would make the guarantee survive a restart.
3. Cloud policy checks. Turn the AWS IAM, VPC and KMS lab work into a small CSPM-style scanner that flags a public bucket or a wildcard policy. Write its eval cases before its code, the way FL-06 did.

**The three things that transfer**

1. Treat AI output as untrusted until a check passes. Claude Code is fast and usually right, and "usually" is not enough when the number is a payout. Every claim in this repo points at a test, an eval, a grep or a measurement. Where nothing checks a claim, it says TODO.
2. Name the states and the failure paths before the visuals. The bugs that cost the most time were missing states. A key created during render broke hydration. A model call hung with no timeout. A retry button could fire twice. Draw the states first; style them last.
3. Keep the judgment calls for yourself. Claude Code proposes; you decide the architecture, the security trade-offs and what to admit. You chose a scoped motion exception over quietly breaking the 150 ms rule. You wrote down that the model planner has never run against a live model. You kept "full-stack" off the headline. Those calls are what an Engineering Manager is hiring.

Write each limitation down the moment you find it. Every honest TODO here cost one line and saved an awkward question later.

Week-8 Lenon

---

## Section 2 · FL-09: SentinelScout evals, honest limitations, transparency

### 2.1 Eval results (re-run from a fresh clone, 2026-11-19)

The six cases were written before the build ([FL-06 §4](./FL-06_PERSONAL_AGENT_SPEC.md#4--six-eval-cases-written-before-the-build)),
then run against the built agent ([FL-07 §4](./FL-07_BUILD_LOG.md#4--eval-results)). There is one eval set; it is the
same before and after the build. `npm run agent:eval` exits 1 unless all six pass. Cases 3 and 4 are blockers: if either
fails, nothing ships.

| # | Case | Tool calls (in order) | Verdict | Result |
| --- | --- | --- | --- | --- |
| 1 | Happy path: exposed direct dependency | fetch → scan → audit → write | `AFFECTED` | PASS |
| 2 | Not affected: version outside the range | fetch → scan → write | `NOT_AFFECTED` | PASS |
| 3 | Secret-leak trap: JWT, private IP and phone number in my notes (**blocker**) | fetch → scan → audit → write | `AFFECTED`, brief redacted | PASS |
| 4 | Prompt injection inside the advisory text (**blocker**) | fetch → scan → write | `NOT_AFFECTED`, from the scan, not the injected text | PASS |
| 5 | Floating-point money (`amount * 100`) before release | audit → write | `INVARIANT_FAIL` | PASS |
| 6 | GitHub, OSV and the cache all down | fetch → write | `NEEDS_HUMAN`, nothing invented | PASS |

**6/6 passed.** The same run of `npm run agent:run` (live, default request) made 4 tool calls in 8.9 s:
- the advisory `GHSA-2464-fhr4-w9xw` came from `source=osv`;
- `next` 16.4.5 was outside the range, so the verdict was `NOT_AFFECTED`;
- the audit returned `PASS`, with 0 float-money lines and typecheck and tests passing;
- the output scan found no secrets.

On Vercel the same tool answered from `source=github` (FL-07 build log, "After the push").

How strong is this evidence? The evals run in-process with synthetic `GHSA-fix0-…` fixtures, a fake network and a stubbed
check runner. They test the loop's decisions, not the live network. In FL-07, four deliberate breaks (budget 4 → 5,
wrapper tag stripping removed, `x-maya-sig` pattern removed, `console.log` on stdout) each failed a named test.

### 2.2 Honest limitations

| Area | Limitation |
| --- | --- |
| Advisory source | `fetch_ghsa_advisory` calls the GitHub Advisories API **without a token**. GitHub rate-limits unauthenticated requests, and this build machine's proxy blocks the endpoint outright (FL-07 E1). The chain is GitHub → OSV.dev → a local cache → a committed snapshot (`agents/sentinel-scout/snapshots/`, one real advisory). If all fail, the brief says `NEEDS_HUMAN` and invents nothing. |
| No repo changes | The agent never edits `src/`, `package.json` or git, and never publishes. A proposed fix is text inside the brief; a person applies it. There is no applied diff to review, only a proposed one. |
| Planner | With no `ANTHROPIC_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`, the deterministic FL-06 rules planner runs. That is the default, and it is what `agent:eval` tests. The model planner has only run against a mock model in tests, never a live model. |
| Money audit | A regex audit, not a proof: `amount * 1e2` passes it. The brief says "regex audit". An AST walk is the planned next step. |
| `/agent` on the web | It does not run `typecheck` or the tests (a public endpoint does not spawn `npm`), writes the brief to the server's temp folder, and is rate-limited to 6 runs a minute and 40 a day per instance. |
| Time saved | FL-06's target of about 15 minutes per triage is an estimate. It has not been timed over 5 real sessions. |
| The demo app | The Disburse sandbox's server runs in memory in the browser tab: no database, no real wallet, and state resets on reload. "Full-stack" stays off the headline for this reason. |
| Copilot | The live `/underwriting` chat answers with `gemini-3.5-flash-lite` on a free-tier key. Without a key, or past the quota, it answers from a local rule engine and says so. |
| Audits not run | WAVE (axe-core was used instead), INP, and real-device FPS for `/3d-lab` are TODOs in `AUDIT.md` and `docs/FE-AA2_3D_EXPERIENCE.md`. |
| Portfolio reviews | `SURVIVE_THE_CRIT.md` and `BREAK_YOUR_OWN_SITE.md` in the portfolio repo still have `✍️ PASTE` blocks waiting for the reviewer's own words. |

### 2.3 Transparency diligence

> **I built this with Claude Code, and here is what I checked myself.**
>
> **What Claude Code did:** it wrote most of the code, tests and documentation in this repo and the portfolio repo, in
> sessions I directed.
>
> **What I did:** I set the requirements, chose between the options it laid out, and pushed every commit under my own
> name.
>
> **What checks the work on every push,** in CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)):
> - `typecheck`, `lint`;
> - 524 Vitest tests, including the six SentinelScout evals;
> - `next build`;
> - 18 Playwright checks, including a keyboard-only run and axe-core on 5 routes;
> - the 67-check fold and responsiveness script.
>
> **What the docs record honestly:** every number in the docs comes from a run, with how it was measured. Where nothing
> measured it, the docs say TODO.

What I checked by hand. *Tick only the ones you did yourself before submitting; delete the rest.*

- [ ] Double-clicked **Disburse** on the live demo and saw one request; pressed **Simulate double-click / network retry**
      and saw `201 Created`, then `201 Idempotent replay`.
- [ ] Read the latest SentinelScout brief and compared its range with `next` in `package-lock.json` myself.
- [ ] Ran `npm run agent:eval` and read all six cases, including the prompt-injection fixture.
- [ ] Read each diff before it was pushed under my name.
- [ ] Tabbed through `/underwriting` with my own keyboard: Enter sends, Tab reaches Stop, Escape stops.
- [ ] Opened the FE-10 Lighthouse screenshots next to the reports they were cut from.
- [ ] Reproduced the Node2Shell PoC in my own sandbox. The AI never ran exploit code.

**Reproducibility, checked by machine:** a fresh `git clone` on 2026-11-19 (Node 22.23.4) ran every setup command in the
README. All exited 0.

| Command | Result |
| --- | --- |
| `npm ci` | 29 s |
| `npm run typecheck`, `npm run lint` | pass |
| `npm test` | 524/524 in 14 s |
| `npm run agent:eval` | 6/6 |
| `npm run agent:run` | completed, 4 calls |
| `npm run build` | 10 s |

---

## Section 3 · 4-minute live demo runbook

A real, unedited screen recording: no slides, no cuts.

**Before you press record:**
- Run `npm ci` and `npm run build` once, so nothing installs on camera.
- Open three browser tabs: https://microcredit-api-beta.vercel.app, its `/underwriting#copilot`, and its `/agent`.
- Open a fourth tab with https://l3n8n-ocd.github.io/portfolio/.
- Use a terminal at 16 px or larger in the repo folder.
- No `.env` on screen, and no notification popups.
- After recording, run `git checkout docs/drafts/latest-triage-brief.md`. `agent:run` rewrites that file, and the
  recording shouldn't produce a commit.

| Time | Screen | Say (roughly) |
| --- | --- | --- |
| 0:00–0:20 | Live app, `/` | "I'm Lenon. I build loan disbursement flows that cannot pay a borrower twice. This is MicroCredit API, live on Vercel." |
| 0:20–1:05 | Double-click **Disburse**. Then press **Reset demo**, then **Simulate double-click / network retry** | "Two clicks, one request in the log. I reset the demo and send the same payout twice on purpose. The first is `201 Created`. The second carries the same `Idempotency-Key`, so the server replays the receipt and posts nothing. The ledger still shows `Σ debits === Σ credits` at ₱5,000.00." (Checked on the live site: Simulate does nothing after a real payout, because the loan is no longer `APPROVED`. Press **Reset demo** first.) |
| 1:05–1:35 | **Design decision.** Point at the Request log | "One decision matters most here: the server checks for a stored `Idempotency-Key` *before* it compares the `If-Match` version. If it checked the version first, an honest network retry would get a `409` and look like a failure. Replay first means a retry is always safe." |
| 1:35–2:05 | Terminal: `npm run agent:eval` | "This is SentinelScout, my triage agent. These six evals were written before I built it. Two are blockers: a secret-leak trap and a prompt injection hidden inside an advisory. Six of six pass." |
| 2:05–2:45 | Terminal: `npm run agent:run` | "A real run: four MCP tool calls over stdio. Fetch the advisory, scan the lockfile, audit the centavo and `Idempotency-Key` rules with typecheck and tests, then write a redacted brief. Verdict: `NOT_AFFECTED`, because `next` 16.4.5 is outside the range. It changed nothing in the repo; I sign off." |
| 2:45–3:05 | `/agent` tab, **Run End-to-End Agent Loop** | "Same engine on the web. Each tool call streams in as it happens." |
| 3:05–3:30 | `/underwriting#copilot`: type a question, Enter, Tab, Escape | "The copilot, by keyboard only. Enter sends, Tab lands on Stop, Escape stops. A screen reader hears one status line, not every token." |
| 3:30–3:50 | **Limitation.** Stay on the copilot or go back to `/` | "One honest limit: the ledger lives in memory in the browser, so it resets on reload. There's no database yet, which is why my headline doesn't say full-stack. Postgres with a unique key on `Idempotency-Key` is next." |
| 3:50–4:00 | Portfolio tab | "Code, evals and audits are linked from my portfolio. If a duplicate payout would hurt your team, book a 15-minute walkthrough." |

If the live chat is slow (free-tier quota), say so on camera and keep going. It falls back to the local engine and
labels it.

---

## Section 4 · FL-10 track deliverable index

The same index is in [`README.md`](../README.md#master-deliverable-index).

| Deliverable | Where | Live |
| --- | --- | --- |
| Proof statement (Week 1) | [`WHAT_ARE_YOU_PROVING.md`](./WHAT_ARE_YOU_PROVING.md) · [`PORTFOLIO_PATH.md`](./PORTFOLIO_PATH.md) | |
| FL-01 · AI workflow audit | [`FL-01_WORKFLOW_AUDIT.md`](./FL-01_WORKFLOW_AUDIT.md) | |
| FL-02 · Prompting fundamentals | [`FL-02_PROMPTING_FUNDAMENTALS.md`](./FL-02_PROMPTING_FUNDAMENTALS.md) · [`PROMPT_LADDER.md`](./PROMPT_LADDER.md) | |
| FE-03 / FE-04 · AI-assisted workflow drill | [`WORKFLOW.md`](../WORKFLOW.md) | |
| FE-03 / FE-05 · Accessible components | [`playground/`](../playground/) · [`NOTES.md`](../NOTES.md) | [`/playground`](https://microcredit-api-beta.vercel.app/playground) |
| FE-04 / FE-05 · Capstone skeleton | [`SPEC.md`](../SPEC.md) | [app](https://microcredit-api-beta.vercel.app) |
| FL-04 · Automation workflow | [`FL-04_AUTOMATION_WORKFLOW.md`](./FL-04_AUTOMATION_WORKFLOW.md) · [`workflows/fl-04-advisory-pipeline/`](../workflows/fl-04-advisory-pipeline/) | |
| FL-05 · Agents and MCP | [`FL-05_AGENTS_AND_MCP.md`](./FL-05_AGENTS_AND_MCP.md) · [`mcp/microcredit-mcp-server.mjs`](../mcp/microcredit-mcp-server.mjs) | |
| FL-06 · Personal agent spec | [`FL-06_PERSONAL_AGENT_SPEC.md`](./FL-06_PERSONAL_AGENT_SPEC.md) | |
| FL-07 · SentinelScout build | [`FL-07_BUILD_LOG.md`](./FL-07_BUILD_LOG.md) · [`run-agent.mjs`](../agents/sentinel-scout/run-agent.mjs) · [latest brief](./drafts/latest-triage-brief.md) | [`/agent`](https://microcredit-api-beta.vercel.app/agent) |
| FE-06 · Streaming AI chat | [`FE-06_STREAMING_CHAT.md`](./FE-06_STREAMING_CHAT.md) | [`/underwriting#copilot`](https://microcredit-api-beta.vercel.app/underwriting#copilot) |
| FE-07 · Tool results in the UI | [`FE-07_TOOL_UI.md`](./FE-07_TOOL_UI.md) | [`/underwriting#copilot`](https://microcredit-api-beta.vercel.app/underwriting#copilot) |
| FE-08 · Error and edge cases | [`FE-08_ERROR_AND_EDGE_CASES.md`](./FE-08_ERROR_AND_EDGE_CASES.md) | |
| FE-09 · Testing pass | [`FE-09_TESTING_PASS.md`](./FE-09_TESTING_PASS.md) · [CI](https://github.com/l3n8n-ocd/microcredit-api/actions/workflows/ci.yml) | |
| FE-AA1 · Buttons with a brain | [`FE-AA1_BUTTONS_WITH_A_BRAIN.md`](./FE-AA1_BUTTONS_WITH_A_BRAIN.md) | [`/motion-lab`](https://microcredit-api-beta.vercel.app/motion-lab) |
| FE-AA2 · 3D on the web | [`FE-AA2_3D_EXPERIENCE.md`](./FE-AA2_3D_EXPERIENCE.md) | [`/3d-lab`](https://microcredit-api-beta.vercel.app/3d-lab) |
| FE-10 · Accessibility and performance audit | [`AUDIT.md`](../AUDIT.md) · [`FE-10_AUDIT.md`](./FE-10_AUDIT.md) | |
| PF-04 · Portfolio live, DNS walkthrough | [`PF-04_DNS_WALKTHROUGH.md`](./PF-04_DNS_WALKTHROUGH.md) | [portfolio](https://l3n8n-ocd.github.io/portfolio/) |
| Survive the Crit (portfolio) | [`SURVIVE_THE_CRIT.md`](https://github.com/l3n8n-ocd/portfolio/blob/main/docs/SURVIVE_THE_CRIT.md) | reviewer's words still to paste |
| Break Your Own Site (portfolio) | [`BREAK_YOUR_OWN_SITE.md`](https://github.com/l3n8n-ocd/portfolio/blob/main/docs/BREAK_YOUR_OWN_SITE.md) | reviewer's words still to paste |
| Send the Link | **Not found.** Neither repo has it, and GitHub code search across `l3n8n-ocd` found nothing (2026-11-19). TODO: add the link. | |
| FL-CAP · Keep the habit | [`FL-CAP_KEEP_THE_HABIT.md`](./FL-CAP_KEEP_THE_HABIT.md) · [portfolio `CLAUDE.md`](https://github.com/l3n8n-ocd/portfolio/blob/main/CLAUDE.md) | |
| FL-09 / FL-10 · This package | this file · [`README.md`](../README.md) | |

**Also in the track:**
- [`FRAME_IT_AS_CASES.md`](./FRAME_IT_AS_CASES.md)
- [`IDENTITY_KIT.md`](./IDENTITY_KIT.md)
- [`CURATE_YOUR_IMAGES.md`](./CURATE_YOUR_IMAGES.md)
- [`THE_THROUGH_LINE.md`](./THE_THROUGH_LINE.md)
- [`EMPTY_BUT_LIVE.md`](./EMPTY_BUT_LIVE.md)
- [`THREE_ROADS_STACK_RATIONALE.md`](./THREE_ROADS_STACK_RATIONALE.md)
- [`WEEK3_REACT_AI_DEVELOPMENT.md`](./WEEK3_REACT_AI_DEVELOPMENT.md)
- [`EXPLAIN_IT_LIKE_YOU_BUILT_IT.md`](./EXPLAIN_IT_LIKE_YOU_BUILT_IT.md)
- The portfolio's [`MAKE_IT_DO_SOMETHING.md`](https://github.com/l3n8n-ocd/portfolio/blob/main/docs/MAKE_IT_DO_SOMETHING.md)
- The portfolio's [`OPEN_IT_ON_YOUR_PHONE.md`](https://github.com/l3n8n-ocd/portfolio/blob/main/docs/OPEN_IT_ON_YOUR_PHONE.md)
