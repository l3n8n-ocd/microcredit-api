import { Vault3DConfigurator } from '../../features/three-d/Vault3DConfigurator.tsx'

export const metadata = {
  title: '3D Lab · MicroCredit API',
  description: 'FE-AA2: a lazy-loaded WebGL POS terminal, a .glb loader and the FE-10 performance lens.',
}

const REPO = 'https://github.com/l3n8n-ocd/microcredit-api/blob/main'

/**
 * `/3d-lab` — FE-AA2. Coursework, like /playground and /motion-lab. A server shell; the configurator
 * is a client island, and the WebGL canvas inside it is a further lazy chunk (next/dynamic, ssr: false).
 */
export default function ThreeDLabPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">3D Lab: POS &amp; Ledger Vault Inspector</h1>
      <p className="mt-2 max-w-3xl text-slate-700">
        A MicroCredit point-of-sale terminal in WebGL. Press <strong>Simulate 201 Disbursed</strong> or{' '}
        <strong>Simulate 409 Conflict</strong> and it acts out the two outcomes the Disburse sandbox returns. Repaint it,
        swap its module, change the light, or drop your own <code className="font-mono">.glb</code> on it.
      </p>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        Three.js loads only on this page, after it renders. The terminal is built from primitives in the browser, so there is no
        model to download. Source:{' '}
        <a className="font-semibold text-ink underline underline-offset-2" href={`${REPO}/src/features/three-d/Vault3DCanvas.tsx`}>
          Vault3DCanvas.tsx
        </a>
        . Performance notes:{' '}
        <a className="font-semibold text-ink underline underline-offset-2" href={`${REPO}/docs/FE-AA2_3D_EXPERIENCE.md`}>
          FE-AA2_3D_EXPERIENCE.md
        </a>
        .
      </p>
      <div className="mt-6">
        <Vault3DConfigurator />
      </div>
    </main>
  )
}
