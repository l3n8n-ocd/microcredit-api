'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { OVERRIDE_DEMO } from './content.ts'

/**
 * The form inside both override dialogs (hand-built and shadcn/ui). It follows
 * the repo's form-control rule (CLAUDE.md §11 rule 1): a `<label htmlFor>`,
 * `aria-invalid` always present, `aria-describedby` pointing at the hint and,
 * when shown, the error; a failed submit shows one `role="alert"` and moves
 * focus to the invalid field.
 */

export interface OverrideFormProps {
  readonly onCancel: () => void
  readonly onApprove: (reason: string) => void
}

const BUTTON =
  'min-h-11 rounded-md border border-main px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export function OverrideForm({ onCancel, onApprove }: OverrideFormProps) {
  const [reason, setReason] = useState('')
  const [showError, setShowError] = useState(false)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const fieldId = useId()
  const hintId = `${fieldId}-hint`
  const errorId = `${fieldId}-error`

  const isValid = reason.trim().length >= OVERRIDE_DEMO.minReasonLength
  const invalid = showError && !isValid

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!isValid) {
      setShowError(true)
      fieldRef.current?.focus()
      return
    }
    onApprove(reason.trim())
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label htmlFor={fieldId} className="block text-sm font-semibold text-ink">
        Reason for override
      </label>
      <textarea
        ref={fieldRef}
        id={fieldId}
        rows={3}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        aria-invalid={invalid ? 'true' : 'false'}
        aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
        className={`mt-1 w-full rounded-md border bg-white px-3 py-2 text-base text-ink sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          invalid ? 'border-rose-600' : 'border-slate-500'
        }`}
      />
      <p id={hintId} className="mt-1 text-xs text-slate-600">
        At least {OVERRIDE_DEMO.minReasonLength} characters. It is stored with the override.
      </p>
      {invalid && (
        <p id={errorId} role="alert" className="mt-1 text-xs font-semibold text-rose-800">
          Enter a reason of at least {OVERRIDE_DEMO.minReasonLength} characters to approve.
        </p>
      )}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={`${BUTTON} bg-white text-ink hover:bg-slate-100`}>
          Cancel
        </button>
        <button type="submit" className={`${BUTTON} bg-main text-white hover:bg-slate-700`}>
          Approve override
        </button>
      </div>
    </form>
  )
}
