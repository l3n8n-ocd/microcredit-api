/**
 * FE-08 layout-matched skeletons. Each variant reserves the exact box of the
 * content it stands in for, so swapping skeleton → content moves nothing (CLS 0).
 *
 * The sizes are not eyeballed: the real content imports the same class
 * constants below (`STAT_CARD_CLASS`, `CHAT_TURN_RESERVE`, `LEDGER_CELL_CLASS`).
 *
 *   chat-turn   the assistant body of a slow reply: 4 lines of `leading-6` = `min-h-24`
 *   score-card  a stat card on /underwriting: `p-4`, a `text-xs` label (1 rem line),
 *               `mt-1`, a `text-lg` value (1.75 rem line)
 *   ledger-row  one `text-sm` table row (1.25 rem line) with `py-1` cells and a top border
 *
 * Bars are static. The only looping animation in the app stays the copilot's
 * thinking dots (CLAUDE.md §12 rule 4).
 */

/** A stat card's box. Used by the real cards on /underwriting and by `score-card`. */
export const STAT_CARD_CLASS = 'rounded-lg border border-slate-200 bg-white p-4'
/** Height the assistant body keeps once it has shown the skeleton, so the first tokens fill it instead of resizing it. */
export const CHAT_TURN_RESERVE = 'min-h-24'
/** One cell of a `text-sm` ledger/health table row. */
export const LEDGER_CELL_CLASS = 'py-1 pr-3'
export const LEDGER_ROW_CLASS = 'border-t border-slate-200'

const BAR = 'block rounded bg-slate-200'

export type SkeletonVariant = 'chat-turn' | 'score-card' | 'ledger-row'

export interface SkeletonCardProps {
  readonly variant: SkeletonVariant
  /** `ledger-row` only: number of cells. */
  readonly columns?: number
}

const ROW_WIDTHS = ['w-28', 'w-20', 'w-14', 'w-24'] as const

export function SkeletonCard({ variant, columns = 3 }: SkeletonCardProps) {
  if (variant === 'chat-turn') {
    return (
      <div className={CHAT_TURN_RESERVE} data-skeleton="chat-turn">
        <p className="text-xs leading-6 text-slate-600">Still working: no first token after 1.5 s.</p>
        {(['w-11/12', 'w-4/5', 'w-2/3'] as const).map((width) => (
          <span key={width} aria-hidden="true" className="flex h-6 items-center">
            <span className={`${BAR} h-3 ${width}`} />
          </span>
        ))}
      </div>
    )
  }

  if (variant === 'score-card') {
    return (
      <div className={STAT_CARD_CLASS} data-skeleton="score-card" aria-hidden="true">
        <span className="flex h-4 items-center">
          <span className={`${BAR} h-2.5 w-24`} />
        </span>
        <span className="mt-1 flex h-7 items-center">
          <span className={`${BAR} h-4 w-20`} />
        </span>
      </div>
    )
  }

  return (
    <tr className={LEDGER_ROW_CLASS} data-skeleton="ledger-row" aria-hidden="true">
      {Array.from({ length: columns }, (_, index) => (
        <td key={index} className={LEDGER_CELL_CLASS}>
          <span className="flex h-5 items-center">
            <span className={`${BAR} h-3 ${ROW_WIDTHS[index % ROW_WIDTHS.length] ?? 'w-16'}`} />
          </span>
        </td>
      ))}
    </tr>
  )
}
