# FL-01 · AI Workflow Audit and Tool Setup — Lenon D. Adriano

> FlyRank · Week 1 · General AI Fluency
> Repository: [`github.com/l3n8n-ocd/microcredit-api`](https://github.com/l3n8n-ocd/microcredit-api)
> Related: [`WHAT_ARE_YOU_PROVING.md`](./WHAT_ARE_YOU_PROVING.md) · [`PORTFOLIO_PATH.md`](./PORTFOLIO_PATH.md)

---

## Section 1 · Real Weekly Workflow Audit (12 Tasks)

**Classification key**

| Classification | Meaning |
| -------------- | ------- |
| **Just Me** | Human judgment, physical presence, or sign-off is the point. AI is not in the loop. |
| **Collaborate with AI** | I drive the design and own the domain rules. AI is a thinking and pairing partner. |
| **Delegate to AI with Review** | AI produces the first draft from my spec. I review, correct, and approve before it's used. |
| **Fully Automate** | Deterministic, rule-based work. Once tested, it runs with no human in the loop. |

| # | Recurring Weekly Task | Domain (Work / Study / Side Project) | Classification | One-Line Rationale |
| - | --------------------- | ------------------------------------ | -------------- | ------------------ |
| 1 | Reproducing vulnerability PoCs and verifying exploit chains in sandboxed environments | Work (VulnTech Internship) | **Just Me** | Requires strict ethical judgment, isolated sandbox safety, and ground-truth verification where AI hallucinations or blind execution are dangerous. |
| 2 | Hosting and moderating live student tech events and troubleshooting live OBS/audio-visual hardware | Side Project (BulSU MSC / AWS Student Builder Group) | **Just Me** | Real-time human facilitation, reading the room, and physical hardware debugging cannot be delegated to an LLM. |
| 3 | Verifying double-entry centavo ledger invariants (`Σ debits = Σ credits`) and adversarial concurrency edge cases | Work (FlyRank · `MicroCredit API`) | **Just Me** | Financial integrity requires deterministic human sign-off so subtle race conditions or rounding bugs never slip through. |
| 4 | Authoring technical vulnerability advisories and CVE research documentation | Work (VulnTech Internship) | **Collaborate with AI** | I provide the verified PoC logs and root-cause analysis while AI helps structure, tighten, and format the advisory prose. |
| 5 | Designing the 10-state loan lifecycle state machine (`APPLIED` to `SETTLED`) and TypeScript discriminated unions | Work (FlyRank · `MicroCredit API`) | **Collaborate with AI** | Co-designing edge-case transitions and `409 Conflict` rules with Claude speeds up architecture modeling while I enforce domain rules. |
| 6 | Building and debugging Flutter UI components and cloud backend integrations for `RoadWatch` | Study (BSIT WMAD Capstone) | **Collaborate with AI** | Pair-programming widget trees and state management with AI accelerates iteration while I test on target devices. |
| 7 | Drafting unit and integration test suites for `Idempotency-Key` retries and `If-Match` optimistic locking | Work (FlyRank · `MicroCredit API`) | **Delegate to AI with Review** | AI excels at generating exhaustive test permutations from a strict spec, which I then review and run against the test runner. |
| 8 | Generating initial Figma/Canva presentation copy and event announcement drafts for community meetups | Side Project (Community) | **Delegate to AI with Review** | AI rapidly produces first-pass event blurbs and slide outlines that I review and adjust for brand tone in under 5 minutes. |
| 9 | Summarizing long OWASP LLM/API security specs and cloud IAM documentation into study notes | Study (Cloud Security) | **Delegate to AI with Review** | AI condenses dense technical RFCs into structured tables, which I spot-check against primary documentation. |
| 10 | Transforming raw RSS/webhook payloads from DICT, AWS SBG, and GDG into normalized notification schemas | Side Project (Community) | **Fully Automate** | Deterministic schema mapping via Python/Bash scripts and scheduled triggers requires zero human intervention once tested. |
| 11 | Enforcing Conventional Commits, TypeScript strict-mode (`no-any`) checks, and lint formatting on git pre-commit | Work (FlyRank · all repos) | **Fully Automate** | Rule-based static analysis and commit-message hooks run automatically on every commit without manual review. |
| 12 | Routine workspace scaffolding, `.gitignore` generation, and boilerplate file setup via terminal scripts | Side Project (Tooling) | **Fully Automate** | Standardized Bash/Python automation handles repetitive repo initialization deterministically. |

**Distribution:** 3 × Just Me · 3 × Collaborate · 3 × Delegate with Review · 3 × Fully Automate.

**Pattern:** the "Just Me" tasks share one trait: being wrong is expensive and can't be undone (a live
exploit, a live audience, real money). Everything AI touches has a verification step I own: the
compiler, the test runner, a spot-check against the primary source, or my review.

> **Evidence for #11:** shipped in this repository. Every commit runs `lint-staged` (oxlint) and a
> strict typecheck, and `commitlint` rejects messages outside the six types in `CLAUDE.md` §7
> ([`8283a56`](https://github.com/l3n8n-ocd/microcredit-api/commit/8283a56)). GitHub Actions repeats typecheck, lint, test, and build on every push
> ([`be34d64`](https://github.com/l3n8n-ocd/microcredit-api/commit/be34d64)).

---

## Section 2 · Three Target Tasks for FL-02 → FL-04

| Target | Source in audit | Classification | Used in |
| ------ | --------------- | -------------- | ------- |
| **T1** · State Machine Generator | #5 | Collaborate with AI | **FL-02** · Prompting Fundamentals |
| **T2** · Advisory & PoC Report Formatter | #4 (formatting step only) | Delegate to AI with Review | **FL-02 / FL-03** |
| **T3** · Ledger Invariant Audit Pipeline | #3 + #7 (mechanical check only) | Fully Automate | **FL-04** · Ship an Automation Workflow |

> **Why T2 and T3 are classified differently from their source tasks.** Each target task takes only the
> part of the original task that can safely move to a less hands-on category:
> - **T2 ⊂ #4:** advisory *authoring* stays Collaborate, because I own the root cause. But once the PoC
>   logs and root cause are verified by me (task #1), *formatting* them into a fixed template is
>   delegable, as long as I review it.
> - **T3 ⊂ #3:** ledger *sign-off* stays Just Me. But the *mechanical* invariant check
>   (`Σ debits == Σ credits`, duplicate-key detection) is deterministic, so it can be fully automated.
>   I still read and sign the report it produces.

### T1 · TypeScript Discriminated Union & Pure `transition(loan, event)` State Machine Generator

**Classification:** Collaborate with AI · **Assignment:** FL-02 (Prompting Fundamentals) · **Project:** `MicroCredit API`

**Goal:** prompt Claude to co-design the `LoanState` discriminated union and a pure
`transition(loan, event)` function for the 10 states in [`README.md`](../README.md#loan-lifecycle-state-machine),
while I enforce the domain rules.

**"Done Well" definition**

| # | Criterion | Threshold | How it's measured |
| - | --------- | --------- | ----------------- |
| 1 | TypeScript compiler errors under `strict: true` (`noImplicitAny`, `strictNullChecks`, plus the other flags in `CLAUDE.md` §2) | **0** | `npx tsc --noEmit` exits `0` |
| 2 | Illegal transitions rejected across all 10 states (`APPLIED` … `SETTLED` / `DEFAULTED`) | **100%** of illegal `(state, event)` pairs | Table-driven test over every `state × event` pair: each legal pair returns the expected next state; each illegal pair is a compile error (`// @ts-expect-error`) or returns a typed `409 Conflict` result |
| 3 | Floating-point currency types | **0**; money fields use the branded integer type `Centavos` only | Type review plus a search for `number`-typed money fields in loan types |
| 4 | `any` types | **0** | `@typescript-eslint/no-explicit-any` reports no violations |

### T2 · Technical Vulnerability Advisory & PoC Reproduction Report Formatter

**Classification:** Delegate to AI with Review · **Assignment:** FL-02 / FL-03 · **Project:** VulnTech Internship

**Goal:** turn my raw, already-verified terminal notes into a publication-ready Markdown advisory
using a fixed template prompt.

**"Done Well" definition**

| # | Criterion | Threshold | How it's measured |
| - | --------- | --------- | ----------------- |
| 1 | Required sections present: Executive Summary, Affected Versions, Root Cause, Reproduction Steps, CVSS Vector, Remediation Diff | **6 / 6** | Section checklist at review time |
| 2 | Time from raw terminal notes to publication-ready advisory | **< 10 minutes** | Timed from pasting the notes to final approval |
| 3 | Manual factual corrections needed during review | **< 3** | Counted and logged per advisory |
| 4 | Leaked sensitive tokens, credentials, or IPs | **0** | Redaction scan (secret/IP regex or `gitleaks`) on the output before publishing |

**Guardrails:** inputs are only PoC logs I verified myself in the sandbox (audit #1). AI never runs
exploits. The CVSS vector is checked against the official FIRST CVSS calculator by me, never taken
as-is from AI. Raw notes are redacted *before* they're pasted into any AI tool.

### T3 · Automated Idempotency & Double-Entry Ledger Invariant Audit Pipeline

**Classification:** Fully Automate · **Assignment:** FL-04 (Ship an Automation Workflow) · **Project:** `MicroCredit API`

**Goal:** one command that stress-tests the ledger and idempotency rules described in
[`README.md`](../README.md#double-entry-ledger--concurrency-architecture) and writes an audit report.

**"Done Well" definition**

| # | Criterion | Threshold | How it's measured |
| - | --------- | --------- | ----------------- |
| 1 | Runs from a single command or script (proposed: `npm run audit:ledger`) | **1 command** | Fresh clone → install → one command |
| 2 | Ingests simulated *concurrent* loan disbursement and repayment events | Includes forced retries and parallel admin actions | Fixture generator deliberately reuses `Idempotency-Key`s and stale `If-Match` versions |
| 3 | `Σ debits == Σ credits` verified in integer centavos | **100%** of journal entries | Per-entry check; any float or non-integer amount fails the run |
| 4 | Duplicate `Idempotency-Key` mutations flagged | **< 2 seconds** for the simulated batch (proposed: 10,000 events) | Wall-clock time recorded in the report |
| 5 | Output | Pass/fail **Markdown audit report** and a non-zero exit code on failure | Report file generated; usable as a CI gate |
| 6 | Manual intervention during the run | **0** | No prompts, flags, or hand edits. Runs headless or on a schedule |

**Human step that stays (audit #3):** I read and sign off on the generated report. The pipeline does
the checking, but the sign-off stays mine.

---

## Section 3 · Claude Project Custom Instructions & Toolkit Setup Evidence

### 3.1 Claude Project Custom Instructions (copy-paste)

<!-- CUSTOM-INSTRUCTIONS:START -->
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
<!-- CUSTOM-INSTRUCTIONS:END -->

The same block is mirrored in [`CLAUDE.md`](../CLAUDE.md) §10, so local Claude Code and the web
Claude Project work from identical context.

### 3.2 Toolkit & Anthropic Academy Checklist

> Status legend: ✅ done and verified · ⬜ not done yet. Items 1–3 were verified from screenshots
> shared during the working session; the image files still need to be added at the paths shown.

| # | Item | Status | Evidence |
| - | ---- | :----: | -------- |
| 1 | Anthropic Academy: **AI Fluency: Framework & Foundations**, Module 1 ("Introduction to AI Fluency") completed | ✅ | Verified 2026-11-05 from a course-sidebar screenshot showing the module checked. 📸 Image to add: `docs/assets/fl-01/academy-module-1.png` |
| 2 | Claude web **Project** created ("FlyRank AI Engineering & Fluency") | ✅ | Verified 2026-11-05 from a screenshot of the Project page. 📸 Image to add: `docs/assets/fl-01/claude-project.png` |
| 3 | Custom Instructions (§3.1) pasted into the Claude Project | ✅ | Verified 2026-11-05 from a screenshot of the open Instructions panel; the visible text matches §3.1. 📸 Image to add: `docs/assets/fl-01/claude-project-instructions.png` |
| 4 | Claude Code workspace context configured (`CLAUDE.md` with proof statement, engineering rules, tutor mode, and these instructions) | ✅ | [`CLAUDE.md`](../CLAUDE.md) |
| 5 | GitHub repository with Conventional Commits history | ✅ | [`l3n8n-ocd/microcredit-api`](https://github.com/l3n8n-ocd/microcredit-api/commits/main) |
| 6 | Three target tasks chosen with measurable "Done Well" definitions | ✅ | Section 2 of this document |
