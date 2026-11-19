import Link from 'next/link'
import { App } from '../App.tsx'
import { Vault3DInspectorCard } from '../features/three-d/Vault3DInspectorCard.tsx'

/**
 * `/` — Flagship. A Server Component shell that renders the interactive
 * Disbursement + Underwriting experience (a 'use client' island). Disburse and
 * Simulate stay above the fold (e2e/fold.mjs).
 *
 * The AI Copilot launch card sits BELOW the demo on purpose: nothing may push
 * Disburse down at 360px. The always-visible entry point is the nav pill.
 */
export default function HomePage() {
  return (
    <>
      <App />
      <aside aria-labelledby="copilot-launch-heading" className="border-t border-slate-200 bg-canvas px-4 py-8 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 rounded-lg border border-main bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 id="copilot-launch-heading" className="text-lg font-semibold text-ink">
              AI Underwriting &amp; Ledger Risk Copilot
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-700">
              Just watched the second request bounce? Ask why. A streaming chat explains{' '}
              <code className="font-mono">Idempotency-Key</code>, <code className="font-mono">If-Match</code>, the 10
              loan states and <code className="font-mono">Σ debits === Σ credits</code>, with every number computed by
              the app&apos;s own functions.
            </p>
          </div>
          <Link
            href="/underwriting#copilot"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-main bg-main px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Open the AI Copilot →
          </Link>
        </div>
      </aside>
      {/* FE-AA3: a plain link, no shader on `/`. The shader exception in CLAUDE.md §12 covers /shader-hero only. */}
      <section aria-labelledby="shader-hero-heading" className="bg-canvas px-4 pb-6 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 id="shader-hero-heading" className="text-lg font-semibold text-ink">
              Signature hero: a fullscreen GLSL shader
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-700">
              The same claim over a hand-written shader that uses <code className="font-mono">u_time</code>,{' '}
              <code className="font-mono">u_resolution</code> and <code className="font-mono">u_mouse</code>. The pixel ratio
              is capped at 1.5, it pauses off-screen, and there is a still fallback for reduced motion.
            </p>
          </div>
          <Link
            href="/shader-hero"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-main px-4 text-sm font-semibold text-ink transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Open the shader hero →
          </Link>
        </div>
      </section>
      {/* FE-AA2: below the fold with the copilot card. Three.js loads only if "Load the 3D inspector" is pressed. */}
      <section aria-labelledby="vault-3d-heading" className="bg-canvas px-4 pb-10 sm:px-8">
        <div className="mx-auto max-w-5xl rounded-lg border border-slate-200 bg-white p-5">
          <h2 id="vault-3d-heading" className="text-lg font-semibold text-ink">
            3D Hardware POS &amp; Ledger Vault Inspector
          </h2>
          <div className="mt-3">
            <Vault3DInspectorCard />
          </div>
        </div>
      </section>
    </>
  )
}
