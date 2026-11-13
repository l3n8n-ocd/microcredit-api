/**
 * FE-09 · The primary flow, end to end, in a real browser against `next start`.
 *
 *   1. `/` loads with the Disburse sandbox above the fold and an empty ledger.
 *   2. "Simulate double-click / network retry" posts once and replays once:
 *      Σ debits === Σ credits stays ₱5,000.00 on each side.
 *   3. `/underwriting`: a prompt to the AI copilot streams a reply with a tool
 *      card. `/api/chat` is answered by `page.route`, so no model is called.
 *   4. No `console.error` and no uncaught page error on the way.
 *
 * Locators are roles, labels and visible text only (docs/FE-09_TESTING_PASS.md §1).
 */
import { expect, test } from '@playwright/test'

const PROMPT = "Score Liza's Bigasan & Load: 92% of bills on time, 18 supplier invoices, 5 GCash top-ups a week."

const TRUST_INPUT = {
  borrowerName: "Liza's Bigasan & Load",
  businessType: 'market-vendor',
  monthlyUtilityOnTimeRatio: 92,
  supplierInvoiceCount: 18,
  gcashLoadWeeklyCadence: 5,
}

/** What `evaluateBorrowerTrustScore` returns for TRUST_INPUT (src/lib/ai/tools.ts). */
const TRUST_OUTPUT = {
  borrowerName: "Liza's Bigasan & Load",
  businessType: 'market-vendor',
  score: 798,
  maxScore: 1000,
  riskTier: 'LOW_RISK',
  pillars: [
    { id: 'utility', label: 'Utility consistency', points: 322, maxPoints: 350, basis: '92% of bills on time' },
    { id: 'supplier', label: 'Supplier history', points: 262, maxPoints: 350, basis: '18 invoices (full at 24)' },
    { id: 'gcash', label: 'GCash cadence', points: 214, maxPoints: 300, basis: '5 top-ups a week (full at 7)' },
  ],
  recommendedLimitCentavos: 2_500_000,
  requested: null,
  reasonCodes: [],
}

/** The SSE body the mocked /api/chat sends: the same frames the real route streams. */
function mockedReply(): string {
  const input = JSON.stringify(TRUST_INPUT)
  const frames = [
    { type: 'meta', engine: { kind: 'local', label: 'mocked /api/chat (Playwright)' } },
    { type: 'tool-input-start', toolCallId: 'call_e2e', toolName: 'evaluateBorrowerTrustScore', rationale: 'The request asks for a score.' },
    { type: 'tool-input-delta', toolCallId: 'call_e2e', delta: input.slice(0, 40) },
    { type: 'tool-input-delta', toolCallId: 'call_e2e', delta: input.slice(40) },
    { type: 'tool-input-available', toolCallId: 'call_e2e', toolName: 'evaluateBorrowerTrustScore', input: TRUST_INPUT },
    { type: 'tool-output-available', toolCallId: 'call_e2e', output: TRUST_OUTPUT },
    { type: 'token', text: 'Liza scores ' },
    { type: 'token', text: '**798 / 1000**' },
    { type: 'token', text: ', LOW_RISK.' },
    { type: 'done', finishReason: 'stop' },
  ]
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')
}

test('primary flow: pay once, replay bounces, the copilot answers with a tool card, no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

  const chatBodies: unknown[] = []
  await page.route('**/api/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { cancelled: false } })
    chatBodies.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: mockedReply() })
  })

  // 1. The sandbox is above the fold, and the ledger starts empty and balanced.
  await page.goto('/')
  const disburse = page.getByRole('button', { name: 'Disburse', exact: true })
  const simulate = page.getByRole('button', { name: 'Simulate double-click / network retry' })
  await expect(disburse).toBeInViewport({ ratio: 1 })
  await expect(simulate).toBeInViewport({ ratio: 1 })
  const ledger = page.getByRole('region', { name: 'Ledger (append-only)' })
  await expect(ledger.getByRole('row', { name: /^Σ \(balanced\)/ })).toContainText('₱0.00')

  // 2. One payout, one replay: the second request with the same Idempotency-Key posts nothing.
  await simulate.click()
  const log = page.getByRole('region', { name: 'Request log' }).getByRole('listitem')
  await expect(log).toHaveCount(2)
  await expect(log.nth(0)).toContainText('201 Created · posted JE-0001')
  await expect(log.nth(1)).toContainText('201 Idempotent replay of JE-0001 · no new ledger entry')
  const totals = ledger.getByRole('row', { name: /^Σ \(balanced\)/ }).getByRole('cell')
  await expect(totals).toHaveText(['₱5,000.00', '₱5,000.00'])
  await expect(page.getByRole('region', { name: 'Loans' }).getByRole('row', { name: /L-1042/ })).toContainText('DISBURSED')

  // 3. The copilot: the reply streams in with a tool card, from the mocked route.
  await page.goto('/underwriting')
  await page.getByLabel('Ask the copilot').fill(PROMPT)
  await page.getByRole('button', { name: 'Send' }).click()

  const card = page.getByRole('region', { name: 'Tool call evaluateBorrowerTrustScore: output-available' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('img', { name: 'Trust score breakdown, 3 pillars' })).toBeVisible()
  await expect(card).toContainText('₱25,000.00')
  await expect(page.getByRole('group', { name: 'Copilot reply' }).last()).toContainText('Liza scores 798 / 1000, LOW_RISK.')
  await expect(page.getByRole('status').filter({ hasText: 'Reply complete.' })).toHaveCount(1)
  expect(chatBodies).toHaveLength(1)
  expect(chatBodies[0]).toMatchObject({ messages: [{ role: 'user', content: PROMPT }] })

  // 4. Nothing logged an error.
  expect(errors).toEqual([])
})
