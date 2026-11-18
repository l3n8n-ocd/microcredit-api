/**
 * FE-AA2 · /3d-lab and the `/` inspector card in a real browser against `next start`.
 *
 *   1. `/` and `/underwriting` download 0 bytes of Three.js; `/` fetches it only after
 *      "Load the 3D inspector" is pressed.
 *   2. /3d-lab renders the WebGL terminal; the FE-10 lens reports frames, triangles and one lazy chunk.
 *   3. DPR is clamped to 1.5 on a 3x screen, and the canvas has `touch-action: none`.
 *   4. The sample .glb downloads and loads back through the file input and through a drop.
 *   5. The static switch and `prefers-reduced-motion` render the SVG blueprint and no WebGL; leaving
 *      the canvas loses its WebGL context (everything disposed).
 *   6. No console error on the way.
 *
 * Locators are roles, labels and visible text only (docs/FE-09_TESTING_PASS.md §1).
 */
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const THREE_MARKER = 'WebGLRenderer'

function watch(page: Page): { errors: string[]; threeScripts: string[] } {
  const errors: string[] = []
  const threeScripts: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', async (response) => {
    if (response.request().resourceType() !== 'script') return
    try {
      if ((await response.text()).includes(THREE_MARKER)) threeScripts.push(response.url())
    } catch {
      // body gone (navigation); not a Three.js chunk we need to count
    }
  })
  return { errors, threeScripts }
}

const lens = (page: Page) => page.getByRole('region', { name: 'FE-10 Performance Lens' })
const canvas = (page: Page) => page.getByRole('img', { name: /3D MicroCredit POS terminal/ })

test('/ and /underwriting ship 0 KB of Three.js; / loads it only on demand', async ({ page }) => {
  const seen = watch(page)
  await page.goto('/underwriting', { waitUntil: 'networkidle' })
  expect(seen.threeScripts).toEqual([])

  await page.goto('/', { waitUntil: 'networkidle' })
  expect(seen.threeScripts).toEqual([])
  const card = page.getByRole('region', { name: '3D Hardware POS & Ledger Vault Inspector' })
  await card.getByRole('button', { name: 'Simulate 201 Disbursed' }).click()
  await expect(card.getByRole('img', { name: /201 Disbursed/ })).toBeVisible()
  expect(seen.threeScripts).toEqual([])

  await card.getByRole('button', { name: 'Load the 3D inspector' }).click()
  await expect(card.getByRole('img', { name: /3D MicroCredit POS terminal/ })).toBeVisible()
  await expect.poll(() => seen.threeScripts.length).toBe(1)
  expect(seen.errors).toEqual([])
})

test('/3d-lab renders WebGL and the FE-10 lens reports frames, geometry and one lazy chunk', async ({ page }) => {
  const seen = watch(page)
  await page.goto('/3d-lab', { waitUntil: 'networkidle' })
  await expect(canvas(page)).toBeVisible()
  await expect(lens(page).getByText(/^\d+$/).first()).toBeVisible({ timeout: 5_000 })
  await expect(lens(page).getByText(/^\d+ · [\d,]+$/)).toBeVisible()
  await expect(lens(page).getByText(/compressed \(.+ of JavaScript\) in 1 file,/)).toBeVisible()
  expect(seen.threeScripts).toHaveLength(1)
  expect(await canvas(page).evaluate((el) => getComputedStyle(el).touchAction)).toBe('none')

  await page.getByRole('button', { name: 'Simulate 409 Conflict' }).click()
  await expect(canvas(page)).toHaveAccessibleName(/409 Conflict/)
  expect(seen.errors).toEqual([])
})

test('a 3x screen renders at 1.5x', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true })
  const page = await context.newPage()
  await page.goto('/3d-lab', { waitUntil: 'networkidle' })
  await expect(lens(page).getByText('1.5x of 3x')).toBeVisible({ timeout: 5_000 })
  const ratio = await canvas(page).evaluate((el) => (el as HTMLCanvasElement).width / el.clientWidth)
  expect(ratio).toBeCloseTo(1.5, 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
  await context.close()
})

test('the sample .glb downloads, then loads back through the file input and a drop', async ({ page }) => {
  const seen = watch(page)
  await page.goto('/3d-lab', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Generate & load sample .glb' }).click()
  await expect(page.getByText(/Loaded microcredit-pos-sample\.glb: [\d.]+ KB, [\d,]+ triangles/)).toBeVisible({ timeout: 10_000 })

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /Download the sample \.glb/ }).click(),
  ])
  const path = await download.path()
  const bytes = await readFile(path)
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('glTF')

  await page.getByRole('button', { name: 'Back to the POS terminal' }).click()
  await expect(page.getByText(/Showing the procedural POS terminal/)).toBeVisible()

  await page.getByLabel('Load a .glb or .gltf file').setInputFiles({ name: 'from-disk.glb', mimeType: 'model/gltf-binary', buffer: bytes })
  await expect(page.getByText(/Loaded from-disk\.glb: /)).toBeVisible({ timeout: 10_000 })

  const dropzone = page.getByRole('region', { name: '3D viewport' })
  const data = await page.evaluateHandle((b64) => {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([raw], 'dropped.glb', { type: 'model/gltf-binary' }))
    return transfer
  }, bytes.toString('base64'))
  await dropzone.dispatchEvent('dragover', { dataTransfer: data })
  await dropzone.dispatchEvent('drop', { dataTransfer: data })
  await expect(page.getByText(/Loaded dropped\.glb: /)).toBeVisible({ timeout: 10_000 })
  expect(seen.errors).toEqual([])
})

test('the static switch swaps in the SVG blueprint and loses the WebGL context', async ({ page }) => {
  await page.goto('/3d-lab', { waitUntil: 'networkidle' })
  await expect(canvas(page)).toBeVisible()
  const gl = await canvas(page).evaluateHandle((el) => (el as HTMLCanvasElement).getContext('webgl2'))

  await page.getByLabel('Static blueprint (reduced motion / low power)').check()
  await expect(page.getByRole('img', { name: /Isometric blueprint of the MicroCredit POS terminal/ })).toBeVisible()
  await expect(canvas(page)).toHaveCount(0)
  await expect(lens(page).getByText('WebGL not mounted · 0 KB of Three.js requested · 0 frames rendered')).toBeVisible()
  expect(await gl.evaluate((context) => context?.isContextLost() ?? null)).toBe(true)

  await page.getByLabel('Static blueprint (reduced motion / low power)').uncheck()
  await expect(canvas(page)).toBeVisible()
})

test('prefers-reduced-motion renders the blueprint and never downloads Three.js', async ({ page }) => {
  const seen = watch(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/3d-lab', { waitUntil: 'networkidle' })
  await expect(page.getByRole('img', { name: /Shown because the system asks for reduced motion/ })).toBeVisible()
  await expect(canvas(page)).toHaveCount(0)
  await expect(page.getByLabel('Static blueprint (reduced motion / low power)')).toBeDisabled()
  expect(seen.threeScripts).toEqual([])
  expect(seen.errors).toEqual([])
})
