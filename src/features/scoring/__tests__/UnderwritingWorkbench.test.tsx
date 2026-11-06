import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { useCallback, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { toCentavos } from '../../../utils/index.ts'
import {
  createDisbursementServer,
  DisbursementForm,
  journalTotals,
  SEED_LOANS,
  type DisbursementServer,
} from '../../disbursement/index.ts'
import { UnderwritingWorkbench } from '../UnderwritingWorkbench.tsx'

afterEach(() => {
  cleanup()
})

/** Deterministic UUID v4 factory, like the Disburse form test's. */
function keyFactory(namespace = 'a'): () => string {
  let n = 0
  return () => {
    n += 1
    return `${namespace}${n.toString(16).padStart(7, '0')}-0000-4000-8000-000000000000`
  }
}

function setup(server: DisbursementServer = createDisbursementServer(SEED_LOANS), debounceMs = 0) {
  const view = render(<UnderwritingWorkbench server={server} createKey={keyFactory()} debounceMs={debounceMs} />)
  return { server, ui: within(view.container) }
}

type Ui = ReturnType<typeof setup>['ui']

/** Ledger L-1042 disbursed ₱5,000.00 to GCash before the workbench renders: DISBURSED v4. */
async function disburseL1042(server: DisbursementServer): Promise<void> {
  const response = await server.disburse({
    headers: { 'Idempotency-Key': 'f0000001-0000-4000-8000-000000000000', 'If-Match': '"3"' },
    body: { loanId: 'L-1042', provider: 'gcash', recipientMobile: '09171234567', amount: toCentavos(500_000), referenceNote: '' },
  })
  if (response.kind !== 'CREATED') throw new Error(response.kind)
}

function queueLoanIds(ui: Ui): string[] {
  const table = ui.getByRole('table', { name: 'Underwriting queue' })
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent ?? '')
}

function describedText(field: HTMLElement): string {
  return (field.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
}

describe('UnderwritingWorkbench: every control is labelled and described (CLAUDE.md §11 rule 1)', () => {
  it('binds the search box, all 8 state radios and the 3 repayment controls', () => {
    const { ui } = setup()
    const fields = [
      ui.getByLabelText('Search borrower name or loan ID'),
      ...['ALL', 'APPLIED', 'UNDER_REVIEW', 'APPROVED', 'DISBURSED', 'REPAYING', 'SETTLED', 'REJECTED'].map((state) =>
        ui.getByLabelText(state),
      ),
      ui.getByLabelText('Loan to repay'),
      ui.getByLabelText('Repayment amount (PHP)'),
      ui.getByLabelText('Repayment to reverse'),
    ]
    expect(fields).toHaveLength(12)
    for (const field of fields) {
      expect(field.getAttribute('aria-invalid')).toBe('false')
      expect(describedText(field).trim()).not.toBe('')
    }
  })

  it('names the radio group "Filter by state" so arrow keys move inside one group', () => {
    const { ui } = setup()
    const group = ui.getByRole('group', { name: 'Filter by state' })
    expect(within(group).getAllByRole('radio')).toHaveLength(8)
    expect(new Set(within(group).getAllByRole('radio').map((radio) => radio.getAttribute('name'))).size).toBe(1)
  })
})

describe('UnderwritingWorkbench: queue filter and debounced search', () => {
  it('lists all 5 seed loans with a score, and filters by state', () => {
    const { ui } = setup()
    expect(queueLoanIds(ui)).toEqual(['L-1042', 'L-1043', 'L-1044', 'L-1045', 'L-1046'])
    fireEvent.click(ui.getByLabelText('APPROVED'))
    expect(queueLoanIds(ui)).toEqual(['L-1042', 'L-1043'])
    expect(ui.getByText('Showing 2 of 5 loans.')).toBeDefined()
  })

  it('waits for the debounce before filtering by borrower name, then matches case-insensitively', async () => {
    const { ui } = setup(createDisbursementServer(SEED_LOANS), 40)
    fireEvent.change(ui.getByLabelText('Search borrower name or loan ID'), { target: { value: 'liza' } })
    // Typed, not yet applied: the list has not changed.
    expect(queueLoanIds(ui)).toHaveLength(5)
    await waitFor(() => {
      expect(queueLoanIds(ui)).toEqual(['L-1044'])
    })
    expect(ui.getByText('Showing 1 of 5 loans.').getAttribute('aria-live')).toBe('polite')
  })

  it('matches by loan ID and borrower ID too', async () => {
    const { ui } = setup()
    fireEvent.change(ui.getByLabelText('Search borrower name or loan ID'), { target: { value: 'borrower-31' } })
    await waitFor(() => {
      expect(queueLoanIds(ui)).toEqual(['L-1046'])
    })
  })
})

describe('UnderwritingWorkbench: review decisions carry Idempotency-Key + If-Match', () => {
  it('shows the score breakdown and reason codes, then approves L-1044 and announces it', async () => {
    const { server, ui } = setup()
    fireEvent.click(ui.getByRole('button', { name: 'Review L-1044' }))
    const heading = ui.getByRole('heading', { level: 3, name: /L-1044/ })
    expect(document.activeElement).toBe(heading)
    const score = ui.getByTestId('trust-score')
    expect(score.getAttribute('aria-live')).toBe('polite')
    expect(score.textContent).toBe('Trust score 702 / 1000 · LOW risk')
    expect(ui.getByText('UTIL_LATE_PAYMENTS')).toBeDefined()
    expect(ui.getByText('₱25,000.00')).toBeDefined()

    fireEvent.click(ui.getByRole('button', { name: 'Approve offer' }))
    await waitFor(() => {
      expect(ui.getByRole('status').textContent).toContain('L-1044 is now APPROVED (v3). It is now in the Disburse form.')
    })
    expect(server.listLoans().find((loan) => loan.id === 'L-1044')).toMatchObject({ status: 'APPROVED', version: 3 })
    // The Approve button is gone (APPROVED has no review action); focus stays on the panel heading.
    expect(ui.queryByRole('button', { name: 'Approve offer' })).toBeNull()
    expect(document.activeElement).toBe(ui.getByRole('heading', { level: 3, name: /L-1044/ }))
  })

  it('offers only the legal action per state, and no Approve below a score of 400', () => {
    const { ui } = setup()
    fireEvent.click(ui.getByRole('button', { name: 'Review L-1045' }))
    expect(ui.getByRole('button', { name: 'Start review' })).toBeDefined()
    expect(ui.queryByRole('button', { name: 'Approve offer' })).toBeNull()
    fireEvent.click(ui.getByRole('button', { name: 'Review L-1042' }))
    expect(ui.queryByRole('button', { name: /Start review|Approve offer|Reject/ })).toBeNull()
  })

  it('rejects with the borrower’s reason codes', async () => {
    const { server, ui } = setup()
    fireEvent.click(ui.getByRole('button', { name: 'Review L-1044' }))
    fireEvent.click(ui.getByRole('button', { name: 'Reject with reason codes' }))
    await waitFor(() => {
      expect(server.listLoans().find((loan) => loan.id === 'L-1044')).toMatchObject({
        status: 'REJECTED',
        reason: 'UTIL_LATE_PAYMENTS',
      })
    })
  })

  it('a stale second screen gets 409 VERSION_MISMATCH in its alert region', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    const first = setup(server).ui
    const second = within(render(<UnderwritingWorkbench server={server} createKey={keyFactory('b')} debounceMs={0} />).container)
    fireEvent.click(first.getByRole('button', { name: 'Review L-1044' }))
    fireEvent.click(second.getByRole('button', { name: 'Review L-1044' }))
    fireEvent.click(first.getByRole('button', { name: 'Approve offer' }))
    await waitFor(() => {
      expect(first.getByRole('status').textContent).toContain('APPROVED')
    })
    fireEvent.click(second.getByRole('button', { name: 'Reject with reason codes' }))
    await waitFor(() => {
      expect(second.getByRole('alert', { name: '' }).textContent).toContain('409 VERSION_MISMATCH')
    })
    expect(server.listLoans().find((loan) => loan.id === 'L-1044')).toMatchObject({ status: 'APPROVED' })
  })
})

/** Mirrors App.tsx: two panels, one server, each re-reads after the other changes it. */
function Screen({ server }: { readonly server: DisbursementServer }) {
  const [formRevision, setFormRevision] = useState(0)
  const [workbenchRevision, setWorkbenchRevision] = useState(0)
  const bumpForm = useCallback(() => {
    setFormRevision((value) => value + 1)
  }, [])
  const bumpWorkbench = useCallback(() => {
    setWorkbenchRevision((value) => value + 1)
  }, [])
  return (
    <>
      <DisbursementForm server={server} createKey={keyFactory('c')} revision={workbenchRevision} onServerChange={bumpForm} />
      <UnderwritingWorkbench
        server={server}
        createKey={keyFactory('d')}
        debounceMs={0}
        revision={formRevision}
        onServerChange={bumpWorkbench}
      />
    </>
  )
}

describe('UnderwritingWorkbench → Disburse form on one screen', () => {
  it('Approve offer puts L-1044 into the Disburse form’s APPROVED loan list', async () => {
    const view = within(render(<Screen server={createDisbursementServer(SEED_LOANS)} />).container)
    const options = (): (string | null)[] =>
      within(view.getByLabelText('Approved loan'))
        .getAllByRole('option')
        .map((option) => option.getAttribute('value'))
    expect(options()).toEqual(['', 'L-1042', 'L-1043'])
    fireEvent.click(view.getByRole('button', { name: 'Review L-1044' }))
    fireEvent.click(view.getByRole('button', { name: 'Approve offer' }))
    await waitFor(() => {
      expect(options()).toEqual(['', 'L-1042', 'L-1043', 'L-1044'])
    })
  })
})

describe('RepaymentPanel: centavo split, ledger invariant and reversal guard', () => {
  it('posts ₱1,000.00 as 95239 + 4761 centavos and keeps Σ debits === Σ credits', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    await disburseL1042(server)
    const { ui } = setup(server)
    fireEvent.change(ui.getByLabelText('Loan to repay'), { target: { value: 'L-1042' } })
    fireEvent.change(ui.getByLabelText('Repayment amount (PHP)'), { target: { value: '1,000.00' } })
    expect(ui.getByTestId('split-principal').textContent).toBe('₱952.39')
    expect(ui.getByTestId('split-interest').textContent).toBe('₱47.61')

    fireEvent.click(ui.getByRole('button', { name: 'Post repayment' }))
    await waitFor(() => {
      expect(ui.getByRole('status').textContent).toContain('L-1042 is now REPAYING (v5). Posted JE-0002.')
    })
    const repayment = server.getLedger().find((entry) => entry.kind === 'REPAYMENT')
    expect(repayment?.lines.map((line) => line.amount)).toEqual([100_000, 95_239, 4_761])
    expect(journalTotals(server.getLedger().flatMap((entry) => entry.lines))).toMatchObject({ balanced: true })
    const assertion = ui.getByTestId('ledger-assertion')
    expect(assertion.getAttribute('aria-live')).toBe('polite')
    expect(assertion.textContent).toBe('Ledger: Σ debits ₱6,000.00 === Σ credits ₱6,000.00 (balanced, 2 entries)')
  })

  it('on a failed submit: one alert summary, aria-invalid + error text, focus on the first invalid field', () => {
    const { ui } = setup()
    fireEvent.click(ui.getByRole('button', { name: 'Post repayment' }))
    expect(ui.getByText('Fix 2 fields before posting.').closest('[role="alert"]')).not.toBeNull()
    const loan = ui.getByLabelText('Loan to repay')
    const amount = ui.getByLabelText('Repayment amount (PHP)')
    expect(loan.getAttribute('aria-invalid')).toBe('true')
    expect(amount.getAttribute('aria-invalid')).toBe('true')
    expect(describedText(loan)).toContain('Select a DISBURSED or REPAYING loan.')
    expect(describedText(amount)).toContain('Enter an amount in pesos')
    expect(document.activeElement).toBe(loan)
  })

  it('refuses more than the payoff before sending anything', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    await disburseL1042(server)
    const { ui } = setup(server)
    fireEvent.change(ui.getByLabelText('Loan to repay'), { target: { value: 'L-1042' } })
    fireEvent.change(ui.getByLabelText('Repayment amount (PHP)'), { target: { value: '5,250.01' } })
    fireEvent.click(ui.getByRole('button', { name: 'Post repayment' }))
    expect(describedText(ui.getByLabelText('Repayment amount (PHP)'))).toContain('more than the payoff of ₱5,250.00')
    expect(document.activeElement).toBe(ui.getByLabelText('Repayment amount (PHP)'))
    expect(server.getLedger()).toHaveLength(1)
  })

  it('reverses a repayment with a mirrored entry, then no longer offers it', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    await disburseL1042(server)
    const { ui } = setup(server)
    fireEvent.change(ui.getByLabelText('Loan to repay'), { target: { value: 'L-1042' } })
    fireEvent.change(ui.getByLabelText('Repayment amount (PHP)'), { target: { value: '1,050.00' } })
    fireEvent.click(ui.getByRole('button', { name: 'Post repayment' }))
    await waitFor(() => {
      expect(ui.getByRole('status').textContent).toContain('Posted JE-0002')
    })

    fireEvent.change(ui.getByLabelText('Repayment to reverse'), { target: { value: 'JE-0002' } })
    fireEvent.click(ui.getByRole('button', { name: 'Post compensating reversal' }))
    await waitFor(() => {
      expect(ui.getByRole('status').textContent).toContain('L-1042 is now REPAYING (v6). Posted JE-0003.')
    })
    expect(server.getLedger().at(-1)).toMatchObject({ kind: 'REVERSAL', reversesEntryId: 'JE-0002' })
    const offered = within(ui.getByLabelText('Repayment to reverse'))
      .getAllByRole('option')
      .map((option) => option.getAttribute('value'))
    expect(offered).toEqual([''])
  })

  it('disables Post repayment with aria-busy while the request is in flight', async () => {
    const server = createDisbursementServer(SEED_LOANS, { latencyMs: 30 })
    await disburseL1042(server)
    const { ui } = setup(server)
    fireEvent.change(ui.getByLabelText('Loan to repay'), { target: { value: 'L-1042' } })
    fireEvent.change(ui.getByLabelText('Repayment amount (PHP)'), { target: { value: '1,050.00' } })
    fireEvent.click(ui.getByRole('button', { name: 'Post repayment' }))
    const busy = ui.getByRole('button', { name: 'Posting…' })
    expect(busy.hasAttribute('disabled')).toBe(true)
    expect(busy.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(busy)
    await waitFor(() => {
      expect(ui.getByRole('button', { name: 'Post repayment' }).hasAttribute('disabled')).toBe(false)
    })
    expect(server.getLedger().filter((entry) => entry.kind === 'REPAYMENT')).toHaveLength(1)
  })
})
