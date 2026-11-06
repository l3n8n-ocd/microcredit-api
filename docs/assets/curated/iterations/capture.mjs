/**
 * Real-capture script for docs/CURATE_YOUR_IMAGES.md (kept for reproducibility, not part of the app).
 * Run after `npm run build`, with FONTS pointing at a folder that has @fontsource/plus-jakarta-sans and
 * @fontsource/jetbrains-mono installed (this container cannot reach Google Fonts):
 *   FONTS=/path/to/fonts node docs/assets/curated/iterations/capture.mjs
 */
import { chromium } from 'playwright'
import { preview } from 'vite'
import { readFileSync } from 'node:fs'
const F = process.env.FONTS + '/node_modules/@fontsource'
const faces = [
  ...[400, 500, 600, 700].map((w) => ['Plus Jakarta Sans', w, `${F}/plus-jakarta-sans/files/plus-jakarta-sans-latin-${w}-normal.woff2`]),
  ...[400, 500].map((w) => ['JetBrains Mono', w, `${F}/jetbrains-mono/files/jetbrains-mono-latin-${w}-normal.woff2`]),
]
const css = faces.map(([f, w], i) => `@font-face{font-family:'${f}';font-weight:${w};font-display:swap;src:url(https://fonts.gstatic.com/local/${i}.woff2) format('woff2')}`).join('\n')
const OUT = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
process.chdir(new URL('../../../../', import.meta.url).pathname)
const server = await preview({ preview: { port: 4177, strictPort: true }, logLevel: 'silent' })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: css }))
await page.route('https://fonts.gstatic.com/local/*', (r) => r.fulfill({ contentType: 'font/woff2', body: readFileSync(faces[Number(r.request().url().match(/(\d+)\.woff2$/)[1])][2]) }))
await page.goto('http://localhost:4177/')
await page.evaluate(() => document.fonts.ready)

const PAD = 16
const column = await page.locator('main > div').boundingBox()
async function shoot(file, top, bottom, bottomPad = PAD) {
  // boundingBox() is viewport-relative; a fullPage clip is page-relative, so add the scroll offset.
  const scrollY = await page.evaluate(() => window.scrollY)
  const a = await top.boundingBox(), b = await bottom.boundingBox()
  const y = a.y + scrollY - PAD, height = b.y + b.height - a.y + PAD + bottomPad
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true, clip: { x: column.x - PAD, y, width: column.width + 2 * PAD, height } })
  process.stdout.write(`${file}: ${Math.round((column.width + 2 * PAD) * 2)}×${Math.round(height * 2)} px\n`)
}
const heading = (name) => page.getByRole('heading', { name, exact: true })

// real-01: the Disburse card from its title to the amount field, untouched sample payout.
await shoot('real-01-disbursement-sandbox.png', heading('Disburse an approved loan'), page.getByLabel('Principal amount (PHP)'), 6)

// real-02: network retry on L-1042 (replay), then two admins on L-1043 (409).
await page.getByRole('button', { name: 'Simulate double-click / network retry' }).click()
await page.getByText('201 Idempotent replay').first().waitFor()
await page.getByLabel('Approved loan', { exact: true }).selectOption('L-1043')
await page.getByLabel('Two admins (same If-Match)').check()
await page.getByRole('button', { name: 'Simulate double-click / network retry' }).click()
await page.getByText(/409 Conflict \(VERSION_MISMATCH\)/).first().waitFor()
await shoot('real-02-idempotent-replay-conflict.png', heading('Request log'), page.getByTestId('ledger-total-credits'))

// real-03: score L-1044 (UNDER_REVIEW), then repay ₱1,000.00 on the disbursed L-1042.
await page.getByRole('button', { name: 'Review L-1044' }).click()
await page.getByLabel('Loan to repay').selectOption('L-1042')
await page.getByLabel('Repayment amount (PHP)').fill('1,000.00')
await page.getByRole('button', { name: 'Post repayment' }).click()
await page.getByText(/Posted JE-0003/).first().waitFor()
await page.getByLabel('Repayment amount (PHP)').fill('1,050.00') // preview a second split, not posted
await shoot('real-03-scoring-and-repayment-ledger.png', page.getByRole('heading', { level: 3, name: /L-1044/ }), page.getByRole('button', { name: 'Post repayment' }))
process.stdout.write(`state: ${(await page.getByTestId('ledger-assertion').innerText()).replace(/\s+/g, ' ')}\n`)
await browser.close(); await server.close()
