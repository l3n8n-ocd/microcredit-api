'use client'

import { useState } from 'react'
import { ConcurrencyPanel, LedgerPanel, LifecyclePanel, OVERRIDE_DEMO, OverrideForm } from '../../../playground/index.ts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.tsx'

/**
 * The shadcn/ui (Radix) twins of the hand-built examples in `playground/`.
 * Same copy, same form, same panels: only the component underneath differs,
 * so a keyboard walk through both shows what the library adds. See NOTES.md.
 */

const TRIGGER =
  'min-h-11 rounded-md border border-main bg-white px-4 text-sm font-semibold text-ink hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export function ShadcnOverrideDialog() {
  const [open, setOpen] = useState(false)
  const [approved, setApproved] = useState(false)

  return (
    <div>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* asChild: Radix merges its props and handlers onto OUR button instead of rendering its own. */}
        <DialogTrigger asChild>
          <button type="button" className={TRIGGER}>
            Review cap override (shadcn/ui)
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{OVERRIDE_DEMO.title}</DialogTitle>
            <DialogDescription>{OVERRIDE_DEMO.description}</DialogDescription>
          </DialogHeader>
          <OverrideForm
            onCancel={() => setOpen(false)}
            onApprove={() => {
              setApproved(true)
              setOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
      <p role="status" className="mt-2 min-h-5 text-sm text-ink">
        {approved ? OVERRIDE_DEMO.approved : ''}
      </p>
    </div>
  )
}

const PANEL = 'p-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export function ShadcnLifecycleTabs() {
  return (
    <Tabs defaultValue="lifecycle">
      <TabsList aria-label="Loan lifecycle and ledger (shadcn/ui)">
        <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
        <TabsTrigger value="ledger">Ledger</TabsTrigger>
        <TabsTrigger value="concurrency">Concurrency</TabsTrigger>
      </TabsList>
      {/* The generated TabsContent is `outline-none` on a focusable panel. A focus ring is added back here. */}
      <TabsContent value="lifecycle" className={PANEL}>
        <LifecyclePanel />
      </TabsContent>
      <TabsContent value="ledger" className={PANEL}>
        <LedgerPanel />
      </TabsContent>
      <TabsContent value="concurrency" className={PANEL}>
        <ConcurrencyPanel />
      </TabsContent>
    </Tabs>
  )
}
