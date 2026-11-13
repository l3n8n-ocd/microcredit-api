'use client'

import { RouteErrorPanel } from '../components/RouteErrorPanel.tsx'

/**
 * Root error boundary (FE-08): catches a render error in any page under the
 * root layout. The layout itself (navbar, fonts) stays on screen.
 */
export default function RootError({ error, retry }: { readonly error: unknown; readonly retry: () => void }) {
  return <RouteErrorPanel error={error} retry={retry} boundary="root" title="This page hit an error." />
}
