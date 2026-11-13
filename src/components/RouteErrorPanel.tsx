'use client'

import { useEffect, useRef } from 'react'

/**
 * FE-08 route error UI, shared by `src/app/error.tsx` and
 * `src/app/underwriting/error.tsx`. Identity Kit only: canvas `#F8FAFC`, ink
 * `#0F172A`, slate `#1E293B`, emerald `#059669` as the focus ring.
 *
 * What it does:
 *   - moves focus to its heading, so keyboard and screen-reader users land on it;
 *   - shows a diagnostic code: Next's `digest` for a Server Component error (it
 *     matches the server log line), or the error's type for a client one;
 *   - logs one structured line with the boundary, type and digest. Never the
 *     message: it can carry user data (CLAUDE.md §8);
 *   - offers `retry()`, which in Next 16 re-fetches the segment
 *     (`router.refresh()`) and then re-renders it.
 */
export interface RouteErrorPanelProps {
  /** `error.tsx` receives `unknown`: a Client Component can throw anything. */
  readonly error: unknown
  readonly retry: () => void
  /** Which `error.tsx` caught it, e.g. `root` or `underwriting`. */
  readonly boundary: string
  readonly title: string
}

function digestOf(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'digest' in error && typeof error.digest === 'string') {
    return error.digest
  }
  return null
}

function describeRouteError(error: unknown): { readonly type: string; readonly digest: string | null; readonly code: string } {
  const type = error instanceof Error ? error.name : typeof error
  const digest = digestOf(error)
  return { type, digest, code: digest === null ? `ERR_ROUTE_${type.toUpperCase()}` : `DIGEST_${digest}` }
}

export function RouteErrorPanel({ error, retry, boundary, title }: RouteErrorPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { type, digest, code } = describeRouteError(error)
  // Shown on screen only for client errors. A Server Component error's message is already generic in production.
  const message = error instanceof Error && digest === null ? error.message.slice(0, 200) : null

  useEffect(() => {
    headingRef.current?.focus()
    console.error(JSON.stringify({ event: 'route.error', boundary, type, digest }))
  }, [boundary, type, digest])

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <section aria-labelledby="route-error-title" className="rounded-lg border border-main bg-white p-5 text-ink">
        <p className="font-mono text-xs text-slate-600">
          <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-main align-middle" />
          error boundary: <span>{boundary}</span>
        </p>
        <h1
          id="route-error-title"
          ref={headingRef}
          tabIndex={-1}
          className="mt-2 text-2xl font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {title}
        </h1>
        <p className="mt-2 text-sm text-slate-700">
          Nothing was sent or charged by this error: it happened while drawing the page. Retry re-loads this part of
          the page; the rest of the app and any saved conversation are untouched.
        </p>
        {message !== null && message !== '' && <p className="mt-2 text-sm text-slate-700">{message}</p>}
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-slate-200 bg-canvas p-3 font-mono text-xs">
          <dt className="text-slate-600">code</dt>
          <dd className="break-all">
            {code}
          </dd>
          <dt className="text-slate-600">type</dt>
          <dd>{type}</dd>
          <dt className="text-slate-600">digest</dt>
          <dd>{digest ?? 'none (client-side error)'}</dd>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={retry}
            className="min-h-11 rounded-md border border-main bg-main px-4 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Retry this page
          </button>
          <a
            href="/"
            className="inline-flex min-h-11 items-center rounded-md border border-main bg-white px-4 text-sm font-semibold text-ink hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Go to the Disburse demo
          </a>
        </div>
      </section>
    </main>
  )
}
