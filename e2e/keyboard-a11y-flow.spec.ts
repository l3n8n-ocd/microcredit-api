/**
 * FE-10 · the primary flow by keyboard alone, plus axe-core on the main routes.
 *
 * No `click()`, no `fill()`: only `page.keyboard` (Tab, Shift+Tab, Enter, Space, Escape, arrows) and
 * typing. Every element that takes focus on the way must show a focus indicator (outline or ring).
 *
 *   1. `/`: Tab → "Skip to main content", Enter → focus in <main>. Arrow keys switch the retry mode,
 *      Space on "Simulate double-click / network retry" posts once and replays once.
 *   2. Shift+Tab back to the nav, Enter on "Underwriting".
 *   3. Tab to the prompt, Enter sends. Tab reaches Stop (next after the prompt); Space stops the reply.
 *      Enter sends again; Escape stops it. A follow-up settles and the status line summarises it.
 *   4. axe-core (WCAG 2.0 / 2.1 / 2.2 A + AA, best practices) finds 0 violations on 5 routes.
 *
 * Uses the real /api/chat (the local rule engine; no API key in CI), whose replies stream over a few
 * seconds, like e2e/fold.mjs. Locators are roles, labels and visible text (docs/FE-09_TESTING_PASS.md §1).
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

interface FocusStop {
  readonly label: string
  readonly indicator: string
}

/** What has focus, and how it shows it. Fails the test if focus is invisible. */
async function focusStop(page: Page): Promise<FocusStop> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!(el instanceof HTMLElement)) return { label: '(none)', indicator: 'none' }
    const style = getComputedStyle(el)
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 ? `outline ${style.outlineWidth} ${style.outlineStyle}` : ''
    const ring = style.boxShadow !== 'none' ? 'ring (box-shadow)' : ''
    // Radios and checkboxes styled as chips show focus on their <label> (peer-focus-visible).
    const label = el.closest('label') ?? (el.id === '' ? null : document.querySelector(`label[for="${CSS.escape(el.id)}"]`))
    const labelStyle = label === null ? null : getComputedStyle(label)
    const peer = labelStyle !== null && labelStyle.outlineStyle !== 'none' && parseFloat(labelStyle.outlineWidth) > 0 ? 'outline on its label' : ''
    const own = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? '' : (el.textContent ?? '')
    const name = (el.getAttribute('aria-label') ?? (own.trim() || label?.textContent || '')).trim().replace(/\s+/g, ' ').slice(0, 40)
    return { label: `${el.tagName.toLowerCase()}${el.getAttribute('type') === null ? '' : `[${el.getAttribute('type')}]`} "${name}"`, indicator: outline || ring || peer || 'none' }
  })
}

/** Presses `key` until `target` has focus, checking every stop on the way shows focus. */
async function tabTo(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab', path: FocusStop[], max = 80): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(key)
    const stop = await focusStop(page)
    path.push(stop)
    expect(stop.indicator, `no visible focus on ${stop.label}`).not.toBe('none')
    if (await target.evaluate((el) => el === document.activeElement)) return
  }
  throw new Error(`${key} never reached the target after ${max} presses`)
}

test('the primary flow completes by keyboard alone, with visible focus at every stop', async ({ page }) => {
  test.setTimeout(90_000)
  const path: FocusStop[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  // 1. Skip link, then the disbursement sandbox.
  await page.goto('/')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to main content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  path.push(await focusStop(page))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()

  const networkRetry = page.getByRole('radio', { name: 'Network retry (same key)' })
  await tabTo(page, networkRetry, 'Tab', path)
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('radio', { name: 'Two admins (same If-Match)' })).toBeChecked()
  await page.keyboard.press('ArrowUp')
  await expect(networkRetry).toBeChecked()

  const simulate = page.getByRole('button', { name: 'Simulate double-click / network retry' })
  await tabTo(page, simulate, 'Tab', path)
  await page.keyboard.press('Space')
  const log = page.getByRole('region', { name: 'Request log' }).getByRole('listitem')
  await expect(log).toHaveCount(2)
  await expect(log.nth(0)).toContainText('201 Created · posted JE-0001')
  await expect(log.nth(1)).toContainText('201 Idempotent replay of JE-0001 · no new ledger entry')

  // 2. Back up to the nav and into /underwriting.
  await tabTo(page, page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Underwriting', exact: true }), 'Shift+Tab', path)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/underwriting$/)

  // 3. The copilot: send, Tab to Stop, Space; send, Escape; send a follow-up to the end.
  const prompt = page.getByLabel('Ask the copilot')
  const status = page.getByRole('status').filter({ hasText: /Copilot|Reply complete|Stopped/ })
  await tabTo(page, prompt, 'Tab', path)
  await page.keyboard.type('Walk me through the 10 loan states.')
  await page.keyboard.press('Enter')
  await expect(status).toHaveText(/Copilot is (thinking|replying)\./)

  await page.keyboard.press('Tab')
  const stop = page.getByRole('button', { name: 'Stop generating AI response' })
  await expect(stop).toBeFocused()
  await expect(stop).toHaveAttribute('aria-keyshortcuts', 'Escape')
  path.push(await focusStop(page))
  await expect(status).toHaveText('Copilot is replying.', { timeout: 15_000 })
  await page.keyboard.press('Space')
  await expect(status).toHaveText('Stopped. The partial reply is kept.')
  await expect(prompt).toBeFocused()

  await page.keyboard.type('Show the journal entry for ₱5,000.00.')
  await page.keyboard.press('Enter')
  await expect(status).toHaveText('Copilot is replying.', { timeout: 15_000 })
  await page.keyboard.press('Escape')
  await expect(status).toHaveText('Stopped. The partial reply is kept.')
  await expect(prompt).toBeFocused()

  await page.keyboard.type('Can a REJECTED loan be DISBURSED?')
  await page.keyboard.press('Enter')
  await expect(status).toHaveText(/^Reply complete\. \S.+/, { timeout: 30_000 })
  await expect(page.getByRole('log', { name: 'Conversation' })).toHaveAttribute('aria-live', 'off')

  expect(errors).toEqual([])
  test.info().annotations.push({ type: 'focus path', description: path.map((s) => `${s.label} [${s.indicator}]`).join(' → ') })
})

for (const route of ['/', '/underwriting', '/playground', '/motion-lab', '/3d-lab']) {
  test(`axe-core: 0 violations on ${route} at 375 px`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(route, { waitUntil: 'networkidle' })
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    const summary = results.violations.map((v) => `${v.id} (${v.impact ?? 'n/a'}) ×${v.nodes.length}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
    expect(summary).toEqual([])
    expect(results.passes.length).toBeGreaterThan(30)
  })
}
