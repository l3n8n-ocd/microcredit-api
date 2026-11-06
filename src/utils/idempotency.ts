/** Idempotency keys for money-moving mutations (CLAUDE.md §8). */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuidV4(value: string): boolean {
  return UUID_V4.test(value)
}

/** One key per user intent. Callers reuse it on every retry of that intent. */
export function createIdempotencyKey(): string {
  return crypto.randomUUID()
}
