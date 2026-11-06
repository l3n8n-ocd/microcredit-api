import { DisbursementSettingsForm } from './features/loan-lifecycle/index.ts'

export function App() {
  return (
    <main className="min-h-dvh bg-slate-950 px-4 py-12 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <p className="font-mono text-xs font-semibold tracking-widest text-emerald-400 uppercase">
          FE-01 · Toolchain ready
        </p>
        <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">MicroCredit API</h1>
        <p className="mt-2 text-base text-slate-300">
          Alternative Credit Scoring &amp; Micro-Lending Portal
        </p>
        <DisbursementSettingsForm />
      </div>
    </main>
  )
}
