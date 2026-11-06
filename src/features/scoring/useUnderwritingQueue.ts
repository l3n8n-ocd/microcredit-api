import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DisbursementServer,
  JournalEntry,
  LoanCommandRequest,
  LoanCommandResponse,
  LoanState,
  LoanStatus,
} from '../disbursement/index.ts'
import type { ApplicantProfile } from './applicants.ts'
import { scoreApplicant, type TrustScore } from './scoreEngine.ts'

export const QUEUE_FILTERS = [
  'ALL',
  'APPLIED',
  'UNDER_REVIEW',
  'APPROVED',
  'DISBURSED',
  'REPAYING',
  'SETTLED',
  'REJECTED',
] as const satisfies readonly ('ALL' | LoanStatus)[]

export type QueueFilter = (typeof QUEUE_FILTERS)[number]

export interface QueueRow {
  readonly loan: LoanState
  readonly profile: ApplicantProfile | null
  readonly score: TrustScore | null
}

/** Pure: rows in `filter` whose loan ID, borrower ID or business name contains `query` (case-insensitive). */
export function filterQueue(rows: readonly QueueRow[], filter: QueueFilter, query: string): readonly QueueRow[] {
  const needle = query.trim().toLowerCase()
  return rows.filter((row) => {
    if (filter !== 'ALL' && row.loan.status !== filter) return false
    if (needle === '') return true
    return [row.loan.id, row.loan.borrowerId, row.profile?.name ?? ''].some((text) => text.toLowerCase().includes(needle))
  })
}

export interface UseUnderwritingQueueOptions {
  readonly profiles: readonly ApplicantProfile[]
  /** Bumped by another panel on this screen after it changes the server. */
  readonly revision: number
  /** Called after this hook changes the server, so the other panel re-reads. */
  readonly onServerChange: () => void
  /** Delay before the search text filters the queue. */
  readonly debounceMs: number
}

export interface UnderwritingQueue {
  readonly loans: readonly LoanState[]
  readonly ledger: readonly JournalEntry[]
  readonly rows: readonly QueueRow[]
  readonly visibleRows: readonly QueueRow[]
  readonly filter: QueueFilter
  readonly setFilter: (filter: QueueFilter) => void
  /** What the user typed, shown in the input immediately. */
  readonly query: string
  readonly setQuery: (query: string) => void
  /** True while a command is in flight. Every action button is disabled meanwhile. */
  readonly inFlight: boolean
  /** Sends one command; returns null if another command is already in flight. */
  readonly send: (request: LoanCommandRequest) => Promise<LoanCommandResponse | null>
}

export function useUnderwritingQueue(server: DisbursementServer, options: UseUnderwritingQueueOptions): UnderwritingQueue {
  const { profiles, revision, onServerChange, debounceMs } = options

  const [loans, setLoans] = useState<readonly LoanState[]>(() => server.listLoans())
  const [ledger, setLedger] = useState<readonly JournalEntry[]>(() => server.getLedger())
  const [seenRevision, setSeenRevision] = useState(revision)
  if (revision !== seenRevision) {
    // Another panel changed the server: re-read during render, not in an effect.
    setSeenRevision(revision)
    setLoans(server.listLoans())
    setLedger(server.getLedger())
  }

  const [filter, setFilter] = useState<QueueFilter>('ALL')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, debounceMs)
    return () => {
      clearTimeout(timer)
    }
  }, [query, debounceMs])

  // Scores depend only on the profiles, so they are computed once, not per render or per row.
  const scores = useMemo(
    () => new Map(profiles.map((profile) => [profile.borrowerId, scoreApplicant(profile.signals)])),
    [profiles],
  )
  const rows = useMemo<readonly QueueRow[]>(
    () =>
      loans.map((loan) => ({
        loan,
        profile: profiles.find((profile) => profile.borrowerId === loan.borrowerId) ?? null,
        score: scores.get(loan.borrowerId) ?? null,
      })),
    [loans, profiles, scores],
  )
  const visibleRows = useMemo(() => filterQueue(rows, filter, debouncedQuery), [rows, filter, debouncedQuery])

  const inFlightRef = useRef(false)
  const [inFlight, setInFlight] = useState(false)
  const send = useCallback(
    async (request: LoanCommandRequest): Promise<LoanCommandResponse | null> => {
      // The ref blocks a second click in the same frame, before `disabled` renders.
      if (inFlightRef.current) return null
      inFlightRef.current = true
      setInFlight(true)
      try {
        const response = await server.command(request)
        setLoans(server.listLoans())
        setLedger(server.getLedger())
        onServerChange()
        return response
      } finally {
        inFlightRef.current = false
        setInFlight(false)
      }
    },
    [server, onServerChange],
  )

  return { loans, ledger, rows, visibleRows, filter, setFilter, query, setQuery, inFlight, send }
}
