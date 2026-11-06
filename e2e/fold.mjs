/**
 * Above-the-fold check for the One Action (CLAUDE.md §0), in a real browser.
 *
 * On a phone (360×740) and a laptop (1280×800), the Disburse and
 * "Simulate double-click / network retry" buttons must be fully visible on the
 * first screen, with no scrolling. Then Simulate must produce exactly one
 * `201 Created` and one `201 Idempotent replay`: the second payout bounces.
 *
 * Run after `npm run build`:  npm run test:e2e
 */
import { chromium } from 'playwright'
import { preview } from 'vite'

const VIEWPORTS = [
  { name: 'phone', width: 360, height: 740 },
  { name: 'laptop', width: 1280, height: 800 },
]
const BUTTONS = [/^Disburse$/, /^Simulate double-click \/ network retry$/]

const server = await preview({ preview: { port: 4173, strictPort: true }, logLevel: 'silent' })
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:4173/'
const browser = await chromium.launch()
const failures = []

try {
  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
    await page.goto(url)

    for (const name of BUTTONS) {
      const box = await page.getByRole('button', { name }).boundingBox()
      const bottom = box === null ? Number.POSITIVE_INFINITY : box.y + box.height
      const fits = box !== null && box.y >= 0 && bottom <= viewport.height
      process.stdout.write(`${fits ? '✓' : '✗'} ${viewport.name}: ${name.source} bottom=${Math.round(bottom)}px (fold ${viewport.height}px)\n`)
      if (!fits) failures.push(`${viewport.name}: ${name.source} is not fully above the fold`)
    }

    await page.getByRole('button', { name: BUTTONS[1] }).click()
    await page.getByText(/201 Idempotent replay/).first().waitFor()
    const entries = await page.getByTestId('request-log-entry').allInnerTexts()
    const created = entries.filter((text) => text.includes('201 Created')).length
    const replayed = entries.filter((text) => text.includes('201 Idempotent replay')).length
    const ok = created === 1 && replayed === 1
    process.stdout.write(`${ok ? '✓' : '✗'} ${viewport.name}: Simulate → ${created} created, ${replayed} replayed\n`)
    if (!ok) failures.push(`${viewport.name}: expected 1 created + 1 replay, got ${created} + ${replayed}`)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}

if (failures.length > 0) {
  console.error(`\nFold check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
