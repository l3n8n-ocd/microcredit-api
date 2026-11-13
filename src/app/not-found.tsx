import Link from 'next/link'

/** FE-08: the 404 page. Identity Kit tokens only; every way out leads back to a working screen. */
export default function NotFound() {
  const link =
    'inline-flex min-h-11 items-center rounded-md border border-main px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <section aria-labelledby="not-found-title" className="rounded-lg border border-main bg-white p-5 text-ink">
        <p className="font-mono text-xs text-slate-600">
          <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-main align-middle" />
          code <span data-testid="not-found-code">HTTP_404</span>
        </p>
        <h1 id="not-found-title" className="mt-2 text-2xl font-bold tracking-tight">
          No page at this address.
        </h1>
        <p className="mt-2 text-sm text-slate-700">
          The link may be old, or the address has a typo. Every screen is in the navigation above.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/" className={`${link} bg-main text-white hover:bg-slate-700`}>
            Go to the Disburse demo
          </Link>
          <Link href="/underwriting" className={`${link} bg-white text-ink hover:bg-slate-100`}>
            Open Underwriting
          </Link>
        </div>
      </section>
    </main>
  )
}
