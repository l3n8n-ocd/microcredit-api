# Portfolio Design System: Consistency, Not Talent (and Frame, Not Upstage)

> Week 3 · General AI Fluency · Lenon D. Adriano · 2026-11-06
> Flagship proof: [MicroCredit API](https://microcredit-api-beta.vercel.app) · One Person: an Engineering
> Manager at a seed-to-Series A lending startup · Sitemap: [`PORTFOLIO_PATH.md` v2](./PORTFOLIO_PATH.md#revised-sitemap-v2--3-sections)
> · Copy: [`FRAME_IT_AS_CASES.md`](./FRAME_IT_AS_CASES.md)

The idea: a portfolio looks professional because a few rules are applied every time, not because
someone has an eye for design. Each rule below is small enough to check with a command or a
contrast number.

**Scope.** The portfolio site follows every token below. The MicroCredit API demo app in `src/` keeps
its current Tailwind classes, which already map to these tokens (§1.2). It also keeps the system
font stack, so a low-end Android phone downloads no web fonts (`CLAUDE.md` §6).

---

## Section 1 · The 3 Intentional Design Rules (No Talent Required)

### Rule 1 · Strict typography pairing: three families, three jobs

| Role | Family | Weights | Used for |
| --- | --- | --- | --- |
| Headings | **Plus Jakarta Sans** (geometric sans) | 600, 700 | `h1`–`h3` only: the claim, the case titles |
| Body | **Inter** (neutral sans) | 400, 600 | Paragraphs, labels, buttons |
| Code and telemetry | **JetBrains Mono** | 400, 600 | `Idempotency-Key`, `If-Match: "3"`, `409 VERSION_MISMATCH`, `₱5,000.00`, commit hashes, file paths |

- **No fourth family.** No script fonts, no display fonts, no icon fonts.
- **Monospace means "this is real".** Any value a reviewer could copy into a terminal or test is set in
  JetBrains Mono: a header, a state such as `APPROVED → DISBURSED`, an amount in centavos, a path such as
  `src/utils/money.ts`. Prose about it stays in Inter.
- **Type scale:** 14 / 16 / 20 / 30 / 40 px. Body is 16 px with line-height 1.6, and lines stop at about
  70 characters.
- **Loading budget:** at most 6 font files, `woff2`, Latin subset, `font-display: swap`. If a font fails to
  load, the fallback is `system-ui` or `ui-monospace`, and the page still reads.

### Rule 2 · Intentional colour tokens: each colour means one thing

Dark-mode fintech palette. Ratios are WCAG 2.1 contrast against the background `#090D16`, computed for
this document (see [Verification](#verification)).

| Token | Hex | Meaning (one per token) | Contrast on `#090D16` |
| --- | --- | --- | --- |
| `obsidian` | `#090D16` | Page background | — |
| `card` | `#0F172A` | Card and panel fill | — |
| `line` | `#1E293B` | Card borders. Decorative only. | 1.33:1 (not used for meaning) |
| `field` | `#64748B` | Input and button outlines a user must see | 4.08:1 (passes 3:1, WCAG 1.4.11) |
| `ink` | `#F1F5F9` | Primary text | 17.74:1 |
| `muted` | `#94A3B8` | Secondary text, captions | 7.58:1 |
| `ok` | `#10B981` | Success **only**: `Σ debits === Σ credits`, `201 Created`, live status | 7.66:1 |
| `link` | `#38BDF8` | Links, focus rings, code highlights | 9.07:1 |
| `fail` | `#FB7185` | Failure **only**: `409`, `422`, field errors | 7.22:1 |

Rules that follow from the table:
1. **Green is earned.** `ok` appears only next to something that passed: a balanced ledger, a `201`, a
   green CI run. It is never a decoration colour.
2. **Never colour alone** (`CLAUDE.md` §6). Every `ok` or `fail` pairs with text or a symbol: `✓ 201
   Created`, `⚠ 409 VERSION_MISMATCH`, `Σ (balanced)`.
3. **Emerald buttons take obsidian text.** `#090D16` on `#10B981` is 7.66:1. White on `#10B981` is 2.54:1,
   which fails, so it is not used.
4. **`fail` is an addition to the brief's palette.** The demo's whole point is a second payout that
   bounces. A `409` must look different from a `201`, and from a link.

**How the demo app in `src/` maps to the tokens today:**

| Token | `src/` class today | Note |
| --- | --- | --- |
| `obsidian` / `card` | `bg-slate-950` / `bg-slate-900/60` | Same family, slightly different shade |
| `line` / `field` | `border-slate-800` / `border-slate-600` | `border-slate-600` (`#475569`) is 2.56:1. **TODO:** raise input borders to `slate-500` (`#64748B`, 4.08:1). |
| `ink` / `muted` | `text-slate-100` / `text-slate-300` | Same family |
| `ok` | `emerald-400` / `emerald-500` | Same meaning: success, balanced ledger |
| `fail` | `rose-300`–`rose-950` | Same meaning: 409, 422, field errors |
| *(app only)* | `amber-200` / `amber-400` | The Simulate test control and `201 Idempotent replay`: a repeat that is neither a success nor an error. Not used on the portfolio site. |

### Rule 3 · Whitespace and layout rhythm: one column, no clutter

- **Width:** content stops at `max-w-4xl` (56 rem, 896 px). The demo app uses `max-w-3xl`.
- **Spacing scale:** 4 px steps only (Tailwind's default). Sections get `py-16 sm:py-24`, cards get
  `p-6`, and gaps between cards are `gap-6`.
- **Mobile first:** design at 360 px, then scale up with `sm:` and `md:`. The demo's
  `e2e/fold.mjs` already holds this for Disburse and Simulate at 360×740 and 1280×800.
- **Zero decorative bloat:**
  - no gradient behind text;
  - no particle or blob backgrounds;
  - no parallax or scroll-jacking;
  - no stock imagery;
  - motion is at most a 150 ms colour or opacity transition, and is off under
    `prefers-reduced-motion`.
- **Same skeleton for every case:** Problem → What I Did & Decided → What Came of It, as in
  [`FRAME_IT_AS_CASES.md` §3](./FRAME_IT_AS_CASES.md#3--the-framed-case-studies). The reader learns the
  layout once.

---

## Section 2 · The "Frame, Not Upstage" Rule Applied

The design is the frame. The proof is the picture. A reviewer should remember the bounced payout, not
the colours.

| Page part | The proof (hero) | The frame (stays quiet) | What is banned here |
| --- | --- | --- | --- |
| Hero `/` | The live MicroCredit API demo: **Disburse** and **Simulate double-click / network retry** on the first screen, and the second request coming back as `201 Idempotent replay` or `409` | One `h1` with the claim in Plus Jakarta Sans, `ink` on `obsidian`, one `ok` button: "Book a 15-min code walkthrough" | Illustrations, the milestone image, gradients, a second CTA styled as loudly as the first |
| Flagship `/#flagship-proof` | Code receipts in JetBrains Mono: `transitionLoan` and its typed `409`, `splitRepayment` with `principal + interest === total`, the `Σ debits === Σ credits` check in `ledger.ts`, the CI badge | One `card` per receipt, `line` borders, `link` for file paths | Screenshots that repeat what the code block shows |
| "Also shipped" strip | **Node2Shell (CVE-2026-111497)**: the advisory link and the `node:24.22.0` vs `24.22.1` differential PoC. **RoadWatch**: the repo link and the `ROLE_PLATFORMS` lockdown | Smaller type than the flagship: one line each, `muted` text, `link` titles | Equal billing with the flagship (PORTFOLIO_PATH v2 keeps them supporting) |
| Act `/#act` | The 15-minute test: run Simulate, read `src/features/disbursement/`, then book | One `ok` button, a `mailto:` fallback in `link` | Calendar embeds (heavy on slow networks), social icons rows |

Three checks a reviewer can make in 30 seconds:
1. **Squint test.** Blur the screenshot. The brightest thing on the first screen should be the
   Disburse/Simulate area or the claim, never an image.
2. **Delete test.** Remove every decorative element. If the page still proves the claim, the
   decoration was frame. If it no longer does, the "decoration" was carrying content and must become
   real content.
3. **Colour test.** Every green on the page points at something that passed. Every red points at a
   bounce.

---

## Section 3 · AI Image Judgment & Selection Log

### Rejected

| Candidate | Why it was rejected |
| --- | --- |
| Stock photo of hands typing on a glowing keyboard | It says "a person codes", which every portfolio says. It shows nothing about idempotency, centavos or `If-Match`. |
| 3D corporate handshake | It signals "business deal". The One Person is hiring an engineer, not signing a vendor. |
| Abstract AI art (swirls, nebulae, "neural" waves) | No link to fintech engineering, and it upstages the demo by being the brightest thing on the page. |
| Any image containing text not checked against the repo | Generated images can invent commit hashes, test counts or features. That would break Voice Card rule 4: claims follow evidence. |

### Chosen

| Asset | Where it lives | Status |
| --- | --- | --- |
| Technical diagrams as text-defined SVG: the `stateDiagram-v2` lifecycle in [`README.md`](../README.md#loan-lifecycle-state-machine) and the flowcharts in [`PORTFOLIO_PATH.md`](./PORTFOLIO_PATH.md) | Mermaid source in the Markdown. GitHub renders it as SVG. | ✅ In repo. They are diffable and reviewable, and change in the same commit as the code they describe. |
| Real terminal output: `git log --oneline`, the Vitest run (`247 passed`), `npm run test:e2e` (`6/6`, Simulate's bottom edge at 717 px of 740) | Today as text in [`WEEK3_REACT_AI_DEVELOPMENT.md`](./WEEK3_REACT_AI_DEVELOPMENT.md#checks-run-on-commit-2) and the CI logs | 🟡 **TODO:** capture as screenshots for the portfolio. None is in `docs/assets/` yet. |
| The Week 1 milestone card: [`docs/assets/week-01/week1-milestone.png`](./assets/week-01/week1-milestone.png) (1920×1080) | README, top of "🎓 FlyRank Internship Deliverables" | ✅ In repo. See the judgment notes below. |

### Judgment notes on the milestone card

The card was AI-generated from a written prompt. The prompt named the background `#090D16`, emerald
`#10B981` and cyan `#38BDF8` rim light, the Week 1 checklist, a state machine, a ledger scale and an
idempotency shield.

1. **Its text was checked against the repo, not trusted.** All 16 commit hashes drawn in the terminal and
   checklist are real commits in this repository, from `4d93972` (the first commit) to `5433382`. Two
   looked wrong at first glance (`cd64969`, `0105736`), but that was me misreading the small, slanted
   text.
2. **One label ran ahead of the code when it was made.** "10 states · discriminated union" described the
   design in Week 1, when 5 states were built. It became true in Week 3, at commit `f24c143`.
3. **It upstages, so it is placed where it can't.** An isometric 3D scene is decoration. It works as a
   milestone cover in the README and as a social card. It is **not** used in the portfolio hero, where the
   live demo is the visual (Section 2).
4. **Asset name.** The brief for this document called it `docs/assets/week-1-milestone-card.svg`. No such
   file exists. The real file is the PNG above, and it is the one documented.

---

## Section 4 · CSS / Tailwind Design Tokens Snippet

Tailwind CSS v4 (this repo uses `tailwindcss` 4.3.4) is configured in CSS with `@theme`, not in a
`tailwind.config.js`. `--color-*: initial` removes Tailwind's default palette, so a class outside the
tokens, such as `text-blue-500` or `bg-slate-950`, produces no CSS at all. An unapproved colour then
shows up as unstyled during review instead of slipping through.

```css
/* docs/PORTFOLIO_DESIGN_SYSTEM.md §4 · Tailwind CSS v4 (CSS-first config, no tailwind.config.js) */
@import 'tailwindcss';

@theme {
  /* Reset Tailwind's default palette: only these colours exist as utilities. */
  --color-*: initial;

  /* Surfaces */
  --color-obsidian: #090d16;   /* page background */
  --color-card: #0f172a;       /* card / panel fill */
  --color-line: #1e293b;       /* card border: decorative only (1.33:1) */
  --color-field: #64748b;      /* input + focusable outline (4.08:1, passes WCAG 1.4.11) */

  /* Text */
  --color-ink: #f1f5f9;        /* primary text, 17.74:1 */
  --color-muted: #94a3b8;      /* secondary text, 7.58:1 */

  /* Signals: each one means one thing */
  --color-ok: #10b981;         /* Σ debits === Σ credits, 201 Created, live status (7.66:1) */
  --color-link: #38bdf8;       /* links and code highlights (9.07:1) */
  --color-fail: #fb7185;       /* 409 / 422 bounces and errors (7.22:1) */

  /* Typography: three families, nothing else */
  --font-display: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif;
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Layout rhythm */
  --container-page: 56rem;     /* = max-w-4xl */
  --radius-card: 0.75rem;
}

@layer base {
  html {
    background-color: var(--color-obsidian);
    color: var(--color-ink);
    font-family: var(--font-sans);
  }
  h1,
  h2,
  h3 {
    font-family: var(--font-display);
    letter-spacing: -0.01em;
  }
  code,
  pre,
  kbd {
    font-family: var(--font-mono);
  }
  :focus-visible {
    outline: 2px solid var(--color-link);
    outline-offset: 2px;
  }
}

@layer components {
  .card {
    border: 1px solid var(--color-line);
    border-radius: var(--radius-card);
    background-color: var(--color-card);
    padding: 1.5rem;
  }
  .btn-ok {
    border-radius: 0.5rem;
    background-color: var(--color-ok);
    color: var(--color-obsidian); /* obsidian on emerald 7.66:1; white would be 2.54:1 */
    font-weight: 600;
    padding: 0.5rem 1rem;
  }
}
```

**Usage:**

```tsx
<main className="mx-auto max-w-page px-4 py-16 sm:py-24">
  <h1 className="text-4xl font-bold">I build loan disbursement flows that cannot pay a borrower twice.</h1>
  <section className="card mt-8">
    <p className="font-mono text-ok">✓ 201 Created · Σ debits === Σ credits</p>
    <p className="font-mono text-fail">⚠ 409 VERSION_MISMATCH · second payout rejected</p>
    <a className="text-link underline" href="https://github.com/l3n8n-ocd/microcredit-api">src/features/disbursement/</a>
  </section>
  <a className="btn-ok mt-8 inline-block" href="https://github.com/l3n8n-ocd">Book a 15-min code walkthrough</a>
</main>
```

The fonts are not bundled by this block. Load them with the budget in Rule 1, for example self-hosted
`woff2` files declared with `@font-face { font-display: swap; }`.

---

## Verification

| Check | Result |
| --- | --- |
| The §4 block compiled with this repo's `@tailwindcss/node` (Tailwind 4.3.4) | `bg-obsidian`, `text-ok`, `text-link`, `font-display`, `max-w-page`, `max-w-4xl` and `rounded-card` are generated. `.card` and `.btn-ok` compile. `bg-slate-950` and `text-emerald-400` are **not** generated, so the default palette is gone. |
| Contrast ratios in Rule 2 | Computed with the WCAG 2.1 relative-luminance formula. Every text token is ≥ 7:1 on `#090D16`, except `muted` on `card`, which is 6.96:1. |
| `src/` colour families today | slate 70 uses, emerald 27, rose 17, amber 7, white 3. No gradients, no `animate-*`, no web fonts. |
| `CLAUDE.md` §12 visual check on `src/` | Prints nothing. It catches a planted `text-blue-500 bg-gradient`. |
| Milestone card text | 16/16 commit hashes are real commits. |
| Voice Card check on this file | `grep` for the banned words prints nothing. |

**Not done yet (TODO):** the portfolio site itself is not built, so these tokens are not on a live page
yet. The terminal screenshots are not captured. The demo's input borders are still `slate-600`
(2.56:1).
