import { MotionLab } from '../../features/motion-lab/MotionLab.tsx'

export const metadata = {
  title: 'Motion Lab · MicroCredit API',
  description: 'FE-AA1: a 6-state SmartActionButton, its motion tokens, and a live state inspector.',
}

const REPO = 'https://github.com/l3n8n-ocd/microcredit-api/blob/main'

const RATIONALE: readonly { state: string; token: string; why: string }[] = [
  {
    state: 'press',
    token: '100ms cubic-bezier(0.22, 1, 0.36, 1)',
    why: 'Answers the finger before the network does. Fast out, soft landing, so a double-click still reads as two presses.',
  },
  {
    state: 'idle → loading',
    token: '220ms cubic-bezier(0.16, 1, 0.3, 1)',
    why: 'Long enough to see "Disburse" leave upward and "Locking Idempotency-Key..." rise in. Short enough that a 600 ms reply never waits on the animation.',
  },
  {
    state: 'loading → success',
    token: '240ms cubic-bezier(0.34, 1.56, 0.64, 1), hold 1400ms',
    why: 'The one overshoot in the system marks the one moment that matters: the payout landed. The hold leaves time to read "201 Disbursed · ₱5,000.00" before it resets.',
  },
  {
    state: 'loading → error',
    token: '320ms cubic-bezier(0.36, 0.07, 0.19, 0.97)',
    why: 'One damped shake, −5 px → 5 px → −3 px → 2 px → 0, then still. It says no once. The label and the cross carry the meaning, not the colour.',
  },
  {
    state: 'reduced motion',
    token: '120ms opacity',
    why: 'No lift, press, slide, spring or shake. The surface, icon and text still change, so the feedback survives.',
  },
]

/**
 * `/motion-lab` — FE-AA1. Coursework, like /playground: a workbench for the
 * SmartActionButton. Server shell; the workbench is a client island.
 */
export default function MotionLabPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">Motion Lab</h1>
      <p className="mt-2 max-w-3xl text-slate-700">
        One button, six states: <code className="font-mono">idle</code>, hover / focus, press,{' '}
        <code className="font-mono">loading</code>, <code className="font-mono">success</code>,{' '}
        <code className="font-mono">error</code>, plus <code className="font-mono">disabled</code>. Every layer sits in one grid
        cell, so the button keeps its size in every state, and only <code className="font-mono">transform</code> and{' '}
        <code className="font-mono">opacity</code> animate. Click it ten times: one run starts. Source:{' '}
        <a
          className="font-semibold text-ink underline underline-offset-2"
          href={`${REPO}/src/components/ui/SmartActionButton.tsx`}
        >
          SmartActionButton.tsx
        </a>
        .
      </p>
      <div className="mt-6">
        <MotionLab />
      </div>
      <section aria-labelledby="rationale" className="mt-6 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
        <h2 id="rationale" className="text-lg font-semibold">
          Duration &amp; easing rationale
        </h2>
        <dl className="mt-4 divide-y divide-slate-200 border-y border-slate-200 text-sm">
          {RATIONALE.map((row) => (
            <div key={row.state} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-x-4">
              <dt className="font-semibold">{row.state}</dt>
              <dd className="space-y-1">
                <code className="block font-mono text-xs text-slate-800">{row.token}</code>
                <p className="text-slate-700">{row.why}</p>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-slate-600">
          These durations go past the 150 ms cap in CLAUDE.md §12 rule 4. The exception covers this one component and is written
          down in{' '}
          <a
            className="font-semibold text-ink underline underline-offset-2"
            href={`${REPO}/docs/FE-AA1_BUTTONS_WITH_A_BRAIN.md`}
          >
            FE-AA1_BUTTONS_WITH_A_BRAIN.md
          </a>
          .
        </p>
      </section>
    </main>
  )
}
