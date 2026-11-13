'use client'

import { RouteErrorPanel } from '../../components/RouteErrorPanel.tsx'

/**
 * `/underwriting` error boundary (FE-08). The copilot's drill toolbar has a
 * "Throw a render error" button that lands here, so this boundary can be
 * tested on the live site in one click.
 */
export default function UnderwritingError({ error, retry }: { readonly error: unknown; readonly retry: () => void }) {
  return (
    <RouteErrorPanel
      error={error}
      retry={retry}
      boundary="underwriting"
      title="The underwriting screen hit an error."
    />
  )
}
