# Plant Your Flag: Domain + Badge

> Synced copy of [`docs/PLANT_YOUR_FLAG.md` in the portfolio repo](https://github.com/l3n8n-ocd/portfolio/blob/main/docs/PLANT_YOUR_FLAG.md). That copy wins; links
> here point to it.

FlyRank General AI Fluency, Week 9 ([`#plant-your-flag`](https://aifluency.flyrank.ai/week-09.html#plant-your-flag),
`CUSTOM-MQX0P6DW-02B21A98`).

| | |
| --- | --- |
| Live site | https://l3n8n-ocd.github.io/portfolio/ |
| Credential | https://internship.flyrank.ai/verify?id=FR-D11-7F2E2-34A8A&first_name=Lenon |
| Badge and analytics code | [`src/components/Footer.tsx`](https://github.com/l3n8n-ocd/portfolio/blob/main/src/components/Footer.tsx), [`FlyRankBadge.tsx`](https://github.com/l3n8n-ocd/portfolio/blob/main/src/components/FlyRankBadge.tsx), [`AnalyticsBeacon.tsx`](https://github.com/l3n8n-ocd/portfolio/blob/main/src/components/AnalyticsBeacon.tsx), [`index.html`](https://github.com/l3n8n-ocd/portfolio/blob/main/index.html) |
| Evidence | [`docs/assets/launch-audit/`](https://github.com/l3n8n-ocd/portfolio/tree/main/docs/assets/launch-audit/) |

Checked on 2026-11-21. Anything not checked is marked TODO.

---

## 1 · A clean address over HTTPS

- **Address:** `https://l3n8n-ocd.github.io/portfolio/`, served by GitHub Pages from `main` via
  `.github/workflows/deploy.yml`. No custom domain: the budget is $0, and the brief accepts the GitHub Pages
  subdomain.
- **TLS:** a `curl -v` from the build container negotiated **TLSv1.3** with `TLS_AES_128_GCM_SHA256` (X25519,
  RSASSA-PSS) and HTTP/2.
  - The certificate is `CN=*.github.io`, issued by Let's Encrypt `YR1`, SHA-256 fingerprint
    `F2:F9:A1:59:CE:50:A0:A1:68:B3:EA:EA:F2:FC:ED:5A:DD:D4:9B:A3:8E:2B:F6:32:48:F0:57:A1:39:FC:78:56`.
  - The build container intercepts some TLS traffic with its own CA, named "CCR agent-proxy interception CA".
    This certificate came from Let's Encrypt, not that CA, so the TLS 1.3 handshake is GitHub's own.
  - **TODO (Lenon):** confirm once in Chrome DevTools → Security on your own machine.
- **Canonical:** `<link rel="canonical" href="https://l3n8n-ocd.github.io/portfolio/">`.
- **Title:** `Lenon D. Adriano | Cloud Security & Full-Stack AI Engineer`.
- **Favicon:** the new `public/favicon.svg`, an "LA" monogram in the site's `#050816` and emerald `#10b981`.
  It stays sharp at 16 px. The old `favicon.jpg` (the portrait photo) is kept as the `alternate icon`.
  Vite writes both paths as `/portfolio/…` in the build.

## 2 · Free, cookie-free analytics

**What is installed:**
1. **GoatCounter** (free and open source). `index.html` loads `https://gc.zgo.at/count.js` with
   `data-goatcounter="https://lenonadriano.goatcounter.com/count"`.
   - It counts page views without cookies and without storing personal data, so the site needs no cookie
     banner.
   - `AnalyticsBeacon.tsx` also sends two kinds of GoatCounter **events**: `section/<id>` when a nav link changes
     the hash, and `theme/<dark|light>` when the theme changes.
   - GoatCounter does not count `localhost`.
2. **A local visitor counter** in the footer. It counts page views this session (`sessionStorage`), section
   jumps and theme toggles (this page load), and visits on this device (`localStorage`). It never leaves the
   browser, and the footer says so.

**What the footer shows, and how each value is read:**

| Footer text | Read from |
| --- | --- |
| `GoatCounter loaded` / `blocked by this browser` | Whether `window.goatcounter.count` exists after the script's `load` or `error` event, or after 5 s |
| `Cookie-free (0 cookies)` | `document.cookie` |
| `HTTPS` / `HTTP (local preview)` | `location.protocol` |
| page views, section jumps, theme toggles, visits | the local counters above |

**Verification** ([`flag-02-analytics-and-launch-hygiene.png`](https://github.com/l3n8n-ocd/portfolio/blob/main/docs/assets/launch-audit/flag-02-analytics-and-launch-hygiene.png)),
read from the live site:
- the script tag is in the page;
- `https://gc.zgo.at/count.js` answered `200`;
- `window.goatcounter.count` is a function;
- `document.cookie` holds 0 cookies;
- the page-view hit went to `lenonadriano.goatcounter.com/count` and got `400`, because the site does not exist
  yet (below).

In Chromium, a theme toggle moved the counter to 1, and so did a section jump.

**⚠ TODO (Lenon): create the GoatCounter site.** On 2026-11-21, `https://lenonadriano.goatcounter.com/` answered
`400 no site at this domain`.
1. Sign up free at https://www.goatcounter.com with the site code `lenonadriano`.
2. Open the dashboard and load the live portfolio once. The page view should appear within a minute.

Until then, the script loads but GoatCounter rejects the hits. That is why the footer says "GoatCounter loaded",
not "Active": the page can check the first, but only the dashboard shows the second.

## 3 · The FlyRank graduate badge

**The credential is real.** On 2026-11-21, FlyRank's verifier answered for `FR-D11-7F2E2-34A8A`:
- "Verified FlyRank document. The reference and recipient first name match an issued FlyRank document."
- D11 · Certificate of Completion, recipient Lenon Adriano, track Front-end AI Engineering, cohort July 2026.
- Internship July 1 to November 21, 2026; issued November 21, 2026.

**The badge in the footer:**
- [`FlyRankBadge.tsx`](https://github.com/l3n8n-ocd/portfolio/blob/main/src/components/FlyRankBadge.tsx) draws it: a 164×164 `#051F21` circle with `#54E399`
  rings and text, reading "FlyRank · AI Internship · Verified · Front-end AI Engineering · July 2026 Cohort ·
  FR-D11-7F2E2-34A8A".
- The SVG attributes are JSX camelCase (`strokeWidth`, `textAnchor`, `fontFamily`, `fontSize`, `fontWeight`,
  `letterSpacing`). A strict `tsc --noEmit` of the three new files passes.
- **It is built from the brief's spec, not copied from an official file.** FlyRank's public verifier publishes
  no badge artwork. To use FlyRank's own SVG, replace the `<svg>` in that one file.
- Badge and caption form **one link** to the verify URL, with `target="_blank"` and `rel="noopener noreferrer"`.
  - The link is named `Verify Lenon Adriano's FlyRank AI Internship credential`, and the SVG is `aria-hidden`.
  - The caption shows the cohort, the credential ID and "Verify Credential ↗".
- It is an outline link, not a filled button, so "Book a 15-min walkthrough" stays the page's one primary
  button (CLAUDE.md §2).

Proof: [`flag-01-footer-verified-badge.png`](https://github.com/l3n8n-ocd/portfolio/blob/main/docs/assets/launch-audit/flag-01-footer-verified-badge.png). It was
captured on the live site at 1280 px and 2x; the badge measures 164×164 CSS px.

## 4 · Launch hygiene and the phone check

| Check | Result |
| --- | --- |
| `<title>` | `Lenon D. Adriano \| Cloud Security & Full-Stack AI Engineer` |
| Favicon | `image/svg+xml /portfolio/favicon.svg` (+ `favicon.jpg` alternate) |
| Canonical | `https://l3n8n-ocd.github.io/portfolio/` |
| `og:title` / `og:description` | the title above / "I build payment flows that can't pay a borrower twice. Try the duplicate-payout demo and book a 15-minute walkthrough." |
| `og:image` | `https://l3n8n-ocd.github.io/portfolio/og-preview.png`: 1200×630, live `200`, 237,701 bytes |
| `twitter:card` | `summary_large_image` |
| 375×812 phone | 0 px horizontal overflow; the badge stays 164×164, stacked over its caption and the analytics box |
| `npm run build` | no errors or warnings |
| `npm run lint` | the same 3 existing errors (`GooeyNav.jsx` ×2, `Scanner.jsx`), and none new. ESLint does not check `.tsx` here; `tsc --strict` does. |

Proof: [`flag-02-analytics-and-launch-hygiene.png`](https://github.com/l3n8n-ocd/portfolio/blob/main/docs/assets/launch-audit/flag-02-analytics-and-launch-hygiene.png)
shows the tags and a link-preview card drawn from them.
[`flag-03-mobile-final-check-375px.png`](https://github.com/l3n8n-ocd/portfolio/blob/main/docs/assets/launch-audit/flag-03-mobile-final-check-375px.png) shows the
phone view.

All three screenshots were taken on the live site (§6).

## 5 · Where this differs from the brief

| Brief | Shipped | Why |
| --- | --- | --- |
| Edit `src/App.tsx` and `src/components/Footer.tsx` | `src/App.jsx` mounts a new `src/components/Footer.tsx` | Neither file existed. The footer was inline in `App.jsx`. |
| `public/favicon.svg` | Created; `favicon.jpg` kept as the alternate | Only the JPG existed. |
| "Install my exact official badge verbatim" | Built from the spec, swappable in one file | No official SVG was provided, and the verifier publishes none. |
| Footer: `Analytics: Active · Cookie-Free · TLS 1.3 HTTPS` | `Analytics: GoatCounter loaded · Cookie-free (0 cookies) · HTTPS` | Each word is read live. A page cannot read its TLS version, so TLS 1.3 is recorded in §1. "Active" waits for the GoatCounter site to exist (§2). |
| "visitor hits … tracked" by `sessionStorage` / `localStorage` | Labelled "stored in your browser only" | Browser storage can only count this visitor on this device. Site-wide counts are GoatCounter's job. |

## 6 · Live check after deploy

Commit `8524e4e` deployed through "Deploy to GitHub Pages" (success) and was live about 45 s after the push. Then,
against `https://l3n8n-ocd.github.io/portfolio/`:

| Check | Result |
| --- | --- |
| Page | `200`, with `goatcounter-script` in the HTML |
| `favicon.svg` | `200` |
| Footer readout | `Analytics: GoatCounter loaded · Cookie-free (0 cookies) · HTTPS` |
| GoatCounter requests | `200 https://gc.zgo.at/count.js`, `400 https://lenonadriano.goatcounter.com/count` (site not created yet) |
| Badge link | `https://internship.flyrank.ai/verify?id=FR-D11-7F2E2-34A8A&first_name=Lenon`, `target="_blank"`, `rel="noopener noreferrer"`, 164×164 |
| 375×812 | 0 px horizontal overflow |

**Still open (Lenon):**
1. Create the GoatCounter site `lenonadriano` (§2), then reload the live page and watch the dashboard.
2. Confirm TLS 1.3 in Chrome DevTools → Security on your own machine (§1).
3. If FlyRank gives you its own badge SVG, paste it into `FlyRankBadge.tsx` (§3).
