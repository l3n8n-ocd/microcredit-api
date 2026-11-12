import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn/ui's class-name helper: `clsx` joins conditional classes, then
 * `tailwind-merge` drops earlier Tailwind classes that a later one overrides
 * (`cn('px-2', 'px-4')` is `'px-4'`). Used by `src/components/ui/*`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
