'use client'

import { useId, useState, type ReactNode } from 'react'

/**
 * Disclosure (show / hide), hand-built against the W3C ARIA Authoring
 * Practices Guide "Disclosure" pattern. No component library.
 *
 *   - a real `<button type="button">`: Enter and Space activate it natively,
 *     so there is no key handler to get wrong
 *   - `aria-expanded` says whether the content is showing
 *   - `aria-controls` points at the content's `id`
 *   - the content is removed from rendering AND from the accessibility tree
 *     with `hidden` when collapsed
 */

export interface DisclosureProps {
  /** The button text. It should make sense on its own, e.g. "Why a retry cannot pay twice". */
  readonly summary: string
  readonly children: ReactNode
  readonly defaultOpen?: boolean
}

export function Disclosure({ summary, children, defaultOpen = false }: DisclosureProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <div className="rounded-lg border border-slate-300 bg-white">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((current) => !current)}
        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-4 py-2 text-left text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {/* Decorative: the state is carried by aria-expanded, not by this glyph. */}
        <span aria-hidden="true" className="w-3 font-mono">
          {isOpen ? '−' : '+'}
        </span>
        {summary}
      </button>
      <div id={panelId} hidden={!isOpen} className="border-t border-slate-200 px-4 py-3 text-sm text-ink">
        {children}
      </div>
    </div>
  )
}
