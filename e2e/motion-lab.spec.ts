/**
 * FE-AA1 · /motion-lab in a real browser against `next start`.
 *
 *   1. The Disburse button keeps one layout box in every state, and a full
 *      run (idle → loading → success → idle) records zero layout shift.
 *   2. Every animated layer transitions `transform` / `opacity` only.
 *   3. Error plays the `smart-shake` keyframes once; simulated reduced motion
 *      and the OS setting (`emulateMedia`) both turn it off.
 *   4. Keyboard only: Tab reaches the button, Enter runs it, Space retries it.
 *   5. "Fire 10 Rapid Clicks" starts one run: 1 accepted, 9 ignored.
 *   6. No `console.error` and no uncaught page error on the way.
 *
 * Locators are roles, labels and visible text only (docs/FE-09_TESTING_PASS.md §1).
 */
import { expect, test, type Page } from '@playwright/test'

const DISBURSE = 'Disburse ₱5,000.00'
const LOADING = 'Locking Idempotency-Key...'
const SUCCESS = '201 Disbursed · ₱5,000.00'
const ERROR = '409 Conflict · Retry Payout'

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

function telemetryCells(page: Page, name: string) {
  return page
    .getByRole('table', { name: /Live state and click counts/ })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name, exact: true }) })
    .getByRole('cell')
}

test('one layout box in every state, and zero layout shift across a full run', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/motion-lab')
  await page.evaluate(() => document.fonts.ready)

  const sizes: string[] = []
  for (const state of ['idle', 'loading', 'success', 'error', 'disabled'] as const) {
    await page.getByLabel(state, { exact: true }).check()
    // offsetWidth / offsetHeight: the layout box, unaffected by the shake's transform.
    const button = page.getByRole('button', { name: state === 'disabled' ? DISBURSE : { idle: DISBURSE, loading: LOADING, success: SUCCESS, error: ERROR }[state] })
    sizes.push(await button.evaluate((el) => `${(el as HTMLElement).offsetWidth}×${(el as HTMLElement).offsetHeight}`))
  }
  expect(new Set(sizes).size, `sizes per state: ${sizes.join(', ')}`).toBe(1)
  await page.getByLabel('live', { exact: true }).check()

  await page.evaluate(() => {
    const w = window as unknown as { __shift: number }
    w.__shift = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__shift += (entry as unknown as { value: number }).value
    }).observe({ type: 'layout-shift', buffered: false })
  })
  await page.getByRole('button', { name: DISBURSE }).click()
  await expect(page.getByRole('button', { name: LOADING })).toBeVisible()
  await expect(page.getByRole('button', { name: SUCCESS })).toBeVisible({ timeout: 3_000 })
  await expect(page.getByRole('button', { name: DISBURSE })).toBeVisible({ timeout: 3_000 })
  expect(await page.evaluate(() => (window as unknown as { __shift: number }).__shift)).toBe(0)
  expect(errors).toEqual([])
})

test('every animated layer transitions transform / opacity only', async ({ page }) => {
  await page.goto('/motion-lab')
  const status = page.getByText(/layers transition transform \/ opacity only/)
  await expect(status).toBeVisible()
  const text = (await status.textContent()) ?? ''
  const match = /^(\d+)\/(\d+) layers/.exec(text)
  expect(match, text).not.toBeNull()
  expect(match?.[1]).toBe(match?.[2])
  expect(Number(match?.[2])).toBeGreaterThan(0)
  expect(text).not.toContain('offenders')
})

test('error shakes once; simulated and system reduced motion both stop the shake and keep the label', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/motion-lab')
  await page.getByLabel('Force Error').check()

  await page.getByRole('button', { name: DISBURSE }).click()
  const errored = page.getByRole('button', { name: ERROR })
  await expect(errored).toBeVisible({ timeout: 3_000 })
  expect(await errored.evaluate((el) => getComputedStyle(el).animationName)).toBe('smart-shake')
  expect(await errored.evaluate((el) => getComputedStyle(el).animationIterationCount)).toBe('1')

  await page.getByLabel(/Simulate prefers-reduced-motion: reduce/).check()
  await errored.click()
  await expect(page.getByRole('button', { name: ERROR })).toBeVisible({ timeout: 3_000 })
  expect(await errored.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  await expect(page.getByText('120ms opacity crossfade (reduced motion)')).toHaveCount(2)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByLabel(/Simulate prefers-reduced-motion: reduce/).uncheck()
  await expect(page.getByText('on (system setting)')).toBeVisible()
  await errored.click()
  await expect(page.getByRole('button', { name: ERROR })).toBeVisible({ timeout: 3_000 })
  expect(await errored.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  expect(errors).toEqual([])
})

test('keyboard only: Tab reaches the button, Enter runs it, Space retries it', async ({ page }) => {
  await page.goto('/motion-lab')
  await page.getByLabel('Force Error').check()
  const disburse = page.getByRole('button', { name: DISBURSE })

  // Tab from the element before it, so the browser's own tab order is what lands focus.
  await page.getByRole('link', { name: 'Disburse page' }).focus()
  await page.keyboard.press('Tab')
  await expect(disburse).toBeFocused()
  expect(await disburse.evaluate((el) => el.matches(':focus-visible'))).toBe(true)

  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: LOADING })).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('button', { name: ERROR })).toBeVisible({ timeout: 3_000 })

  await page.getByLabel('Force Success').check()
  await page.getByRole('button', { name: ERROR }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: SUCCESS })).toBeVisible({ timeout: 3_000 })
})

test('Fire 10 Rapid Clicks starts one run: 1 accepted, 9 ignored', async ({ page }) => {
  await page.goto('/motion-lab')
  await page.getByRole('button', { name: 'Fire 10 Rapid Clicks' }).click()
  const cells = telemetryCells(page, 'Disburse')
  await expect(cells.nth(1)).toHaveText('1')
  await expect(cells.nth(2)).toHaveText('9')
  await expect(page.getByRole('button', { name: SUCCESS })).toBeVisible({ timeout: 3_000 })
})
