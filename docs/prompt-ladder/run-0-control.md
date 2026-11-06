# Run 0 — Control: Baseline outside this repository (raw output)

> Recorded 2026-11-06 by Lenon D. Adriano in a fresh claude.ai chat, outside this repository and
> outside the FlyRank Claude Project. Same prompt as [Run 0](../PROMPT_LADDER.md#run-0--baseline).
> The reply text is as pasted; `loan.ts` and `loan.test.ts` are the attached files, copied byte for byte.

---

I'll write a loan module (state machine, amortization schedule, payment allocation, late fees, payoff), plus tests, and run them to check it works.

`loan.ts` is a dependency-free module built around a `Loan` class. `loan.test.ts` has 13 tests that cover it, and all of them pass under strict TypeScript.

Loan states

* The loan moves through PENDING → APPROVED → ACTIVE, and can end as PAID_OFF, REJECTED, CANCELLED or WRITTEN_OFF.
* It switches between ACTIVE, DELINQUENT and DEFAULTED based on how many days the oldest unpaid installment is past due.
* Every status change is recorded with a date and a reason.
* An invalid move, like disbursing a rejected loan, throws a typed `LoanError`.

Payments

* Each payment goes to the oldest installment first. Within an installment it pays fees, then interest, then principal.
* A payment made before the due date counts toward the next installment.
* Money beyond that reduces the principal, and the remaining installments are recalculated to smaller amounts.
* `payoffQuote()` / `payOff()` close the loan early and charge interest only up to the payoff date.
* Payment IDs are idempotent. If a payment gateway resends the same transaction, it returns the original payment instead of charging twice.

Other

* `evaluate(asOf)` is meant to run daily. It charges late fees after the grace period and updates the status.
* `statement(asOf)` returns the amount due now, the next installment, and the outstanding balance, for borrower-facing screens.
* `snapshot()` / `Loan.restore()` convert the loan to and from plain JSON so you can store it in a database.

All money is stored as whole centavos, so ₱100,000.00 is `10_000_000`. This avoids floating-point rounding errors. Dates are `"YYYY-MM-DD"` strings.

Two rules are business decisions you may want to change. A defaulted loan stays DEFAULTED even after the borrower catches up, until it's paid off or written off. Extra payments are split into installments of the same count but smaller size, rather than a shorter term. Both rules are described in the comment at the top of `loan.ts`.

To run the tests: `npm i -D tsx typescript @types/node` then `npx tsx --test loan.test.ts`.

### `loan.ts`

```ts
/**
 * Loan lifecycle and payment handling for a lending app.
 *
 * Conventions
 *  - Money is always an integer in minor units (centavos / cents). Never floats.
 *  - Dates are calendar dates "YYYY-MM-DD", treated as UTC days (no time-zone drift).
 *  - Repayment is a monthly amortizing schedule, fixed at disbursement.
 *  - A payment goes to the oldest installment first; within an installment
 *    it pays fees → interest → principal.
 *  - Paying before a due date counts toward the next installment. Anything beyond
 *    that is a principal prepayment: the remaining installments are re-amortized
 *    (same number of installments, smaller amounts).
 *  - Early payoff charges interest only up to the payoff date.
 *
 * Status flow
 *   PENDING            → APPROVED | REJECTED | CANCELLED
 *   APPROVED           → ACTIVE (disburse) | CANCELLED
 *   ACTIVE            ⇄  DELINQUENT        (past the grace period / brought current)
 *   ACTIVE, DELINQUENT → DEFAULTED         (days past due > defaultAfterDays)
 *   ACTIVE, DELINQUENT, DEFAULTED → PAID_OFF
 *   DEFAULTED          → WRITTEN_OFF
 *   REJECTED, CANCELLED, PAID_OFF and WRITTEN_OFF are final.
 *   A DEFAULTED loan stays DEFAULTED until it is paid off or written off,
 *   even if the borrower catches up on missed installments.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Integer amount in minor units. ₱1,234.56 → 123456 */
export type Cents = number;
/** Calendar date, "YYYY-MM-DD". */
export type ISODate = string;

export type LoanStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "ACTIVE"
  | "DELINQUENT"
  | "DEFAULTED"
  | "PAID_OFF"
  | "WRITTEN_OFF";

export interface LoanTerms {
  /** Amount disbursed, in minor units. */
  principal: Cents;
  /** Nominal annual rate as a decimal: 0.24 = 24% a year (2% a month). */
  annualInterestRate: number;
  /** Number of monthly installments. */
  termMonths: number;
  /** Days after a due date before a late fee is charged and the loan turns DELINQUENT. */
  gracePeriodDays: number;
  /** Flat fee charged once per installment that goes past the grace period. */
  lateFee: Cents;
  /** Days past due (oldest unpaid installment) after which the loan is DEFAULTED. */
  defaultAfterDays: number;
}

export interface Installment {
  /** 1-based. */
  number: number;
  dueDate: ISODate;
  principalDue: Cents;
  interestDue: Cents;
  feesDue: Cents;
  principalPaid: Cents;
  interestPaid: Cents;
  feesPaid: Cents;
  lateFeeCharged: boolean;
}

export interface PaymentInput {
  /** Your payment reference (gateway transaction id etc.). Re-posting the same id is a no-op. */
  id: string;
  amount: Cents;
  receivedOn: ISODate;
}

export interface PaymentAllocation {
  /** Installment number, or null for a principal prepayment. */
  installment: number | null;
  fees: Cents;
  interest: Cents;
  principal: Cents;
}

export interface Payment {
  id: string;
  kind: "REGULAR" | "PAYOFF";
  amount: Cents;
  receivedOn: ISODate;
  allocations: PaymentAllocation[];
  /** Money left over once the loan is fully paid. Refund it or hold it as credit. */
  unapplied: Cents;
}

export interface StatusChange {
  from: LoanStatus | null;
  to: LoanStatus;
  on: ISODate;
  reason: string;
}

export interface Balance {
  principal: Cents;
  interest: Cents;
  fees: Cents;
  total: Cents;
}

export interface PayoffQuote extends Balance {
  asOf: ISODate;
}

export interface Statement {
  asOf: ISODate;
  status: LoanStatus;
  daysPastDue: number;
  /** Everything due on or before asOf, including late fees that apply by then. */
  amountDue: Cents;
  nextInstallment: { number: number; dueDate: ISODate; amount: Cents } | null;
  /** Remaining per the schedule (includes interest not yet earned; see payoffQuote). */
  outstanding: Balance;
}

/** Plain-JSON form for saving to a database. */
export interface LoanSnapshot {
  id: string;
  terms: LoanTerms;
  status: LoanStatus;
  disbursedOn: ISODate | null;
  schedule: Installment[];
  payments: Payment[];
  history: StatusChange[];
}

export type LoanErrorCode =
  | "INVALID_TERMS"
  | "INVALID_DATE"
  | "INVALID_AMOUNT"
  | "INVALID_TRANSITION"
  | "NOT_SERVICING"
  | "DUPLICATE_PAYMENT"
  | "INSUFFICIENT_PAYOFF";

export class LoanError extends Error {
  constructor(readonly code: LoanErrorCode, message: string) {
    super(message);
    this.name = "LoanError";
  }
}

// ─── State machine ──────────────────────────────────────────────────────────

const TRANSITIONS: Readonly<Record<LoanStatus, readonly LoanStatus[]>> = {
  PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["DELINQUENT", "DEFAULTED", "PAID_OFF"],
  DELINQUENT: ["ACTIVE", "DEFAULTED", "PAID_OFF"],
  DEFAULTED: ["PAID_OFF", "WRITTEN_OFF"],
  REJECTED: [],
  CANCELLED: [],
  PAID_OFF: [],
  WRITTEN_OFF: [],
};

/** Statuses in which the loan is being repaid and accepts payments. */
const SERVICING: ReadonlySet<LoanStatus> = new Set<LoanStatus>(["ACTIVE", "DELINQUENT", "DEFAULTED"]);

export function canTransition(from: LoanStatus, to: LoanStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtcMs(date: ISODate): number {
  if (ISO_DATE.test(date)) {
    const [y, m, d] = date.split("-").map(Number);
    const ms = Date.UTC(y, m - 1, d);
    // Rejects dates like 2026-02-30 that Date.UTC would silently roll over.
    if (new Date(ms).toISOString().startsWith(date)) return ms;
  }
  throw new LoanError("INVALID_DATE", `Not a valid YYYY-MM-DD date: "${date}"`);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** Same day of month `months` later, clamped to month end (Jan 31 + 1 → Feb 28/29). */
export function addMonths(date: ISODate, months: number): ISODate {
  const start = new Date(toUtcMs(date));
  const day = start.getUTCDate();
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

// ─── Amortization ───────────────────────────────────────────────────────────

/**
 * Level-payment schedule for `balance` over `periods` at `monthlyRate`.
 * Every row except the last has the same total; the last absorbs rounding.
 */
export function amortize(
  balance: Cents,
  monthlyRate: number,
  periods: number,
): { principal: Cents; interest: Cents }[] {
  const rows: { principal: Cents; interest: Cents }[] = [];
  if (periods <= 0) return rows;

  if (monthlyRate === 0) {
    const base = Math.floor(balance / periods);
    const extra = balance % periods;
    for (let i = 0; i < periods; i++) rows.push({ principal: base + (i < extra ? 1 : 0), interest: 0 });
    return rows;
  }

  const payment = Math.round((balance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -periods)));
  let remaining = balance;
  for (let i = 1; i <= periods; i++) {
    const interest = Math.round(remaining * monthlyRate);
    const principal = i === periods ? remaining : Math.min(remaining, Math.max(0, payment - interest));
    remaining -= principal;
    rows.push({ principal, interest });
  }
  return rows;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const feesLeft = (i: Installment): Cents => i.feesDue - i.feesPaid;
const interestLeft = (i: Installment): Cents => i.interestDue - i.interestPaid;
const principalLeft = (i: Installment): Cents => i.principalDue - i.principalPaid;
const amountLeft = (i: Installment): Cents => feesLeft(i) + interestLeft(i) + principalLeft(i);
const allocated = (a: PaymentAllocation): Cents => a.fees + a.interest + a.principal;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Pays fees → interest → principal on one installment. Mutates it. */
function allocateTo(inst: Installment, available: Cents): PaymentAllocation | null {
  const fees = Math.min(available, feesLeft(inst));
  available -= fees;
  const interest = Math.min(available, interestLeft(inst));
  available -= interest;
  const principal = Math.min(available, principalLeft(inst));
  if (fees + interest + principal === 0) return null;
  inst.feesPaid += fees;
  inst.interestPaid += interest;
  inst.principalPaid += principal;
  return { installment: inst.number, fees, interest, principal };
}

function validateTerms(t: LoanTerms): void {
  const fail = (message: string): never => {
    throw new LoanError("INVALID_TERMS", message);
  };
  if (!Number.isSafeInteger(t.principal) || t.principal <= 0)
    fail("principal must be a positive integer in minor units");
  if (!Number.isFinite(t.annualInterestRate) || t.annualInterestRate < 0)
    fail("annualInterestRate must be a non-negative decimal (0.24 = 24%)");
  if (!Number.isInteger(t.termMonths) || t.termMonths < 1 || t.termMonths > 600)
    fail("termMonths must be an integer from 1 to 600");
  if (!Number.isInteger(t.gracePeriodDays) || t.gracePeriodDays < 0)
    fail("gracePeriodDays must be a non-negative integer");
  if (!Number.isSafeInteger(t.lateFee) || t.lateFee < 0)
    fail("lateFee must be a non-negative integer in minor units");
  if (!Number.isInteger(t.defaultAfterDays) || t.defaultAfterDays <= t.gracePeriodDays)
    fail("defaultAfterDays must be an integer greater than gracePeriodDays");
}

// ─── Loan ───────────────────────────────────────────────────────────────────

export class Loan {
  readonly terms: Readonly<LoanTerms>;
  private _status: LoanStatus = "PENDING";
  private _disbursedOn: ISODate | null = null;
  private _schedule: Installment[] = [];
  private _payments: Payment[] = [];
  private _history: StatusChange[] = [];

  constructor(readonly id: string, terms: LoanTerms, appliedOn: ISODate) {
    validateTerms(terms);
    toUtcMs(appliedOn);
    this.terms = Object.freeze({ ...terms });
    this._history.push({ from: null, to: "PENDING", on: appliedOn, reason: "Application submitted" });
  }

  static restore(snapshot: LoanSnapshot): Loan {
    const s = clone(snapshot);
    const loan = new Loan(s.id, s.terms, s.history[0]?.on ?? s.disbursedOn ?? "1970-01-01");
    loan._status = s.status;
    loan._disbursedOn = s.disbursedOn;
    loan._schedule = s.schedule;
    loan._payments = s.payments;
    loan._history = s.history;
    return loan;
  }

  snapshot(): LoanSnapshot {
    return clone({
      id: this.id,
      terms: this.terms,
      status: this._status,
      disbursedOn: this._disbursedOn,
      schedule: this._schedule,
      payments: this._payments,
      history: this._history,
    });
  }

  // Read-only views (copies, so callers can't mutate internal state).
  get status(): LoanStatus { return this._status; }
  get servicing(): boolean { return SERVICING.has(this._status); }
  get disbursedOn(): ISODate | null { return this._disbursedOn; }
  get schedule(): Installment[] { return clone(this._schedule); }
  get payments(): Payment[] { return clone(this._payments); }
  get history(): StatusChange[] { return clone(this._history); }

  private get monthlyRate(): number {
    return this.terms.annualInterestRate / 12;
  }

  // ── Lifecycle ──

  approve(on: ISODate, reason = "Approved"): void {
    this.transition("APPROVED", on, reason);
  }

  reject(on: ISODate, reason: string): void {
    this.transition("REJECTED", on, reason);
  }

  cancel(on: ISODate, reason: string): void {
    this.transition("CANCELLED", on, reason);
  }

  /** Releases funds and fixes the repayment schedule; first due date is one month later. */
  disburse(on: ISODate): void {
    this.assertTransition("ACTIVE");
    toUtcMs(on);
    this._schedule = amortize(this.terms.principal, this.monthlyRate, this.terms.termMonths).map((row, idx) => ({
      number: idx + 1,
      dueDate: addMonths(on, idx + 1),
      principalDue: row.principal,
      interestDue: row.interest,
      feesDue: 0,
      principalPaid: 0,
      interestPaid: 0,
      feesPaid: 0,
      lateFeeCharged: false,
    }));
    this._disbursedOn = on;
    this.transition("ACTIVE", on, "Funds disbursed");
  }

  writeOff(on: ISODate, reason: string): void {
    this.transition("WRITTEN_OFF", on, reason);
  }

  /**
   * Run daily (e.g. from a scheduled job): charges late fees that have come due
   * and moves the loan between ACTIVE, DELINQUENT and DEFAULTED.
   */
  evaluate(asOf: ISODate): LoanStatus {
    toUtcMs(asOf);
    if (!this.servicing) return this._status;
    for (const inst of this._schedule) {
      if (this.isLate(inst, asOf)) {
        inst.feesDue += this.terms.lateFee;
        inst.lateFeeCharged = true;
      }
    }
    this.refreshStatus(asOf);
    return this._status;
  }

  // ── Payments ──

  /** Posts a regular payment. Safe to retry with the same id. */
  applyPayment(input: PaymentInput): Payment {
    const prior = this.findRetry(input);
    if (prior) return prior;
    this.checkPayment(input);
    const { receivedOn } = input;
    this.evaluate(receivedOn); // late fees up to the day the money arrived

    let left = input.amount;
    const allocations: PaymentAllocation[] = [];

    // 1) Everything due on or before today, plus the next upcoming installment.
    const next = this.currentPeriodIndex(receivedOn);
    const regularEnd = next === -1 ? this._schedule.length : next + 1;
    for (let i = 0; i < regularEnd && left > 0; i++) {
      const a = allocateTo(this._schedule[i], left);
      if (a) {
        allocations.push(a);
        left -= allocated(a);
      }
    }

    // 2) The rest prepays principal; later installments are re-amortized.
    const later = this._schedule.slice(regularEnd);
    const laterPrincipal = later.reduce((sum, i) => sum + principalLeft(i), 0);
    if (left > 0 && laterPrincipal > 0) {
      const prepaid = Math.min(left, laterPrincipal);
      const rows = amortize(laterPrincipal - prepaid, this.monthlyRate, later.length);
      later.forEach((inst, k) => {
        inst.principalDue = inst.principalPaid + rows[k].principal;
        inst.interestDue = inst.interestPaid + rows[k].interest;
      });
      allocations.push({ installment: null, fees: 0, interest: 0, principal: prepaid });
      left -= prepaid;
    }

    return this.record(input, "REGULAR", allocations, left);
  }

  /** What it takes to close the loan on `asOf`: interest is charged only up to that day. */
  payoffQuote(asOf: ISODate): PayoffQuote {
    this.assertServicing();
    toUtcMs(asOf);
    const cur = this.currentPeriodIndex(asOf);
    let principal = 0;
    let interest = 0;
    let fees = 0;
    this._schedule.forEach((inst, idx) => {
      principal += principalLeft(inst);
      fees += feesLeft(inst) + (this.isLate(inst, asOf) ? this.terms.lateFee : 0);
      if (cur === -1 || idx < cur) interest += interestLeft(inst);
      else if (idx === cur) interest += Math.max(0, this.accruedInterest(idx, asOf) - inst.interestPaid);
      // Later periods: interest not yet earned, so it's waived.
    });
    return { asOf, principal, interest, fees, total: principal + interest + fees };
  }

  /** Closes the loan early. The amount must cover payoffQuote(receivedOn).total. */
  payOff(input: PaymentInput): Payment {
    const prior = this.findRetry(input);
    if (prior) return prior;
    this.checkPayment(input);
    const { receivedOn } = input;
    const quote = this.payoffQuote(receivedOn);
    if (input.amount < quote.total) {
      throw new LoanError(
        "INSUFFICIENT_PAYOFF",
        `Payoff on ${receivedOn} is ${quote.total}; received ${input.amount}`,
      );
    }

    this.evaluate(receivedOn);
    const cur = this.currentPeriodIndex(receivedOn);
    if (cur !== -1) {
      // Waive unearned interest. Interest already paid ahead is kept, not refunded.
      for (let idx = cur; idx < this._schedule.length; idx++) {
        const inst = this._schedule[idx];
        const earned = idx === cur ? this.accruedInterest(idx, receivedOn) : 0;
        inst.interestDue = Math.max(inst.interestPaid, earned);
      }
    }

    let left = input.amount;
    const allocations: PaymentAllocation[] = [];
    for (const inst of this._schedule) {
      if (left === 0) break;
      const a = allocateTo(inst, left);
      if (a) {
        allocations.push(a);
        left -= allocated(a);
      }
    }
    return this.record(input, "PAYOFF", allocations, left);
  }

  // ── Queries ──

  /** Remaining per the schedule, including interest not yet earned. */
  outstanding(): Balance {
    let principal = 0;
    let interest = 0;
    let fees = 0;
    for (const inst of this._schedule) {
      principal += principalLeft(inst);
      interest += interestLeft(inst);
      fees += feesLeft(inst);
    }
    return { principal, interest, fees, total: principal + interest + fees };
  }

  /** Days since the oldest unpaid due date (0 if nothing is overdue). */
  daysPastDue(asOf: ISODate): number {
    const oldest = this._schedule.find((i) => amountLeft(i) > 0 && i.dueDate < asOf);
    return oldest ? daysBetween(oldest.dueDate, asOf) : 0;
  }

  /** What a borrower-facing screen needs. Doesn't change the loan. */
  statement(asOf: ISODate): Statement {
    toUtcMs(asOf);
    let amountDue = 0;
    for (const inst of this._schedule) {
      if (inst.dueDate <= asOf) amountDue += amountLeft(inst) + (this.isLate(inst, asOf) ? this.terms.lateFee : 0);
    }
    const next = this._schedule.find((i) => i.dueDate > asOf && amountLeft(i) > 0);
    return {
      asOf,
      status: this._status,
      daysPastDue: this.daysPastDue(asOf),
      amountDue,
      nextInstallment: next ? { number: next.number, dueDate: next.dueDate, amount: amountLeft(next) } : null,
      outstanding: this.outstanding(),
    };
  }

  // ── Internals ──

  private transition(to: LoanStatus, on: ISODate, reason: string): void {
    toUtcMs(on);
    this.assertTransition(to);
    this._history.push({ from: this._status, to, on, reason });
    this._status = to;
  }

  private assertTransition(to: LoanStatus): void {
    if (!canTransition(this._status, to)) {
      throw new LoanError("INVALID_TRANSITION", `Loan ${this.id} can't go from ${this._status} to ${to}`);
    }
  }

  private assertServicing(): void {
    if (!this.servicing) {
      throw new LoanError("NOT_SERVICING", `Loan ${this.id} is ${this._status} and can't take payments`);
    }
  }

  private refreshStatus(on: ISODate): void {
    if (!this.servicing) return;
    if (this.outstanding().total === 0) {
      this.transition("PAID_OFF", on, "Balance fully paid");
      return;
    }
    if (this._status === "DEFAULTED") return; // only payoff or write-off leaves DEFAULTED

    const dpd = this.daysPastDue(on);
    const target: LoanStatus =
      dpd > this.terms.defaultAfterDays ? "DEFAULTED" : dpd > this.terms.gracePeriodDays ? "DELINQUENT" : "ACTIVE";
    if (target !== this._status) {
      this.transition(target, on, target === "ACTIVE" ? "Brought current" : `${dpd} days past due`);
    }
  }

  private isLate(inst: Installment, asOf: ISODate): boolean {
    return !inst.lateFeeCharged && amountLeft(inst) > 0 && daysBetween(inst.dueDate, asOf) > this.terms.gracePeriodDays;
  }

  /** Index of the first installment due after `asOf`, or -1 if all are due. */
  private currentPeriodIndex(asOf: ISODate): number {
    return this._schedule.findIndex((i) => i.dueDate > asOf);
  }

  /** Interest earned so far in the period ending at installment `idx`, by days elapsed. */
  private accruedInterest(idx: number, asOf: ISODate): Cents {
    const inst = this._schedule[idx];
    const start = idx === 0 ? (this._disbursedOn as ISODate) : this._schedule[idx - 1].dueDate;
    const periodDays = daysBetween(start, inst.dueDate);
    const elapsed = Math.min(Math.max(daysBetween(start, asOf), 0), periodDays);
    return Math.round((inst.interestDue * elapsed) / periodDays);
  }

  private findRetry(input: PaymentInput): Payment | undefined {
    const existing = this._payments.find((p) => p.id === input.id);
    if (!existing) return undefined;
    if (existing.amount !== input.amount || existing.receivedOn !== input.receivedOn) {
      throw new LoanError("DUPLICATE_PAYMENT", `Payment id ${input.id} was already used with different details`);
    }
    return clone(existing);
  }

  private checkPayment(input: PaymentInput): void {
    this.assertServicing();
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new LoanError("INVALID_AMOUNT", "Payment amount must be a positive integer in minor units");
    }
    toUtcMs(input.receivedOn);
    if (this._disbursedOn && input.receivedOn < this._disbursedOn) {
      throw new LoanError("INVALID_DATE", "Payment is dated before the loan was disbursed");
    }
  }

  private record(
    input: PaymentInput,
    kind: Payment["kind"],
    allocations: PaymentAllocation[],
    unapplied: Cents,
  ): Payment {
    const payment: Payment = {
      id: input.id,
      kind,
      amount: input.amount,
      receivedOn: input.receivedOn,
      allocations,
      unapplied,
    };
    this._payments.push(payment);
    this.refreshStatus(input.receivedOn);
    return clone(payment);
  }
}
```

### `loan.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Loan, LoanError, addMonths, amortize, daysBetween, type Installment, type LoanTerms } from "./loan";

const TERMS: LoanTerms = {
  principal: 10_000_000, // ₱100,000.00
  annualInterestRate: 0.24, // 2% a month
  termMonths: 12,
  gracePeriodDays: 5,
  lateFee: 50_000, // ₱500.00
  defaultAfterDays: 90,
};

function activeLoan(): Loan {
  const loan = new Loan("L-001", TERMS, "2026-01-20");
  loan.approve("2026-01-25");
  loan.disburse("2026-01-31");
  return loan;
}

const left = (i: Installment) =>
  i.principalDue + i.interestDue + i.feesDue - i.principalPaid - i.interestPaid - i.feesPaid;
const code = (c: string) => (e: unknown) => e instanceof LoanError && e.code === c;

test("schedule: level payments, principal sums exactly, month-end due dates", () => {
  const s = activeLoan().schedule;
  assert.equal(s.length, 12);
  assert.equal(s.reduce((n, i) => n + i.principalDue, 0), TERMS.principal);
  assert.equal(s[0].interestDue, 200_000);
  assert.deepEqual(s.slice(0, 3).map((i) => i.dueDate), ["2026-02-28", "2026-03-31", "2026-04-30"]);
  const amounts = s.map(left);
  for (const a of amounts.slice(0, 11)) assert.equal(a, amounts[0]);
  assert.ok(Math.abs(amounts[11] - amounts[0]) < 100);
});

test("zero-interest schedule spreads the remainder", () => {
  assert.deepEqual(amortize(1000, 0, 3).map((r) => r.principal), [334, 333, 333]);
});

test("date helpers", () => {
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(daysBetween("2026-02-28", "2026-03-06"), 6);
  assert.throws(() => daysBetween("2026-02-30", "2026-03-01"), code("INVALID_DATE"));
});

test("lifecycle: invalid transitions and terms are rejected", () => {
  assert.throws(() => new Loan("bad", { ...TERMS, defaultAfterDays: 3 }, "2026-01-20"), code("INVALID_TERMS"));
  const loan = new Loan("L-002", TERMS, "2026-01-20");
  assert.throws(() => loan.disburse("2026-01-21"), code("INVALID_TRANSITION"));
  assert.throws(
    () => loan.applyPayment({ id: "p", amount: 100, receivedOn: "2026-01-21" }),
    code("NOT_SERVICING"),
  );
  loan.reject("2026-01-22", "Incomplete documents");
  assert.throws(() => loan.approve("2026-01-23"), code("INVALID_TRANSITION"));
  assert.deepEqual(loan.history.map((h) => h.to), ["PENDING", "REJECTED"]);
});

test("late fee after grace period, fees paid first, cured back to ACTIVE", () => {
  const loan = activeLoan();
  assert.equal(loan.evaluate("2026-03-05"), "ACTIVE"); // 5 days late = still in grace
  assert.equal(loan.schedule[0].feesDue, 0);
  assert.equal(loan.evaluate("2026-03-06"), "DELINQUENT");
  assert.equal(loan.schedule[0].feesDue, 50_000);

  const p = loan.applyPayment({ id: "p1", amount: 60_000, receivedOn: "2026-03-06" });
  assert.deepEqual(p.allocations, [{ installment: 1, fees: 50_000, interest: 10_000, principal: 0 }]);
  assert.equal(loan.status, "DELINQUENT");

  loan.applyPayment({ id: "p2", amount: left(loan.schedule[0]), receivedOn: "2026-03-07" });
  assert.equal(loan.status, "ACTIVE");
  loan.evaluate("2026-03-08");
  assert.equal(loan.schedule[0].feesDue, 50_000); // not charged twice
});

test("default: catching up doesn't cure it; payoff closes it", () => {
  const loan = activeLoan();
  assert.equal(loan.evaluate("2026-06-01"), "DEFAULTED"); // 93 days past due
  assert.equal(loan.schedule.filter((i) => i.lateFeeCharged).length, 3);

  const { amountDue } = loan.statement("2026-06-01");
  loan.applyPayment({ id: "catch-up", amount: amountDue, receivedOn: "2026-06-01" });
  assert.equal(loan.status, "DEFAULTED");
  assert.equal(loan.daysPastDue("2026-06-01"), 0);

  const quote = loan.payoffQuote("2026-06-01");
  loan.payOff({ id: "settle", amount: quote.total, receivedOn: "2026-06-01" });
  assert.equal(loan.status, "PAID_OFF");
});

test("write-off only from DEFAULTED; no payments afterwards", () => {
  const loan = activeLoan();
  assert.throws(() => loan.writeOff("2026-03-01", "x"), code("INVALID_TRANSITION"));
  loan.evaluate("2026-06-01");
  loan.writeOff("2026-06-02", "Uncollectible");
  assert.equal(loan.status, "WRITTEN_OFF");
  assert.throws(
    () => loan.applyPayment({ id: "late", amount: 1000, receivedOn: "2026-06-03" }),
    code("NOT_SERVICING"),
  );
});

test("paying before the due date counts toward that installment", () => {
  const loan = activeLoan();
  const before = loan.schedule;
  const p = loan.applyPayment({ id: "early", amount: left(before[0]), receivedOn: "2026-02-20" });
  assert.deepEqual(p.allocations.map((a) => a.installment), [1]);
  assert.deepEqual(loan.schedule[1], before[1]);
});

test("extra money prepays principal and re-amortizes the rest", () => {
  const loan = activeLoan();
  const before = loan.schedule;
  // On the due date of #1: pays #1, then the next one (#2), then the rest prepays.
  const p = loan.applyPayment({ id: "extra", amount: left(before[0]) + 3_000_000, receivedOn: "2026-02-28" });
  assert.deepEqual(p.allocations.map((a) => a.installment), [1, 2, null]);
  const prepaid = p.allocations[2].principal;
  assert.equal(prepaid, 3_000_000 - left(before[1]));

  const after = loan.schedule;
  assert.equal(after.length, 12);
  assert.ok(left(after[2]) < left(before[2]));
  assert.equal(
    after.slice(2).reduce((n, i) => n + i.principalDue, 0),
    TERMS.principal - before[0].principalDue - before[1].principalDue - prepaid,
  );
});

test("early payoff charges interest only to the payoff date", () => {
  const loan = activeLoan();
  loan.applyPayment({ id: "m1", amount: left(loan.schedule[0]), receivedOn: "2026-02-28" });
  const s = loan.schedule;
  const quote = loan.payoffQuote("2026-03-15");
  assert.equal(quote.principal, TERMS.principal - s[0].principalDue);
  assert.equal(quote.interest, Math.round((s[1].interestDue * 15) / 31));
  assert.equal(quote.fees, 0);
  assert.ok(quote.total < s.slice(1).reduce((n, i) => n + left(i), 0));

  assert.throws(
    () => loan.payOff({ id: "po", amount: quote.total - 1, receivedOn: "2026-03-15" }),
    code("INSUFFICIENT_PAYOFF"),
  );
  const p = loan.payOff({ id: "po", amount: quote.total + 100, receivedOn: "2026-03-15" });
  assert.equal(p.unapplied, 100);
  assert.equal(loan.status, "PAID_OFF");
  assert.equal(loan.outstanding().total, 0);
});

test("payments are idempotent by id", () => {
  const loan = activeLoan();
  const input = { id: "gw-123", amount: 100_000, receivedOn: "2026-02-10" };
  const a = loan.applyPayment(input);
  assert.deepEqual(loan.applyPayment(input), a);
  assert.equal(loan.payments.length, 1);
  assert.throws(() => loan.applyPayment({ ...input, amount: 200_000 }), code("DUPLICATE_PAYMENT"));
});

test("full repayment with a prepayment: every centavo of principal accounted for", () => {
  const loan = activeLoan();
  const inputs = [];
  let lastUnapplied = -1;
  for (let n = 1; loan.servicing && n < 50; n++) {
    const next = loan.schedule.find((i) => left(i) > 0)!;
    const extra = next.number === 3 ? 2_000_000 : next.number === 12 ? 500 : 0;
    const input = { id: `m${n}`, amount: left(next) + extra, receivedOn: next.dueDate };
    inputs.push(input);
    lastUnapplied = loan.applyPayment(input).unapplied;
    assert.ok(loan.status === "ACTIVE" || loan.status === "PAID_OFF");
  }
  assert.equal(loan.status, "PAID_OFF");
  assert.equal(lastUnapplied, 500);
  const principalPaid = loan.payments.flatMap((p) => p.allocations).reduce((s, a) => s + a.principal, 0);
  assert.equal(principalPaid, TERMS.principal);
  // A gateway retry after payoff returns the original payment instead of failing.
  assert.equal(loan.applyPayment(inputs[0]).id, "m1");
});

test("snapshot / restore round-trip", () => {
  const loan = activeLoan();
  loan.applyPayment({ id: "m1", amount: 300_000, receivedOn: "2026-02-15" });
  const restored = Loan.restore(JSON.parse(JSON.stringify(loan.snapshot())));
  assert.deepEqual(restored.statement("2026-03-10"), loan.statement("2026-03-10"));
  restored.applyPayment({ id: "m1", amount: 300_000, receivedOn: "2026-02-15" });
  assert.equal(restored.payments.length, 1);
});
```
