# FE-03 / FE-04 Workflow Drill: Vague vs. Precise

## Branch & Diff Overview

| | `feat/disburse-form-vague` (`2ba0a9c`) | `feat/disburse-form-precise` (`0aaed92`) |
| --- | --- | --- |
| Diff vs. `main` | 6 files, +294 / −2 | 16 files, +1,831 / −4 |
| Structure | One 217-line `DisbursementSettingsForm.tsx`, 9-line `utils/money.ts` | `types.ts` 129, `loanStateMachine.ts` 59, `ledger.ts` 47, `validation.ts` 118, `disbursementServer.ts` 184, `DisbursementForm.tsx` 562 |
| Tests | 1 file, 5 tests | 4 files, 101 tests |

`git diff feat/disburse-form-vague..feat/disburse-form-precise --stat`: 19 files, +1,830 / −295. Round 2 deletes both Round 1 files outright; nothing was salvageable as a patch.

## Correctness, Accessibility & Edge Cases

| Concern | Round 1 | Round 2 |
| --- | --- | --- |
| Money | `principalCentavos: number`, no `formatPHP` | Branded `Centavos`; parsing is string-only, so `"19.99"` is exactly `1999`; `formatPHP` hands `Intl` a decimal string |
| Concurrency | No `Idempotency-Key`, no `If-Match`, submit never disabled | Key replay runs *before* the `If-Match` check; stale version → `409 VERSION_MISMATCH`; `transitionLoan` returns `409` on a `DISBURSED` loan |
| Accessibility | `aria-describedby` only on error, no alert region, no `aria-busy` | Hint and error both described, `role="alert"` summary, focus moves to first invalid field, `aria-busy` submit |

## Specific AI Mistake Caught

**Round 1:** `parsePesosToCentavos("90071992547409.93")` returned `9007199254740992`, past `Number.MAX_SAFE_INTEGER`, with no error. That branch passes typecheck, lint, and 5/5 tests, so CI was green on a wrong money parser. The Round 2 spec named the boundary, which produced a `TOO_LARGE` result and a test for it.

**Round 2 verification loop**, in order:
1. First run failed 1/101: Claude's two "admin" screens shared one deterministic key factory, so the fixture reused a key with a different payload and got `422` instead of the targeted `409`. Fixed the fixture, not the server.
2. `tsc` and oxlint failed on an unused import that Vitest ignored.
3. A Playwright smoke test at 360px found two landmarks sharing one accessible name.
4. A mutation check (replay lookup disabled) failed 4 tests and showed why order matters: without replay, a legitimate retry gets a false `409`.

## Review Effort & End-to-End Time Comparison

| | Round 1 | Round 2 |
| --- | --- | --- |
| Prompt + generation | TODO(Lenon): minutes; committed 02:33 UTC | Audit 02:43 UTC → commit 02:51 UTC |
| Human review / fix | TODO(Lenon): minutes | TODO(Lenon): minutes |

Fixing Round 1 by hand meant adding the key, version check, state machine, ledger, and in-flight guard from scratch. Round 2 front-loaded them into the spec, so review became checking named tests instead of hunting for omissions, and any regression now fails CI.
