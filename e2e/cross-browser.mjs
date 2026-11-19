/**
 * FE-11 · cross-browser matrix against the production build (`next start`), or against any deployment
 * with BASE_URL=https://microcredit-api-beta.vercel.app.
 *
 * Four targets: Chromium 1280×800, Firefox 1280×800, WebKit 1280×800 (Desktop Safari's engine) and
 * WebKit at 375×812 as an iPhone (touch, 3x, iOS user agent: Mobile Safari's engine).
 * Playwright's WebKit is the engine Safari is built on, not Apple's Safari app: the doc says so.
 *
 * Per target:
 *   1. every route answers 200 with 0 page errors and 0 px horizontal overflow;
 *   2. the One Action: Simulate double-click / network retry → `201 Created`, then an idempotent replay;
 *      Reset demo, Two admins (same If-Match) → a `409 Conflict` and no second ledger entry;
 *   3. the copilot streams a reply over SSE and settles ("Reply complete.");
 *   4. the shader hero reports its state (running, or a labelled static fallback).
 * On the iPhone target only:
 *   5. every visible input, textarea and select is at least 16 px (iOS zooms the page on focus below that);
 *   6. the viewport meta allows pinch zoom, and the body's `min-h-dvh` fills the dynamic viewport.
 *
 * Needs Firefox and WebKit: `npx playwright install firefox webkit` (plus `install-deps` on Linux).
 * BROWSERS=chrome,firefox,safari,mobile picks a subset.
 * Locators are roles, labels and visible text (docs/FE-09_TESTING_PASS.md §1).
 */
import { spawn } from 'node:child_process'
import { chromium, devices, firefox, webkit } from 'playwright'

const PORT = 4193
const BASE = process.env.BASE_URL ?? `http://localhost:${PORT}`
const ROUTES = ['/', '/underwriting', '/ledger', '/advisories', '/health', '/playground', '/agent', '/motion-lab', '/3d-lab', '/shader-hero', '/portfolio']

const iphone = devices['iPhone 13']
const TARGETS = [
  { name: 'Chrome (Chromium)', type: chromium, options: { viewport: { width: 1280, height: 800 } } },
  { name: 'Firefox', type: firefox, options: { viewport: { width: 1280, height: 800 } } },
  { name: 'Desktop Safari (WebKit)', type: webkit, options: { viewport: { width: 1280, height: 800 } } },
  {
    name: 'Mobile Safari (WebKit, 375×812)',
    type: webkit,
    mobile: true,
    options: { ...iphone, viewport: { width: 375, height: 812 }, screen: { width: 375, height: 812 }, deviceScaleFactor: 3 },
  },
]

// BROWSERS=chrome,safari,mobile runs a subset (names matched case-insensitively against the target names).
const only = (process.env.BROWSERS ?? '').toLowerCase().split(',').map((name) => name.trim()).filter(Boolean)
const selected = only.length === 0 ? TARGETS : TARGETS.filter((target) => only.some((name) => target.name.toLowerCase().includes(name)))

let server = null
if (process.env.BASE_URL === undefined) {
  server = spawn('node_modules/.bin/next', ['start', '-p', String(PORT)], { stdio: 'ignore' })
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(BASE)).ok) break
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

const results = []
let failures = 0
const say = (text) => process.stdout.write(`${text}\n`)
function check(target, label, ok, detail = '') {
  results.push({ target, label, ok, detail })
  if (!ok) failures += 1
  say(`${ok ? '✓' : '✗'} ${target} · ${label}${detail === '' ? '' : `: ${detail}`}`)
}

try {
  for (const target of selected) {
    const browser = await target.type.launch()
    const context = await browser.newContext(target.options)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const label = `${target.name} ${browser.version()}`

    // 1. Routes.
    const routeProblems = []
    let smallControls = []
    for (const route of ROUTES) {
      const response = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      if (response?.status() !== 200 || overflow > 0) routeProblems.push(`${route} HTTP ${response?.status()} overflow ${overflow}px`)
      if (target.mobile) {
        const small = await page.evaluate(() =>
          [...document.querySelectorAll('input, textarea, select')]
            .filter((el) => el instanceof HTMLElement && el.offsetParent !== null && !['radio', 'checkbox', 'range', 'hidden', 'file', 'color'].includes(el.getAttribute('type') ?? ''))
            .map((el) => ({ name: el.getAttribute('aria-label') ?? el.id ?? el.tagName, size: parseFloat(getComputedStyle(el).fontSize) }))
            .filter((control) => control.size < 16),
        )
        smallControls = smallControls.concat(small.map((control) => `${route} ${control.name} ${control.size}px`))
      }
    }
    check(label, `${ROUTES.length} routes: HTTP 200, 0 px horizontal overflow`, routeProblems.length === 0, routeProblems.join('; '))

    // 2. The One Action.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Simulate double-click / network retry' }).click()
    const log = page.getByRole('region', { name: 'Request log' }).getByRole('listitem')
    await log.nth(1).waitFor({ timeout: 15_000 })
    const replay = (await log.allTextContents()).map((text) => text.replace(/\s+/g, ' '))
    check(
      label,
      'Simulate double-click: 201 Created, then an idempotent replay',
      replay.length === 2 && replay[0].includes('201 Created · posted JE-0001') && replay[1].includes('Idempotent replay of JE-0001'),
      replay.join(' | '),
    )
    await page.getByRole('button', { name: 'Reset demo' }).click()
    await page.getByRole('radio', { name: 'Two admins (same If-Match)' }).check()
    await page.getByRole('button', { name: 'Simulate double-click / network retry' }).click()
    await log.nth(1).waitFor({ timeout: 15_000 })
    const conflict = (await log.allTextContents()).map((text) => text.replace(/\s+/g, ' '))
    check(label, 'Two admins: the second request bounces with 409, no ledger entry', conflict.some((text) => /409 Conflict \(.+\) · no ledger entry/.test(text)), conflict.join(' | '))

    // 3. Copilot over SSE.
    await page.goto(`${BASE}/underwriting`, { waitUntil: 'networkidle' })
    const prompt = page.getByLabel('Ask the copilot')
    await prompt.fill('Walk me through the 10 loan states.')
    await prompt.press('Enter')
    const status = page.getByRole('status').filter({ hasText: /Copilot|Reply complete|Stopped/ })
    // Live, a hosted model may use its whole 27 s budget and then hand over to the local engine, so wait 45 s.
    let settled = ''
    try {
      await status.filter({ hasText: /^Reply complete\./ }).waitFor({ timeout: 45_000 })
      settled = (await status.filter({ hasText: /^Reply complete\./ }).textContent()) ?? ''
    } catch {
      settled = `did not settle; status lines: ${JSON.stringify((await page.getByRole('status').allTextContents()).filter(Boolean))}`
    }
    check(label, 'copilot streams over SSE and settles', settled.startsWith('Reply complete.'), settled.slice(0, 80))

    // 4. Shader hero.
    await page.goto(`${BASE}/shader-hero`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const shader = (await page.getByRole('status').filter({ hasText: /^Shader / }).textContent()) ?? ''
    check(label, 'shader hero reports a state', /^Shader (running|static-no-webgl|static-reduced-motion)\.$/.test(shader), shader)

    if (target.mobile) {
      // 5. 16 px form controls.
      check(label, 'every visible text control is at least 16 px (no iOS focus zoom)', smallControls.length === 0, smallControls.join('; ') || 'all ≥ 16 px')
      // 6. Viewport meta and dynamic viewport height.
      const meta = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '')
      check(label, 'viewport meta allows pinch zoom', meta.includes('width=device-width') && !/maximum-scale|user-scalable\s*=\s*no/.test(meta), meta)
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
      const fill = await page.evaluate(() => ({ body: document.body.getBoundingClientRect().height, inner: window.innerHeight, dvh: getComputedStyle(document.body).minHeight }))
      check(label, 'body min-height is 100dvh and fills the viewport', fill.body >= fill.inner, `min-height ${fill.dvh}, body ${Math.round(fill.body)}px ≥ viewport ${fill.inner}px`)
    }

    check(label, '0 page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await browser.close()
  }
} finally {
  server?.kill()
}

say(`\nFE-11 cross-browser: ${results.length - failures}/${results.length} checks passed against ${BASE}`)
process.exit(failures === 0 ? 0 : 1)
