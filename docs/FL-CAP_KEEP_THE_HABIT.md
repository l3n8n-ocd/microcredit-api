# FL-CAP · Keep the Habit: the next case study, named and scheduled

> **Synced copy.** The source is `docs/FL-CAP_KEEP_THE_HABIT.md` in [`l3n8n-ocd/portfolio`](https://github.com/l3n8n-ocd/portfolio). Here, `CLAUDE.md`, `CASES` and every relative path mean the portfolio repo's; links point there. Edit the portfolio copy first, then copy it here.

General AI Fluency capstone, Week 6. Three things make the next case study a short job instead of
a rebuild:

1. a 4-step runbook (§1);
2. a named next piece of work with its copy already drafted (§2);
3. a reminder in a real calendar file (§3).

The build context lives in [`CLAUDE.md`](https://github.com/l3n8n-ocd/portfolio/blob/main/CLAUDE.md) (§4).

- **Live portfolio:** https://l3n8n-ocd.github.io/portfolio/
- **Reminder file:** [`docs/reminders/add-next-case-study.ics`](https://github.com/l3n8n-ocd/portfolio/blob/main/docs/reminders/add-next-case-study.ics)
- **Build context:** [`CLAUDE.md`](https://github.com/l3n8n-ocd/portfolio/blob/main/CLAUDE.md)

---

## Section 1 · How to add the next case (the short runbook)

**Where it goes:** the `CASES` array in
[`src/components/CapstoneAndProjects.tsx`](https://github.com/l3n8n-ocd/portfolio/blob/main/src/components/CapstoneAndProjects.tsx). That file is the
`#projects` section on https://l3n8n-ocd.github.io/portfolio/. There is no separate data file.

**Shape:** one `CaseStudy` object. The fields map onto the Week 2 beats:

| Field | Holds |
| --- | --- |
| `impact` | The plain-English outcome line: what can't go wrong now. The card shows it first. |
| `facts[0]` | Beat 1, The Problem |
| `facts[1]`, `facts[2]` | Beat 2, What I Did & Decided |
| `facts[3]` | Beat 3, What Came of It: numbers a reader can check |
| `links` | At most 3 `{ label, href }`: live demo, code, proof image |

**Step 1 · Capture one real artifact.**
- Take one real terminal or UI screenshot: 1280×800, or a crop of the part that proves the claim.
- Save it as `public/assets/cases/<slug>.webp`, under 50 KB.
- Link it from the card as `{ label: 'Proof ↗', href: '/portfolio/assets/cases/<slug>.webp' }`. Cards
  have no image slot today, so the artifact backs a link.
- Never use an AI mockup in its place.

**Step 2 · Draft in the three-beat shape with the Claude Project.**
Paste the raw build notes, then the 6-line prompt from §4, into Claude Code in this repo or into the
Claude Project. The prompt asks for:
- One-line plain-English outcome: what can't go wrong now that this exists.
- Beat 1, The Problem: the concrete failure or bottleneck before building.
- Beat 2, What I Did & Decided: the architecture, the trade-offs, and the calls a human made.
- Beat 3, What Came of It: test and eval counts, timings, live repo and demo links. Anything not
  measured is marked TODO.

**Step 3 · Slot and demote.**
- Insert the card at `index` `'02'` or `'03'` and renumber the rest. MicroCredit API stays `'01'` as
  the flagship.
- Keep the main grid at 4 cases or fewer. Adding Case 04 makes 4, so nothing moves.
- At Case 05, move the oldest supporting case out of `CASES` and into the links-only archive row
  (`CLOUD_LABS`). Rename that row's title, "Also: guided AWS cloud labs (NextWork)", to fit.
- Update the `<h2>` count ("Three things I shipped" → "Four things I shipped").
- While in the file, re-check the numbers on the other cards. Today card 01 says "461 Vitest tests";
  MicroCredit API now runs 497.

**Step 4 · Verify and push.**
```bash
npm run build
npm run preview -- --port 4173
```
- Open `http://localhost:4173/portfolio/` at 375 px wide (DevTools device toolbar).
- In the console, `document.documentElement.scrollWidth - innerWidth` must print `0`.
- Then `git push origin main`. `.github/workflows/deploy.yml` builds and deploys to GitHub Pages: the
  last 6 runs took 28–36 s.

---

## Section 2 · The named next piece of work

### Case 04 · SentinelScout: MCP security-advisory and invariant triage agent (FL-06 / FL-07)

Code and evidence live in `l3n8n-ocd/microcredit-api`:
- the spec, [`docs/FL-06_PERSONAL_AGENT_SPEC.md`](https://github.com/l3n8n-ocd/microcredit-api/blob/main/docs/FL-06_PERSONAL_AGENT_SPEC.md);
- the build log, [`docs/FL-07_BUILD_LOG.md`](https://github.com/l3n8n-ocd/microcredit-api/blob/main/docs/FL-07_BUILD_LOG.md);
- the live page, https://microcredit-api-beta.vercel.app/agent.

Every number below is quoted from the build log.

**One-line plain-English outcome**

> A new security advisory gets a checked yes/no answer and a scrubbed brief I sign, and text hidden in
> the advisory can't steer the agent.

**Beat 1 · The Problem.**
A new GitHub Security Advisory meant four manual steps, done a little differently each time:
- look up the installed version in the lockfile;
- compare it with the advisory's affected range;
- re-run the money grep, the type check and the tests;
- write a brief with the tokens and IPs scrubbed out by hand.

The advisory text itself is untrusted input: anyone who can publish one can hide instructions in it.

**Beat 2 · What I Did & Decided.**
- **4 MCP tools over JSON-RPC stdio:**
  - `fetch_ghsa_advisory`;
  - `scan_local_repo_exposure`;
  - `audit_centavos_and_idempotency`, which checks integer centavos plus `Idempotency-Key` and
    `If-Match`;
  - `write_sanitized_triage_brief`.
- **Nothing is applied, committed or published.** Lenon signs off on the brief.
- **The 4-call budget lives in the MCP server, per `triage_id`,** so every host obeys it:
  - `npm run agent:run` (a CLI);
  - the `/agent` page.

  I cut the planned Claude Code subagent: it couldn't run from `npm` or a browser.
- **Advisory text is wrapped as untrusted data.** A leak gate redacts these from the brief:
  - JWTs and bearer tokens;
  - `x-maya-sig` / `x-gcash-sig` signatures;
  - RFC 1918 IPs;
  - PH mobile numbers.
- **The stdout break was deliberate (experiment E7).** One `console.log` in the MCP server corrupted
  stdout: `MCP stdout is not JSON-RPC`. The client's frame check caught it, but the CLI crashed with a
  raw stack trace. The fix turns a transport failure into `MCP_TRANSPORT_ERROR`, so the loop prints
  `[HALTED]` and exits 1. A test fails if the `console.log` comes back.

**Beat 3 · What Came of It.**
- **`npm run agent:eval`: 6/6,** both blockers included: a secret-leak trap, and a prompt injection
  hidden inside an advisory.
- **Real triage `T-20261112-02` of `GHSA-2464-fhr4-w9xw`:**
  - 4 tool calls in 6,014 ms;
  - verdict `NOT_AFFECTED`, because `next` 16.4.5 is outside `>=16.0.0 <16.4.1`;
  - invariant audit `PASS` (0 float-money lines).
- **Deliberate breaks:** four of them each failed a named unit test. Eval cases 2–5 each failed under
  at least one break.
- **TODO:** time saved per triage is not measured. FL-06 sets a target of about 15 minutes per
  session, an estimate, to be timed over 5 real sessions.

**Ready to paste into `CASES`** (index `'02'`; Node2Shell and RoadWatch become `'03'` and `'04'`):

```ts
  {
    index: '02',
    category: 'AI agent · Security triage',
    title: 'SentinelScout',
    impact:
      "A new security advisory gets a checked yes/no answer and a scrubbed brief I sign, and text hidden in the advisory can't steer the agent.",
    facts: [
      'Before: each GitHub Security Advisory meant a manual lockfile lookup, a version-range check, a re-run of the money grep and tests, and a hand-scrubbed brief. The advisory text itself is untrusted input.',
      'An agent with 4 MCP tools over JSON-RPC stdio: fetch the advisory, scan the lockfile, audit the centavo and Idempotency-Key / If-Match rules, write a redacted brief. It changes, commits and publishes nothing.',
      'The 4-call limit is enforced in the MCP server, so the CLI and the /agent page both obey it. Advisory text is wrapped as untrusted; a leak gate strips tokens, private IPs, phone numbers and wallet signatures.',
      'Eval suite 6/6, including a secret-leak trap and a prompt injection hidden in an advisory. A real triage of GHSA-2464-fhr4-w9xw took 4 tool calls in 6.0 s and returned NOT_AFFECTED.',
    ],
    note: 'Time saved per triage is not measured yet (FL-06 target: about 15 minutes, an estimate).',
    tags: ['TypeScript', 'MCP', 'JSON-RPC', 'Agent evals'],
    links: [
      { label: 'Run /agent ↗', href: 'https://microcredit-api-beta.vercel.app/agent' },
      { label: 'Build log ↗', href: 'https://github.com/l3n8n-ocd/microcredit-api/blob/main/docs/FL-07_BUILD_LOG.md' },
    ],
  },
```

The artifact for Step 1 is a still frame from the real run recording,
`docs/assets/curated/fl-07-agent-run.webm` in microcredit-api. It is 1.1 MB, so export one frame as
WebP under 50 KB.

**Numbers left out on purpose.**
- **"42 min → 4.5 min" is not a SentinelScout number.** It belongs to the FL-04 advisory pipeline
  ([`docs/FL-04_AUTOMATION_WORKFLOW.md`](https://github.com/l3n8n-ocd/microcredit-api/blob/main/docs/FL-04_AUTOMATION_WORKFLOW.md)).
  Both of its ends are estimates; only that pipeline's ~50 ms gate was measured.
- **The "4 live MCP tools" are the agent's 4.** The server exposes 6: 2 more from FL-05.

### Queued: Case 05 · AWS IAM, VPC isolation and KMS security lab series

- **Evidence today:** three guided NextWork labs, linked in the `CLOUD_LABS` row:
  - S3 website hosting;
  - IAM;
  - a VPC build.
- **Not built yet:**
  - a KMS lab;
  - a serverless or multi-cloud CSPM scanner.
- **Before it ships as a case, it needs:**
  - one repo with the infrastructure as code;
  - one checkable result, for example a denied cross-account call or a key-policy test;
  - one real screenshot.

Until then it stays in the archive row.

---

## Section 3 · The reminder

| Field | Value |
| --- | --- |
| Title | Portfolio Habit: Ship Next 3-Beat Case Study (Case 04: SentinelScout MCP Agent) |
| First run | Sunday, November 29, 2026 · 8:00 PM PHT (`Asia/Manila`, UTC+8) to 9:00 PM |
| Repeats | Monthly on the last Sunday (`RRULE:FREQ=MONTHLY;BYDAY=-1SU`) |
| Alert | 30 minutes before (`VALARM`, `TRIGGER:-PT30M`) |
| File | [`docs/reminders/add-next-case-study.ics`](https://github.com/l3n8n-ocd/portfolio/blob/main/docs/reminders/add-next-case-study.ics) |

**Next six dates** (computed from the file with `dateutil`):
- Nov 29, 2026
- Dec 27, 2026
- Jan 31, 2027
- Feb 28, 2027
- Mar 28, 2027
- Apr 25, 2027

All at 8:00 PM PHT.

**How the file was checked.**
- `icalendar` 7.3.0 parses it: 1 `VEVENT`, 1 `VALARM`.
- Every line ends in CRLF, and no line is longer than 75 octets (RFC 5545 §3.1).
- To put it on a phone, use Google Calendar on the web: Settings → Import & export → Import, then pick
  the `.ics` file.

![Reminder card rendered from docs/reminders/add-next-case-study.ics: Nov 29, 2026 · 8:00 PM PHT, repeats monthly on the last Sunday, with the 4-step checklist](https://raw.githubusercontent.com/l3n8n-ocd/portfolio/main/docs/assets/crit-audit/next-case-reminder-evidence.png)

The image is a render of the `.ics` file's parsed fields, not a screenshot of a calendar app. The
dates, rule and alert on it come from the file. A screenshot of the imported event in your own
calendar would be stronger evidence still.

**The recurring checklist** (also in the event's description):
1. Capture 1 real artifact (terminal or UI, under 50 KB) into `public/assets/cases/`.
2. Paste the raw notes and the 6-line prompt from `CLAUDE.md` into Claude.
3. Slot the card into `CASES` in `src/components/CapstoneAndProjects.tsx`. MicroCredit API stays `01`.
4. Run `npm run build`, check 375 px for sideways scroll, then `git push origin main`.

---

## Section 4 · Preserved build context

[`CLAUDE.md`](https://github.com/l3n8n-ocd/portfolio/blob/main/CLAUDE.md) holds what a new case needs, so the next session starts from it:

- **§1** the file, the `CaseStudy` interface, and the field-to-beat map.
- **§2** the three-beat shape and the 10-second rules:
  - the outcome line comes first;
  - one primary button;
  - at most 4 cases.
- **§3** the Voice Card and its banned-word check.
- **§4** the stack and theme tokens exactly as they are in `src/App.css` today, and the brief's target
  palette marked as not in the code yet.
- **§5** the build and 375 px checks.

**The 6-line prompt for next month** (paste it into Claude Code in this repo, with the raw notes under it):

```text
Read CLAUDE.md and docs/FL-CAP_KEEP_THE_HABIT.md. Add one case to CASES in src/components/CapstoneAndProjects.tsx.
Case: <name>. My raw notes, numbers and links are below. Use only facts in them; anything else becomes a TODO.
Shape: impact = one plain-English line (what can't go wrong now); facts = [Beat 1 problem, Beat 2 did & decided (1–2), Beat 3 what came of it with numbers].
Put it at index <02|03>, renumber the rest, keep MicroCredit API at 01, keep the grid at 4 or fewer, and update the <h2> count.
Apply the Voice Card and its banned-word check. No new colours, fonts or buttons; links use .project-link-button.
Run npm run build and the 375 px overflow check, show me the diff, then commit as Lenon with feat(cases): add <name> case study and push to main.
```

For Case 04, the notes are §2 above, so the job is: paste the prompt, paste §2, review the diff, push.
