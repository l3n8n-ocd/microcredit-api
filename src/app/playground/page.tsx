import type { ReactNode } from 'react'
import { DisbursementOverrideModal, IdempotencyDisclosure, LoanLifecycleTabs } from '../../../playground/index.ts'
import { ShadcnLifecycleTabs, ShadcnOverrideDialog } from '../../features/playground/ShadcnExamples.tsx'

export const metadata = {
  title: 'Accessible component playground · MicroCredit API',
  description:
    'A modal dialog, tabs and a disclosure hand-built against the W3C ARIA Authoring Practices Guide, next to their shadcn/ui equivalents.',
}

const KEY = 'rounded border border-slate-400 bg-white px-1.5 py-0.5 font-mono text-xs text-ink'

function Variant({ label, source, children }: { readonly label: string; readonly source: string; readonly children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-300 bg-white p-4">
      <h3 className="text-sm font-semibold text-ink">{label}</h3>
      <p className="mt-0.5 font-mono text-xs text-slate-600">{source}</p>
      <div className="mt-4">{children}</div>
    </div>
  )
}

/**
 * `/playground` — FE-03 / FE-05. A Server Component shell; each demo is a
 * client island. For each pattern the hand-built component comes first and
 * its shadcn/ui equivalent second (stacked on a phone, side by side from `lg`).
 * This is coursework, not a product screen: it is the last link in the nav.
 */
export default function PlaygroundPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">Accessible component playground</h1>
      <p className="mt-2 max-w-3xl text-slate-700">
        Three components built from scratch against the W3C ARIA Authoring Practices Guide, each next to the
        shadcn/ui (Radix) version of the same thing. Put the mouse down and use the keyboard. What the library does
        that the hand-built version does not is written up in{' '}
        <a
          className="font-semibold text-ink underline underline-offset-2"
          href="https://github.com/l3n8n-ocd/microcredit-api/blob/main/NOTES.md"
        >
          NOTES.md
        </a>
        .
      </p>

      <section aria-labelledby="dialog-heading" className="mt-10">
        <h2 id="dialog-heading" className="text-xl font-semibold">
          1. Modal dialog
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-700">
          <kbd className={KEY}>Enter</kbd> opens it. <kbd className={KEY}>Tab</kbd> and{' '}
          <kbd className={KEY}>Shift</kbd>+<kbd className={KEY}>Tab</kbd> stay inside. <kbd className={KEY}>Esc</kbd>{' '}
          closes it and focus goes back to the button that opened it.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Variant label="Hand-built" source="playground/ModalDialog.tsx">
            <DisbursementOverrideModal />
          </Variant>
          <Variant label="shadcn/ui" source="src/components/ui/dialog.tsx · @radix-ui/react-dialog">
            <ShadcnOverrideDialog />
          </Variant>
        </div>
      </section>

      <section aria-labelledby="tabs-heading" className="mt-10">
        <h2 id="tabs-heading" className="text-xl font-semibold">
          2. Tabs
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-700">
          <kbd className={KEY}>←</kbd> <kbd className={KEY}>→</kbd> move between tabs and wrap.{' '}
          <kbd className={KEY}>Home</kbd> and <kbd className={KEY}>End</kbd> jump to the ends.{' '}
          <kbd className={KEY}>Tab</kbd> goes from the selected tab straight to its panel.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Variant label="Hand-built" source="playground/Tabs.tsx">
            <LoanLifecycleTabs />
          </Variant>
          <Variant label="shadcn/ui" source="src/components/ui/tabs.tsx · @radix-ui/react-tabs">
            <ShadcnLifecycleTabs />
          </Variant>
        </div>
      </section>

      <section aria-labelledby="disclosure-heading" className="mt-10">
        <h2 id="disclosure-heading" className="text-xl font-semibold">
          3. Disclosure
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-700">
          <kbd className={KEY}>Enter</kbd> or <kbd className={KEY}>Space</kbd> shows and hides the content. Hand-built
          only: the assignment installs shadcn/ui&apos;s Dialog and Tabs, not its Collapsible.
        </p>
        <div className="mt-4 max-w-2xl">
          <Variant label="Hand-built" source="playground/Disclosure.tsx">
            <IdempotencyDisclosure />
          </Variant>
        </div>
      </section>
    </main>
  )
}
