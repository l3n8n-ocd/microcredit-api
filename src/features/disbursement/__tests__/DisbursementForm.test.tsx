import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isUuidV4 } from '../../../utils/index.ts'
import { DisbursementForm } from '../DisbursementForm.tsx'
import { createDisbursementServer, type DisbursementServer } from '../disbursementServer.ts'
import { accountBalance, journalTotals } from '../ledger.ts'
import { SAMPLE_PAYOUT, SEED_LOANS } from '../seedLoans.ts'

afterEach(() => {
  cleanup()
})

/**
 * Deterministic UUID v4 factory: 00000001-0000-4000-8000-000000000000, 00000002-…
 * `namespace` (one hex digit) keeps two screens sharing one server from colliding.
 */
function keyFactory(namespace = '0'): () => string {
  let n = 0
  return () => {
    n += 1
    return `${namespace}${n.toString(16).padStart(7, '0')}-0000-4000-8000-000000000000`
  }
}

function setup(server: DisbursementServer = createDisbursementServer(SEED_LOANS), namespace = '0') {
  const view = render(<DisbursementForm server={server} createKey={keyFactory(namespace)} />)
  return { server, ui: within(view.container) }
}

type Ui = ReturnType<typeof setup>['ui']

interface Fill {
  loanId?: string
  provider?: string
  recipientMobile?: string
  amount?: string
  dailyCap?: string
  referenceNote?: string
}

function fill(ui: Ui, values: Fill = {}): void {
  fireEvent.change(ui.getByLabelText('Approved loan'), { target: { value: values.loanId ?? 'L-1042' } })
  fireEvent.change(ui.getByLabelText('Wallet provider'), { target: { value: values.provider ?? 'gcash' } })
  fireEvent.change(ui.getByLabelText('Recipient mobile number'), {
    target: { value: values.recipientMobile ?? '09171234567' },
  })
  fireEvent.change(ui.getByLabelText('Principal amount (PHP)'), { target: { value: values.amount ?? '5,000.00' } })
  if (values.dailyCap !== undefined) {
    fireEvent.change(ui.getByLabelText('Max daily disbursement cap (PHP)'), { target: { value: values.dailyCap } })
  }
  if (values.referenceNote !== undefined) {
    fireEvent.change(ui.getByLabelText('Reference note (optional)'), { target: { value: values.referenceNote } })
  }
}

function disburseButton(ui: Ui): HTMLElement {
  return ui.getByRole('button', { name: /^Disburs/ })
}

function errorTextFor(field: HTMLElement): string {
  const ids = (field.getAttribute('aria-describedby') ?? '').split(' ')
  const errorId = ids.find((id) => id.endsWith('-error'))
  return errorId === undefined ? '' : (document.getElementById(errorId)?.textContent ?? '')
}

describe('DisbursementForm: APPROVED → DISBURSED with a balanced centavo journal', () => {
  it('disburses once, posts Σ debits === Σ credits, and bumps the loan version', async () => {
    const { server, ui } = setup()
    fill(ui)
    fireEvent.click(disburseButton(ui))

    expect(disburseButton(ui).hasAttribute('disabled')).toBe(true)
    expect(disburseButton(ui).getAttribute('aria-busy')).toBe('true')

    await waitFor(() => {
      expect(ui.getByRole('status').textContent).toContain('201 Created · posted JE-0001')
    })

    const ledger = server.getLedger()
    expect(ledger).toHaveLength(1)
    const entry = ledger[0]
    expect(entry?.lines).toEqual([
      { account: 'loans_receivable:borrower-42', side: 'DEBIT', amount: 500000 },
      { account: 'wallet_clearing:gcash', side: 'CREDIT', amount: 500000 },
    ])
    expect(journalTotals(entry?.lines ?? [])).toEqual({ debits: 500000, credits: 500000, balanced: true })
    expect(server.listLoans().find((loan) => loan.id === 'L-1042')).toMatchObject({ status: 'DISBURSED', version: 4 })

    expect(ui.getByTestId('ledger-total-debits').textContent).toBe('₱5,000.00')
    expect(ui.getByTestId('ledger-total-credits').textContent).toBe('₱5,000.00')
    expect(disburseButton(ui).getAttribute('aria-busy')).toBe('false')
    // The UI never offers an illegal transition: L-1042 is no longer selectable.
    const options = within(ui.getByLabelText('Approved loan')).getAllByRole('option')
    expect(options.map((option) => option.getAttribute('value'))).toEqual(['', 'L-1043'])
  })

  it('previews the balanced journal entry live from loan + provider + amount', () => {
    const { ui } = setup()
    fill(ui, { provider: 'maya', amount: '12,300' })

    const preview = ui.getByRole('region', { name: 'Request & journal preview' })
    expect(preview.textContent).toContain('DR loans_receivable:borrower-42 ₱12,300.00')
    expect(preview.textContent).toContain('CR wallet_clearing:maya ₱12,300.00')
    expect(preview.textContent).toContain('Σ debits ₱12,300.00 = Σ credits ₱12,300.00 (balanced)')
    expect(preview.textContent).toContain('If-Match"3"')
  })

  it('only offers APPROVED loans', () => {
    const { ui } = setup()
    const options = within(ui.getByLabelText('Approved loan')).getAllByRole('option')
    expect(options.map((option) => option.getAttribute('value'))).toEqual(['', 'L-1042', 'L-1043'])
  })
})

describe('DisbursementForm: duplicates never double-credit the borrower', () => {
  it('sends exactly one request when Disburse is double-clicked', async () => {
    const { server, ui } = setup()
    const spy = vi.spyOn(server, 'disburse')
    fill(ui)

    fireEvent.click(disburseButton(ui))
    fireEvent.click(disburseButton(ui))

    await waitFor(() => {
      expect(ui.getByRole('status').textContent).toContain('201 Created')
    })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(server.getLedger()).toHaveLength(1)
  })

  it('replays a network retry with the same Idempotency-Key instead of posting twice', async () => {
    const { server, ui } = setup()
    fill(ui)
    fireEvent.click(ui.getByRole('button', { name: 'Simulate double-click / network retry' }))

    await waitFor(() => {
      expect(ui.getAllByTestId('request-log-entry')).toHaveLength(2)
    })
    const [first, second] = ui.getAllByTestId('request-log-entry')
    expect(first?.textContent).toContain('201 Created · posted JE-0001')
    expect(second?.textContent).toContain('201 Idempotent replay of JE-0001 · no new ledger entry')
    expect(first?.textContent).toContain('Idempotency-Key: 00000005-0000-4000-8000-000000000000')
    expect(second?.textContent).toContain('Idempotency-Key: 00000005-0000-4000-8000-000000000000')

    expect(server.getLedger()).toHaveLength(1)
    expect(accountBalance(server.getLedger(), 'loans_receivable:borrower-42')).toBe(500000)
    expect(ui.getByTestId('ledger-total-debits').textContent).toBe('₱5,000.00')
  })

  it('rejects the second of two admins (new key, same If-Match) with 409 and no second entry', async () => {
    const { server, ui } = setup()
    fill(ui)
    fireEvent.click(ui.getByLabelText('Two admins (same If-Match)'))
    fireEvent.click(ui.getByRole('button', { name: 'Simulate double-click / network retry' }))

    await waitFor(() => {
      expect(ui.getByRole('alert').textContent).toContain('Request 2: 409 Conflict (VERSION_MISMATCH)')
    })
    expect(server.getLedger()).toHaveLength(1)
    expect(accountBalance(server.getLedger(), 'loans_receivable:borrower-42')).toBe(500000)
  })

  it('rejects a stale If-Match from a second admin screen loaded before the payout', async () => {
    const server = createDisbursementServer(SEED_LOANS)
    const adminA = setup(server, 'a').ui
    const adminB = setup(server, 'b').ui
    fill(adminA)
    fill(adminB, { provider: 'maya' })

    fireEvent.click(disburseButton(adminA))
    await waitFor(() => {
      expect(adminA.getByRole('status').textContent).toContain('201 Created')
    })

    fireEvent.click(disburseButton(adminB))
    await waitFor(() => {
      expect(adminB.getByRole('alert').textContent).toContain('409 Conflict (VERSION_MISMATCH)')
    })
    expect(server.getLedger()).toHaveLength(1)
    expect(accountBalance(server.getLedger(), 'wallet_clearing:maya')).toBe(0)
  })

  it('issues a new UUID v4 Idempotency-Key when the payload (intent) changes', () => {
    const { ui } = setup()
    const keyCell = (): string => {
      const term = ui.getByText('Idempotency-Key', { selector: 'dt' })
      return term.nextElementSibling?.textContent ?? ''
    }
    fill(ui)
    const before = keyCell()
    expect(isUuidV4(before)).toBe(true)
    fireEvent.change(ui.getByLabelText('Principal amount (PHP)'), { target: { value: '6,000.00' } })
    expect(keyCell()).not.toBe(before)
    expect(isUuidV4(keyCell())).toBe(true)
  })
})

describe('DisbursementForm: validation and accessibility', () => {
  const FIELD_LABELS = [
    'Approved loan',
    'Wallet provider',
    'Recipient mobile number',
    'Principal amount (PHP)',
    'Max daily disbursement cap (PHP)',
    'Reference note (optional)',
  ]

  it.each(FIELD_LABELS)('binds "%s" with <label htmlFor>, aria-invalid and a hint via aria-describedby', (name) => {
    const { ui } = setup()
    const field = ui.getByLabelText(name)
    const label = ui.getByText(name, { selector: 'label' })

    expect(label.getAttribute('for')).toBe(field.id)
    expect(field.getAttribute('aria-invalid')).toBe('false')
    const hintId = field.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(hintId)?.textContent).not.toBe('')
  })

  it.each([
    ['0817123456', 'too short and wrong prefix'],
    ['08171234567', 'wrong prefix'],
    ['0917123456', '10 digits'],
    ['+639171234567', 'international format'],
    ['0917-123-456', 'punctuation'],
  ])('rejects mobile %s (%s) and links the error with aria-describedby', (mobile) => {
    const { server, ui } = setup()
    const spy = vi.spyOn(server, 'disburse')
    fill(ui, { recipientMobile: mobile })
    fireEvent.click(disburseButton(ui))

    const field = ui.getByLabelText('Recipient mobile number')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(errorTextFor(field)).toContain('11-digit mobile number that starts with 09')
    expect(ui.getByRole('alert').textContent).toContain('Fix 1 field before disbursing.')
    expect(document.activeElement).toBe(field)
    expect(spy).not.toHaveBeenCalled()
  })

  it.each([
    ['499', 'Enter an amount from ₱500.00 to ₱50,000.00.'],
    ['50,000.01', 'Enter an amount from ₱500.00 to ₱50,000.00.'],
    ['50,100', 'Enter an amount from ₱500.00 to ₱50,000.00.'],
    ['99999999999999.99', 'Enter an amount from ₱500.00 to ₱50,000.00.'],
    ['5,050.00', 'Amount must be in ₱100.00 steps'],
    // 5000.1 must parse to exactly 500010 centavos (step error), not 500009.99… (float drift).
    ['5000.1', 'Amount must be in ₱100.00 steps'],
    ['5000.005', 'at most 2 decimal places'],
    ['5e3', 'Use digits with an optional decimal point'],
    ['-5000', 'Use digits with an optional decimal point'],
    ['', 'Enter an amount in pesos.'],
  ])('rejects amount %j', (amount, message) => {
    const { server, ui } = setup()
    const spy = vi.spyOn(server, 'disburse')
    fill(ui, { amount })
    fireEvent.click(disburseButton(ui))

    const field = ui.getByLabelText('Principal amount (PHP)')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(errorTextFor(field)).toContain(message)
    expect(spy).not.toHaveBeenCalled()
  })

  it('accepts the exact boundaries ₱500.00 and ₱50,000.00', async () => {
    for (const amount of ['500.00', '50,000.00']) {
      const { server, ui } = setup()
      fill(ui, { amount })
      fireEvent.click(disburseButton(ui))
      await waitFor(() => {
        expect(server.getLedger()).toHaveLength(1)
      })
      cleanup()
    }
  })

  it('rejects an amount above the daily cap', () => {
    const { ui } = setup()
    fill(ui, { amount: '5,000', dailyCap: '1,000.00' })
    fireEvent.click(disburseButton(ui))

    expect(errorTextFor(ui.getByLabelText('Principal amount (PHP)'))).toContain(
      'exceeds the daily disbursement cap of ₱1,000.00',
    )
  })

  it('reports every invalid field and clears errors once fixed', () => {
    const { ui } = setup()
    fireEvent.click(disburseButton(ui))
    expect(ui.getByRole('alert').textContent).toContain('Fix 4 fields before disbursing.')
    expect(document.activeElement).toBe(ui.getByLabelText('Approved loan'))

    fill(ui)
    for (const name of FIELD_LABELS) {
      expect(ui.getByLabelText(name).getAttribute('aria-invalid')).toBe('false')
    }
  })

  it('rejects a reference note over 140 characters', () => {
    const { ui } = setup()
    fill(ui, { referenceNote: 'x'.repeat(141) })
    fireEvent.click(disburseButton(ui))
    expect(ui.getByLabelText('Reference note (optional)').getAttribute('aria-invalid')).toBe('true')
  })
})

describe('DisbursementForm: pre-filled sample payout (the demo opens ready to test)', () => {
  function setupSample() {
    const server = createDisbursementServer(SEED_LOANS)
    const view = render(<DisbursementForm server={server} createKey={keyFactory()} initialValues={SAMPLE_PAYOUT} />)
    return { server, ui: within(view.container) }
  }

  it('starts on a valid payout, so Simulate replays the retry without any typing', async () => {
    const { server, ui } = setupSample()
    expect((ui.getByLabelText('Approved loan') as HTMLSelectElement).value).toBe('L-1042')
    expect((ui.getByLabelText('Principal amount (PHP)') as HTMLInputElement).value).toBe('5,000.00')
    for (const label of ['Approved loan', 'Wallet provider', 'Recipient mobile number', 'Principal amount (PHP)']) {
      expect(ui.getByLabelText(label).getAttribute('aria-invalid')).toBe('false')
    }

    fireEvent.click(ui.getByRole('button', { name: 'Simulate double-click / network retry' }))

    await waitFor(() => {
      expect(ui.getAllByTestId('request-log-entry')).toHaveLength(2)
    })
    const [first, second] = ui.getAllByTestId('request-log-entry')
    expect(first?.textContent).toContain('201 Created · posted JE-0001')
    expect(second?.textContent).toContain('201 Idempotent replay of JE-0001 · no new ledger entry')
    expect(server.getLedger()).toHaveLength(1)
    expect(journalTotals(server.getLedger().flatMap((entry) => entry.lines)).balanced).toBe(true)
  })

  it('Reset demo returns to the sample payout, not an empty form', async () => {
    const { ui } = setupSample()
    fireEvent.click(disburseButton(ui))
    await waitFor(() => {
      expect(ui.getAllByTestId('request-log-entry')).toHaveLength(1)
    })
    // A fulfilled intent clears the loan so the next payout is a new intent.
    expect((ui.getByLabelText('Approved loan') as HTMLSelectElement).value).toBe('')

    fireEvent.click(ui.getByRole('button', { name: 'Reset demo' }))
    expect((ui.getByLabelText('Approved loan') as HTMLSelectElement).value).toBe('L-1042')
    expect(ui.queryAllByTestId('request-log-entry')).toHaveLength(0)
  })
})
