/**
 * Public surface of the playground: three components hand-built against the
 * W3C ARIA Authoring Practices Guide, plus the MicroCredit-themed examples
 * shown on `/playground`. See NOTES.md for how they compare with shadcn/ui.
 */
export { ModalDialog, type ModalDialogProps } from './ModalDialog.tsx'
export { Tabs, type TabItem, type TabsProps } from './Tabs.tsx'
export { Disclosure, type DisclosureProps } from './Disclosure.tsx'

export { DisbursementOverrideModal, IdempotencyDisclosure, LoanLifecycleTabs } from './examples.tsx'
export { OverrideForm, type OverrideFormProps } from './OverrideForm.tsx'
export { ConcurrencyPanel, LedgerPanel, LifecyclePanel } from './panels.tsx'
export { OVERRIDE_DEMO } from './content.ts'
