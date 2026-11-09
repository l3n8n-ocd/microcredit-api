/**
 * Above-the-fold + responsiveness check for the Next.js app, in a real browser.
 *
 * 1. On `/` at phone (360×740) and laptop (1280×800), the Disburse and
 *    "Simulate double-click / network retry" buttons are fully above the fold,
 *    and Simulate produces exactly one 201 Created + one 201 Idempotent replay.
 * 2. All 5 SPEC.md routes load at 375px and 1280px with zero horizontal overflow.
 *
 * Fonts: the app self-hosts Plus Jakarta Sans / JetBrains Mono, but a low-end
 * Android phone paints the fallback first, and the fallback is TALLER. This check
 * forces DejaVu Sans (the tallest sans on the CI runner and in this image) so it
 * measures that worst case on every machine.
 *
 * Run after `npm run build` (it starts the production server itself):
 *   npm run test:e2e
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from 'playwright'

const PORT = 4173
const BASE = `http://localhost:${PORT}`
const BUTTONS = [/^Disburse$/, /^Simulate double-click \/ network retry$/]
const ROUTES = ['/', '/underwriting', '/ledger', '/advisories', '/health', '/portfolio']
const FORCE_FALLBACK = `:root{--font-plus-jakarta:'DejaVu Sans';--font-jetbrains:'DejaVu Sans Mono'}`

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, { cache: 'no-store' })
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Next server did not start on ${BASE} within ${timeoutMs}ms`)
}

const server = spawn('node_modules/.bin/next', ['start', '-p', String(PORT)], { stdio: 'ignore' })
const browser = await chromium.launch()
const failures = []

try {
  await waitForServer()

  // 1. Above-the-fold on `/`.
  for (const viewport of [
    { name: 'phone', width: 360, height: 740 },
    { name: 'laptop', width: 1280, height: 800 },
  ]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: FORCE_FALLBACK })
    await page.evaluate(() => document.fonts.ready)

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
    const created = entries.filter((t) => t.includes('201 Created')).length
    const replayed = entries.filter((t) => t.includes('201 Idempotent replay')).length
    const ok = created === 1 && replayed === 1
    process.stdout.write(`${ok ? '✓' : '✗'} ${viewport.name}: Simulate → ${created} created, ${replayed} replayed\n`)
    if (!ok) failures.push(`${viewport.name}: expected 1 created + 1 replay, got ${created} + ${replayed}`)
    await page.close()
  }

  // 2. Every route loads with no horizontal overflow at 375px and 1280px.
  for (const width of [375, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    for (const route of ROUTES) {
      const res = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
      const status = res?.status() ?? 0
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      const ok = status === 200 && overflow <= 0
      process.stdout.write(`${ok ? '✓' : '✗'} ${width}px ${route}: HTTP ${status}, horizontal overflow ${overflow}px\n`)
      if (!ok) failures.push(`${width}px ${route}: status ${status}, overflow ${overflow}px`)
    }
    await page.close()
  }
} finally {
  await browser.close()
  server.kill('SIGTERM')
  await once(server, 'exit').catch(() => {})
}

if (failures.length > 0) {
  console.error(`\nChecks failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
