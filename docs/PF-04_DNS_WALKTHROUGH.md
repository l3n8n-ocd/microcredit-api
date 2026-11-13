# PF-04 · DNS Walkthrough: from a typed address to my portfolio

- **Portfolio (live):** https://l3n8n-ocd.github.io/portfolio/. Source: https://github.com/l3n8n-ocd/portfolio
- **Capstone:** https://microcredit-api-beta.vercel.app

Every record below was looked up on 2026-11-13 through `dns.google`; nothing is made up.

## 1. What DNS does

People remember names like `l3n8n-ocd.github.io`. Routers only move packets to numbers. DNS is the
lookup that turns the name into the number before the browser asks for any HTML. For my portfolio,
the name returns four IPv4 `A` records (`185.199.108.153` through `185.199.111.153`) and four IPv6
`AAAA` records (`2606:50c0:8000::153` through `2606:50c0:8003::153`).

## 2. What a `CNAME` record is

An `A` record says "this name lives at this IP address". A `CNAME` says "this name is another name;
go look that one up". It points a name at a name, never at an address.

Cloud hosts ask for a `CNAME` on custom subdomains because they own the addresses, not you. If GitHub
moves Pages to new IPs, every `CNAME` pointing at `l3n8n-ocd.github.io` follows the change, and no
one has to edit their own DNS zone. Hardcoded `A` records would keep sending visitors to the old
addresses until someone fixes them by hand.

My portfolio has no `CNAME` today. `l3n8n-ocd.github.io` answers with `A` records directly, and I
own no custom domain. If I bought one, the record would be
`www.<my-domain>  CNAME  l3n8n-ocd.github.io`. *(TODO: `lenonadriano.dev` is not registered;
`dns.google` returned NXDOMAIN.)*

## 3. From the address bar to a `200 OK`

```text
Browser ──(1) cache miss──► Recursive resolver (ISP, 1.1.1.1 or 8.8.8.8)
                              │ (2) root ──► .io TLD ──► github.io nameservers
                              │ (3) answer: A 185.199.108.153 …, TTL 3600
Browser ◄─────────────────────┘
   │ (4) TCP + TLS to 185.199.108.153, SNI = l3n8n-ocd.github.io
   └──► GET /portfolio/  ──►  HTTP/2 200, server: GitHub.com, cache-control: max-age=600
```

1. **Cache, then resolver.** The browser and the OS check their own caches. On a miss, they ask a
   recursive resolver, which does the rest of the lookup on their behalf.
2. **Root → TLD → authoritative.** A root server points the resolver to the `.io` servers. Those
   point it to `github.io`'s own nameservers, which are NS1 (`dns1.p05.nsone.net`) and AWS Route 53
   (`ns-393.awsdns-49.com`). Those servers hold the actual records.
3. **The record.** The authoritative server returns the `A`/`AAAA` records with a `TTL` of 3600.
   Resolvers may reuse that answer for up to an hour. When the record is a `CNAME`, the resolver repeats
   the lookup for the target name until it reaches an `A`/`AAAA` record.
4. **Connect and fetch.** The browser opens TCP to one of the IPs and starts TLS. The TLS
   `ClientHello` carries `SNI: l3n8n-ocd.github.io`, so the shared server knows which site's
   certificate to present. Then the HTTP request names the host again (`Host`, or `:authority`
   in HTTP/2) and the path `/portfolio/`. GitHub answers `200` with `index.html`. That page then
   loads the built bundle, `/portfolio/assets/index-lBWDy-q7.js`, plus one CSS file.

## 4. Deployed portfolio file map (`l3n8n-ocd/portfolio`, commit `91a44a0`)

| File | What it does |
| --- | --- |
| `index.html` | Page shell: `<title>LA's Portfolio</title>`, `<div id="root">`, loads `src/main.jsx` |
| `vite.config.js` | `base: '/portfolio/'`, so asset URLs match the GitHub Pages project path; plugins `react()` and `tailwindcss()` |
| `src/main.jsx` | Mounts `<App />` into `#root` and imports `index.css` |
| `src/index.css` | `@import 'tailwindcss'` (Tailwind v4) and the base styles |
| `src/App.jsx` | Page layout and the theme: `useState` read from `localStorage['portfolio-theme']`, default `dark`. There is no `src/hooks/` folder. |
| `src/components/` | `Navbar` (theme toggle, `aria-label`), `About`, `Projects`, `Skills`, `Testimonials`, `Contact` |
| `src/Scanner.jsx`, `GooeyNav.jsx`, `LogoLoop.jsx` | WebGL background (`ogl`), nav effect, logo strip. `PillNav.jsx` is not imported anywhere, so it is not in the build. |
| `.github/workflows/deploy.yml` | On push to `main`: Node 20, `npm ci`, `vite build`, upload `dist/`, `actions/deploy-pages@v4` |

The repo is JavaScript (`.jsx`), not TypeScript.
