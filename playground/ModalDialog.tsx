'use client'

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'

/**
 * Modal dialog, hand-built against the W3C ARIA Authoring Practices Guide
 * "Dialog (Modal)" pattern. No component library.
 *
 * What the pattern asks for, and where it is done below:
 *   - `role="dialog"` + `aria-modal="true"`                     the dialog element
 *   - `aria-labelledby` → the title, `aria-describedby` → the description
 *   - focus moves INTO the dialog when it opens                 effect 1
 *   - Tab / Shift+Tab cycle inside it and never leave           effect 2
 *   - Escape closes it                                          effect 2
 *   - focus returns to the element that opened it               effect 1 cleanup
 *
 * What it deliberately does not do (see NOTES.md for each gap and what
 * Radix / shadcn/ui does instead): it does not hide the page behind it from
 * screen readers, lock scrolling, render in a portal, close on an outside
 * press, or coordinate with a second dialog opened on top of it.
 */

/** Elements a keyboard user can Tab to. A selector list, not a layout check: see NOTES.md. */
const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function tabbableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE))
}

export interface ModalDialogProps {
  readonly open: boolean
  /** Called on Escape. The parent owns `open`, so it decides what closing means. */
  readonly onClose: () => void
  /** Becomes the dialog's accessible name through `aria-labelledby`. */
  readonly title: string
  /** Becomes the dialog's accessible description through `aria-describedby`. */
  readonly description: string
  readonly children: ReactNode
  /** Where focus goes on open. Defaults to the first tabbable element inside the dialog. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>
  /**
   * Where focus goes on close. Defaults to whatever had focus when the dialog
   * opened. Pass the trigger's ref when that is not reliable: Safari does not
   * focus a button on mouse click, so `document.activeElement` is `<body>`.
   */
  readonly returnFocusRef?: RefObject<HTMLElement | null>
}

export function ModalDialog({
  open,
  onClose,
  title,
  description,
  children,
  initialFocusRef,
  returnFocusRef,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  // Effect 1: focus in on open, focus back on close.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || dialog === null) return undefined

    // Remember who opened us BEFORE moving focus.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const returnTarget = returnFocusRef?.current ?? opener
    const first = initialFocusRef?.current ?? tabbableWithin(dialog)[0] ?? dialog
    first.focus()

    // Cleanup runs when `open` turns false or the dialog unmounts: the same
    // code path for Escape, Cancel and a successful submit.
    return () => {
      if (returnTarget !== null && returnTarget.isConnected) returnTarget.focus()
    }
  }, [open, initialFocusRef, returnFocusRef])

  // Effect 2: Escape and the focus trap. The listener is on `document`, not on
  // the dialog, so it still works if focus has slipped out (a click on the
  // backdrop moves focus to <body>): the next Tab is pulled back inside.
  useEffect(() => {
    if (!open) return undefined

    const onKeyDown = (event: KeyboardEvent): void => {
      const dialog = dialogRef.current
      if (dialog === null) return

      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const tabbable = tabbableWithin(dialog)
      const first = tabbable[0]
      const last = tabbable.at(-1)
      if (first === undefined || last === undefined) {
        // Nothing to Tab to: keep focus on the dialog itself.
        event.preventDefault()
        dialog.focus()
        return
      }

      const active = document.activeElement
      const outside = !(active instanceof Node) || !dialog.contains(active)
      if (event.shiftKey) {
        // Shift+Tab on the first element wraps to the last.
        if (outside || active === first || active === dialog) {
          event.preventDefault()
          last.focus()
        }
      } else if (outside || active === last) {
        // Tab on the last element wraps to the first.
        event.preventDefault()
        first.focus()
      }
      // Anywhere in between, the browser's own Tab order is left alone.
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    // The backdrop only dims the page. It is not a button and does not close the dialog.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" data-testid="modal-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        // -1: focusable from code (the fallback when it has no tabbable child), not a Tab stop.
        tabIndex={-1}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg border border-main bg-white p-6 text-ink shadow-lg focus:outline-none"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={descriptionId} className="mt-1 text-sm text-slate-600">
          {description}
        </p>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
