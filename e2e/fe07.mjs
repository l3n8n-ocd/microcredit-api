#!/usr/bin/env node
/**
 * FE-07 tool UI, end to end, against the production build (`next start`).
 *
 *   npm run build && npm run test:e2e:fe07
 *
 * Drives the four tool chips on /underwriting through the real /api/chat (the
 * local engine's tool runner) and checks:
 *   - each card passes through its states in order, recorded as they render;
 *   - each result is a component (SVG chart, findings table, confirm widget);
 *   - Approve & Execute Payout double-clicked pays once, and the replay test
 *     comes back REPLAYED with one ledger entry;
 *   - output-error → Retry Tool Call with Sanitized Inputs → output-available;
 *   - zero console errors.
 * Writes the FE-07 screenshots to docs/assets/curated/. Exit 1 on any failure.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 4185
const BASE = `http://localhost:${PORT}`
const OUT = 'docs/assets/curated'

const results = []
const say = (text) => process.stdout.write(`${text}\n`)
const check = (ok, label) => {
  results.push(ok)
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
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(error.message))

// Records every state the newest card renders, as it renders it.
await page.addInitScript(() => {
  window.__toolStates = []
  window.__cardsBefore = 0
  const watch = () =>
    new MutationObserver(() => {
      const cards = [...document.querySelectorAll('[data-testid="tool-card"]')]
      // Only a card created after the last reset counts.
      if (cards.length <= window.__cardsBefore) return
      const state = cards.at(-1)?.getAttribute('data-tool-state')
      if (state && window.__toolStates.at(-1) !== state) window.__toolStates.push(state)
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tool-state'] })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true })
  else watch()
})

await page.goto(`${BASE}/underwriting`, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.locator('#copilot').scrollIntoViewIfNeeded()

const idle = page.locator('button[data-state="send"]')
const lastCard = () => page.getByTestId('tool-card').last()
const clear = async () => {
  const button = page.getByRole('button', { name: 'Clear conversation' })
  if (await button.isEnabled()) await button.click()
}
const runChip = async (label) => {
  await clear()
  await page.evaluate(() => {
    window.__toolStates = []
    window.__cardsBefore = document.querySelectorAll('[data-testid="tool-card"]').length
  })
  await page.getByRole('list', { name: 'Tool demos' }).getByRole('button', { name: label }).click()
}
const states = () => page.evaluate(() => window.__toolStates.join(' → '))
/**
 * Shot of the newest card. For the capture only, the chat grows to its content
 * height, so a card taller than the log is not cut off by the chat header.
 * The override is removed straight after.
 */
const shoot = async (name) => {
  const style = await page.addStyleTag({
    content: '#copilot { height: auto !important } #copilot [role="log"] { height: auto !important; overflow: visible !important } button.absolute.bottom-3 { visibility: hidden !important }',
  })
  await lastCard().scrollIntoViewIfNeeded()
  await lastCard().screenshot({ path: `${OUT}/${name}` })
  await style.evaluate((node) => node.remove())
}

// 1. Trust score: catch input-streaming live, then the chart.
await runChip('Run Trust Score Tool (Chart)')
await page.locator('[data-tool-state="input-streaming"] [data-arg-state="done"]').first().waitFor({ timeout: 10_000 })
await shoot('fe-07-1-input-streaming.png')
await page.locator('[data-tool-state="input-available"]').waitFor({ timeout: 10_000 })
await shoot('fe-07-2-input-available.png')
await idle.waitFor({ timeout: 30_000 })
check((await states()) === 'input-streaming → input-available → output-available', `trust score states: ${await states()}`)
const bars = await lastCard().locator('svg [data-points]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-points')))
check(bars.length === 3, `trust score: SVG chart with ${bars.length} bars (${bars.join(', ')})`)
await shoot('fe-07-3-score-chart.png')

// 2. Ledger audit table.
await runChip('Run Ledger Audit Tool (Table)')
await idle.waitFor({ timeout: 30_000 })
check((await states()) === 'input-streaming → input-available → output-available', `ledger states: ${await states()}`)
const findings = await lastCard().getByTestId('idempotency-findings').innerText()
check(findings.includes('201 CREATED') && findings.includes('201 REPLAYED'), 'ledger: first 201 CREATED, same-key retry 201 REPLAYED')
check((await lastCard().getByTestId('invariant').innerText()).startsWith('✓ Balanced'), 'ledger: Σ debits === Σ credits')
await shoot('fe-07-4-ledger-table.png')

// 3. Proposal: double-click Approve, then the replay test.
await runChip('Propose Disbursement (Confirm Tool)')
await idle.waitFor({ timeout: 30_000 })
await lastCard().getByRole('button', { name: 'Approve & Execute Payout' }).dblclick()
const receipt = lastCard().getByTestId('payout-receipt')
await receipt.waitFor()
check((await receipt.innerText()).includes('201 CREATED') && (await receipt.getByTestId('entries-for-loan').innerText()) === '1', 'confirm: double-click paid once (201 CREATED, 1 entry)')
await lastCard().getByRole('button', { name: 'Re-send the same request (replay test)' }).click()
await lastCard().getByTestId('replay-result').waitFor()
const replay = await lastCard().getByTestId('replay-result').innerText()
check(replay.includes('201 REPLAYED') && replay.includes('still 1'), `confirm: replay test → ${replay}`)
await shoot('fe-07-5-confirm-payout.png')

// 4. Error, then the sanitized retry.
await runChip('Simulate Tool Error State')
await idle.waitFor({ timeout: 30_000 })
check((await states()) === 'input-streaming → input-available → output-error', `error states: ${await states()}`)
check((await lastCard().getByTestId('tool-error-code').innerText()) === 'ERR_TOOL_SCHEMA_BOUNDS', 'error: ERR_TOOL_SCHEMA_BOUNDS')
await shoot('fe-07-6-output-error.png')
await page.evaluate(() => {
  window.__toolStates = []
  window.__cardsBefore = document.querySelectorAll('[data-testid="tool-card"]').length
})
await lastCard().getByRole('button', { name: 'Retry Tool Call with Sanitized Inputs' }).click()
await idle.waitFor({ timeout: 30_000 })
check((await states()) === 'input-streaming → input-available → output-available', `retry with sanitized inputs: ${await states()}`)
check((await lastCard().getByTestId('fallback-badge').count()) === 1, 'retry: requestedCentavos removed, fallback badge shown')

// 5. Inspector: pin the first state of a finished card.
const inspector = lastCard().getByRole('group', { name: 'Tool Lifecycle State Inspector' })
await inspector.getByRole('button', { name: /input-streaming/ }).click()
check((await lastCard().getAttribute('data-view-state')) === 'input-streaming', 'inspector: pinned a past state')
check(await inspector.getByRole('button', { name: /output-error/ }).isDisabled(), 'inspector: unreached state disabled')

check(consoleErrors.length === 0, `${consoleErrors.length} console errors`)
await browser.close()
server.kill()
const passed = results.filter(Boolean).length
say(`\nFE-07 tool UI: ${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
