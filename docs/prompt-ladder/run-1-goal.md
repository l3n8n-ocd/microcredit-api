# Run 1 — Version 1: Clearer Goal (raw output)

> Recorded 2026-11-06 in a fresh Claude subagent with no tools. Verbatim response; nothing edited.
> Prompt: [`PROMPT_LADDER.md` → Run 1](../PROMPT_LADDER.md#run-1--version-1-clearer-goal)

---

Here's a pure, type-safe implementation. Each loan state is its own type, keyed by `status`. Each event is also its own type. Money is held as integer centavos (₱1.00 = 100), so there's no floating-point rounding. The function never throws for a bad event and never changes its input. It always returns a new loan or a typed error.

```ts
// ---------- Money ----------
/** Integer number of centavos (₱1.00 = 100). Never a fractional value. */
export type Centavos = number & { readonly __brand: 'Centavos' };

export function toCentavos(value: number): Centavos {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Invalid centavo amount: ${value}`);
  }
  return value as Centavos;
}

const ZERO = 0 as Centavos;

// ---------- States ----------
export type LoanStatus =
  | 'APPLIED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'DISBURSED'
  | 'REPAYING'
  | 'SETTLED'
  | 'DELINQUENT'
  | 'DEFAULTED'
  | 'REJECTED'
  | 'CANCELLED';

interface LoanBase {
  readonly id: string;
  readonly principal: Centavos;
}

export type Loan =
  | (LoanBase & { readonly status: 'APPLIED' })
  | (LoanBase & { readonly status: 'UNDER_REVIEW' })
  | (LoanBase & { readonly status: 'APPROVED' })
  | (LoanBase & { readonly status: 'DISBURSED'; readonly outstanding: Centavos })
  | (LoanBase & { readonly status: 'REPAYING'; readonly outstanding: Centavos })
  | (LoanBase & { readonly status: 'DELINQUENT'; readonly outstanding: Centavos })
  | (LoanBase & { readonly status: 'SETTLED'; readonly outstanding: Centavos })
  | (LoanBase & { readonly status: 'DEFAULTED'; readonly outstanding: Centavos })
  | (LoanBase & { readonly status: 'REJECTED'; readonly reason: string })
  | (LoanBase & { readonly status: 'CANCELLED'; readonly reason: string });

// ---------- Events ----------
export type LoanEvent =
  | { readonly type: 'START_REVIEW' }
  | { readonly type: 'APPROVE' }
  | { readonly type: 'REJECT'; readonly reason: string }
  | { readonly type: 'CANCEL'; readonly reason: string }
  | { readonly type: 'DISBURSE' }
  | { readonly type: 'START_REPAYMENT' }
  | { readonly type: 'POST_REPAYMENT'; readonly amount: Centavos }
  | { readonly type: 'MARK_DELINQUENT' }
  | { readonly type: 'CURE' }
  | { readonly type: 'DECLARE_DEFAULT' }
  | { readonly type: 'SETTLE' };

// ---------- Result ----------
export type TransitionError =
  | { readonly code: 'ILLEGAL_TRANSITION'; readonly from: LoanStatus; readonly event: LoanEvent['type'] }
  | { readonly code: 'INVALID_AMOUNT'; readonly amount: number }
  | { readonly code: 'OVERPAYMENT'; readonly amount: Centavos; readonly outstanding: Centavos }
  | { readonly code: 'BALANCE_NOT_ZERO'; readonly outstanding: Centavos };

export type TransitionResult =
  | { readonly ok: true; readonly loan: Loan }
  | { readonly ok: false; readonly error: TransitionError };

const ok = (loan: Loan): TransitionResult => ({ ok: true, loan });
const fail = (error: TransitionError): TransitionResult => ({ ok: false, error });

function assertNever(x: never): never {
  throw new Error(`Unhandled loan state: ${JSON.stringify(x)}`);
}

/** Validates a repayment and returns the new balance, or an error. */
function applyRepayment(
  outstanding: Centavos,
  amount: Centavos,
): { ok: true; remaining: Centavos } | { ok: false; error: TransitionError } {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: { code: 'INVALID_AMOUNT', amount } };
  }
  if (amount > outstanding) {
    return { ok: false, error: { code: 'OVERPAYMENT', amount, outstanding } };
  }
  return { ok: true, remaining: (outstanding - amount) as Centavos };
}

// ---------- Transition ----------
export function transitionLoan(loan: Loan, event: LoanEvent): TransitionResult {
  // Copy only the shared fields, so leftover fields from the old state are never carried over.
  const base: LoanBase = { id: loan.id, principal: loan.principal };

  switch (loan.status) {
    case 'APPLIED':
      if (event.type === 'START_REVIEW') return ok({ ...base, status: 'UNDER_REVIEW' });
      break;

    case 'UNDER_REVIEW':
      if (event.type === 'APPROVE') return ok({ ...base, status: 'APPROVED' });
      if (event.type === 'REJECT') return ok({ ...base, status: 'REJECTED', reason: event.reason });
      break;

    case 'APPROVED':
      if (event.type === 'DISBURSE') {
        return ok({ ...base, status: 'DISBURSED', outstanding: loan.principal });
      }
      if (event.type === 'CANCEL') return ok({ ...base, status: 'CANCELLED', reason: event.reason });
      break;

    case 'DISBURSED':
      if (event.type === 'START_REPAYMENT') {
        return ok({ ...base, status: 'REPAYING', outstanding: loan.outstanding });
      }
      break;

    case 'REPAYING':
      if (event.type === 'POST_REPAYMENT') {
        const r = applyRepayment(loan.outstanding, event.amount);
        if (!r.ok) return fail(r.error);
        // Settles automatically, and only, when the balance reaches exactly zero.
        return r.remaining === 0
          ? ok({ ...base, status: 'SETTLED', outstanding: ZERO })
          : ok({ ...base, status: 'REPAYING', outstanding: r.remaining });
      }
      if (event.type === 'SETTLE') {
        return loan.outstanding === 0
          ? ok({ ...base, status: 'SETTLED', outstanding: ZERO })
          : fail({ code: 'BALANCE_NOT_ZERO', outstanding: loan.outstanding });
      }
      if (event.type === 'MARK_DELINQUENT') {
        return ok({ ...base, status: 'DELINQUENT', outstanding: loan.outstanding });
      }
      break;

    case 'DELINQUENT':
      if (event.type === 'POST_REPAYMENT') {
        // A delinquent loan still accepts payments, but there is no DELINQUENT -> SETTLED edge.
        // A loan paid to zero here must be CURED (-> REPAYING) and then SETTLED.
        const r = applyRepayment(loan.outstanding, event.amount);
        if (!r.ok) return fail(r.error);
        return ok({ ...base, status: 'DELINQUENT', outstanding: r.remaining });
      }
      if (event.type === 'CURE') {
        return ok({ ...base, status: 'REPAYING', outstanding: loan.outstanding });
      }
      if (event.type === 'DECLARE_DEFAULT') {
        return ok({ ...base, status: 'DEFAULTED', outstanding: loan.outstanding });
      }
      break;

    // Terminal states: no outgoing transitions.
    case 'SETTLED':
    case 'DEFAULTED':
    case 'REJECTED':
    case 'CANCELLED':
      break;

    default:
      return assertNever(loan);
  }

  return fail({ code: 'ILLEGAL_TRANSITION', from: loan.status, event: event.type });
}
```

**Example**

```ts
let loan: Loan = { id: 'L-001', status: 'APPLIED', principal: toCentavos(500_000) }; // ₱5,000.00

const steps: LoanEvent[] = [
  { type: 'START_REVIEW' },
  { type: 'APPROVE' },
  { type: 'DISBURSE' },
  { type: 'START_REPAYMENT' },
  { type: 'POST_REPAYMENT', amount: toCentavos(300_000) }, // balance ₱2,000.00
  { type: 'POST_REPAYMENT', amount: toCentavos(200_000) }, // balance ₱0 -> SETTLED
];

for (const e of steps) {
  const r = transitionLoan(loan, e);
  if (!r.ok) throw new Error(r.error.code);
  loan = r.loan;
}
// loan.status === 'SETTLED'

transitionLoan(loan, { type: 'APPROVE' });
// { ok: false, error: { code: 'ILLEGAL_TRANSITION', from: 'SETTLED', event: 'APPROVE' } }
```

**How it meets each requirement**

- **Exactly 10 states and only the legal transitions:** each state lists only the events it accepts. Anything else returns `ILLEGAL_TRANSITION`. The 4 terminal states (SETTLED, DEFAULTED, REJECTED, CANCELLED) accept nothing.
- **Repayments reduce the balance:**
  - Payments are accepted only while the loan is in REPAYING or DELINQUENT.
  - An amount that is zero, negative or not a whole number of centavos returns `INVALID_AMOUNT`.
  - Paying more than the balance returns `OVERPAYMENT`.
- **Settles only at zero:**
  - A repayment in REPAYING moves the loan to SETTLED only when the balance hits exactly 0.
  - An explicit `SETTLE` event with money still owed returns `BALANCE_NOT_ZERO`.
  - DELINQUENT has no path to SETTLED, as your rules specify. A delinquent loan paid to zero must be cured first, then settled.
- **Never mutates the input:** every change builds a new object, and all fields are `readonly`. Each new state copies only `id` and `principal`, so fields from the old state, like `reason`, never leak into the new one.
- **Exhaustive:** `assertNever` gives a compile error if a new state is added and not handled.
- **Money precision:** amounts are integer centavos throughout, so balances never pick up floating-point rounding errors. Interest and fees are out of scope here. When disbursed, the outstanding balance starts at the principal.
