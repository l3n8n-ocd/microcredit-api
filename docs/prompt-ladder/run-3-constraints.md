# Run 3 — Version 3: + Constraints (raw output)

> Recorded 2026-11-06 in a fresh Claude subagent with no tools. Verbatim response; nothing edited.
> Prompt: [`PROMPT_LADDER.md` → Run 3](../PROMPT_LADDER.md#run-3--version-3-constraints)

---

```ts
// loanStateMachine.ts
// Pure loan lifecycle reducer: status transitions, repayment posting,
// double-entry journal generation, idempotent replay, optimistic concurrency.

// ───────────────────────── Branded primitives ─────────────────────────

export type Centavos = number & { readonly __brand: 'Centavos' };
export type LoanVersion = number & { readonly __brand: 'LoanVersion' };
export type IdempotencyKey = string & { readonly __brand: 'IdempotencyKey' };

/** Boundary parser. Non-negative safe integers only; integer +/- on these is exact. */
export const toCentavos = (value: number): Centavos | null =>
  Number.isSafeInteger(value) && value >= 0 ? (value as Centavos) : null;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Boundary parser for the `Idempotency-Key` header (UUID v4). */
export const parseIdempotencyKey = (raw: string): IdempotencyKey | null =>
  UUID_V4.test(raw.trim()) ? (raw.trim().toLowerCase() as IdempotencyKey) : null;

/** Boundary parser for the `If-Match` header: `"7"` or `7`. */
export const parseIfMatch = (raw: string): LoanVersion | null => {
  const m = /^(?:"(\d{1,15})"|(\d{1,15}))$/.exec(raw.trim());
  const digits = m?.[1] ?? m?.[2];
  return digits === undefined ? null : (Number(digits) as LoanVersion);
};

const addC = (a: Centavos, b: Centavos): Centavos => (a + b) as Centavos;
/** Caller guarantees a >= b. */
const subC = (a: Centavos, b: Centavos): Centavos => (a - b) as Centavos;
const minC = (a: Centavos, b: Centavos): Centavos => (a <= b ? a : b);

// ───────────────────────── Ledger ─────────────────────────

export type Wallet = 'gcash' | 'maya';

export type LedgerAccount =
  | `wallet_clearing:${Wallet}`
  | `loans_receivable:${string}`
  | 'interest_income';

export interface JournalLine {
  readonly account: LedgerAccount;
  readonly side: 'DEBIT' | 'CREDIT';
  readonly amount: Centavos;
}

export interface JournalEntry {
  readonly id: string;
  readonly loanId: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly postedAt: string;
  readonly memo: 'DISBURSEMENT' | 'REPAYMENT';
  readonly lines: readonly JournalLine[];
}

/** Σ debits === Σ credits, every line a positive safe integer, at least two lines. */
export function isBalanced(entry: JournalEntry): boolean {
  if (entry.lines.length < 2) return false;
  let debits = 0n;
  let credits = 0n;
  for (const line of entry.lines) {
    if (!Number.isSafeInteger(line.amount) || line.amount <= 0) return false;
    if (line.side === 'DEBIT') debits += BigInt(line.amount);
    else credits += BigInt(line.amount);
  }
  return debits === credits;
}

// ───────────────────────── Loan states ─────────────────────────

/** Total interest is computed upstream (rate math lives in the decimal/amortization module). */
export interface LoanTerms {
  readonly principal: Centavos;
  readonly interest: Centavos;
}

export interface OutstandingBalance {
  readonly principal: Centavos;
  readonly interest: Centavos;
}

interface LoanCore {
  readonly id: string;
  readonly borrowerId: string;
  readonly version: LoanVersion;
  readonly requestedPrincipal: Centavos;
}

interface FundedCore extends LoanCore {
  readonly terms: LoanTerms;
  readonly disbursedVia: Wallet;
  readonly disbursedAt: string;
}

export type Loan =
  | (LoanCore & { readonly status: 'APPLIED' })
  | (LoanCore & { readonly status: 'UNDER_REVIEW' })
  | (LoanCore & { readonly status: 'APPROVED'; readonly terms: LoanTerms })
  | (LoanCore & { readonly status: 'REJECTED'; readonly reason: string })
  | (LoanCore & { readonly status: 'CANCELLED'; readonly terms: LoanTerms; readonly reason: string })
  | (FundedCore & { readonly status: 'DISBURSED'; readonly outstanding: OutstandingBalance })
  | (FundedCore & { readonly status: 'REPAYING'; readonly outstanding: OutstandingBalance })
  | (FundedCore & {
      readonly status: 'DELINQUENT';
      readonly outstanding: OutstandingBalance;
      readonly delinquentSince: string;
    })
  | (FundedCore & {
      readonly status: 'DEFAULTED';
      readonly outstanding: OutstandingBalance;
      readonly defaultedAt: string;
    })
  | (FundedCore & { readonly status: 'SETTLED'; readonly settledAt: string });

export type LoanStatus = Loan['status'];

type LoanIn<S extends LoanStatus> = Extract<Loan, { readonly status: S }>;
type FundedLoan = LoanIn<'DISBURSED' | 'REPAYING' | 'DELINQUENT' | 'DEFAULTED' | 'SETTLED'>;

// ───────────────────────── Events ─────────────────────────

interface MutationMeta {
  readonly idempotencyKey: IdempotencyKey;
  readonly ifMatch: LoanVersion;
  /** Supplied by the caller so the reducer stays pure. */
  readonly occurredAt: string;
}

export type LoanEvent =
  | (MutationMeta & { readonly type: 'START_REVIEW' })
  | (MutationMeta & { readonly type: 'APPROVE'; readonly terms: LoanTerms })
  | (MutationMeta & { readonly type: 'REJECT'; readonly reason: string })
  | (MutationMeta & { readonly type: 'CANCEL'; readonly reason: string })
  | (MutationMeta & { readonly type: 'DISBURSE'; readonly wallet: Wallet })
  | (MutationMeta & { readonly type: 'BEGIN_REPAYMENT' })
  | (MutationMeta & { readonly type: 'POST_REPAYMENT'; readonly amount: Centavos; readonly channel: Wallet })
  | (MutationMeta & { readonly type: 'SETTLE' })
  | (MutationMeta & { readonly type: 'MARK_DELINQUENT' })
  | (MutationMeta & { readonly type: 'CURE' })
  | (MutationMeta & { readonly type: 'DECLARE_DEFAULT' });

export type LoanEventType = LoanEvent['type'];
type EventOf<T extends LoanEventType> = Extract<LoanEvent, { readonly type: T }>;

// ───────────────────────── Aggregate & results ─────────────────────────

export interface MutationResponse {
  readonly loan: Loan;
  readonly journalEntry: JournalEntry | null;
}

export interface IdempotencyRecord {
  readonly fingerprint: string;
  readonly response: MutationResponse;
}

export interface LoanAggregate {
  readonly loan: Loan;
  readonly journal: readonly JournalEntry[];
  readonly idempotency: ReadonlyMap<IdempotencyKey, IdempotencyRecord>;
}

export type TransitionFailure =
  | {
      readonly ok: false;
      readonly status: 409;
      readonly code: 'VERSION_MISMATCH';
      readonly ifMatch: LoanVersion;
      readonly current: LoanVersion;
    }
  | {
      readonly ok: false;
      readonly status: 409;
      readonly code: 'ILLEGAL_TRANSITION';
      readonly from: LoanStatus;
      readonly event: LoanEventType;
      readonly detail: string;
    }
  | { readonly ok: false; readonly status: 422; readonly code: 'IDEMPOTENCY_KEY_REUSED'; readonly detail: string }
  | { readonly ok: false; readonly status: 422; readonly code: 'INVALID_AMOUNT'; readonly detail: string }
  | { readonly ok: false; readonly status: 500; readonly code: 'LEDGER_INVARIANT_VIOLATION'; readonly detail: string };

export type TransitionResult =
  | {
      readonly ok: true;
      /** true => served from the idempotency log; `next` is the input, nothing was posted. */
      readonly replayed: boolean;
      readonly next: LoanAggregate;
      readonly response: MutationResponse;
    }
  | TransitionFailure;

type Step =
  | { readonly ok: true; readonly loan: Loan; readonly journalEntry: JournalEntry | null }
  | TransitionFailure;

// ───────────────────────── Public API ─────────────────────────

export function createApplication(input: {
  readonly id: string;
  readonly borrowerId: string;
  readonly requestedPrincipal: Centavos;
}): LoanAggregate {
  return {
    loan: { ...input, version: 1 as LoanVersion, status: 'APPLIED' },
    journal: [],
    idempotency: new Map(),
  };
}

/**
 * Order matters:
 *   1. Idempotency lookup BEFORE the version check. A retry of a successful
 *      request carries the now-stale If-Match and must get the original result, not a 409.
 *   2. If-Match check.
 *   3. Transition + journal posting.
 * Only successful mutations are recorded under their key. Rejections have no
 * side effects, so the client may retry the same key after refetching.
 */
export function transitionLoan(aggregate: LoanAggregate, event: LoanEvent): TransitionResult {
  const fp = fingerprint(event);
  const prior = aggregate.idempotency.get(event.idempotencyKey);
  if (prior !== undefined) {
    return prior.fingerprint === fp
      ? { ok: true, replayed: true, next: aggregate, response: prior.response }
      : {
          ok: false,
          status: 422,
          code: 'IDEMPOTENCY_KEY_REUSED',
          detail: `key ${event.idempotencyKey} was already used with a different request`,
        };
  }

  const { loan } = aggregate;
  if (event.ifMatch !== loan.version) {
    return { ok: false, status: 409, code: 'VERSION_MISMATCH', ifMatch: event.ifMatch, current: loan.version };
  }

  const step = applyEvent(loan, event, (loan.version + 1) as LoanVersion);
  if (!step.ok) return step;

  if (step.journalEntry !== null && !isBalanced(step.journalEntry)) {
    return {
      ok: false,
      status: 500,
      code: 'LEDGER_INVARIANT_VIOLATION',
      detail: `unbalanced entry ${step.journalEntry.id}`,
    };
  }

  const response: MutationResponse = { loan: step.loan, journalEntry: step.journalEntry };
  const idempotency = new Map(aggregate.idempotency);
  idempotency.set(event.idempotencyKey, { fingerprint: fp, response });

  return {
    ok: true,
    replayed: false,
    next: {
      loan: step.loan,
      journal: step.journalEntry === null ? aggregate.journal : [...aggregate.journal, step.journalEntry],
      idempotency,
    },
    response,
  };
}

// ───────────────────────── Transition table ─────────────────────────

function applyEvent(loan: Loan, event: LoanEvent, v: LoanVersion): Step {
  switch (loan.status) {
    case 'APPLIED':
      if (event.type === 'START_REVIEW') return moved({ ...core(loan, v), status: 'UNDER_REVIEW' });
      break;

    case 'UNDER_REVIEW':
      if (event.type === 'APPROVE') {
        const invalid = validateTerms(event.terms);
        return invalid ?? moved({ ...core(loan, v), status: 'APPROVED', terms: event.terms });
      }
      if (event.type === 'REJECT') return moved({ ...core(loan, v), status: 'REJECTED', reason: event.reason });
      break;

    case 'APPROVED':
      if (event.type === 'DISBURSE') return disburse(loan, event, v);
      if (event.type === 'CANCEL') {
        return moved({ ...core(loan, v), status: 'CANCELLED', terms: loan.terms, reason: event.reason });
      }
      break;

    case 'DISBURSED':
      if (event.type === 'BEGIN_REPAYMENT') {
        return moved({ ...funded(loan, v), status: 'REPAYING', outstanding: loan.outstanding });
      }
      break;

    case 'REPAYING':
      if (event.type === 'POST_REPAYMENT') return repay(loan, event, v);
      if (event.type === 'SETTLE') {
        const due = totalOutstanding(loan.outstanding);
        return due === 0
          ? moved({ ...funded(loan, v), status: 'SETTLED', settledAt: event.occurredAt })
          : illegal(loan.status, event.type, `outstanding balance is ${due} centavos`);
      }
      if (event.type === 'MARK_DELINQUENT') {
        return totalOutstanding(loan.outstanding) === 0
          ? illegal(loan.status, event.type, 'nothing is outstanding')
          : moved({
              ...funded(loan, v),
              status: 'DELINQUENT',
              outstanding: loan.outstanding,
              delinquentSince: event.occurredAt,
            });
      }
      break;

    case 'DELINQUENT':
      if (event.type === 'POST_REPAYMENT') return repay(loan, event, v);
      if (event.type === 'CURE') {
        return moved({ ...funded(loan, v), status: 'REPAYING', outstanding: loan.outstanding });
      }
      if (event.type === 'DECLARE_DEFAULT') {
        return totalOutstanding(loan.outstanding) === 0
          ? illegal(loan.status, event.type, 'nothing is outstanding')
          : moved({
              ...funded(loan, v),
              status: 'DEFAULTED',
              outstanding: loan.outstanding,
              defaultedAt: event.occurredAt,
            });
      }
      break;

    case 'SETTLED':
    case 'DEFAULTED':
    case 'REJECTED':
    case 'CANCELLED':
      break; // terminal

    default:
      return assertNever(loan);
  }
  return illegal(loan.status, event.type, `no transition from ${loan.status} on ${event.type}`);
}

// ───────────────────────── Money-moving steps ─────────────────────────

/** Dr loans_receivable:<borrower> / Cr wallet_clearing:<wallet>, principal only. */
function disburse(loan: LoanIn<'APPROVED'>, event: EventOf<'DISBURSE'>, v: LoanVersion): Step {
  const { principal, interest } = loan.terms;
  return {
    ok: true,
    loan: {
      ...core(loan, v),
      status: 'DISBURSED',
      terms: loan.terms,
      disbursedVia: event.wallet,
      disbursedAt: event.occurredAt,
      outstanding: { principal, interest },
    },
    journalEntry: journalEntry(loan.id, event, 'DISBURSEMENT', [
      { account: `loans_receivable:${loan.borrowerId}`, side: 'DEBIT', amount: principal },
      { account: `wallet_clearing:${event.wallet}`, side: 'CREDIT', amount: principal },
    ]),
  };
}

/**
 * Waterfall: interest first, then principal.
 * Dr wallet_clearing:<channel>             amount
 *   Cr interest_income                     interestPortion   (omitted if 0)
 *   Cr loans_receivable:<borrower>         principalPortion  (omitted if 0)
 * Balanced by construction: principalPortion = amount − interestPortion.
 */
function repay(loan: LoanIn<'REPAYING' | 'DELINQUENT'>, event: EventOf<'POST_REPAYMENT'>, v: LoanVersion): Step {
  const { amount } = event;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return invalidAmount('repayment must be a positive integer number of centavos');
  }
  const due = totalOutstanding(loan.outstanding);
  if (amount > due) {
    return invalidAmount(`repayment of ${amount} exceeds outstanding balance of ${due} centavos`);
  }

  const interestPortion = minC(amount, loan.outstanding.interest);
  const principalPortion = subC(amount, interestPortion);
  const outstanding: OutstandingBalance = {
    principal: subC(loan.outstanding.principal, principalPortion),
    interest: subC(loan.outstanding.interest, interestPortion),
  };

  const lines: JournalLine[] = [{ account: `wallet_clearing:${event.channel}`, side: 'DEBIT', amount }];
  if (interestPortion > 0) lines.push({ account: 'interest_income', side: 'CREDIT', amount: interestPortion });
  if (principalPortion > 0) {
    lines.push({ account: `loans_receivable:${loan.borrowerId}`, side: 'CREDIT', amount: principalPortion });
  }

  const next: Loan =
    loan.status === 'REPAYING'
      ? { ...funded(loan, v), status: 'REPAYING', outstanding }
      : { ...funded(loan, v), status: 'DELINQUENT', outstanding, delinquentSince: loan.delinquentSince };

  return { ok: true, loan: next, journalEntry: journalEntry(loan.id, event, 'REPAYMENT', lines) };
}

// ───────────────────────── Helpers ─────────────────────────

/** Rebuilds the shared fields explicitly so stale state-specific fields never leak across a spread. */
const core = (l: Loan, version: LoanVersion): LoanCore => ({
  id: l.id,
  borrowerId: l.borrowerId,
  version,
  requestedPrincipal: l.requestedPrincipal,
});

const funded = (l: FundedLoan, version: LoanVersion): FundedCore => ({
  ...core(l, version),
  terms: l.terms,
  disbursedVia: l.disbursedVia,
  disbursedAt: l.disbursedAt,
});

const totalOutstanding = (o: OutstandingBalance): Centavos => addC(o.principal, o.interest);

const journalEntry = (
  loanId: string,
  event: MutationMeta,
  memo: JournalEntry['memo'],
  lines: readonly JournalLine[],
): JournalEntry => ({
  id: `je_${loanId}_${event.idempotencyKey}`,
  loanId,
  idempotencyKey: event.idempotencyKey,
  postedAt: event.occurredAt,
  memo,
  lines,
});

function validateTerms(terms: LoanTerms): TransitionFailure | null {
  if (!Number.isSafeInteger(terms.principal) || terms.principal <= 0) {
    return invalidAmount('principal must be a positive integer number of centavos');
  }
  if (!Number.isSafeInteger(terms.interest) || terms.interest < 0) {
    return invalidAmount('interest must be a non-negative integer number of centavos');
  }
  return null;
}

const moved = (loan: Loan): Step => ({ ok: true, loan, journalEntry: null });

const illegal = (from: LoanStatus, event: LoanEventType, detail: string): TransitionFailure => ({
  ok: false,
  status: 409,
  code: 'ILLEGAL_TRANSITION',
  from,
  event,
  detail,
});

const invalidAmount = (detail: string): TransitionFailure => ({
  ok: false,
  status: 422,
  code: 'INVALID_AMOUNT',
  detail,
});

/** Request identity for key-reuse detection. Excludes occurredAt, which may be server-stamped per attempt. */
function fingerprint(event: LoanEvent): string {
  return JSON.stringify([event.type, event.ifMatch, ...payloadOf(event)]);
}

function payloadOf(event: LoanEvent): readonly (string | number)[] {
  switch (event.type) {
    case 'APPROVE':
      return [event.terms.principal, event.terms.interest];
    case 'REJECT':
    case 'CANCEL':
      return [event.reason];
    case 'DISBURSE':
      return [event.wallet];
    case 'POST_REPAYMENT':
      return [event.amount, event.channel];
    case 'START_REVIEW':
    case 'BEGIN_REPAYMENT':
    case 'SETTLE':
    case 'MARK_DELINQUENT':
    case 'CURE':
    case 'DECLARE_DEFAULT':
      return [];
  }
}

function assertNever(x: never): never {
  throw new Error(`Unhandled loan state: ${JSON.stringify(x)}`);
}
```

**Design decisions to review**

- **First argument is the aggregate, not just the loan.** A pure function can only replay an idempotent request if the idempotency log is part of its input. `LoanAggregate` bundles `loan`, the append-only `journal` and the `idempotency` map, and `transitionLoan` returns a new aggregate. The stored `MutationResponse` holds a `Loan` snapshot and not the aggregate, so the log never nests inside itself.
- **Replay is checked before `If-Match`.** A retried `Disburse` carries the version it read before the first attempt succeeded. If the version were checked first, that retry would get a 409 instead of the original payout result.
- **Concurrency still needs the persistence layer.** This function is only correct if the write of `next` is a compare-and-swap on the version (`UPDATE … WHERE version = $ifMatch`) with a unique `(loan_id, idempotency_key)` constraint. Without that, two workers that both read v7 can both commit.
- **Repayments pay interest first, then principal.** The journal recognises interest only when it is collected, because the given chart of accounts has no interest-receivable account. As a result, `loans_receivable` tracks principal only, while `loan.outstanding` tracks principal plus interest.
- **Settling is an explicit `SETTLE` event that checks the balance.** It returns `ILLEGAL_TRANSITION` with a `detail` unless the outstanding balance is exactly 0. A fully paid `DELINQUENT` loan goes through `CURE` and then `SETTLE`, because DELINQUENT → SETTLED is not one of the legal transitions. `MARK_DELINQUENT` and `DECLARE_DEFAULT` are rejected when the balance is 0.
- **Extra non-throwing error codes.** Besides the two required 409 codes, there are:
  - `IDEMPOTENCY_KEY_REUSED` (422) for the same key with a different payload.
  - `INVALID_AMOUNT` (422) for non-positive amounts or overpayment.
  - `LEDGER_INVARIANT_VIOLATION` (500), a defensive check on an entry that is balanced by construction.
- **`assertNever` is the only `throw`.** It can only be reached if the union is extended without updating the switch.
- **Idempotency keys are scoped to one loan,** because the log lives on the aggregate. Journal entry IDs are built from the loan ID and the key, so they stay unique across loans.
