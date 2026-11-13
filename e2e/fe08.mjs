#!/usr/bin/env node
/**
 * FE-08 sabotage drill, end to end, against the production build (`next start`).
 *
 *   npm run build && npm run test:e2e:fe08
 *
 * Every failure state is triggered the way a reviewer would trigger it: from
 * the drill toolbar on /underwriting, which sends `x-sabotage-mode` to the real
 * /api/chat. The script asserts and measures:
 *   - zero console errors on the happy path;
 *   - Retry re-sends only the failed prompt, and a double-click sends ONE request;
 *   - 429 → countdown → retry; network-drop sends nothing; malformed → its banner;
 *   - layout shifts around the first token (normal and after the 1.5 s skeleton);
 *   - skeleton boxes vs the real boxes they stand in for (/underwriting, /health);
 *   - the render-error drill lands on underwriting/error.tsx and retry() recovers;
 *   - 404 page; at 375 px: 16 px fields, overscroll-contain, dvh-sized chat.
 * It writes the four Checkpoint 1 screenshots to docs/assets/curated/.
 * Exit code 1 if any check fails.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 4183
const BASE = `http://localhost:${PORT}`
const OUT = 'docs/assets/curated'
const PROMPT = "Evaluate sari-sari store owner Liza's trust score from her GCash load history and utility bills."

const results = []
const say = (text) => process.stdout.write(`${text}\n`)
const check = (ok, label) => {
  results.push({ ok, label })
  say(`${ok ? '✓' : '✗'} ${label}`)
}

const server = spawn('node_modules/.bin/next', ['start', '-p', String(PORT)], { stdio: 'ignore' })
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${BASE}/`)).ok) break
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500))
}

const browser = await chromium.launch()

/** Records layout shifts and the moment the newest reply shows its first real text. */
const INSTRUMENT = () => {
  window.__fe08 = { shifts: [], firstToken: null }
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__fe08.shifts.push({ t: entry.startTime, v: entry.value, input: entry.hadRecentInput })
  }).observe({ type: 'layout-shift', buffered: true })
  // Init scripts run before <body> exists: attach once the DOM is there.
  const watch = () =>
    new MutationObserver(() => {
      if (window.__fe08.firstToken !== null) return
      const body = [...document.querySelectorAll('[role="group"][aria-label="Copilot reply"]')].at(-1)
      const text = body?.textContent ?? ''
      if (body && !text.includes('Thinking…') && !text.includes('Still working') && text.trim() !== '') {
        window.__fe08.firstToken = performance.now()
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true })
  else watch()
}
const resetFirstToken = (page) => page.evaluate(() => { window.__fe08.firstToken = null })
const shiftsNearFirstToken = (page) =>
  page.evaluate(() => {
    const { shifts, firstToken } = window.__fe08
    const near = shifts.filter((s) => firstToken !== null && Math.abs(s.t - firstToken) < 250)
    // CLS-style total for the whole reply: shifts not caused by recent input (reported, not asserted).
    const after = shifts.filter((s) => firstToken !== null && s.t >= firstToken - 250 && !s.input)
    return { firstToken, sum: near.reduce((a, s) => a + s.v, 0), count: near.length, replyTotal: after.reduce((a, s) => a + s.v, 0) }
  })

const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
let chatPosts = 0
page.on('request', (request) => {
  if (request.url().endsWith('/api/chat') && request.method() === 'POST') chatPosts += 1
})

const copilot = page.locator('#copilot')
// Scoped to the conversation: Next.js's route announcer is also role="alert".
const banner = page.getByRole('log', { name: 'Conversation' }).getByRole('alert')
const input = page.getByLabel('Ask the copilot')
const sendIdle = page.getByRole('button', { name: 'Send' })
/** The drill toolbar is a <details>: open means its radio labels are visible. */
const toolbarSummary = () => page.getByText('Sabotage & Resilience Drill Toolbar')
const openToolbar = async () => {
  if (!(await page.getByLabel('off (normal)').isVisible())) await toolbarSummary().click()
}
const closeToolbar = async () => {
  if (await page.getByLabel('off (normal)').isVisible()) await toolbarSummary().click()
}
const arm = async (mode) => {
  await openToolbar()
  await page.locator(`label[for="copilot-drill-${mode}"]`).click()
}
const ask = async (text) => {
  await input.fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}
const clearChat = async () => {
  if (await page.getByRole('button', { name: 'Clear conversation' }).isEnabled()) await page.getByRole('button', { name: 'Clear conversation' }).click()
}

await page.addInitScript(INSTRUMENT)
await page.goto(`${BASE}/underwriting`, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await copilot.scrollIntoViewIfNeeded()

// ── 1. First-run onboarding ────────────────────────────────────────────────
const onboarding = page.getByRole('region', { name: 'What this copilot checks' })
check((await onboarding.isVisible()) && (await onboarding.getByRole('list', { name: 'Starter prompts' }).getByRole('button').count()) === 4, 'first run: onboarding card with 4 one-click prompts')
await copilot.screenshot({ path: `${OUT}/fe-08-1-empty-state-onboarding.png` })

// ── 2. Happy path, zero console errors, shifts at the first token ──────────
consoleErrors.length = 0
await resetFirstToken(page)
await onboarding.getByRole('button', { name: 'Walk the 10 loan states' }).click()
await sendIdle.waitFor({ timeout: 30_000 })
const happyShift = await shiftsNearFirstToken(page)
check(consoleErrors.length === 0, `happy path: ${consoleErrors.length} console errors`)
check((await banner.count()) === 0, 'happy path: no failure banner')
check(happyShift.firstToken !== null && happyShift.sum === 0, `happy path: first token ${happyShift.firstToken === null ? 'NOT SEEN' : 'seen'}, layout-shift score within 250 ms of it = ${happyShift.sum} (${happyShift.count} entries)`)
say(`  (info) layout-shift score for the rest of the reply, not from input: ${happyShift.replyTotal.toFixed(5)}`)
await copilot.screenshot({ path: `${OUT}/fe-08-2-happy-path-streaming.png` })

// ── 3. Mid-stream failure, then a double-clicked Retry ─────────────────────
await clearChat()
await arm('mid-stream-error')
await ask(PROMPT)
await banner.waitFor({ timeout: 30_000 })
const partial = await page.getByRole('group', { name: 'Copilot reply' }).last().innerText()
check((await banner.innerText()).includes('The reply stopped part-way.'), 'mid-stream: banner kind mid-stream')
check(partial.trim().length > 20, `mid-stream: partial reply kept (${partial.trim().length} chars)`)
const retry = banner.getByRole('button')
const retryLabel = await retry.innerText()
check(retryLabel.startsWith('Retry failed prompt: “Evaluate sari-sari'), `mid-stream: Retry names the prompt: ${retryLabel}`)
check((await page.getByLabel('off (normal)').isChecked()), 'drill disarmed itself after one request')
await closeToolbar()
await page.screenshot({ path: `${OUT}/fe-08-3-mid-stream-error-retry.png`, clip: await copilot.boundingBox() })
const before = chatPosts
await retry.dblclick()
await sendIdle.waitFor({ timeout: 30_000 })
check(chatPosts - before === 1, `retry double-click sent ${chatPosts - before} request(s)`)
check((await banner.count()) === 0, 'retry recovered: banner gone')
// Top-level turns only: the conversation's first list. A reply's own Markdown bullets are not turns.
const roles = await page
  .getByRole('log', { name: 'Conversation' })
  .getByRole('list')
  .first()
  .evaluate((list) =>
    [...list.children].map((item) => (item.querySelector('[role="group"][aria-label="Copilot reply"]') ? 'assistant' : 'user')).join(','),
  )
check(roles === 'user,assistant', `retry replaced the failed reply in place (${roles})`)

// ── 4. 429 with Retry-After, and the empty filter ──────────────────────────
await clearChat()
await arm('rate-limit-429')
await ask(PROMPT)
await banner.waitFor()
const rateText = await banner.innerText()
check(rateText.includes('Rate limit reached (HTTP 429).') && rateText.includes('Retry-After:'), 'rate limit: banner with Retry-After countdown')
check(await banner.getByRole('button').isDisabled(), 'rate limit: Retry locked during the countdown')
await closeToolbar()
const rateShot = await copilot.screenshot()
await page.waitForFunction(() => !document.querySelector('[role="log"] [role="alert"]')?.textContent?.includes('Retry-After'), null, { timeout: 10_000 })
const before429 = chatPosts
await banner.getByRole('button').click()
await sendIdle.waitFor({ timeout: 30_000 })
check(chatPosts - before429 === 1 && (await banner.count()) === 0, 'rate limit: Retry enabled at 0 s and recovered')

const search = page.getByLabel('Search borrower name or loan ID')
await search.scrollIntoViewIfNeeded()
await search.fill('zzz-nobody')
const empty = page.getByRole('region', { name: 'No loans match this view.' })
await empty.waitFor()
check((await empty.innerText()).includes('“zzz-nobody”'), 'empty filter: names the query')
const workbench = page.locator('section', { has: page.getByRole('heading', { name: 'Underwriting workbench' }) }).first()
const emptyBox = await workbench.boundingBox()
const emptyShot = await page.screenshot({ clip: { x: emptyBox.x, y: emptyBox.y, width: emptyBox.width, height: Math.min(emptyBox.height, 640) } })
const resetButton = empty.getByRole('button', { name: /^Reset filters & show all loans \(\d+\)$/ })
check(await resetButton.isVisible(), `empty filter: ${await resetButton.innerText()}`)
await resetButton.click()
check((await empty.count()) === 0 && (await page.getByRole('button', { name: /^Review / }).count()) > 0, 'empty filter: reset shows the queue again')

// Screenshot 4 is a side-by-side of the two captures above, built in the browser.
const shotPage = await context.newPage()
await shotPage.setContent(`<!doctype html><body style="margin:0;background:#f8fafc;font:14px system-ui;color:#0f172a">
  <div style="display:flex;gap:16px;padding:16px;align-items:flex-start">
    <figure style="margin:0;flex:1"><figcaption style="margin-bottom:8px;font-weight:600">429 drill: Retry-After countdown, Retry locked</figcaption><img style="width:100%;border:1px solid #1e293b" src="data:image/png;base64,${rateShot.toString('base64')}"></figure>
    <figure style="margin:0;flex:1"><figcaption style="margin-bottom:8px;font-weight:600">Zero results: names the filter, one-click reset</figcaption><img style="width:100%;border:1px solid #1e293b" src="data:image/png;base64,${emptyShot.toString('base64')}"></figure>
  </div></body>`)
await shotPage.setViewportSize({ width: 1280, height: 720 })
await shotPage.screenshot({ path: `${OUT}/fe-08-4-rate-limit-and-empty-filter.png`, fullPage: true })
await shotPage.close()

// ── Other drills ───────────────────────────────────────────────────────────
await copilot.scrollIntoViewIfNeeded()
await clearChat()
const beforeDrop = chatPosts
await arm('network-drop')
await ask(PROMPT)
await banner.waitFor()
check((await banner.innerText()).includes('No connection. Nothing was sent.') && chatPosts === beforeDrop, `network-drop: offline banner, ${chatPosts - beforeDrop} requests sent`)
await banner.getByRole('button').click()
await sendIdle.waitFor({ timeout: 30_000 })
check((await banner.count()) === 0, 'network-drop: Retry sent it and recovered')

await clearChat()
await arm('malformed-tool-json')
await ask(PROMPT)
await banner.waitFor({ timeout: 30_000 })
check((await banner.innerText()).includes('A reply frame was not valid JSON.'), 'malformed-tool-json: malformed banner, partial kept')

await clearChat()
await arm('slow-3s')
await resetFirstToken(page)
await ask('Walk me through the 10 loan states.')
await page.getByText('Still working: no first token after 1.5 s.').waitFor({ timeout: 2500 })
check(true, 'slow-3s: skeleton shown after 1.5 s with no token')
await sendIdle.waitFor({ timeout: 30_000 })
const slowShift = await shiftsNearFirstToken(page)
check(slowShift.firstToken !== null && slowShift.sum === 0, `slow-3s: first token ${slowShift.firstToken === null ? 'NOT SEEN' : 'seen'}, layout-shift score within 250 ms of it = ${slowShift.sum} (${slowShift.count} entries)`)
say(`  (info) layout-shift score for the rest of the slow reply, not from input: ${slowShift.replyTotal.toFixed(5)}`)

// ── Route boundaries ───────────────────────────────────────────────────────
await openToolbar()
await page.getByRole('button', { name: /Throw a render error/ }).click()
const boundaryHeading = page.getByRole('heading', { name: 'The underwriting screen hit an error.' })
await boundaryHeading.waitFor()
check((await page.getByText('error boundary: underwriting').count()) === 1, `render-error drill caught by underwriting/error.tsx (code ${await page.getByText(/^ERR_ROUTE_/).innerText()})`)
check(await boundaryHeading.evaluate((el) => document.activeElement === el), 'error boundary: focus moved to its heading')
await page.getByRole('button', { name: 'Retry this page' }).click()
await page.getByRole('heading', { name: /AI Underwriting/ }).waitFor()
check(true, 'error boundary: retry() re-rendered the copilot')

const notFound = await page.goto(`${BASE}/no-such-page`)
check(notFound.status() === 404 && (await page.getByText('HTTP_404', { exact: true }).count()) === 1, 'not-found.tsx: HTTP 404 page')

// ── Skeletons vs real boxes (client navigation with the RSC payload delayed) ──
async function compareSkeleton(fromPath, linkName, skeletonSelector, realSelector) {
  const nav = await context.newPage()
  await nav.goto(`${BASE}${fromPath}`, { waitUntil: 'networkidle' })
  let released
  const gate = new Promise((resolve) => { released = resolve })
  await nav.route((url) => url.searchParams.has('_rsc'), async (route) => {
    await gate
    await route.continue()
  })
  await nav.getByRole('navigation').getByRole('link', { name: linkName, exact: true }).click()
  const skeleton = nav.locator(skeletonSelector).first()
  let skeletonHeight = null
  try {
    await skeleton.waitFor({ timeout: 5000 })
    skeletonHeight = (await skeleton.boundingBox()).height
  } catch {}
  released()
  await nav.locator(realSelector).first().waitFor({ timeout: 15_000 })
  const realHeight = (await nav.locator(realSelector).first().boundingBox()).height
  await nav.close()
  return { skeletonHeight, realHeight }
}
const cards = await compareSkeleton('/', 'Underwriting', '[data-skeleton="score-card"]', 'main dl > div')
check(cards.skeletonHeight !== null && Math.abs(cards.skeletonHeight - cards.realHeight) <= 1, `score-card skeleton ${cards.skeletonHeight}px vs real stat card ${cards.realHeight}px`)
const rows = await compareSkeleton('/', 'Health', '[data-skeleton="ledger-row"]', 'main table tbody tr')
check(rows.skeletonHeight !== null && Math.abs(rows.skeletonHeight - rows.realHeight) <= 1, `ledger-row skeleton ${rows.skeletonHeight}px vs real health row ${rows.realHeight}px`)

// ── 375 px: Mobile Safari hardening ────────────────────────────────────────
const phone = await browser.newPage({ viewport: { width: 375, height: 667 } })
await phone.goto(`${BASE}/underwriting`, { waitUntil: 'networkidle' })
const mobile = await phone.evaluate(() => {
  const fields = [...document.querySelectorAll('input, textarea, select')].filter(
    (el) => !['radio', 'checkbox', 'hidden'].includes(el.type) && el.offsetParent !== null,
  )
  const log = document.querySelector('[role="log"]')
  const chat = document.querySelector('#copilot')
  return {
    small: fields.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.id),
    fields: fields.length,
    overscroll: getComputedStyle(log).overscrollBehaviorY,
    chatHeight: chat.getBoundingClientRect().height,
    viewport: window.innerHeight,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
})
check(mobile.small.length === 0, `375px: ${mobile.fields} text fields, ${mobile.small.length} under 16px`)
check(mobile.overscroll === 'contain', `375px: transcript overscroll-behavior-y = ${mobile.overscroll}`)
check(mobile.chatHeight <= mobile.viewport, `375px: copilot ${Math.round(mobile.chatHeight)}px fits a ${mobile.viewport}px viewport (100dvh - 4rem)`)
check(mobile.overflow === 0, `375px: horizontal overflow ${mobile.overflow}px`)
await phone.close()

await browser.close()
server.kill()
const failed = results.filter((r) => !r.ok)
say(`\nFE-08 drill: ${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
