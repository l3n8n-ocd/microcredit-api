# Three Roads: Choose Your Stack with AI

> Week 4 · General AI Fluency · Lenon D. Adriano · 2026-11-09
> Sitemap: [`PORTFOLIO_PATH.md` v2](./PORTFOLIO_PATH.md#revised-sitemap-v2--3-sections) · Content map:
> [`THE_THROUGH_LINE.md`](./THE_THROUGH_LINE.md) · Look: [`IDENTITY_KIT.md`](./IDENTITY_KIT.md) · Live
> shell: [`EMPTY_BUT_LIVE.md`](./EMPTY_BUT_LIVE.md)

## Section 1 · My four real constraints (input given to AI)

| # | Constraint | The real detail |
| --- | --- | --- |
| 1 | **Budget** | Free only: `$0/mo` for hosting, build minutes, and the domain tier. |
| 2 | **Honest skill level** | 3rd-year BSIT (Web & Mobile App Dev) at BulSU. Comfortable with React, TypeScript, Tailwind, Flutter, HTML/CSS, Git and Vercel. Still building production experience with complex distributed backends and database operations. |
| 3 | **What the portfolio must do** | Walk an Engineering Manager through the 4-section sitemap — `/` Hero claim → `/#flagship-proof` 3 case studies → `/#about` bio → `/#act` 15-minute walkthrough CTA — in under 30 seconds. |
| 4 | **How the work is shown, and what must be dynamic** | Embed the interactive React/TypeScript state-machine + centavo-ledger demo (the `MicroCredit API` double-click idempotency sandbox); show high-DPI captures (`real-01`–`real-03`); show code diffs (`CVE-2026-111497` remediation, `FE-03/FE-04`); and render long-form, scannable case studies. **Honest backend answer:** nothing needs a persistent database or custom server *yet* — the sandbox runs deterministically in client-side TypeScript memory, and the CTA is a zero-backend booking / GitHub-profile link (no email, per [`THE_THROUGH_LINE.md`](./THE_THROUGH_LINE.md) §4). |

## Section 2 · The three stack roads (simplest to most powerful)

| | Road 1 · Static HTML | Road 2 · Next.js (chosen) | Road 3 · Full-stack + DB |
| --- | --- | --- | --- |
| How | Hand-written semantic HTML + static CSS tokens | Next.js App Router: Server Components for the cases, `'use client'` islands for the demo | DB-backed CMS, server-persisted ledger rows, auth |
| Host (free) | GitHub Pages `$0/mo` | Vercel Hobby `$0/mo`, push-to-deploy | Vercel + Supabase free (pauses after inactivity) |
| Backend? | No | **Not yet** (free serverless `/api/health` already there for later) | Yes: Postgres + Prisma + CMS API + keep-alive cron |
| Trade-off | Unbreakable, but can't mount the real React components | More moving parts to keep green, but the manager tests the real components inline | Max flexibility, but a cold-started free DB can 500 mid-demo |

**Road 1 — Static HTML on GitHub Pages (simplest).** Build hand-written HTML with the Identity Kit CSS
tokens, no React runtime. Host free on GitHub Pages. No backend. **Trade-off:** zero build maintenance
and nearly impossible to break, **but** it cannot natively mount the live React 19 + TypeScript
`DisbursementForm` and `UnderwritingWorkbench` without clumsy `<iframe>` embeds or rewriting the state
machine as vanilla DOM scripts — which splits the proof from the repo it lives in.

**Road 2 — Next.js App Router + TypeScript + Tailwind on Vercel Hobby (the sweet spot, chosen).** Build
inside the unified `microcredit-api` repo (`/` and `/portfolio`): static Server Components for the three
framed cases, and `'use client'` islands that mount the real `Centavos` ledger and the `Idempotency-Key`
double-click simulator in the page. Host free on Vercel with automatic GitHub deploys. **Backend: not
yet** — pages, cases, and the sandbox run fully in-memory/static; a free serverless `/api/health` route
already exists for later (FE-06). **Trade-off:** I keep `package.json` and the Next build checks green —
more moving parts than raw HTML — in exchange for a hiring manager testing my real production React +
TypeScript components without leaving the page.

**Road 3 — Next.js + Headless CMS + Postgres + Prisma + Auth (most powerful, over-engineered).** A
database-backed case-study CMS, server-persisted ledger rows for every anonymous visitor's clicks, and
admin auth. Host on Vercel + Supabase free, which pauses the database after ~7 days idle. Needs a real
backend. **Trade-off:** maximum flexibility, **but** if an Engineering Manager opens the portfolio on a
Monday and the free Postgres has paused, the flagship demo answers with a `500 Internal Server Error` —
destroying the exact reliability claim I am trying to prove.

## Section 3 · Pressure-testing the front-runner (Road 2)

1. **What breaks if I pick the simplest (Road 1)?** My core proof. My One Claim is *"I build loan
   disbursement flows that cannot pay a borrower twice,"* built in React + TypeScript. A static HTML
   screenshot can't let the manager click **Simulate double-click / network retry** and watch the live
   `409 Conflict (VERSION_MISMATCH)` transition. That turns an interactive proof into an unverified claim.
2. **What do I maintain if I pick the most powerful (Road 3)?** Prisma migrations, DB connection pooling,
   CMS schema syncs, rate-limiting against anonymous spam writes, and a keep-alive cron just to stop a
   free Supabase Postgres from sleeping — all to serve three case studies that change a few times a
   semester.
3. **Can I finish Road 2 in two weeks?** Yes. It is the exact React, TypeScript and Tailwind stack I work
   in daily, and it shares the repo as the `MicroCredit API` capstone —
   [microcredit-api-beta.vercel.app/portfolio](https://microcredit-api-beta.vercel.app/portfolio) is
   already live.
4. **Does Road 2 show my work the way it needs to be shown?** Yes. It renders the long-form case studies
   (`Node2Shell CVE-2026-111497` diffs, `RoadWatch` workflows) as fast, high-contrast Server Components in
   Plus Jakarta Sans and JetBrains Mono, while mounting the live state machine above the fold.

## Section 4 · My written rationale (copy-paste ready)

I chose **Next.js App Router with strict TypeScript and Tailwind CSS, hosted free on Vercel, with no
persistent backend yet.** It lives in the same `microcredit-api` repo as my capstone, so my portfolio and
the thing it is proving never drift apart.

I rejected two roads. Road 1, hand-written HTML on GitHub Pages, is unbreakable, but it would split my
portfolio from my repo and reduce my live React state machine to dead screenshots. My whole claim is that
a manager can double-click **Disburse** and watch the second request bounce; a picture of that proves
nothing. Road 3, Next.js plus a Postgres database and a headless CMS, is powerful but wrong for this job.
A free-tier database pauses after about a week idle, so a manager opening my site cold could hit a `500`
on the exact demo meant to prove reliability. I will not build a failure mode into my proof.

**Does it show my work well?** Yes. A manager can trigger the real `Idempotency-Key` replay and the
`If-Match` `409 Conflict` guard in their own browser, read the `CVE-2026-111497` remediation diff, and
view real Playwright captures — all on one fast page.

**Can I maintain this?** Yes. One repo, static Server Components for the case studies, zero database
bills, and `oxlint` + Vitest + an above-the-fold Playwright check that run on every push. That is
realistic to keep green alongside my BSIT classes and my VulnTech security research long after the
internship ends.

**The honest backend answer: not yet.** Nothing in the portfolio needs a database. The sandbox is
deterministic in-memory TypeScript, so it is faster, safer, and more reliable than a server round-trip
for a 30-second review. When FE-06 needs an AI underwriting route, Vercel's free serverless functions
(the `/api/health` route already proves the pattern) are there — added when the work demands it, not
before.
