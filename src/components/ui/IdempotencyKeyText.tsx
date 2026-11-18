import { PENDING_IDEMPOTENCY_KEY } from '../../hooks/useIdempotencyKey.ts'

/**
 * The 28 characters that follow "pending" (7) so the placeholder is as long as a UUID (36), in the
 * same 8-4-4-4-12 shape.
 */
const UUID_TAIL_MASK = '·-····-····-····-············'

/**
 * FE-10: shows an `Idempotency-Key`. The server's HTML carries "pending" until hydration swaps in the
 * real UUID. A 7-character placeholder wrapped onto one line where the UUID needs two at 375 px, so
 * the swap pushed the form down 16 px (CLS 0.0100, the only layout shift on `/`). Padding the
 * placeholder to 36 monospace characters makes it wrap exactly like the key that replaces it.
 * Screen readers hear "pending"; the mask is aria-hidden.
 */
export function IdempotencyKeyText({ value }: { readonly value: string }) {
  if (value !== PENDING_IDEMPOTENCY_KEY) return <>{value}</>
  return (
    <>
      {PENDING_IDEMPOTENCY_KEY}
      <span aria-hidden="true" className="opacity-60">
        {UUID_TAIL_MASK}
      </span>
    </>
  )
}
