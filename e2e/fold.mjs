/**
 * Above-the-fold + responsiveness check for the Next.js app, in a real browser.
 *
 * 1. On `/` at phone (360×740) and laptop (1280×800), the Disburse and
 *    "Simulate double-click / network retry" buttons are fully above the fold,
 *    and Simulate produces exactly one 201 Created + one 201 Idempotent replay.
 * 2. All 5 SPEC.md routes load at 375px and 1280px with zero horizontal overflow.
 * 3. The AI Copilot on `/underwriting` (FE-06), at 375px and 1280px, against the
 *    real `/api/chat` route: tokens arrive one by one, Stop aborts the request,
 *    the server confirms it cancelled the reply, the partial reply is kept, a follow-up sends straight away, scrolling up
 *    releases auto-scroll, and the conversation survives a reload.
 * 4. `/playground` (FE-03 / FE-05), keyboard only, with the browser's real tab
 *    order: both dialogs (hand-built and shadcn/ui) trap Tab and Shift+Tab,
 *    close on Escape and return focus to their trigger; both tab sets wrap with
 *    the arrow keys and jump with Home / End; the disclosure toggles.
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
const ROUTES = ['/', '/underwriting', '/ledger', '/advisories', '/health', '/portfolio', '/playground']
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

  // 3. AI Copilot: real streaming, Stop recovery, smart auto-scroll, persistence.
  for (const width of [375, 1280]) {
    // A short viewport, so the reply outgrows the log while it is still streaming.
    const page = await browser.newPage({ viewport: { width, height: 620 } })
    const check = (ok, label) => {
      process.stdout.write(`${ok ? '✓' : '✗'} ${width}px copilot: ${label}\n`)
      if (!ok) failures.push(`${width}px copilot: ${label}`)
    }
    const aborted = []
    page.on('requestfailed', (request) => {
      if (request.url().endsWith('/api/chat')) aborted.push(request.failure()?.errorText ?? '')
    })
    // Stop also sends an explicit cancel. The server counts the ones that found
    // their request still running and aborted it (GET /api/chat).
    const matchedCancels = async () => (await (await page.request.get(`${BASE}/api/chat`)).json()).cancels.matched
    const cancelsBefore = await matchedCancels()

    await page.goto(`${BASE}/underwriting`, { waitUntil: 'networkidle' })
    const chat = page.locator('#copilot')
    const log = chat.getByRole('log')
    const lastBody = chat.getByTestId('assistant-body').last()
    const bodyLength = async () => (await lastBody.innerText()).length

    // 3a. Thinking shows inside the bubble, then tokens arrive one by one.
    await chat.getByRole('button', { name: 'Walk the 10 loan states' }).click()
    await chat.getByTestId('thinking-indicator').waitFor()
    check(await lastBody.getByTestId('thinking-indicator').isVisible(), 'thinking indicator is inside the assistant bubble')
    await chat.getByTestId('thinking-indicator').waitFor({ state: 'detached' })
    const lengths = new Set()
    for (let sample = 0; sample < 12; sample += 1) {
      lengths.add(await bodyLength())
      await page.waitForTimeout(60)
    }
    check(lengths.size >= 5, `text grew token by token (${lengths.size} distinct lengths in 12 samples)`)

    // 3b. Scroll up mid-stream: the pin is released, the pill appears, the view stays put.
    await page.waitForFunction(() => {
      const element = document.querySelector('#copilot [role="log"]')
      return element !== null && element.scrollHeight - element.clientHeight > 150
    })
    const followed = await log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)
    check(followed <= 48, `auto-scroll follows the stream while pinned (${Math.round(followed)}px from the bottom)`)
    await log.evaluate((element) => {
      element.scrollTop = 0
    })
    const pill = chat.getByRole('button', { name: /Jump to latest \(streaming/ })
    await pill.waitFor()
    await page.waitForTimeout(200)
    check((await log.evaluate((element) => element.scrollTop)) === 0, 'scrolling up releases auto-scroll while tokens keep arriving')
    await pill.click()
    const distance = await log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)
    check(distance <= 48, `"Jump to latest" returns to the bottom (${Math.round(distance)}px away)`)

    // 3c. Stop: request aborted, partial reply kept and flagged, text stops growing.
    await chat.getByRole('button', { name: 'Stop' }).click()
    await chat.getByText('[Stopped mid-stream]').waitFor()
    const stoppedAt = await bodyLength()
    await page.waitForTimeout(400)
    check(stoppedAt > 0 && (await bodyLength()) === stoppedAt, `Stop keeps the partial reply and no token lands after it (${stoppedAt} chars)`)
    check(aborted.length === 1, `Stop aborted the /api/chat request (${aborted.join(', ') || 'no aborted request seen'})`)
    const cancelsAfter = await matchedCancels()
    check(
      cancelsAfter === cancelsBefore + 1,
      `Stop's DELETE /api/chat found the running reply and the server aborted it (matched ${cancelsBefore} → ${cancelsAfter})`,
    )

    // 3d. Stop, then send again: the composer is usable at once and the next reply completes.
    const input = chat.getByLabel('Ask the copilot')
    check(await input.isEditable(), 'input is editable right after Stop')
    await input.fill('Can a REJECTED loan be DISBURSED?')
    await input.press('Enter')
    await chat.getByRole('button', { name: 'Stop' }).waitFor()
    await chat.getByRole('button', { name: 'Send' }).waitFor({ timeout: 20_000 })
    const reply = await lastBody.innerText()
    check(reply.startsWith('No.') && reply.includes('409 ILLEGAL_TRANSITION'), 'follow-up after Stop streams to completion')

    // 3e. Multi-turn context: a follow-up with no topic keyword is answered in context.
    await input.fill('and for Liza?')
    await input.press('Enter')
    await chat.getByRole('button', { name: 'Send' }).waitFor({ timeout: 20_000, state: 'attached' })
    await chat.getByText('Reply complete.').waitFor({ state: 'attached', timeout: 20_000 })
    check((await lastBody.innerText()).includes("Liza's Bigasan"), 'follow-up "and for Liza?" resolves from earlier turns')

    // 3f. A code block (the journal) must not widen the page on a phone.
    await input.fill('Show the journal entry for a ₱12,500.00 GCash disbursement.')
    await input.press('Enter')
    await chat.getByText('Reply complete.').waitFor({ state: 'detached' })
    await chat.getByText('Reply complete.').waitFor({ state: 'attached', timeout: 20_000 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check((await lastBody.innerText()).includes('1250000') && overflow <= 0, `journal code block renders with ${overflow}px horizontal overflow`)

    // 3g. Reload: the conversation comes back from localStorage. Clear removes it.
    await page.reload({ waitUntil: 'networkidle' })
    const restored = await chat.locator('[data-role]').count()
    check(restored === 8, `conversation restored after reload (${restored} of 8 messages)`)
    await chat.getByRole('button', { name: 'Clear conversation' }).click()
    const stored = await page.evaluate(() => window.localStorage.getItem('microcredit_ai_copilot_v1'))
    check((await chat.locator('[data-role]').count()) === 0 && stored === null, 'Clear conversation empties the chat and the storage key')
    await page.close()
  }

  // 4. /playground: keyboard only. No clicks from here on.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const check = (ok, label) => {
      process.stdout.write(`${ok ? '✓' : '✗'} playground: ${label}\n`)
      if (!ok) failures.push(`playground: ${label}`)
    }
    await page.goto(`${BASE}/playground`, { waitUntil: 'networkidle' })
    const focusInDialog = () =>
      page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false)

    for (const variant of ['hand-built', 'shadcn/ui']) {
      const trigger = page.getByRole('button', { name: `Review cap override (${variant})` })
      await trigger.focus()
      await page.keyboard.press('Enter')
      await page.getByRole('dialog').waitFor()
      check(await focusInDialog(), `${variant} dialog: Enter opens it and focus moves inside`)

      let stayedInside = true
      for (let press = 0; press < 8; press += 1) {
        await page.keyboard.press('Tab')
        stayedInside = stayedInside && (await focusInDialog())
      }
      for (let press = 0; press < 8; press += 1) {
        await page.keyboard.press('Shift+Tab')
        stayedInside = stayedInside && (await focusInDialog())
      }
      check(stayedInside, `${variant} dialog: 8 × Tab and 8 × Shift+Tab never leave it`)

      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      check(
        await trigger.evaluate((element) => element === document.activeElement),
        `${variant} dialog: Escape closes it and focus is back on its trigger`,
      )
    }

    for (const variant of ['hand-built', 'shadcn/ui']) {
      const tablist = page.getByRole('tablist', { name: `Loan lifecycle and ledger (${variant})` })
      await tablist.getByRole('tab', { name: 'Lifecycle' }).focus()
      // Radix moves focus inside a setTimeout, so wait for each key to land
      // before sending the next one, as a person's keystrokes would.
      const steps = [
        ['ArrowLeft', 'Concurrency'],
        ['ArrowRight', 'Lifecycle'],
        ['End', 'Concurrency'],
        ['Home', 'Lifecycle'],
        ['ArrowRight', 'Ledger'],
      ]
      const walk = []
      for (const [key, expected] of steps) {
        await page.keyboard.press(key)
        const landed = await page
          .waitForFunction(
            (name) => {
              const element = document.activeElement
              return (
                element?.getAttribute('role') === 'tab' &&
                element.getAttribute('aria-selected') === 'true' &&
                (element.textContent ?? '').trim() === name
              )
            },
            expected,
            { timeout: 2000 },
          )
          .then(() => expected)
          .catch(() => `(${key} did not reach ${expected})`)
        walk.push(landed)
      }
      check(
        walk.every((landed, index) => landed === steps[index]?.[1]),
        `${variant} tabs: ← → End Home → focus and select ${walk.join(', ')}`,
      )
      await page.keyboard.press('Tab')
      const landed = await page.evaluate(() => document.activeElement?.getAttribute('role') ?? '')
      check(landed === 'tabpanel', `${variant} tabs: Tab goes from the selected tab to its panel (landed on ${landed})`)
    }

    const summary = page.getByRole('button', { name: 'Why a retry cannot pay a borrower twice' })
    await summary.focus()
    await page.keyboard.press('Enter')
    const opened = (await summary.getAttribute('aria-expanded')) === 'true' && (await page.getByText('422 IDEMPOTENCY_KEY_REUSED').isVisible())
    await page.keyboard.press('Space')
    const closed = (await summary.getAttribute('aria-expanded')) === 'false' && !(await page.getByText('422 IDEMPOTENCY_KEY_REUSED').isVisible())
    check(opened && closed, 'disclosure: Enter shows the content, Space hides it')
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
