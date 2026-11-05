# What Are You Proving? — Lenon D. Adriano

> Week 1 · General AI Fluency · Flagship proof:
> [`github.com/l3n8n-ocd/microcredit-api`](https://github.com/l3n8n-ocd/microcredit-api)

---

## ✅ Final Deliverable (Copy-Paste Ready for FlyRank Portal)

### One-Paragraph Proof Statement

I build loan disbursement flows that cannot pay a borrower twice. In MicroCredit
API, every payout carries an `Idempotency-Key` and every admin action sends an
`If-Match` version, so a retry or two admins clicking at once gets rejected
instead of double-paying. I built it for Engineering Managers at seed-to-Series A
lending startups who cannot afford a duplicate payout. Double-click **Disburse**
in the demo, watch the second request bounce, then book a 15-minute code
walkthrough.

### One-Line Why

A CV or LinkedIn profile can list "React and TypeScript" but cannot show what
happens when a disbursement request fires twice, whereas MicroCredit API lets an
Engineering Manager trigger that exact race and watch the second payout get
rejected.

### Claim · Person · Action

| Element        | Final answer                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **One Claim**  | I build loan disbursement flows that cannot pay a borrower twice.                                     |
| **One Person** | An Engineering Manager at a seed-to-Series A lending startup who cannot afford a duplicate payout. |
| **One Action** | Double-click **Disburse** in the demo, watch the second request bounce, then book a 15-minute code walkthrough. |

> ⚠️ **Evidence status (per `CLAUDE.md` §9.2 rule 4, "No unearned claims"):** the
> idempotency and `If-Match` design is documented in
> [`README.md`](../README.md#concurrency--idempotency), and the toolchain that will
> carry it is in place: strict TypeScript, Vite, Vitest, oxlint, git hooks, and green
> CI ([`74c36fb`](https://github.com/l3n8n-ocd/microcredit-api/commit/74c36fb) → [`be34d64`](https://github.com/l3n8n-ocd/microcredit-api/commit/be34d64)). Not built yet: the
> `Disburse` flow, its idempotency tests, and a deployed demo. The statement becomes
> fully true when those ship. **TODO:** build and deploy the double-submit
> `Disburse` demo, then link it here.

This statement replaced the earlier one in
[`PORTFOLIO_PATH.md`](./PORTFOLIO_PATH.md#proof-statement), which now mirrors it.
See the log below for why.

---

## 🔍 Narrowing & Sharpening Log

### Step 0 — The Initial Broad Draft

> "I am a full-stack and frontend developer who builds fintech apps and secure
> interfaces for companies so they will hire me."

#### Critique (FlyRank "What Are You Proving?" rubric)

| Rubric check | Verdict | What's wrong, specifically |
| ------------ | :-----: | -------------------------- |
| **One claim, no "and" trap** | ❌ Fail | Two "and"s hide **four** things: *full-stack* **and** *frontend* (two roles, and they overlap), *fintech apps* **and** *secure interfaces* (two skills). A reader can't tell which one you'd stake your reputation on. |
| **Claim, not a job title** | ❌ Fail | "I am a … developer" is a **label**, not a claim. It says what you are called, not what you can do that others can't. |
| **Specific person** | ❌ Fail | "Companies" can't read a portfolio or book a call. A person does. There is no role, no company stage, and no domain. |
| **Concrete action** | ❌ Fail | "So they will hire me" is **your goal**, not the reader's next step. It gives them nothing to click, try, or book. |
| **Only describes `MicroCredit API`** | ❌ Fail | Name-swap test: thousands of developers could sign this sentence unchanged. It never mentions the build, the state machine, the ledger, or idempotency. |
| **Evidence a reader can check** | ❌ Fail | "Secure" and "fintech" are adjectives with no mechanism behind them. Nothing in the sentence can be checked. |

#### Earlier statement (`PORTFOLIO_PATH.md`) — also re-checked

The earlier proof statement is sharper but still hits the **"and" trap**. Its one
claim actually lists *three* skills: "double-entry centavo ledgers, finite-state
loan lifecycles, **and** idempotent payment mutations." It also claims "in
production," which no deployment backs yet. That's why each version below picks
**one** of those three.

---

### Version A — The Double-Payout Claim *(idempotency + `If-Match`)*

> I build loan disbursement flows that cannot pay a borrower twice. In MicroCredit
> API, every payout carries an `Idempotency-Key` and every admin action sends an
> `If-Match` version, so a retry or two admins clicking at once gets rejected
> instead of double-paying. I built it for Engineering Managers at seed-to-Series A
> lending startups who cannot afford a duplicate payout. Double-click **Disburse**
> in the demo, watch the second request bounce, then book a 15-minute code
> walkthrough.

| Cut word or phrase | Why it was cut |
| ------------------ | -------------- |
| "full-stack and frontend developer" | A job title plus the "and" trap. The claim describes an outcome instead. |
| "fintech apps" | A category, not proof. Replaced with the specific flow: *loan disbursement*. |
| "secure interfaces" | An adjective you can't check. Replaced with the mechanism: `Idempotency-Key` + `If-Match`. |
| "companies" | Nobody to hire you. Replaced with *Engineering Managers at seed-to-Series A lending startups*. |
| "so they will hire me" | Your goal, not their action. Replaced with *double-click Disburse → book 15 minutes*. |
| "high-integrity," "reliable," "complex" (from the earlier statement) | Adjectives with no mechanism. "Cannot pay a borrower twice" says the same thing as a fact the reader can test. |
| "ledgers … state machines" (from the earlier statement) | The "and" trap. Moved to Versions B and C so this version proves **one** thing. |

### Version B — The Illegal-State Claim *(discriminated-union state machine)*

> I make illegal loan states impossible to represent. MicroCredit API models its
> 10-state loan lifecycle, `APPLIED` to `SETTLED`, as a TypeScript discriminated
> union behind a single `transition()` function, so the admin dashboard can never
> offer to disburse a rejected loan and the compiler catches the mistake before a
> reviewer does. I built it for Engineering Managers at seed-to-Series A lending
> startups whose loan status bugs become compliance incidents. Try to force an
> illegal transition in the MicroCredit API demo, then book a 15-minute code
> walkthrough with me.

| Cut word or phrase | Why it was cut |
| ------------------ | -------------- |
| "full-stack and frontend developer" | A job title plus the "and" trap. |
| "builds fintech apps" | A category. Replaced with *10-state loan lifecycle* and *discriminated union*. |
| "secure interfaces" | Vague. Replaced with a property you can check: *illegal states impossible to represent*. |
| "companies" | Replaced with *Engineering Managers … whose status bugs become compliance incidents*. |
| "so they will hire me" | Replaced with *try to force an illegal transition → book 15 minutes*. |
| "from rough concept to production" (earlier statement) | Not backed by a deployment yet. Cut instead of claimed. |

### Version C — The Balanced-Ledger Claim *(integer-centavo double-entry)*

> I build lending ledgers where every centavo balances. In MicroCredit API, money
> is stored only as integer centavos, every movement posts as a balanced
> debit/credit pair, and mistakes are reversed by compensating entries, never
> edited, so a balance can always be rebuilt from its history. I built it for
> Engineering Managers at seed-to-Series A lending startups who have to explain
> every peso to an auditor. Post a disbursement in the MicroCredit API demo, watch
> both sides of the entry land, then book a 15-minute code walkthrough with me.

| Cut word or phrase | Why it was cut |
| ------------------ | -------------- |
| "full-stack and frontend developer" | A job title plus the "and" trap. |
| "fintech apps" | A category. Replaced with *lending ledgers* and *integer centavos*. |
| "secure interfaces" | The wrong skill for this claim. The claim is accuracy, not security. |
| "companies" | Replaced with *Engineering Managers … who have to explain every peso to an auditor*. |
| "so they will hire me" | Replaced with *post a disbursement → watch both entries → book 15 minutes*. |
| "accurate," "precise" | Adjectives. "Every centavo balances" is a fact the reader can check. |

---

### Pass / Revise Checklist

| # | Check | Draft | A · Double-Payout | B · Illegal-State | C · Balanced-Ledger |
| - | ----- | :---: | :---------------: | :---------------: | :-----------------: |
| 1 | **One claim**, no "and" trap hiding several skills | ❌ | ✅ | ✅ | ✅ |
| 2 | **Specific person** (role + company stage + domain + pain) | ❌ | ✅ | ✅ | ✅ |
| 3 | **One concrete action** (verb + object + time box) | ❌ | ✅ | ✅ | ✅ |
| 4 | **Name-swap test**: only describes `MicroCredit API` | ❌ | ✅ | ✅ | ✅ |
| 5 | **Speakable in one breath** (≈ 75 words or fewer) | ✅ | ✅ (74) | 🔁 Revise (87) | 🔁 Revise (88) |
| 6 | **Action takes 5 seconds or less** in a demo | ❌ | ✅ one double-click | 🔁 needs a guided path | 🔁 needs reading two ledger rows |
| 7 | **The pain is the reader's own fear** | ❌ | ✅ a duplicate payout is lost money | 🔁 a bug class, less visceral | 🔁 audit pain, narrower audience |
| 8 | **Backed by evidence in the repo today** (`CLAUDE.md` rule 4) | ❌ | ⚠️ design in README; demo TODO | ⚠️ design in README; code TODO | ⚠️ design in README; code TODO |

**Winner: Version A (Double-Payout).** It's the only version that passes checks
1–7 cleanly:

- **Shortest to say:** 74 words, so it fits in one breath.
- **Fastest action:** a single double-click proves the claim in about 5 seconds, which
  matches the Hero preview planned in [`PORTFOLIO_PATH.md`](./PORTFOLIO_PATH.md#sitemap-pressure-test--revisions).
- **Most direct pain:** a duplicate payout is lost money for the exact person who would hire me.

Versions B and C stay as **supporting evidence** inside the case study, not as
competing claims. All three still fail check 8 until the demo ships.
