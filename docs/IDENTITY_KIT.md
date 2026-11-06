# Identity Kit: Decide Once

> Week 3 · General AI Fluency · Lenon D. Adriano · 2026-11-06 · Applies to the portfolio, every case
> study and [MicroCredit API](https://microcredit-api-beta.vercel.app). Two fonts, four colours, one
> monogram. Decided once, here.

<img src="./assets/identity-monogram.svg" width="96" height="96" alt="LA. monogram: white L and A with an emerald period on a dark slate rounded square">

## 1 · The Two-Line Style Note (copy-paste ready for the Claude Project and the portal)

> **Line 1 (Fonts & Hex Palette):** Heading & UI in Plus Jakarta Sans (`600`/`700`), technical/ledger data in JetBrains Mono (`400`/`500`); Palette: Near-White Background `F8FAFC`, Near-Black Text `0F172A`, Main Brand Slate `1E293B`, and Single Emerald Accent `059669`.
>
> **Line 2 (The Mood):** A calm, high-contrast ledger-sheet aesthetic with generous whitespace and zero decorative gradients, ensuring the interactive state machines, centavo accounting invariants, and security diffs remain the loudest things on the page.

It is also in [`CLAUDE.md` §9.4](../CLAUDE.md#94-identity-kit-style-note), so Claude Code applies it on
every build.

---

## 2 · Typography: two free Google Fonts

| # | Font | License | Weights | Used for |
| --- | --- | --- | --- | --- |
| 1 | **Plus Jakarta Sans** (headings and body prose) | SIL Open Font License 1.1 | `700` headings at `-0.02em` tracking; `600` for UI labels and buttons; `400`/`500` body at `1.6` line-height | Case-study prose, the claim, buttons, labels |
| 2 | **JetBrains Mono** (monospace and telemetry) | SIL Open Font License 1.1 (it moved from Apache 2.0 in 2020; checked in the `@fontsource/jetbrains-mono` 5.3.0 `LICENSE`) | `400`/`500` | HTTP headers (`Idempotency-Key`, `If-Match: "3"`), ledger figures (`₱1,050.00` / `105000`), state badges (`APPLIED → DISBURSED`), code diffs |

**Why we stopped at two.**
- One sans covers headings and prose. One mono covers anything a reader could copy into a terminal.
- A display serif or a script font would add a third voice. Its only job would be to look designed, and
  it would compete with `409 VERSION_MISMATCH` for attention.
- Each extra family is another download on the low-end Android phones the demo targets (`CLAUDE.md` §6).
  Two families at these weights are 6 font files.

**Loading.** [`index.html`](../index.html) preconnects to `fonts.googleapis.com` and `fonts.gstatic.com`
and requests both families with `display=swap`. Text shows in the fallback font at once and swaps when
the font arrives. [`src/index.css`](../src/index.css) sets Tailwind's `--font-sans` and `--font-mono` to
these two families, so the live demo uses them too.

---

## 3 · The 4-Color Palette

Contrast ratios use the WCAG 2.1 relative-luminance formula and were computed for this kit.

| Role | Color Name | Hex Code | RGB | WCAG Contrast | Strict Usage Rule |
| --- | --- | --- | --- | --- | --- |
| Near-white background | **Crisp Paper** | `#F8FAFC` | `248, 250, 252` | Canvas for the other three | The only page background. Long case studies and diagrams sit on it. |
| Near-black text | **Obsidian Ink** | `#0F172A` | `15, 23, 42` | **17.06:1** on Crisp Paper (AAA) | All headings and body text. Also the text colour *on* emerald buttons. |
| Main color | **Deep Ledger Slate** | `#1E293B` | `30, 41, 59` | 13.98:1 on Crisp Paper | Structural borders, the nav bar, card headers, the monogram badge. |
| Single accent | **Verification Emerald** | `#059669` | `5, 150, 105` | 3.60:1 on Crisp Paper · 4.74:1 with Obsidian Ink on it | Only three uses: the primary CTA "Book a 15-Min Walkthrough", verified-invariant badges (`Σ debits === Σ credits`), and focus rings. Never a background wash. |

**Emerald rules that the numbers force:**
1. **Never emerald text on paper.** At 3.60:1 it fails WCAG AA for normal text (4.5:1).
2. **The CTA is an emerald fill with Obsidian Ink text** (4.74:1, passes AA). White on emerald is 3.77:1
   and fails.
3. **A verified badge is Obsidian Ink text with an emerald border or dot.** The border and dot only need
   3:1 as non-text graphics, and 3.60:1 passes.
4. **Focus rings are 2 px emerald** (3.60:1 against paper, above the 3:1 for focus indicators).
5. **Emerald means "this passed".** It is never decoration (`CLAUDE.md` §12 rule 2).

**The live demo.** MicroCredit API's demo panel stays a dark screen (Tailwind `slate-950` / `slate-900`)
with its functional status colours: emerald for `201 Created`, rose for `409` / `422`, amber for an
idempotent replay. On a Crisp Paper page it reads as the one dark, data-dense block: the loudest thing on
the page, as Line 2 asks. Those status colours are data inside the demo, not brand colours.

---

## 4 · Logo & Favicon

![LA. monogram](./assets/identity-monogram.svg)

**`LA.`**, for Lenon Adriano: L and A in **Plus Jakarta Sans Bold** on a Deep Ledger Slate rounded
square, with a Verification Emerald period. The period is the "ledger dot": the entry is posted and
balanced.

```text
╭──────────────╮
│              │
│   L  A ▪     │   L A   → Crisp Paper  #F8FAFC  (13.98:1 on the badge)
│              │   ▪     → Verification Emerald #059669 (3.88:1 on the badge)
╰──────────────╯   badge → Deep Ledger Slate #1E293B, 64×64 viewBox, rx 14
```

| File | Use |
| --- | --- |
| [`public/favicon.svg`](../public/favicon.svg) | Browser tab icon. Linked in `index.html` with `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`. Vite copies it into `dist/`. |
| [`docs/assets/identity-monogram.svg`](./assets/identity-monogram.svg) | The same file, for docs and the portfolio header |

**The SVG (626 bytes):**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="la-title">
  <title id="la-title">LA. · Lenon Adriano</title>
  <!-- Plus Jakarta Sans Bold (OFL-1.1), outlined, so it renders the same without the web font. -->
  <rect width="64" height="64" rx="14" fill="#1E293B"/>
  <path fill="#F8FAFC" d="M23.5 45.0L7.5 45.0L7.5 19.0L12.3 19.0L12.3 40.8L23.5 40.8L23.5 45.0ZM28.9 45.0L23.7 45.0L32.7 19.0L38.9 19.0L47.9 45.0L42.7 45.0L40.8 39.4L30.7 39.4L28.9 45.0ZM35.8 24.2L32.1 35.2L39.5 35.2L35.8 24.2Z"/>
  <path fill="#059669" d="M56.5 45.0L51.8 45.0L51.8 40.1L56.5 40.1L56.5 45.0Z"/>
</svg>
```

**How it was made.** The glyphs are the real Plus Jakarta Sans Bold outlines, taken from the
`@fontsource/plus-jakarta-sans` 5.3.0 font file with `opentype.js`. They were laid out with
`-0.02em` tracking and centred in the 64-unit box from measured glyph bounds. A favicon cannot load
web fonts, so a `<text>` element would render in whatever sans the browser has. Outlines render the
same everywhere.

**How it scales.** It was rendered in Chromium at four sizes:

| Size | Result |
| --- | --- |
| **16×16** (browser tab) | "LA" is readable. The emerald period is about 1 px and mostly disappears, which is acceptable at tab size. |
| **32×32** (bookmarks, small header) | The period shows as a distinct emerald square. |
| **64 and 256 px** | Crisp, with even margins of 7.5 units at the sides. |

**In the portfolio header:** top-left at 32 px, next to "Lenon Adriano" in Plus Jakarta Sans 700. It is
the only dark block in the header, so it never outweighs a case-study screenshot or the live demo.

---

## 5 · Drop-In CSS Variables

Twelve lines. Every page and case study takes its decisions from here:

```css
:root {
  --font-sans: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --bg-canvas: #f8fafc;    /* Crisp Paper: the only page background */
  --text-ink: #0f172a;     /* Obsidian Ink: all text, 17.06:1 on canvas */
  --color-main: #1e293b;   /* Deep Ledger Slate: borders, nav, card headers */
  --color-accent: #059669; /* Verification Emerald: CTA fill, verified badges, focus; never text */
  --tracking-heading: -0.02em;
  --leading-body: 1.6;
  --radius: 0.75rem;
  --focus-ring: 2px solid var(--color-accent);
}
```

---

## Decided once: what this replaces

[`PORTFOLIO_DESIGN_SYSTEM.md`](./PORTFOLIO_DESIGN_SYSTEM.md) proposed a dark portfolio palette
(`#090D16` background, cyan links) and a third font, Inter. **This kit replaces both** for colours and
fonts.

That document's rules still hold, with this kit's values:
- one meaning per colour;
- frame, not upstage;
- no gradients or decorative images;
- the AI image log.

`CLAUDE.md` §12 now points here for colours and fonts.

## Verification

| Check | Result |
| --- | --- |
| Contrast ratios in §3 | Computed with the WCAG 2.1 formula. The brief's "17.4:1" for ink on paper is **17.06:1**. |
| Favicon and monogram | Rendered in Chromium at 16, 32, 64 and 256 px, and checked by eye at each size. |
| `npm run build` | `dist/favicon.svg` is emitted. The CSS sets `font-sans` to Plus Jakarta Sans. |
| Above-the-fold check with the new fonts | Measured with all 6 font faces loaded (served from the `@fontsource` files, because this container cannot reach Google Fonts), and again with fonts blocked. Disburse and Simulate end at 535 / 717 px of 740 on a phone and 467 / 601 px of 800 on a laptop, the same as before. `npm run test:e2e` passes 6/6. |
| Live site | **TODO:** after this push, confirm the deployed demo shows the `LA.` tab icon. |
