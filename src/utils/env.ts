/**
 * Reads a secret from an env value. A secret counts as configured only if it
 * is non-empty and is not one of the `.env.example` placeholders, so copying
 * `.env.example` unchanged (locally or into a hosting dashboard) reads as
 * "not set" instead of as a key that fails on first use.
 */
export function readSecret(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' || trimmed.toLowerCase().includes('placeholder') ? null : trimmed
}
