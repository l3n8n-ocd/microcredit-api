import { FullscreenShaderHero } from '../../features/shader-hero/FullscreenShaderHero.tsx'
import { FALLBACK_ONE_LINER, MAX_CHANNEL } from '../../features/shader-hero/LedgerAuroraShader.ts'

export const metadata = {
  title: 'Shader Hero · MicroCredit API',
  description: 'FE-AA3: a commented GLSL fullscreen hero with a DPR cap, tab and viewport pause, and a reduced-motion fallback.',
}

const REPO = 'https://github.com/l3n8n-ocd/microcredit-api/blob/main'
const LINK = 'font-semibold text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/**
 * `/shader-hero` — FE-AA3. Coursework, like /3d-lab: the shader exception in CLAUDE.md §12 covers this
 * route only. `/` links here from a plain card; its own first screen stays the Disburse demo.
 */
export default function ShaderHeroPage() {
  return (
    <main id="main-content" tabIndex={-1} className="focus:outline-none">
      <FullscreenShaderHero />
      <section aria-labelledby="shader-notes" className="mx-auto max-w-3xl px-4 py-12">
        <h2 id="shader-notes" className="text-2xl font-bold tracking-tight">
          What you are looking at
        </h2>
        <p className="mt-3 text-slate-700">
          A fragment shader written for this page. Slate ribbons drift through a flow field built from four layers of value
          noise. Faint sky-blue rules bend with them like the lines of a ledger sheet, and emerald shows only where the
          ribbons fold the most. The cursor pulls the flow a little toward itself. It uses all three uniforms:{' '}
          <code className="font-mono">u_time</code>, <code className="font-mono">u_resolution</code> and{' '}
          <code className="font-mono">u_mouse</code>.
        </p>
        <p className="mt-3 text-slate-700">
          No channel goes above <code className="font-mono">{MAX_CHANNEL}</code>, and every word sits on a 65% slate-950
          scrim, so the text stays above 7:1 wherever the ribbons drift.
        </p>
        <h3 className="mt-8 text-lg font-semibold">Fallback, in one line</h3>
        <p className="mt-2 text-slate-700">{FALLBACK_ONE_LINER}</p>
        <p className="mt-6 text-sm text-slate-700">
          Source:{' '}
          <a className={LINK} href={`${REPO}/src/features/shader-hero/LedgerAuroraShader.ts`}>
            LedgerAuroraShader.ts
          </a>{' '}
          (the commented GLSL) ·{' '}
          <a className={LINK} href={`${REPO}/src/features/shader-hero/FullscreenShaderHero.tsx`}>
            FullscreenShaderHero.tsx
          </a>{' '}
          (the loop, pause and fallback) · walkthrough{' '}
          <a className={LINK} href={`${REPO}/docs/FE-AA3_SIGNATURE_SHADER.md`}>
            FE-AA3_SIGNATURE_SHADER.md
          </a>
          .
        </p>
      </section>
    </main>
  )
}
