# Run 2 — Version 2: + Defined Audience (raw output)

> Recorded 2026-11-06 in a fresh Claude subagent with no tools. Verbatim response; nothing edited.
> Prompt: [`PROMPT_LADDER.md` → Run 2](../PROMPT_LADDER.md#run-2--version-2-defined-audience)

---

```ts
// loanStateMachine.ts

/* ───────────────────────── Money ───────────────────────── */

declare const CentavosBrand: unique symbol;

/** Integer centavos (₱1.00 = 100n). Using bigint means float arithmetic can't get in. */
export type Centavos = bigint & { readonly [CentavosBrand]: true };

export const toCentavos = (value: bigint): Centavos => {
  if (value < 0n) throw new RangeError(`Centavos cannot be negative: ${value}`);
  return value as Centavos;
};

/* ───────────────────────── State ───────────────────────── */

export interface RepaymentPosting {
  readonly paymentId: string;
  readonly amount: Centavos;
  readonly postedAt: string; // ISO-8601, supplied by caller
}

interface LoanBase {
  readonly id: string;
  readonly borrowerId: string;
  /** Goes up by one on every accepted event. Use it for If-Match / optimistic concurrency. */
  readonly version: number;
}

/** Servicing data shared by every state after disbursement. */
interface Servicing {
  readonly principal: Centavos;   // cash paid out to the borrower
  readonly receivable: Centavos;  // principal + finance charges booked at disbursement
  readonly outstanding: Centavos; // invariant: receivable − Σ postings.amount
  readonly postings: readonly RepaymentPosting[];
  readonly disbursedAt: string;
  readonly disbursementRef: string;
}

export type Loan =
  | (LoanBase & { readonly status: 'APPLIED'; readonly requested: Centavos; readonly appliedAt: string })
  | (LoanBase & { readonly status: 'UNDER_REVIEW'; readonly requested: Centavos; readonly reviewStartedAt: string })
  | (LoanBase & {
      readonly status: 'APPROVED';
      readonly requested: Centavos;
      readonly approvedPrincipal: Centavos;
      readonly approvedAt: string;
    })
  | (LoanBase & {
      readonly status: 'REJECTED';
      readonly requested: Centavos;
      readonly reason: string;
      readonly rejectedAt: string;
    })
  | (LoanBase & {
      readonly status: 'CANCELLED';
      readonly approvedPrincipal: Centavos;
      readonly reason: string;
      readonly cancelledAt: string;
    })
  | (LoanBase & Servicing & { readonly status: 'DISBURSED' })
  | (LoanBase & Servicing & { readonly status: 'REPAYING' })
  | (LoanBase & Servicing & { readonly status: 'DELINQUENT'; readonly delinquentSince: string })
  | (LoanBase & Servicing & { readonly status: 'DEFAULTED'; readonly defaultedAt: string })
  | (LoanBase & Omit<Servicing, 'outstanding'> & { readonly status: 'SETTLED'; readonly settledAt: string });

export type LoanStatus = Loan['status'];

/* ───────────────────────── Events ───────────────────────── */

export type LoanEvent =
  | { readonly type: 'START_REVIEW'; readonly at: string }
  | { readonly type: 'APPROVE'; readonly principal: Centavos; readonly at: string }
  | { readonly type: 'REJECT'; readonly reason: string; readonly at: string }
  | { readonly type: 'CANCEL'; readonly reason: string; readonly at: string }
  | {
      readonly type: 'DISBURSE';
      readonly amount: Centavos;
      readonly totalReceivable: Centavos;
      readonly reference: string;
      readonly at: string;
    }
  | { readonly type: 'BEGIN_REPAYMENT'; readonly at: string }
  | { readonly type: 'POST_REPAYMENT'; readonly paymentId: string; readonly amount: Centavos; readonly at: string }
  | { readonly type: 'MARK_DELINQUENT'; readonly at: string }
  | { readonly type: 'CURE'; readonly at: string }
  | { readonly type: 'DECLARE_DEFAULT'; readonly at: string }
  | { readonly type: 'SETTLE'; readonly at: string };

type PostRepayment = Extract<LoanEvent, { type: 'POST_REPAYMENT' }>;

/* ───────────────────────── Result ───────────────────────── */

export type TransitionError =
  | { readonly code: 'ILLEGAL_TRANSITION'; readonly from: LoanStatus; readonly event: LoanEvent['type'] }
  | { readonly code: 'INVALID_AMOUNT'; readonly detail: string }
  | { readonly code: 'OVERPAYMENT'; readonly outstanding: Centavos; readonly attempted: Centavos }
  | { readonly code: 'DUPLICATE_PAYMENT'; readonly paymentId: string }
  | { readonly code: 'BALANCE_NOT_ZERO'; readonly outstanding: Centavos }
  | { readonly code: 'NO_BALANCE_DUE' };

type Failure = { readonly ok: false; readonly error: TransitionError };

export type TransitionResult = { readonly ok: true; readonly loan: Loan } | Failure;

const ok = (loan: Loan): TransitionResult => ({ ok: true, loan });
const fail = (error: TransitionError): Failure => ({ ok: false, error });
const illegal = (loan: Loan, event: LoanEvent): Failure =>
  fail({ code: 'ILLEGAL_TRANSITION', from: loan.status, event: event.type });

/* ───────────────────────── Helpers ───────────────────────── */

/** Copies identity and bumps the version. Never spreads `...loan`, so fields from the old state can't carry over. */
const base = (loan: LoanBase): LoanBase => ({
  id: loan.id,
  borrowerId: loan.borrowerId,
  version: loan.version + 1,
});

const servicing = (loan: Servicing): Servicing => ({
  principal: loan.principal,
  receivable: loan.receivable,
  outstanding: loan.outstanding,
  postings: loan.postings, // shared by reference: it's readonly and never written to
  disbursedAt: loan.disbursedAt,
  disbursementRef: loan.disbursementRef,
});

const applyRepayment = (
  loan: Servicing,
  event: PostRepayment,
): { readonly ok: true; readonly value: Servicing } | Failure => {
  if (event.amount <= 0n) {
    return fail({ code: 'INVALID_AMOUNT', detail: 'Repayment amount must be positive' });
  }
  if (loan.postings.some((p) => p.paymentId === event.paymentId)) {
    return fail({ code: 'DUPLICATE_PAYMENT', paymentId: event.paymentId });
  }
  if (event.amount > loan.outstanding) {
    return fail({ code: 'OVERPAYMENT', outstanding: loan.outstanding, attempted: event.amount });
  }
  return {
    ok: true,
    value: {
      ...servicing(loan),
      outstanding: toCentavos(loan.outstanding - event.amount),
      postings: [...loan.postings, { paymentId: event.paymentId, amount: event.amount, postedAt: event.at }],
    },
  };
};

const assertNever = (loan: never): never => {
  throw new Error(`Unhandled loan status: ${String((loan as { status?: unknown }).status)}`);
};

/* ───────────────────────── Transition ───────────────────────── */

export function transitionLoan(loan: Loan, event: LoanEvent): TransitionResult {
  switch (loan.status) {
    case 'APPLIED':
      return event.type === 'START_REVIEW'
        ? ok({ ...base(loan), status: 'UNDER_REVIEW', requested: loan.requested, reviewStartedAt: event.at })
        : illegal(loan, event);

    case 'UNDER_REVIEW':
      switch (event.type) {
        case 'APPROVE':
          if (event.principal <= 0n || event.principal > loan.requested) {
            return fail({ code: 'INVALID_AMOUNT', detail: 'Approved principal must be in (0, requested]' });
          }
          return ok({
            ...base(loan),
            status: 'APPROVED',
            requested: loan.requested,
            approvedPrincipal: event.principal,
            approvedAt: event.at,
          });
        case 'REJECT':
          return ok({
            ...base(loan),
            status: 'REJECTED',
            requested: loan.requested,
            reason: event.reason,
            rejectedAt: event.at,
          });
        default:
          return illegal(loan, event);
      }

    case 'APPROVED':
      switch (event.type) {
        case 'DISBURSE':
          if (event.amount !== loan.approvedPrincipal) {
            return fail({ code: 'INVALID_AMOUNT', detail: 'Disbursed amount must equal approved principal' });
          }
          if (event.totalReceivable < event.amount) {
            return fail({ code: 'INVALID_AMOUNT', detail: 'Total receivable cannot be less than principal' });
          }
          return ok({
            ...base(loan),
            status: 'DISBURSED',
            principal: event.amount,
            receivable: event.totalReceivable,
            outstanding: event.totalReceivable,
            postings: [],
            disbursedAt: event.at,
            disbursementRef: event.reference,
          });
        case 'CANCEL':
          return ok({
            ...base(loan),
            status: 'CANCELLED',
            approvedPrincipal: loan.approvedPrincipal,
            reason: event.reason,
            cancelledAt: event.at,
          });
        default:
          return illegal(loan, event);
      }

    case 'DISBURSED':
      return event.type === 'BEGIN_REPAYMENT'
        ? ok({ ...base(loan), ...servicing(loan), status: 'REPAYING' })
        : illegal(loan, event);

    case 'REPAYING':
      switch (event.type) {
        case 'POST_REPAYMENT': {
          const r = applyRepayment(loan, event);
          return r.ok ? ok({ ...base(loan), ...r.value, status: 'REPAYING' }) : r;
        }
        case 'MARK_DELINQUENT':
          if (loan.outstanding === 0n) return fail({ code: 'NO_BALANCE_DUE' });
          return ok({ ...base(loan), ...servicing(loan), status: 'DELINQUENT', delinquentSince: event.at });
        case 'SETTLE':
          if (loan.outstanding !== 0n) return fail({ code: 'BALANCE_NOT_ZERO', outstanding: loan.outstanding });
          return ok({
            ...base(loan),
            status: 'SETTLED',
            principal: loan.principal,
            receivable: loan.receivable,
            postings: loan.postings,
            disbursedAt: loan.disbursedAt,
            disbursementRef: loan.disbursementRef,
            settledAt: event.at,
          });
        default:
          return illegal(loan, event);
      }

    case 'DELINQUENT':
      switch (event.type) {
        case 'POST_REPAYMENT': {
          const r = applyRepayment(loan, event);
          return r.ok
            ? ok({ ...base(loan), ...r.value, status: 'DELINQUENT', delinquentSince: loan.delinquentSince })
            : r;
        }
        case 'CURE':
          return ok({ ...base(loan), ...servicing(loan), status: 'REPAYING' });
        case 'DECLARE_DEFAULT':
          if (loan.outstanding === 0n) return fail({ code: 'NO_BALANCE_DUE' });
          return ok({ ...base(loan), ...servicing(loan), status: 'DEFAULTED', defaultedAt: event.at });
        default:
          return illegal(loan, event);
      }

    case 'SETTLED':
    case 'DEFAULTED':
    case 'REJECTED':
    case 'CANCELLED':
      return illegal(loan, event);

    default:
      return assertNever(loan);
  }
}
```

**Design decisions**

- **One event moves the loan along at most one edge, and settling is its own event.** `SETTLE` is accepted only when `outstanding === 0n`. I didn't make the last repayment settle the loan automatically, for two reasons:
  - DELINQUENT → SETTLED isn't a legal edge, so a borrower who pays off while delinquent has to go DELINQUENT → `CURE` → REPAYING → `SETTLE` anyway.
  - Auto-settling only in REPAYING would make the two payoff paths behave differently. It would also tie closing the ledger to whichever payment happened to be last.
- **Repayments stay in their state, and only REPAYING and DELINQUENT accept them.** A repayment in DISBURSED is rejected until `BEGIN_REPAYMENT` arrives. A repayment in DEFAULTED is rejected because recoveries after a write-off belong in a separate collections flow. Both are deliberately strict and easy to loosen if your product needs it.
- **Overpayment is rejected, not capped.** Extra cash needs its own ledger treatment (refund or suspense account). Silently capping it would leave the cash and the receivable out of step.
- **Duplicate `paymentId`s are caught inside the loan itself.** This stays replay-safe even if the upstream idempotency layer misses a retry. The caller decides whether `DUPLICATE_PAYMENT` becomes a 409 or an idempotent replay response.
- **The function is pure and never mutates its input:**
  - No clock reads or ID generation; callers pass `at`.
  - The types are readonly throughout.
  - The postings list is shared by reference, and appending creates a new array.
  - Each target state's fields are listed explicitly instead of spreading `...loan`, so fields like `delinquentSince` don't carry over into REPAYING.
- **`version`** goes up by one only when an event is accepted, so it can back `If-Match` / ETag checks. A rejected event returns no new loan.
- **`MARK_DELINQUENT` and `CURE` are decided elsewhere.** Days-past-due and arrears come from the repayment schedule, so this machine only enforces which transitions are legal and the balance checks.
- **Invariant to property-test:** `receivable − Σ postings.amount === outstanding` in every state after disbursement. Also: no sequence of events reaches SETTLED with a non-zero balance, and every terminal state rejects every event.
