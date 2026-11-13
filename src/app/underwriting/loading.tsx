import { SkeletonCard } from '../../components/ui/SkeletonCard.tsx'

/**
 * FE-08: shown while the force-dynamic `/underwriting` page renders on the
 * server (client navigation, slow server). It reserves the page's real boxes:
 * the same heading, the four stat cards (`score-card`, same `STAT_CARD_CLASS`)
 * and the copilot card at its exact height, so nothing jumps when it swaps in.
 */
export default function UnderwritingLoading() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8" aria-busy="true">
      <p role="status" className="sr-only">
        Loading the underwriting screen.
      </p>
      <h1 className="text-3xl font-bold tracking-tight">Alternative-data underwriting</h1>
      <div aria-hidden="true" className="mt-2 max-w-2xl space-y-2">
        <span className="block h-4 w-full rounded bg-slate-200" />
        <span className="block h-4 w-11/12 rounded bg-slate-200" />
        <span className="block h-4 w-2/3 rounded bg-slate-200" />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="score-card-skeletons">
        {[0, 1, 2, 3].map((index) => (
          <SkeletonCard key={index} variant="score-card" />
        ))}
      </div>

      <div
        aria-hidden="true"
        className="mt-8 flex h-[min(44rem,calc(100dvh-4rem))] min-h-96 flex-col overflow-hidden rounded-lg border border-main bg-white"
      >
        <div className="h-16 shrink-0 border-b border-main bg-main" />
        <div className="px-3 py-4 sm:px-4">
          <SkeletonCard variant="chat-turn" />
        </div>
      </div>
    </main>
  )
}
