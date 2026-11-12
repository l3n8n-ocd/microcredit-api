import { AgentRunner } from '../../features/agent/AgentRunner.tsx'
import { resolvePlannerModel } from '../../lib/sentinel-scout/model.ts'

export const metadata = {
  title: 'SentinelScout agent · MicroCredit API',
  description: 'Run the FL-07 SentinelScout triage agent and watch each tool call.',
}

/** The model label depends on server env, which can change between deploys. */
export const dynamic = 'force-dynamic'

const REPO = 'https://github.com/l3n8n-ocd/microcredit-api/blob/main'

/**
 * `/agent` — FL-07. Coursework, like /playground: the last link in the nav.
 * Server shell; the runner is a client island that streams /api/agent.
 */
export default function AgentPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">SentinelScout</h1>
      <p className="mt-2 max-w-3xl text-slate-700">
        A triage agent with one job: given a GitHub Security Advisory, decide whether this repo is exposed, check that the{' '}
        <code className="font-mono">Σ debits === Σ credits</code> and <code className="font-mono">Idempotency-Key</code> /{' '}
        <code className="font-mono">If-Match</code> rules still hold, and write a redacted brief for a person to sign off. Four
        tools, at most four calls, nothing applied, committed or published.
      </p>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        Here it runs on the server that hosts this page: the brief goes to that server&apos;s temp folder, and the type check and
        tests are not run from a public endpoint. The full version is <code className="font-mono">npm run agent:run</code>, which
        talks to the{' '}
        <a className="font-semibold text-ink underline underline-offset-2" href={`${REPO}/mcp/microcredit-mcp-server.mjs`}>
          MCP server
        </a>{' '}
        over stdio. How it was built:{' '}
        <a className="font-semibold text-ink underline underline-offset-2" href={`${REPO}/docs/FL-07_BUILD_LOG.md`}>
          FL-07 build log
        </a>
        .
      </p>
      <div className="mt-6">
        <AgentRunner modelLabel={resolvePlannerModel()?.label ?? null} />
      </div>
    </main>
  )
}
