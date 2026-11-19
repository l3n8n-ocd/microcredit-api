/**
 * FE-AA3 · /shader-hero in a real browser against `next start`.
 *
 *   1. The Ledger Aurora shader compiles and runs (state "running", frames change), with no console error.
 *   2. Every line of text on the hero measures at least 7:1 against the brightest (or darkest) pixel
 *      behind it, sampled over several shader frames with the text made transparent.
 *   3. DPR is capped at 1.5 on a 3x screen: the drawing buffer is 1.5x the CSS size.
 *   4. Scrolling the hero off-screen or hiding the tab pauses it; `u_time` resumes where it stopped.
 *   5. `prefers-reduced-motion: reduce` renders the still gradient, no canvas and no loop; its text
 *      keeps the same 7:1 floor.
 *
 * Locators are roles, labels and visible text (docs/FE-09_TESTING_PASS.md §1). The canvas and pixel
 * reads go through `page.evaluate`, since a decorative, `aria-hidden` canvas has no role to query.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

const MIN_CONTRAST = 7

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

const hero = (page: Page): Locator => page.getByRole('region', { name: 'Loan disbursement flows that cannot pay a borrower twice.' })
const status = (page: Page): Locator => page.getByRole('status').filter({ hasText: /^Shader / })

/** The value next to a term in the "Live shader uniforms" readout. */
function readout(page: Page, term: string): Locator {
  return page.getByLabel('Live shader uniforms').getByText(term, { exact: true }).locator('xpath=following-sibling::dd[1]')
}

async function seconds(page: Page): Promise<number> {
  const text = (await readout(page, 'u_time').textContent()) ?? ''
  const value = Number(text.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(value)) throw new Error(`u_time readout is not a number: "${text}"`)
  return value
}

interface ContrastRow {
  readonly text: string
  readonly ratio: number
}

/**
 * For each text element in the hero: its colour (sRGB via a 2D canvas, since Tailwind v4 computes
 * oklch), then the worst pixel behind it in a screenshot taken with all hero text transparent.
 */
async function measureContrast(page: Page, rounds: number): Promise<ContrastRow[]> {
  const targets = await hero(page).evaluate((section) => {
    const toRgb = (css: string): [number, number, number] => {
      const ctx = document.createElement('canvas').getContext('2d')
      if (ctx === null) throw new Error('no 2D canvas')
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data
      return [r, g, b]
    }
    const rows: { text: string; rgb: [number, number, number]; box: { x: number; y: number; width: number; height: number } }[] = []
    for (const el of section.querySelectorAll<HTMLElement>('*')) {
      // Screen-reader-only text has no pixels; a disabled control is exempt from WCAG 1.4.3.
      if (el.closest('.sr-only') !== null || el.closest('button:disabled') !== null) continue
      const color = toRgb(getComputedStyle(el).color)
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || (node.textContent ?? '').trim() === '') continue
        // The text's own line boxes: inside padding, so borders and rounded corners are not sampled.
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const rect of range.getClientRects()) {
          if (rect.width < 2 || rect.height < 2 || rect.bottom > window.innerHeight) continue
          rows.push({
            text: (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48),
            rgb: color,
            box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          })
        }
      }
    }
    return rows
  })
  expect(targets.length).toBeGreaterThan(12)

  await page.addStyleTag({ content: 'section[aria-labelledby] * { color: transparent !important; text-shadow: none !important; }' })
  const worst = targets.map(() => Infinity)
  for (let round = 0; round < rounds; round += 1) {
    await page.waitForTimeout(400)
    // One viewport screenshot per round (the hero sits at the top, unscrolled), scored in one pass.
    const png = await page.screenshot()
    const ratios = await page.evaluate(
      async ({ base64, rows }) => {
        const lum = (r: number, g: number, b: number): number => {
          const lin = (c: number): number => {
            const s = c / 255
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
          }
          return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
        }
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d')
        if (ctx === null) throw new Error('no 2D canvas')
        ctx.drawImage(bitmap, 0, 0)
        return rows.map(({ rgb, box }) => {
          const x = Math.floor(box.x)
          const y = Math.floor(box.y)
          const data = ctx.getImageData(x, y, Math.max(1, Math.ceil(box.x + box.width) - x), Math.max(1, Math.ceil(box.y + box.height) - y)).data
          const text = lum(rgb[0], rgb[1], rgb[2])
          let min = Infinity
          for (let i = 0; i < data.length; i += 4) {
            const bg = lum(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
            min = Math.min(min, (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05))
          }
          return min
        })
      },
      { base64: png.toString('base64'), rows: targets },
    )
    ratios.forEach((ratio, index) => {
      worst[index] = Math.min(worst[index] ?? Infinity, ratio)
    })
  }
  return targets.map((target, index) => ({ text: target.text, ratio: Math.round((worst[index] ?? 0) * 100) / 100 }))
}

test('the shader compiles and runs, and every line of hero text stays at 7:1 or more over it', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = watchErrors(page)
  await page.goto('/shader-hero', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: 'Loan disbursement flows that cannot pay a borrower twice.' })).toBeVisible()
  await expect(status(page)).toHaveText('Shader running.')
  await expect(readout(page, 'state')).toHaveText('running')
  await expect(readout(page, 'u_resolution')).toHaveText(/^\d+×\d+$/)

  // The picture moves: two frames a second apart differ (a corner outside the scrim).
  const corner = { x: 8, y: 60, width: 160, height: 160 }
  const before = await page.screenshot({ clip: corner })
  await page.mouse.move(1100, 200)
  await page.waitForTimeout(1000)
  const after = await page.screenshot({ clip: corner })
  expect(before.equals(after)).toBe(false)
  await expect(readout(page, 'u_mouse')).not.toHaveText('0.50, 0.50')

  const rows = await measureContrast(page, 4)
  test.info().annotations.push({ type: 'contrast (worst pixel, 4 frames)', description: rows.map((row) => `${row.ratio}:1 "${row.text}"`).join(' · ') })
  const failing = rows.filter((row) => row.ratio < MIN_CONTRAST)
  expect(failing).toEqual([])
  expect(errors).toEqual([])
})

test('the drawing buffer is capped at 1.5x on a 3x screen', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
  const page = await context.newPage()
  await page.goto('/shader-hero', { waitUntil: 'networkidle' })
  await expect(status(page)).toHaveText('Shader running.')
  await expect(readout(page, 'DPR (cap 1.5)')).toHaveText('1.50x')
  const scale = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    return canvas === null ? null : { x: canvas.width / canvas.clientWidth, y: canvas.height / canvas.clientHeight, dpr: window.devicePixelRatio }
  })
  expect(scale?.dpr).toBe(3)
  expect(scale?.x).toBeCloseTo(1.5, 2)
  expect(scale?.y).toBeCloseTo(1.5, 2)
  await context.close()
})

test('scrolling the hero away or hiding the tab pauses it; u_time resumes where it stopped', async ({ page }) => {
  // Short enough that the notes below can push the whole hero out of view.
  await page.setViewportSize({ width: 1280, height: 400 })
  await page.goto('/shader-hero', { waitUntil: 'networkidle' })
  await expect(status(page)).toHaveText('Shader running.')
  await page.waitForTimeout(600)

  // Off-screen.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(hero(page)).not.toBeInViewport()
  await expect(status(page)).toHaveText('Shader paused (tab hidden or hero off-screen).')
  const paused = await seconds(page)
  await page.waitForTimeout(1500)
  expect(await seconds(page)).toBe(paused)

  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(status(page)).toHaveText('Shader running.')
  await page.waitForTimeout(700)
  const resumed = await seconds(page)
  expect(resumed).toBeGreaterThan(paused)
  expect(resumed).toBeLessThan(paused + 1.5)

  // Hidden tab (Playwright cannot background a tab, so emulate the visibility change).
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(status(page)).toHaveText('Shader paused (tab hidden or hero off-screen).')
  const hidden = await seconds(page)
  await page.waitForTimeout(1000)
  expect(await seconds(page)).toBe(hidden)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(status(page)).toHaveText('Shader running.')
})

test('prefers-reduced-motion renders the still gradient: no canvas, no loop', async ({ page }) => {
  const errors = watchErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/shader-hero', { waitUntil: 'networkidle' })
  await expect(status(page)).toHaveText('Shader static-reduced-motion.')
  await expect(readout(page, 'u_time')).toHaveText('not running')
  await expect(page.getByRole('button', { name: 'Static reduced-motion fallback: on' })).toBeDisabled()
  await expect(page.getByText('Your system asks for reduced motion, so the fallback stays on.')).toBeVisible()
  expect(await page.evaluate(() => document.querySelectorAll('canvas').length)).toBe(0)

  // The still gradient keeps the same 7:1 floor (one frame is enough: nothing moves). This hides the
  // hero's text colour for the rest of the test; the checks below read roles and text, not pixels.
  const rows = await measureContrast(page, 1)
  test.info().annotations.push({ type: 'contrast on the static gradient', description: rows.map((row) => `${row.ratio}:1 "${row.text}"`).join(' · ') })
  expect(rows.filter((row) => row.ratio < MIN_CONTRAST)).toEqual([])

  // Turning the OS setting off starts the shader without a reload.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(status(page)).toHaveText('Shader running.')
  const toggle = page.getByRole('button', { name: 'Static reduced-motion fallback: off' })
  await toggle.click()
  await expect(status(page)).toHaveText('Shader static-reduced-motion.')
  expect(await page.evaluate(() => document.querySelectorAll('canvas').length)).toBe(0)
  expect(errors).toEqual([])
})
