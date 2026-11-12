'use client'

import { useRef, useState } from 'react'
import { OVERRIDE_DEMO } from './content.ts'
import { Disclosure } from './Disclosure.tsx'
import { ModalDialog } from './ModalDialog.tsx'
import { OverrideForm } from './OverrideForm.tsx'
import { ConcurrencyPanel, LedgerPanel, LifecyclePanel } from './panels.tsx'
import { Tabs } from './Tabs.tsx'

/**
 * The three hand-built components, dressed in MicroCredit API content for
 * `/playground`. Nothing here talks to a server: approving the override only
 * updates a line of text.
 */

const TRIGGER =
  'min-h-11 rounded-md border border-main bg-main px-4 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** Disbursement Override Approval Modal: the hand-built `ModalDialog`. */
export function DisbursementOverrideModal() {
  const [open, setOpen] = useState(false)
  const [approved, setApproved] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)} className={TRIGGER}>
        Review cap override (hand-built)
      </button>
      <p role="status" className="mt-2 min-h-5 text-sm text-ink">
        {approved ? OVERRIDE_DEMO.approved : ''}
      </p>
      <ModalDialog
        open={open}
        onClose={() => setOpen(false)}
        title={OVERRIDE_DEMO.title}
        description={OVERRIDE_DEMO.description}
        returnFocusRef={triggerRef}
      >
        <OverrideForm
          onCancel={() => setOpen(false)}
          onApprove={() => {
            setApproved(true)
            setOpen(false)
          }}
        />
      </ModalDialog>
    </div>
  )
}

/** Loan Lifecycle & Ledger Tabs: the hand-built `Tabs`. */
export function LoanLifecycleTabs() {
  return (
    <Tabs
      label="Loan lifecycle and ledger (hand-built)"
      tabs={[
        { id: 'lifecycle', label: 'Lifecycle', content: <LifecyclePanel /> },
        { id: 'ledger', label: 'Ledger', content: <LedgerPanel /> },
        { id: 'concurrency', label: 'Concurrency', content: <ConcurrencyPanel /> },
      ]}
    />
  )
}

/** Idempotency Guardrail Technical Disclosure: the hand-built `Disclosure`. */
export function IdempotencyDisclosure() {
  return (
    <Disclosure summary="Why a retry cannot pay a borrower twice">
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Every payout carries an <code className="font-mono">Idempotency-Key</code>. The server looks that key up
          first. If it has seen it with the same payload, it returns the stored{' '}
          <code className="font-mono">201</code> and posts no second journal entry.
        </li>
        <li>
          A new key with a stale <code className="font-mono">If-Match</code> returns{' '}
          <code className="font-mono">409 VERSION_MISMATCH</code>, so two admins clicking at once pay once.
        </li>
        <li>
          The same key with a different payload returns{' '}
          <code className="font-mono">422 IDEMPOTENCY_KEY_REUSED</code>.
        </li>
      </ol>
      <p className="mt-3">
        Try it on the home page: press <strong className="font-semibold">Disburse</strong> twice.
      </p>
    </Disclosure>
  )
}
