# Run 0 — Baseline (raw output)

> Recorded 2026-11-06 in a fresh Claude subagent with no tools. Verbatim response; nothing edited.
> Prompt: [`PROMPT_LADDER.md` → Run 0](../PROMPT_LADDER.md#run-0--baseline)

---

Here's a self-contained TypeScript module for a lending app. It covers:

- **Loan states**: a state machine that only allows valid transitions.
- **Amortization**: builds a fixed-payment repayment schedule.
- **Payments**: applies each payment to late fees, then interest, then principal.
- **Delinquency**: marks a loan delinquent or defaulted based on days past due.
- **Audit trail**: records every state change and payment.

All money is stored in **integer cents** to avoid floating-point rounding errors.

```typescript
// ---------------------------------------------------------------------------
// Money helpers (integer cents only — never use floats for currency)
// ---------------------------------------------------------------------------

export type Cents = number & { readonly __brand: "Cents" };

export const cents = (value: number): Cents => {
  if (!Number.isInteger(value)) {
    throw new Error(`Cents must be an integer, received ${value}`);
  }
  return value as Cents;
};

export const toCents = (amount: string): Cents => {
  // Parses "1234.56" -> 123456 without floating-point math
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) throw new Error(`Invalid amount: "${amount}"`);
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return cents(parseInt(whole, 10) * 100 + parseInt(fraction, 10));
};

export const formatMoney = (value: Cents, currency = "USD", locale = "en-US"): string =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).format(value / 100);

/** Banker's rounding (round half to even) for interest calculations. */
const roundHalfEven = (value: number): number => {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
};

// ---------------------------------------------------------------------------
// Loan states & state machine
// ---------------------------------------------------------------------------

export type LoanStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "DISBURSED"
  | "ACTIVE"
  | "DELINQUENT"
  | "DEFAULTED"
  | "PAID_OFF"
  | "CANCELLED";

export type LoanEvent =
  | { type: "SUBMIT" }
  | { type: "START_REVIEW" }
  | { type: "APPROVE" }
  | { type: "REJECT"; reason: string }
  | { type: "CANCEL"; reason: string }
  | { type: "DISBURSE" }
  | { type: "ACTIVATE" }
  | { type: "MARK_DELINQUENT" }
  | { type: "CURE" }
  | { type: "MARK_DEFAULT" }
  | { type: "PAY_OFF" };

const TRANSITIONS: Record<LoanStatus, Partial<Record<LoanEvent["type"], LoanStatus>>> = {
  DRAFT:        { SUBMIT: "SUBMITTED", CANCEL: "CANCELLED" },
  SUBMITTED:    { START_REVIEW: "UNDER_REVIEW", CANCEL: "CANCELLED" },
  UNDER_REVIEW: { APPROVE: "APPROVED", REJECT: "REJECTED" },
  APPROVED:     { DISBURSE: "DISBURSED", CANCEL: "CANCELLED" },
  DISBURSED:    { ACTIVATE: "ACTIVE" },
  ACTIVE:       { MARK_DELINQUENT: "DELINQUENT", PAY_OFF: "PAID_OFF" },
  DELINQUENT:   { CURE: "ACTIVE", MARK_DEFAULT: "DEFAULTED", PAY_OFF: "PAID_OFF" },
  DEFAULTED:    { PAY_OFF: "PAID_OFF" },
  REJECTED:     {},
  PAID_OFF:     {},
  CANCELLED:    {},
};

export class InvalidTransitionError extends Error {
  constructor(public readonly from: LoanStatus, public readonly event: LoanEvent["type"]) {
    super(`Cannot apply "${event}" to a loan in state "${from}"`);
    this.name = "InvalidTransitionError";
  }
}

export const canTransition = (from: LoanStatus, event: LoanEvent["type"]): boolean =>
  TRANSITIONS[from][event] !== undefined;

export const nextStatus = (from: LoanStatus, event: LoanEvent): LoanStatus => {
  const to = TRANSITIONS[from][event.type];
  if (!to) throw new InvalidTransitionError(from, event.type);
  return to;
};

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface Installment {
  readonly number: number;
  readonly dueDate: Date;
  readonly principalDue: Cents;
  readonly interestDue: Cents;
  principalPaid: Cents;
  interestPaid: Cents;
  lateFeeDue: Cents;
  lateFeePaid: Cents;
}

export interface Payment {
  readonly id: string;
  readonly loanId: string;
  readonly amount: Cents;
  readonly receivedAt: Date;
  readonly allocation: {
    lateFees: Cents;
    interest: Cents;
    principal: Cents;
    overpayment: Cents;
  };
}

export interface StatusChange {
  readonly from: LoanStatus;
  readonly to: LoanStatus;
  readonly event: LoanEvent;
  readonly at: Date;
}

export interface Loan {
  readonly id: string;
  readonly borrowerId: string;
  readonly principal: Cents;
  /** Annual interest rate in basis points (e.g. 1200 = 12.00%). */
  readonly annualRateBps: number;
  readonly termMonths: number;
  status: LoanStatus;
  disbursedAt?: Date;
  schedule: Installment[];
  payments: Payment[];
  history: StatusChange[];
  /** Optimistic-concurrency version; increment on every mutation. */
  version: number;
}

// ---------------------------------------------------------------------------
// Amortization schedule
// ---------------------------------------------------------------------------

const addMonths = (date: Date, months: number): Date => {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
};

export const buildSchedule = (
  principal: Cents,
  annualRateBps: number,
  termMonths: number,
  startDate: Date,
): Installment[] => {
  if (termMonths <= 0) throw new Error("Term must be positive");
  const monthlyRate = annualRateBps / 10_000 / 12;

  // Standard fixed-payment formula; result rounded to whole cents
  const payment =
    monthlyRate === 0
      ? Math.ceil(principal / termMonths)
      : roundHalfEven(
          (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths)),
        );

  const schedule: Installment[] = [];
  let remaining: number = principal;

  for (let i = 1; i <= termMonths; i++) {
    const interest = roundHalfEven(remaining * monthlyRate);
    // Last installment absorbs rounding drift so the loan nets to exactly zero
    const principalPortion = i === termMonths ? remaining : Math.min(payment - interest, remaining);
    remaining -= principalPortion;

    schedule.push({
      number: i,
      dueDate: addMonths(startDate, i),
      principalDue: cents(principalPortion),
      interestDue: cents(interest),
      principalPaid: cents(0),
      interestPaid: cents(0),
      lateFeeDue: cents(0),
      lateFeePaid: cents(0),
    });
  }
  return schedule;
};

// ---------------------------------------------------------------------------
// Loan service
// ---------------------------------------------------------------------------

export interface LoanServiceOptions {
  lateFee: Cents;
  gracePeriodDays: number;
  defaultAfterDays: number;
  now?: () => Date;
  generateId?: () => string;
}

export class ConcurrencyError extends Error {
  constructor(expected: number, actual: number) {
    super(`Version mismatch: expected ${expected}, found ${actual}`);
    this.name = "ConcurrencyError";
  }
}

export class LoanService {
  private readonly now: () => Date;
  private readonly generateId: () => string;
  /** Tracks idempotency keys so retried payment requests are not applied twice. */
  private readonly processedPayments = new Map<string, Payment>();

  constructor(private readonly opts: LoanServiceOptions) {
    this.now = opts.now ?? (() => new Date());
    this.generateId = opts.generateId ?? (() => crypto.randomUUID());
  }

  createLoan(params: {
    borrowerId: string;
    principal: Cents;
    annualRateBps: number;
    termMonths: number;
  }): Loan {
    if (params.principal <= 0) throw new Error("Principal must be positive");
    if (params.annualRateBps < 0) throw new Error("Rate cannot be negative");

    return {
      id: this.generateId(),
      borrowerId: params.borrowerId,
      principal: params.principal,
      annualRateBps: params.annualRateBps,
      termMonths: params.termMonths,
      status: "DRAFT",
      schedule: [],
      payments: [],
      history: [],
      version: 0,
    };
  }

  /** Applies a state-machine event with optimistic concurrency control. */
  transition(loan: Loan, event: LoanEvent, expectedVersion: number): Loan {
    if (loan.version !== expectedVersion) {
      throw new ConcurrencyError(expectedVersion, loan.version);
    }
    const from = loan.status;
    const to = nextStatus(from, event);
    const at = this.now();

    if (event.type === "DISBURSE") {
      loan.disbursedAt = at;
      loan.schedule = buildSchedule(loan.principal, loan.annualRateBps, loan.termMonths, at);
    }

    loan.status = to;
    loan.history.push({ from, to, event, at });
    loan.version += 1;
    return loan;
  }

  /**
   * Applies a payment. Allocation order per installment (oldest first):
   * late fees -> interest -> principal. Any excess is recorded as overpayment.
   */
  applyPayment(loan: Loan, amount: Cents, idempotencyKey: string): Payment {
    const existing = this.processedPayments.get(idempotencyKey);
    if (existing) return existing; // safe retry: return the original result

    if (!["ACTIVE", "DELINQUENT", "DEFAULTED"].includes(loan.status)) {
      throw new Error(`Payments are not accepted for loans in state "${loan.status}"`);
    }
    if (amount <= 0) throw new Error("Payment amount must be positive");

    let remaining: number = amount;
    let lateFees = 0;
    let interest = 0;
    let principal = 0;

    for (const inst of loan.schedule) {
      if (remaining === 0) break;

      const feeOwed = inst.lateFeeDue - inst.lateFeePaid;
      const feePay = Math.min(feeOwed, remaining);
      inst.lateFeePaid = cents(inst.lateFeePaid + feePay);
      remaining -= feePay;
      lateFees += feePay;

      const intOwed = inst.interestDue - inst.interestPaid;
      const intPay = Math.min(intOwed, remaining);
      inst.interestPaid = cents(inst.interestPaid + intPay);
      remaining -= intPay;
      interest += intPay;

      const prinOwed = inst.principalDue - inst.principalPaid;
      const prinPay = Math.min(prinOwed, remaining);
      inst.principalPaid = cents(inst.principalPaid + prinPay);
      remaining -= prinPay;
      principal += prinPay;
    }

    const payment: Payment = {
      id: this.generateId(),
      loanId: loan.id,
      amount,
      receivedAt: this.now(),
      allocation: {
        lateFees: cents(lateFees),
        interest: cents(interest),
        principal: cents(principal),
        overpayment: cents(remaining),
      },
    };

    loan.payments.push(payment);
    loan.version += 1;
    this.processedPayments.set(idempotencyKey, payment);

    this.reconcileStatus(loan);
    return payment;
  }

  /** Outstanding balance across all installments (fees + interest + principal). */
  outstandingBalance(loan: Loan): Cents {
    const total = loan.schedule.reduce(
      (sum, i) =>
        sum +
        (i.principalDue - i.principalPaid) +
        (i.interestDue - i.interestPaid) +
        (i.lateFeeDue - i.lateFeePaid),
      0,
    );
    return cents(total);
  }

  /** Days past due for the oldest unpaid installment (0 if current). */
  daysPastDue(loan: Loan, asOf: Date = this.now()): number {
    const oldestUnpaid = loan.schedule.find(
      (i) => i.principalPaid < i.principalDue || i.interestPaid < i.interestDue,
    );
    if (!oldestUnpaid || oldestUnpaid.dueDate >= asOf) return 0;
    const ms = asOf.getTime() - oldestUnpaid.dueDate.getTime();
    return Math.floor(ms / 86_400_000);
  }

  /**
   * Run daily (e.g. via a scheduled job): assesses late fees and moves
   * loans between ACTIVE / DELINQUENT / DEFAULTED based on days past due.
   */
  assessDelinquency(loan: Loan, asOf: Date = this.now()): Loan {
    if (!["ACTIVE", "DELINQUENT"].includes(loan.status)) return loan;

    for (const inst of loan.schedule) {
      const unpaid = inst.principalPaid < inst.principalDue || inst.interestPaid < inst.interestDue;
      const pastGrace =
        asOf.getTime() - inst.dueDate.getTime() > this.opts.gracePeriodDays * 86_400_000;
      if (unpaid && pastGrace && inst.lateFeeDue === 0) {
        inst.lateFeeDue = this.opts.lateFee;
      }
    }

    const dpd = this.daysPastDue(loan, asOf);
    if (dpd >= this.opts.defaultAfterDays && loan.status === "DELINQUENT") {
      this.transition(loan, { type: "MARK_DEFAULT" }, loan.version);
    } else if (dpd > this.opts.gracePeriodDays && loan.status === "ACTIVE") {
      this.transition(loan, { type: "MARK_DELINQUENT" }, loan.version);
    }
    return loan;
  }

  private reconcileStatus(loan: Loan): void {
    if (this.outstandingBalance(loan) === 0) {
      this.transition(loan, { type: "PAY_OFF" }, loan.version);
    } else if (loan.status === "DELINQUENT" && this.daysPastDue(loan) === 0) {
      this.transition(loan, { type: "CURE" }, loan.version);
    }
  }
}

// ---------------------------------------------------------------------------
// Example usage
// ---------------------------------------------------------------------------

const service = new LoanService({
  lateFee: toCents("25.00"),
  gracePeriodDays: 5,
  defaultAfterDays: 90,
});

const loan = service.createLoan({
  borrowerId: "borrower-123",
  principal: toCents("5000.00"),
  annualRateBps: 1200, // 12% APR
  termMonths: 12,
});

service.transition(loan, { type: "SUBMIT" }, loan.version);
service.transition(loan, { type: "START_REVIEW" }, loan.version);
service.transition(loan, { type: "APPROVE" }, loan.version);
service.transition(loan, { type: "DISBURSE" }, loan.version);
service.transition(loan, { type: "ACTIVATE" }, loan.version);

const first = loan.schedule[0];
if (first) {
  console.log("Monthly installment:", formatMoney(cents(first.principalDue + first.interestDue)));
}

const key = crypto.randomUUID();
const payment = service.applyPayment(loan, toCents("444.24"), key);
const retried = service.applyPayment(loan, toCents("444.24"), key); // same key: no double charge

console.log("Allocation:", payment.allocation);
console.log("Retry returned same payment:", payment.id === retried.id);
console.log("Outstanding:", formatMoney(service.outstandingBalance(loan)));
console.log("Status:", loan.status);
```

**Key design decisions:**

| Concern | Approach |
| --- | --- |
| Money precision | Integer cents with a branded `Cents` type. Amount strings are parsed without using floats. Interest uses banker's rounding. |
| Invalid states | A transition table plus `InvalidTransitionError`. For example, a `REJECTED` loan can't be disbursed. |
| Double payments | Each payment carries an idempotency key, so a retry returns the original result instead of charging again. |
| Concurrent edits | Each loan has a `version` number. A stale update throws `ConcurrencyError`. |
| Payment allocation | Oldest installment first, and within it: late fees, then interest, then principal. |
| Rounding drift | The last installment takes whatever is left, so the schedule adds up exactly to the principal. |

**Before production:**

- **Storage:** loans and idempotency keys are held in memory. Move both to a database and wrap each payment in a transaction, using a unique constraint on the idempotency key.
- **Large totals:** use `bigint` for portfolio-level sums that could exceed `Number.MAX_SAFE_INTEGER`.
- **Overpayments:** add handling for prepayment and for recalculating the schedule after one.
- **Ledger:** add double-entry ledger records for accounting.
- **Tests:** add unit tests for rounding edge cases, every state transition and the payment allocation rules.
