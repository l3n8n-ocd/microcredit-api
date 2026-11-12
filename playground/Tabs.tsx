'use client'

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

/**
 * Tabs, hand-built against the W3C ARIA Authoring Practices Guide "Tabs"
 * pattern (automatic activation: selection follows focus). No component library.
 *
 *   - `role="tablist"` with `aria-orientation="horizontal"` and a label
 *   - `role="tab"` buttons with `aria-selected` and `aria-controls`
 *   - `role="tabpanel"` with `aria-labelledby`, focusable so Tab lands on it
 *   - roving tabindex: only the selected tab is a Tab stop (`0`), the rest are
 *     `-1`. The whole tablist is ONE stop in the page's Tab order; arrow keys
 *     move within it.
 *   - ArrowRight / ArrowLeft move and wrap, Home / End jump to the ends.
 *
 * Not handled (see NOTES.md): right-to-left layouts, disabled tabs, manual
 * activation, vertical orientation.
 */

export interface TabItem {
  /** Stable key for the tab. Used in element IDs, so letters, digits and dashes only. */
  readonly id: string
  readonly label: string
  readonly content: ReactNode
}

export interface TabsProps {
  /** Accessible name of the tablist, e.g. "Loan lifecycle and ledger". */
  readonly label: string
  readonly tabs: readonly TabItem[]
  /** Selected on first render. Defaults to the first tab. */
  readonly defaultTabId?: string
}

export function Tabs({ label, tabs, defaultTabId }: TabsProps) {
  const baseId = useId()
  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    tabs.some((tab) => tab.id === defaultTabId) ? defaultTabId : tabs[0]?.id,
  )
  const tabElements = useRef(new Map<string, HTMLButtonElement>())

  const tabId = (id: string): string => `${baseId}-tab-${id}`
  const panelId = (id: string): string => `${baseId}-panel-${id}`

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = tabs.length - 1
    let next: number
    switch (event.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1
        break
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      default:
        // Tab, Enter, Space and everything else keep their native behaviour.
        return
    }
    // Home / End would otherwise scroll the page.
    event.preventDefault()
    const target = tabs[next]
    if (target === undefined) return
    // Automatic activation: moving focus also selects.
    setSelectedId(target.id)
    tabElements.current.get(target.id)?.focus()
  }

  if (tabs.length === 0) return null

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        className="flex overflow-x-auto border-b border-slate-300"
      >
        {tabs.map((tab, index) => {
          const isSelected = tab.id === selectedId
          return (
            <button
              key={tab.id}
              ref={(element) => {
                if (element === null) tabElements.current.delete(tab.id)
                else tabElements.current.set(tab.id, element)
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={isSelected}
              aria-controls={panelId(tab.id)}
              // Roving tabindex: one Tab stop for the whole tablist.
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelectedId(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              // Selected is shown by weight and an underline, not by colour alone.
              className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                isSelected
                  ? 'border-accent font-semibold text-ink'
                  : 'border-transparent text-slate-600 hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={panelId(tab.id)}
          aria-labelledby={tabId(tab.id)}
          // Focusable, so Tab from the selected tab lands on its panel even when
          // the panel has no focusable content of its own.
          tabIndex={0}
          hidden={tab.id !== selectedId}
          className="p-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {tab.content}
        </div>
      ))}
    </div>
  )
}
