# Run 5 — Version 5: + Verification Requirements, V4 rolled back (raw output)

> Recorded 2026-11-06 in a fresh Claude subagent with no tools. Verbatim response; nothing edited.
> Prompt: [`PROMPT_LADDER.md` → Run 5](../PROMPT_LADDER.md#run-5--version-5-verification-requirements-v4-rolled-back)

---

**Design decisions**

- **Signature:** `transitionLoan(loan, event)` is a pure reducer over a `Loan` aggregate. The aggregate holds its own `journal` and its idempotency records, so idempotency needs no outside store and no I/O. The caller persists `result.loan` with a compare-and-swap on `version`.
- **Order of checks:** key format, then idempotency replay, then `If-Match`, then the state transition. Replay has to come before `If-Match`. A retry carries the version from before the first call succeeded, so checking the version first would turn every legitimate retry into a 409.
- **Repayment allocation:** interest is paid first, then principal. The finance charge is fixed as integer centavos at `APPROVE`. Allocation only uses `Math.min` and subtraction on validated integers, so there is no rounding step anywhere.
- **Settlement:** a repayment that brings a `REPAYING` loan's balance to zero moves it to `SETTLED` in the same call. `DELINQUENT → SETTLED` is not in the graph, so a payoff of a delinquent loan is rejected. The loan must be cured with `CURE` first. Partial repayments are accepted in `DELINQUENT`.
- **Disbursement:** disbursing posts a journal entry too (Dr receivable / Cr wallet clearing). That way every movement of money follows the same balance rule. Interest is recognised when it is paid (cash basis).
- **Out of scope:** a write-off entry on `DEFAULTED`, and expiring old idempotency records. Both belong to the persistence/GL layer.

```ts
// loanStateMachine.ts

// ---------- Money ----------

export type Centavos = number & { readonly __brand: 'Centavos' };

export const isCentavos = (value: number): value is Centavos =>
  Number.isSafeInteger(value) && value >= 0;

/** Boundary constructor (parsers, fixtures). Never called inside transitionLoan. */
export const toCentavos = (value: number): Centavos => {
  if (!isCentavos(value)) {
    throw new RangeError(`Centavos must be a non-negative safe integer; received ${String(value)}`);
  }
  return value;
};

/** Re-brands the result of integer arithmetic on already-validated Centavos operands. */
const unsafeCentavos = (value: number): Centavos => value as Centavos;

// ---------- Ledger ----------

export type WalletProvider = 'gcash' | 'maya';
export type WalletClearingAccount = `wallet_clearing:${WalletProvider}`;
export type ReceivableAccount = `loans_receivable:${string}`;
export type LedgerAccount = WalletClearingAccount | ReceivableAccount | 'interest_income';
export type JournalSide = 'DEBIT' | 'CREDIT';

export type JournalLine = {
  readonly account: LedgerAccount;
  readonly side: JournalSide;
  readonly amount: Centavos;
};

export type RepaymentAllocation = {
  readonly principal: Centavos;
  readonly interest: Centavos;
};

export type JournalPosting =
  | { readonly kind: 'DISBURSEMENT'; readonly lines: readonly JournalLine[] }
  | {
      readonly kind: 'REPAYMENT';
      readonly lines: readonly JournalLine[];
      readonly allocation: RepaymentAllocation;
    };

export type JournalEntry = {
  readonly id: string;
  readonly loanId: string;
  readonly idempotencyKey: string;
  readonly loanVersion: number;
} & JournalPosting;

const walletClearing = (wallet: WalletProvider): WalletClearingAccount =>
  wallet === 'gcash' ? 'wallet_clearing:gcash' : 'wallet_clearing:maya';

const receivable = (borrowerId: string): ReceivableAccount =>
  `loans_receivable:${borrowerId}` as const;

const line = (account: LedgerAccount, side: JournalSide, amount: Centavos): JournalLine => ({
  account,
  side,
  amount,
});

export const sumSide = (entry: JournalEntry, side: JournalSide): number =>
  entry.lines.reduce((total, l) => (l.side === side ? total + l.amount : total), 0);

export const isBalanced = (entry: JournalEntry): boolean => {
  const debits = sumSide(entry, 'DEBIT');
  const credits = sumSide(entry, 'CREDIT');
  return (
    entry.lines.length >= 2 &&
    entry.lines.every((l) => Number.isSafeInteger(l.amount) && l.amount > 0) &&
    Number.isSafeInteger(debits) &&
    debits > 0 &&
    debits === credits
  );
};

// ---------- Loan states ----------

export type ServicingBalances = {
  readonly financeCharge: Centavos;
  readonly wallet: WalletProvider;
  readonly outstandingPrincipal: Centavos;
  readonly outstandingInterest: Centavos;
};

export type LoanState =
  | { readonly status: 'APPLIED' }
  | { readonly status: 'UNDER_REVIEW' }
  | { readonly status: 'APPROVED'; readonly financeCharge: Centavos }
  | { readonly status: 'REJECTED'; readonly reason: string }
  | { readonly status: 'CANCELLED' }
  | ({ readonly status: 'DISBURSED' } & ServicingBalances)
  | ({ readonly status: 'REPAYING' } & ServicingBalances)
  | ({ readonly status: 'DELINQUENT' } & ServicingBalances)
  | { readonly status: 'SETTLED'; readonly financeCharge: Centavos; readonly wallet: WalletProvider }
  | ({ readonly status: 'DEFAULTED' } & ServicingBalances);

export type LoanStatus = LoanState['status'];

export type IdempotencyRecord = {
  readonly fingerprint: string;
  readonly resultingVersion: number;
  readonly journalEntry: JournalEntry | null;
};

export type LoanCore = {
  readonly id: string;
  readonly borrowerId: string;
  readonly principal: Centavos;
  readonly version: number;
  readonly journal: readonly JournalEntry[];
  /** Scoped to this aggregate. TTL/pruning is the repository's job. */
  readonly idempotency: ReadonlyMap<string, IdempotencyRecord>;
};

export type Loan = LoanCore & LoanState;

type ServicingLoan = Extract<Loan, { status: 'DISBURSED' | 'REPAYING' | 'DELINQUENT' }>;

export const applyForLoan = (input: {
  readonly id: string;
  readonly borrowerId: string;
  readonly principal: Centavos;
}): Loan => ({
  id: input.id,
  borrowerId: input.borrowerId,
  principal: input.principal,
  version: 1,
  journal: [],
  idempotency: new Map<string, IdempotencyRecord>(),
  status: 'APPLIED',
});

// ---------- Events ----------

type Command = {
  /** `Idempotency-Key` header, UUID v4, generated once per user intent. */
  readonly idempotencyKey: string;
  /** `If-Match` header: the loan version the client last read. */
  readonly ifMatch: number;
};

export type LoanEvent =
  | (Command & { readonly type: 'SUBMIT_FOR_REVIEW' })
  | (Command & { readonly type: 'APPROVE'; readonly financeCharge: Centavos })
  | (Command & { readonly type: 'REJECT'; readonly reason: string })
  | (Command & { readonly type: 'CANCEL' })
  | (Command & { readonly type: 'DISBURSE'; readonly wallet: WalletProvider })
  | (Command & { readonly type: 'START_REPAYMENT' })
  | (Command & {
      readonly type: 'RECORD_REPAYMENT';
      readonly amount: Centavos;
      readonly channel: WalletProvider;
    })
  | (Command & { readonly type: 'MARK_DELINQUENT' })
  | (Command & { readonly type: 'CURE' })
  | (Command & { readonly type: 'DECLARE_DEFAULT' });

export type LoanEventType = LoanEvent['type'];
type RepaymentEvent = Extract<LoanEvent, { type: 'RECORD_REPAYMENT' }>;

// ---------- Results ----------

export type TransitionFailure =
  | {
      readonly ok: false;
      readonly status: 409;
      readonly code: 'VERSION_MISMATCH';
      readonly currentVersion: number;
    }
  | {
      readonly ok: false;
      readonly status: 409;
      readonly code: 'ILLEGAL_TRANSITION';
      readonly from: LoanStatus;
      readonly event: LoanEventType;
      readonly reason: string;
    }
  | { readonly ok: false; readonly status: 422; readonly code: 'IDEMPOTENCY_KEY_REUSED' }
  | { readonly ok: false; readonly status: 422; readonly code: 'INVALID_AMOUNT'; readonly reason: string }
  | { readonly ok: false; readonly status: 400; readonly code: 'INVALID_IDEMPOTENCY_KEY' }
  | { readonly ok: false; readonly status: 500; readonly code: 'LEDGER_INVARIANT_VIOLATION' };

export type TransitionSuccess = {
  readonly ok: true;
  /** true => nothing was applied; `loan` is the input aggregate, `journalEntry` the original entry. */
  readonly replayed: boolean;
  readonly loan: Loan;
  readonly journalEntry: JournalEntry | null;
};

export type TransitionResult = TransitionSuccess | TransitionFailure;

// ---------- Decision (pure, no versioning / idempotency concerns) ----------

type Decision =
  | { readonly ok: true; readonly state: LoanState; readonly posting: JournalPosting | null }
  | TransitionFailure;

const advance = (state: LoanState, posting: JournalPosting | null = null): Decision => ({
  ok: true,
  state,
  posting,
});

const illegal = (loan: Loan, event: LoanEvent, reason?: string): TransitionFailure => ({
  ok: false,
  status: 409,
  code: 'ILLEGAL_TRANSITION',
  from: loan.status,
  event: event.type,
  reason: reason ?? `${event.type} is not allowed from ${loan.status}`,
});

const invalidAmount = (reason: string): TransitionFailure => ({
  ok: false,
  status: 422,
  code: 'INVALID_AMOUNT',
  reason,
});

const balancesOf = (loan: ServicingLoan): ServicingBalances => ({
  financeCharge: loan.financeCharge,
  wallet: loan.wallet,
  outstandingPrincipal: loan.outstandingPrincipal,
  outstandingInterest: loan.outstandingInterest,
});

function applyRepayment(loan: Loan, event: RepaymentEvent): Decision {
  if (loan.status !== 'REPAYING' && loan.status !== 'DELINQUENT') return illegal(loan, event);

  const { amount } = event;
  if (!isCentavos(amount) || amount === 0) {
    return invalidAmount('repayment amount must be a positive safe integer of centavos');
  }

  const outstanding = loan.outstandingPrincipal + loan.outstandingInterest;
  if (amount > outstanding) {
    return invalidAmount(`repayment ${amount} exceeds outstanding balance ${outstanding}`);
  }

  // Interest first, then principal. Integer-only: no rounding step exists.
  const interest = unsafeCentavos(Math.min(amount, loan.outstandingInterest));
  const principal = unsafeCentavos(amount - interest);
  const remainingPrincipal = unsafeCentavos(loan.outstandingPrincipal - principal);
  const remainingInterest = unsafeCentavos(loan.outstandingInterest - interest);
  const fullyPaid = remainingPrincipal === 0 && remainingInterest === 0;

  if (fullyPaid && loan.status === 'DELINQUENT') {
    return illegal(
      loan,
      event,
      'DELINQUENT → SETTLED is not a legal transition; CURE the loan before posting the final repayment',
    );
  }

  const lines: JournalLine[] = [line(walletClearing(event.channel), 'DEBIT', amount)];
  if (principal > 0) lines.push(line(receivable(loan.borrowerId), 'CREDIT', principal));
  if (interest > 0) lines.push(line('interest_income', 'CREDIT', interest));
  const posting: JournalPosting = { kind: 'REPAYMENT', lines, allocation: { principal, interest } };

  if (fullyPaid) {
    return advance({ status: 'SETTLED', financeCharge: loan.financeCharge, wallet: loan.wallet }, posting);
  }

  const balances: ServicingBalances = {
    financeCharge: loan.financeCharge,
    wallet: loan.wallet,
    outstandingPrincipal: remainingPrincipal,
    outstandingInterest: remainingInterest,
  };
  return advance(
    loan.status === 'REPAYING'
      ? { status: 'REPAYING', ...balances }
      : { status: 'DELINQUENT', ...balances },
    posting,
  );
}

function decide(loan: Loan, event: LoanEvent): Decision {
  switch (event.type) {
    case 'SUBMIT_FOR_REVIEW':
      return loan.status === 'APPLIED' ? advance({ status: 'UNDER_REVIEW' }) : illegal(loan, event);

    case 'APPROVE':
      if (loan.status !== 'UNDER_REVIEW') return illegal(loan, event);
      if (!isCentavos(event.financeCharge)) {
        return invalidAmount('financeCharge must be a non-negative safe integer of centavos');
      }
      return advance({ status: 'APPROVED', financeCharge: event.financeCharge });

    case 'REJECT':
      return loan.status === 'UNDER_REVIEW'
        ? advance({ status: 'REJECTED', reason: event.reason })
        : illegal(loan, event);

    case 'CANCEL':
      return loan.status === 'APPROVED' ? advance({ status: 'CANCELLED' }) : illegal(loan, event);

    case 'DISBURSE': {
      if (loan.status !== 'APPROVED') return illegal(loan, event);
      if (!isCentavos(loan.principal) || loan.principal === 0) {
        return invalidAmount('principal must be a positive safe integer of centavos');
      }
      return advance(
        {
          status: 'DISBURSED',
          financeCharge: loan.financeCharge,
          wallet: event.wallet,
          outstandingPrincipal: loan.principal,
          outstandingInterest: loan.financeCharge,
        },
        {
          kind: 'DISBURSEMENT',
          lines: [
            line(receivable(loan.borrowerId), 'DEBIT', loan.principal),
            line(walletClearing(event.wallet), 'CREDIT', loan.principal),
          ],
        },
      );
    }

    case 'START_REPAYMENT':
      return loan.status === 'DISBURSED'
        ? advance({ status: 'REPAYING', ...balancesOf(loan) })
        : illegal(loan, event);

    case 'RECORD_REPAYMENT':
      return applyRepayment(loan, event);

    case 'MARK_DELINQUENT':
      return loan.status === 'REPAYING'
        ? advance({ status: 'DELINQUENT', ...balancesOf(loan) })
        : illegal(loan, event);

    case 'CURE':
      return loan.status === 'DELINQUENT'
        ? advance({ status: 'REPAYING', ...balancesOf(loan) })
        : illegal(loan, event);

    case 'DECLARE_DEFAULT':
      return loan.status === 'DELINQUENT'
        ? advance({ status: 'DEFAULTED', ...balancesOf(loan) })
        : illegal(loan, event);
  }
}

// ---------- Public reducer ----------

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable request fingerprint: events are flat, so a sorted key list gives deterministic JSON. */
const fingerprintOf = (event: LoanEvent): string =>
  JSON.stringify(event, Object.keys(event).sort());

export function transitionLoan(loan: Loan, event: LoanEvent): TransitionResult {
  if (!UUID_V4.test(event.idempotencyKey)) {
    return { ok: false, status: 400, code: 'INVALID_IDEMPOTENCY_KEY' };
  }

  // 1. Idempotency BEFORE If-Match: a retry legitimately carries the pre-mutation version.
  const fingerprint = fingerprintOf(event);
  const prior = loan.idempotency.get(event.idempotencyKey);
  if (prior !== undefined) {
    return prior.fingerprint === fingerprint
      ? { ok: true, replayed: true, loan, journalEntry: prior.journalEntry }
      : { ok: false, status: 422, code: 'IDEMPOTENCY_KEY_REUSED' };
  }

  // 2. Optimistic concurrency.
  if (event.ifMatch !== loan.version) {
    return { ok: false, status: 409, code: 'VERSION_MISMATCH', currentVersion: loan.version };
  }

  // 3. State machine + posting.
  const decision = decide(loan, event);
  if (!decision.ok) return decision;

  const version = loan.version + 1;
  const journalEntry: JournalEntry | null =
    decision.posting === null
      ? null
      : {
          id: `${loan.id}:v${version}`,
          loanId: loan.id,
          idempotencyKey: event.idempotencyKey,
          loanVersion: version,
          ...decision.posting,
        };

  // Balanced by construction; this gate makes a regression fail closed instead of posting.
  if (journalEntry !== null && !isBalanced(journalEntry)) {
    return { ok: false, status: 500, code: 'LEDGER_INVARIANT_VIOLATION' };
  }

  const next: Loan = {
    id: loan.id,
    borrowerId: loan.borrowerId,
    principal: loan.principal,
    ...decision.state,
    version,
    journal: journalEntry === null ? loan.journal : [...loan.journal, journalEntry],
    idempotency: new Map(loan.idempotency).set(event.idempotencyKey, {
      fingerprint,
      resultingVersion: version,
      journalEntry,
    }),
  };

  return { ok: true, replayed: false, loan: next, journalEntry };
}
```

```ts
// loanStateMachine.test.ts
import { describe, expect, it } from 'vitest';
import {
  applyForLoan,
  isBalanced,
  sumSide,
  toCentavos,
  transitionLoan,
  type Centavos,
  type Loan,
  type LoanEvent,
  type LoanEventType,
  type LoanStatus,
  type TransitionResult,
  type TransitionSuccess,
} from './loanStateMachine';

const BORROWER = 'brw-042';
const PRINCIPAL = toCentavos(100_000); // ₱1,000.00
const FINANCE_CHARGE = toCentavos(5_000); // ₱50.00
const FULL_PAYOFF = toCentavos(105_000); // ₱1,050.00

let seq = 0;
const nextKey = (): string => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

function expectOk(result: TransitionResult): TransitionSuccess {
  if (!result.ok) throw new Error(`expected success, got ${result.status} ${result.code}`);
  return result;
}

function eventOf(type: LoanEventType, ifMatch: number, amount: Centavos = toCentavos(1_000)): LoanEvent {
  const meta = { idempotencyKey: nextKey(), ifMatch };
  switch (type) {
    case 'SUBMIT_FOR_REVIEW':
      return { ...meta, type: 'SUBMIT_FOR_REVIEW' };
    case 'APPROVE':
      return { ...meta, type: 'APPROVE', financeCharge: FINANCE_CHARGE };
    case 'REJECT':
      return { ...meta, type: 'REJECT', reason: 'insufficient alternative data' };
    case 'CANCEL':
      return { ...meta, type: 'CANCEL' };
    case 'DISBURSE':
      return { ...meta, type: 'DISBURSE', wallet: 'gcash' };
    case 'START_REPAYMENT':
      return { ...meta, type: 'START_REPAYMENT' };
    case 'RECORD_REPAYMENT':
      return { ...meta, type: 'RECORD_REPAYMENT', amount, channel: 'gcash' };
    case 'MARK_DELINQUENT':
      return { ...meta, type: 'MARK_DELINQUENT' };
    case 'CURE':
      return { ...meta, type: 'CURE' };
    case 'DECLARE_DEFAULT':
      return { ...meta, type: 'DECLARE_DEFAULT' };
  }
}

const step = (loan: Loan, type: LoanEventType, amount?: Centavos): Loan =>
  expectOk(transitionLoan(loan, eventOf(type, loan.version, amount))).loan;

const PATH_TO: Readonly<Record<LoanStatus, readonly LoanEventType[]>> = {
  APPLIED: [],
  UNDER_REVIEW: ['SUBMIT_FOR_REVIEW'],
  APPROVED: ['SUBMIT_FOR_REVIEW', 'APPROVE'],
  REJECTED: ['SUBMIT_FOR_REVIEW', 'REJECT'],
  CANCELLED: ['SUBMIT_FOR_REVIEW', 'APPROVE', 'CANCEL'],
  DISBURSED: ['SUBMIT_FOR_REVIEW', 'APPROVE', 'DISBURSE'],
  REPAYING: ['SUBMIT_FOR_REVIEW', 'APPROVE', 'DISBURSE', 'START_REPAYMENT'],
  DELINQUENT: ['SUBMIT_FOR_REVIEW', 'APPROVE', 'DISBURSE', 'START_REPAYMENT', 'MARK_DELINQUENT'],
  DEFAULTED: [
    'SUBMIT_FOR_REVIEW',
    'APPROVE',
    'DISBURSE',
    'START_REPAYMENT',
    'MARK_DELINQUENT',
    'DECLARE_DEFAULT',
  ],
  SETTLED: ['SUBMIT_FOR_REVIEW', 'APPROVE', 'DISBURSE', 'START_REPAYMENT', 'RECORD_REPAYMENT'],
};

function loanIn(status: LoanStatus): Loan {
  const applied = applyForLoan({ id: `loan-${status.toLowerCase()}`, borrowerId: BORROWER, principal: PRINCIPAL });
  const loan = PATH_TO[status].reduce<Loan>(
    (l, type) => step(l, type, status === 'SETTLED' ? FULL_PAYOFF : undefined),
    applied,
  );
  if (loan.status !== status) throw new Error(`fixture failed: wanted ${status}, got ${loan.status}`);
  return loan;
}

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value) as unknown[]) deepFreeze(child);
  }
  return value;
};

const expectEveryEntryBalanced = (loan: Loan): void => {
  for (const entry of loan.journal) {
    expect(isBalanced(entry), entry.id).toBe(true);
    expect(sumSide(entry, 'DEBIT'), entry.id).toBe(sumSide(entry, 'CREDIT'));
    for (const l of entry.lines) expect(Number.isSafeInteger(l.amount), entry.id).toBe(true);
  }
};

describe('(a) Σ debits === Σ credits in integer centavos', () => {
  it('final repayment of ₱1,050.00 splits into 100000 principal + 5000 interest and balances', () => {
    const loan = loanIn('REPAYING');
    const { loan: settled, journalEntry } = expectOk(
      transitionLoan(loan, {
        type: 'RECORD_REPAYMENT',
        amount: FULL_PAYOFF,
        channel: 'gcash',
        idempotencyKey: nextKey(),
        ifMatch: loan.version,
      }),
    );

    expect(settled.status).toBe('SETTLED');
    if (journalEntry === null || journalEntry.kind !== 'REPAYMENT') throw new Error('expected a repayment entry');

    expect(journalEntry.allocation).toEqual({ principal: 100_000, interest: 5_000 });
    expect(journalEntry.lines).toEqual([
      { account: 'wallet_clearing:gcash', side: 'DEBIT', amount: 105_000 },
      { account: 'loans_receivable:brw-042', side: 'CREDIT', amount: 100_000 },
      { account: 'interest_income', side: 'CREDIT', amount: 5_000 },
    ]);
    expect(sumSide(journalEntry, 'DEBIT')).toBe(105_000);
    expect(sumSide(journalEntry, 'CREDIT')).toBe(105_000);

    expect(settled.journal.map((e) => e.kind)).toEqual(['DISBURSEMENT', 'REPAYMENT']);
    expectEveryEntryBalanced(settled);
  });

  it('partial then final repayment: interest first, settles only when the balance reaches zero', () => {
    const loan = loanIn('REPAYING');

    const first = expectOk(
      transitionLoan(loan, {
        type: 'RECORD_REPAYMENT',
        amount: toCentavos(30_000),
        channel: 'maya',
        idempotencyKey: nextKey(),
        ifMatch: loan.version,
      }),
    );
    if (first.loan.status !== 'REPAYING') throw new Error(`expected REPAYING, got ${first.loan.status}`);
    expect(first.loan.outstandingPrincipal).toBe(75_000);
    expect(first.loan.outstandingInterest).toBe(0);
    expect(first.journalEntry?.lines).toEqual([
      { account: 'wallet_clearing:maya', side: 'DEBIT', amount: 30_000 },
      { account: 'loans_receivable:brw-042', side: 'CREDIT', amount: 25_000 },
      { account: 'interest_income', side: 'CREDIT', amount: 5_000 },
    ]);

    const final = expectOk(
      transitionLoan(first.loan, {
        type: 'RECORD_REPAYMENT',
        amount: toCentavos(75_000),
        channel: 'gcash',
        idempotencyKey: nextKey(),
        ifMatch: first.loan.version,
      }),
    );
    expect(final.loan.status).toBe('SETTLED');
    expect(final.journalEntry?.lines).toEqual([
      { account: 'wallet_clearing:gcash', side: 'DEBIT', amount: 75_000 },
      { account: 'loans_receivable:brw-042', side: 'CREDIT', amount: 75_000 },
    ]);
    expect(final.loan.journal).toHaveLength(3);
    expectEveryEntryBalanced(final.loan);
  });

  it('rejects an overpayment with 422 and posts nothing', () => {
    const loan = loanIn('REPAYING');
    const result = transitionLoan(loan, {
      type: 'RECORD_REPAYMENT',
      amount: toCentavos(105_001),
      channel: 'gcash',
      idempotencyKey: nextKey(),
      ifMatch: loan.version,
    });
    expect(result).toMatchObject({ ok: false, status: 422, code: 'INVALID_AMOUNT' });
    expect(loan.journal).toHaveLength(1);
  });
});

describe('(b) Idempotency-Key replay', () => {
  it('double-clicked Disburse: the second request is replayed and posts no second entry', () => {
    const approved = loanIn('APPROVED');
    const click: LoanEvent = {
      type: 'DISBURSE',
      wallet: 'gcash',
      idempotencyKey: nextKey(),
      ifMatch: approved.version,
    };

    const first = expectOk(transitionLoan(approved, click));
    const second = expectOk(transitionLoan(first.loan, click)); // stale If-Match on purpose

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.loan).toBe(first.loan);
    expect(second.journalEntry).toBe(first.journalEntry);
    expect(second.loan.journal.filter((e) => e.kind === 'DISBURSEMENT')).toHaveLength(1);
  });

  it('replayed repayment does not reduce the balance twice', () => {
    const loan = loanIn('REPAYING');
    const pay: LoanEvent = {
      type: 'RECORD_REPAYMENT',
      amount: toCentavos(30_000),
      channel: 'gcash',
      idempotencyKey: nextKey(),
      ifMatch: loan.version,
    };

    const first = expectOk(transitionLoan(loan, pay));
    const replay = expectOk(transitionLoan(first.loan, pay));

    expect(replay.replayed).toBe(true);
    expect(replay.loan.journal).toHaveLength(2);
    expect(replay.loan.version).toBe(first.loan.version);
    if (replay.loan.status !== 'REPAYING') throw new Error('expected REPAYING');
    expect(replay.loan.outstandingPrincipal).toBe(75_000);
  });

  it('same key with a different payload is rejected with 422', () => {
    const approved = loanIn('APPROVED');
    const idempotencyKey = nextKey();
    const first = expectOk(
      transitionLoan(approved, { type: 'DISBURSE', wallet: 'gcash', idempotencyKey, ifMatch: approved.version }),
    );
    const reused = transitionLoan(first.loan, {
      type: 'DISBURSE',
      wallet: 'maya',
      idempotencyKey,
      ifMatch: approved.version,
    });
    expect(reused).toEqual({ ok: false, status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(first.loan.journal).toHaveLength(1);
  });

  it('rejects a non-UUID-v4 key with 400', () => {
    const approved = loanIn('APPROVED');
    const result = transitionLoan(approved, {
      type: 'DISBURSE',
      wallet: 'gcash',
      idempotencyKey: 'click-1',
      ifMatch: approved.version,
    });
    expect(result).toEqual({ ok: false, status: 400, code: 'INVALID_IDEMPOTENCY_KEY' });
  });
});

describe('(c) 409 results', () => {
  it('stale If-Match: second admin disbursing the same version gets VERSION_MISMATCH', () => {
    const approved = loanIn('APPROVED');
    const adminA = expectOk(
      transitionLoan(approved, {
        type: 'DISBURSE',
        wallet: 'gcash',
        idempotencyKey: nextKey(),
        ifMatch: approved.version,
      }),
    );
    const adminB = transitionLoan(adminA.loan, {
      type: 'DISBURSE',
      wallet: 'maya',
      idempotencyKey: nextKey(),
      ifMatch: approved.version,
    });

    expect(adminB).toEqual({
      ok: false,
      status: 409,
      code: 'VERSION_MISMATCH',
      currentVersion: adminA.loan.version,
    });
    expect(adminA.loan.journal).toHaveLength(1);
  });

  it('illegal transition returns ILLEGAL_TRANSITION', () => {
    const applied = loanIn('APPLIED');
    const result = transitionLoan(applied, {
      type: 'DISBURSE',
      wallet: 'gcash',
      idempotencyKey: nextKey(),
      ifMatch: applied.version,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'ILLEGAL_TRANSITION',
      from: 'APPLIED',
      event: 'DISBURSE',
    });
  });

  it('final payoff from DELINQUENT is illegal until CURE', () => {
    const delinquent = loanIn('DELINQUENT');
    const payoff = transitionLoan(delinquent, eventOf('RECORD_REPAYMENT', delinquent.version, FULL_PAYOFF));
    expect(payoff).toMatchObject({ ok: false, status: 409, code: 'ILLEGAL_TRANSITION', from: 'DELINQUENT' });

    const cured = step(delinquent, 'CURE');
    expect(step(cured, 'RECORD_REPAYMENT', FULL_PAYOFF).status).toBe('SETTLED');
  });

  const STATUSES: readonly LoanStatus[] = [
    'APPLIED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED',
    'DISBURSED', 'REPAYING', 'DELINQUENT', 'SETTLED', 'DEFAULTED',
  ];
  const EVENT_TYPES: readonly LoanEventType[] = [
    'SUBMIT_FOR_REVIEW', 'APPROVE', 'REJECT', 'CANCEL', 'DISBURSE',
    'START_REPAYMENT', 'RECORD_REPAYMENT', 'MARK_DELINQUENT', 'CURE', 'DECLARE_DEFAULT',
  ];
  const LEGAL: Readonly<Record<LoanStatus, readonly LoanEventType[]>> = {
    APPLIED: ['SUBMIT_FOR_REVIEW'],
    UNDER_REVIEW: ['APPROVE', 'REJECT'],
    APPROVED: ['DISBURSE', 'CANCEL'],
    DISBURSED: ['START_REPAYMENT'],
    REPAYING: ['RECORD_REPAYMENT', 'MARK_DELINQUENT'],
    DELINQUENT: ['RECORD_REPAYMENT', 'CURE', 'DECLARE_DEFAULT'],
    REJECTED: [],
    CANCELLED: [],
    SETTLED: [],
    DEFAULTED: [],
  };

  it('accepts exactly the 11 legal (state, event) pairs and rejects the other 89 with 409', () => {
    let rejected = 0;
    for (const status of STATUSES) {
      const loan = loanIn(status);
      for (const type of EVENT_TYPES) {
        const result = transitionLoan(loan, eventOf(type, loan.version));
        const label = `${status} + ${type}`;
        if (LEGAL[status].includes(type)) {
          expect(result.ok, label).toBe(true);
        } else {
          rejected += 1;
          expect(result, label).toMatchObject({ ok: false, status: 409, code: 'ILLEGAL_TRANSITION', from: status });
        }
      }
    }
    expect(rejected).toBe(89);
  });
});

describe('purity', () => {
  it('never mutates its input, on success or failure', () => {
    const loan = deepFreeze(loanIn('REPAYING'));
    const snapshot = structuredClone(loan);

    const results = [
      transitionLoan(loan, eventOf('RECORD_REPAYMENT', loan.version, toCentavos(30_000))),
      transitionLoan(loan, eventOf('MARK_DELINQUENT', loan.version - 1)),
      transitionLoan(loan, eventOf('APPROVE', loan.version)),
      transitionLoan(loan, eventOf('RECORD_REPAYMENT', loan.version, toCentavos(999_999))),
    ];

    expect(results.map((r) => r.ok)).toEqual([true, false, false, false]);
    expect(loan).toEqual(snapshot);
  });
});
```

**Invariant verification table**

| # | Invariant | Enforced in | Proven by |
|---|---|---|---|
| 1 | Money is integer centavos only; no float math | `Centavos` brand, `isCentavos`/`toCentavos`. Allocation in `applyRepayment` uses only `Math.min` and `-` on validated integers. `isBalanced` requires safe-integer amounts. | `expectEveryEntryBalanced` (checks `Number.isSafeInteger` on every line) in suite (a) |
| 2 | Σ debits === Σ credits for every entry | Built that way: `amount = principal + interest` in `applyRepayment`, equal legs in `DISBURSE`. The `isBalanced` gate in `transitionLoan` returns a 500 instead of posting. | (a) "final repayment of ₱1,050.00…", (a) "partial then final…" |
| 3 | Repayment split: interest first, `principal + interest === amount`, no zero-value lines | `applyRepayment` | (a) both tests: `allocation` equals `{100000, 5000}`, the lines match exactly, and the final principal-only entry has no interest line |
| 4 | Settles only at zero balance; overpayment rejected | `applyRepayment` (`fullyPaid`, `amount > outstanding`) | (a) "partial then final…" (still `REPAYING` after the partial), (a) "rejects an overpayment" |
| 5 | Only the 11 specified transitions are legal | `decide` (switch on `event.type`, then a guard on `loan.status`) | (c) "accepts exactly the 11 legal… rejects the other 89" |
| 6 | No `DELINQUENT → SETTLED` | Guard in `applyRepayment` | (c) "final payoff from DELINQUENT is illegal until CURE" |
| 7 | Stale `If-Match` → `409 VERSION_MISMATCH`, nothing posted | Version check in `transitionLoan`, before `decide` | (c) "stale If-Match: second admin…" |
| 8 | Same key replays the original result: `replayed: true`, no second entry | Lookup in `loan.idempotency`, checked before `If-Match` | (b) "double-clicked Disburse…", (b) "replayed repayment…" |
| 9 | Same key with a different payload → 422 | `fingerprintOf` comparison | (b) "same key with a different payload…" |
| 10 | Key must be a UUID v4 | `UUID_V4` check | (b) "rejects a non-UUID-v4 key with 400" |
| 11 | Input never mutated | Only new objects, new arrays and `new Map(...)` | purity "never mutates its input" (deep-frozen input plus a `structuredClone` snapshot comparison) |
| 12 | 409 and 422 cases are returned, never thrown | Every failure path in `transitionLoan`, `decide` and `applyRepayment` returns a result | Every test in (b) and (c) calls `transitionLoan` directly, so a throw fails the test |

**Verification pass**

I traced the implementation by hand against each test above. **I have not executed it**, so confirm with `tsc --noEmit` and `vitest run`. Three mismatches came up while tracing, and the code above includes the fixes:

1. **Replay ran after the version check.** Replay test (b) sends the original `ifMatch`, which is now stale, so it got a 409 instead of a replay. The idempotency lookup now runs before the `If-Match` check.
2. **Zero-value interest line.** The final principal-only repayment produced an `interest_income` line of 0, which failed the positive-amount rule in `isBalanced`. Lines are now added only when the portion is greater than zero.
3. **Delinquent payoff.** Paying off a `DELINQUENT` loan in full would have meant the unlisted `DELINQUENT → SETTLED` transition. It is now rejected, and the matrix test sends a partial ₱10.00 repayment so `DELINQUENT + RECORD_REPAYMENT` stays legal.

**Requirements:** TypeScript 4.5 or later (inline `type` imports, template-literal `as const`) and Node 17 or later (`structuredClone` in the tests).
