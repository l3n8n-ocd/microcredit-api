# FE-AA1 · Buttons with a Brain: Motion & State Micro-interactions

- **Live:** https://microcredit-api-beta.vercel.app/motion-lab
- **Component:** [`src/components/ui/SmartActionButton.tsx`](../src/components/ui/SmartActionButton.tsx)
- **Motion tokens and CSS:** [`src/app/globals.css`](../src/app/globals.css) (search `FE-AA1`)
- **Workbench:** [`src/app/motion-lab/page.tsx`](../src/app/motion-lab/page.tsx) +
  [`src/features/motion-lab/MotionLab.tsx`](../src/features/motion-lab/MotionLab.tsx)
- **Tests:** [`src/components/ui/__tests__/SmartActionButton.test.tsx`](../src/components/ui/__tests__/SmartActionButton.test.tsx) (13),
  [`src/features/motion-lab/__tests__/MotionLab.test.tsx`](../src/features/motion-lab/__tests__/MotionLab.test.tsx) (11),
  [`e2e/motion-lab.spec.ts`](../e2e/motion-lab.spec.ts) (5 browser checks)

How this serves the One Claim: the Disburse button is where a double payout starts. A button that ignores
a second click while `loading`, says "Locking Idempotency-Key...", and lands on "201 Disbursed · ₱5,000.00"
or "409 Conflict · Retry Payout" shows the Engineering Manager what the server enforces, at the moment they
click. The lab outcomes are simulated by the mode radios. No request leaves the page and no ledger entry is
written. The real `Idempotency-Key` / `If-Match` flow is on `/`.

---

## 1 · Duration & easing rationale

| Transition | Token | Why |
| --- | --- | --- |
| press | `100ms cubic-bezier(0.22, 1, 0.36, 1)` | Answers the finger before the network does. Fast out, soft landing, so a double-click still reads as two presses. |
| hover / focus-visible | same token, `translate3d(0, -1px, 0)` + `accent` ring | The lift says "this is live". The ring is the same `accent` token as every other focus ring. |
| idle → loading | `220ms cubic-bezier(0.16, 1, 0.3, 1)` | The old label leaves up 10 px and fades; the new one rises from below. Long enough to read, short enough that a 600 ms reply never waits on it. |
| loading → success | `240ms cubic-bezier(0.34, 1.56, 0.64, 1)`, hold `1400ms` | The only overshoot in the system marks the one moment that matters. The checkmark draws with `stroke-dashoffset`. The hold leaves time to read the receipt label. |
| loading → error | `320ms cubic-bezier(0.36, 0.07, 0.19, 0.97)` | One damped shake (−5 → 5 → −3 → 2 → 0 px), then still. The label and the cross carry the meaning, not the colour. |
| reduced motion | `120ms` opacity | No lift, press, slide, spring or shake. Surface, icon and text still change. |

These durations go past the 150 ms cap in CLAUDE.md §12 rule 4. Lenon chose a scoped exception: it covers this
component only, and the same commit writes it into CLAUDE.md §12 and
[`PORTFOLIO_DESIGN_SYSTEM.md`](./PORTFOLIO_DESIGN_SYSTEM.md) ("Motion: SmartActionButton"). Everything else keeps
the 150 ms cap.

---

## 2 · The state machine

```
          click               action resolves            1400 ms hold
  idle ──────────▶ loading ───────────────────▶ success ───────────────▶ idle
    ▲                 │
    │ click (retry)   │ action rejects
    └──────── error ◀─┘
```

- `hover` / `focus-visible` and `active` are CSS states of whichever state is showing.
- `disabled` sets the native `disabled` and `aria-disabled="true"`, `opacity-50` and `cursor-not-allowed`. The
  hover and press rules carry `:not(:disabled)`, so a disabled button does not move.
- `forcedState` is the lab's scrubber. Pinning a state, or releasing the pin, aborts the run in flight.
  Releasing always lands on `idle`.

Labels per button:

| State | Button 1 | Button 2 |
| --- | --- | --- |
| idle | Disburse ₱5,000.00 | Send Prompt |
| loading | Locking Idempotency-Key... | Streaming Evaluation... |
| success | 201 Disbursed · ₱5,000.00 | Trust Score Verified |
| error | 409 Conflict · Retry Payout | Stream Dropped · Retry |

₱5,000.00 comes from `formatPHP(toCentavos(500_000))`, not a typed string.

---

## 3 · How it was engineered

### Compositor-only, zero layout shift

- The button is `display: inline-grid; grid-template-areas: 'stack'`, and every child sits in `grid-area: stack`.
  That is three surfaces (main, `accent`, `rose-700`) and four label layers. The grid cell is as wide as the
  widest label, so the box is the same size in every state.
- Only `transform` and `opacity` transition. The colour change is a crossfade between stacked surfaces, never
  an animated `background-color`. The checkmark animates `stroke-dashoffset` on one SVG path.
- Evidence: the lab's inspector reads `getComputedStyle(layer).transitionProperty` for every layer and shows
  18/18 layers as transform / opacity only (Chromium, `next start`). `e2e/motion-lab.spec.ts` checks:
  - the same `offsetWidth × offsetHeight` across `idle`, `loading`, `success`, `error` and `disabled`;
  - a `layout-shift` PerformanceObserver total of 0 through a full idle → loading → success → idle run.

### Interruptible and spam-safe

- The click guard reads `stateRef`, not React state. Ten clicks in one task see `loading` from the second
  click on, so one run starts. A click during `loading` or the `success` hold is ignored and reported through
  `onIgnoredClick`.
- Each run takes a new `runIdRef` value and its own `AbortController`. A late result whose `runId` is stale,
  or whose signal is aborted, is dropped.
- Pinning a state, releasing it, or unmounting does three things: it bumps `runIdRef`, aborts the controller
  and clears the hold timer. The tests check `vi.getTimerCount() === 0` after each of these.
- `onStateChange` is held in a ref, so a parent's inline callback never re-runs the effect that aborts runs.
- Mutation check: replacing the guard with `if (false)` fails 3 tests: 5 rapid clicks, the 10-click burst
  and the lab's "Fire 10 Rapid Clicks". Restoring it passes them.

### Keyboard and screen readers

- It is a native `<button type="button">`: Tab reaches it, Enter and Space activate it, and
  `focus-visible:ring-accent` draws the ring. The e2e test tabs in from the previous link and checks
  `:focus-visible`, then uses Enter to run and Space to retry.
- Hidden label layers are `aria-hidden`, so the accessible name is always the live label.
- An `sr-only` `role="status"` `aria-live="polite"` region announces each non-idle state once.
- `aria-busy` is `"true"` only while `loading`.

### Reduced motion, two ways

- `usePrefersReducedMotion()` reads `matchMedia('(prefers-reduced-motion: reduce)')` through
  `useSyncExternalStore`. The lab's "Simulate `prefers-reduced-motion: reduce`" checkbox forces it on.
- Either one makes the component write `--smart-lift: 0px`, `--smart-press: 1`, `--smart-shift: 0px`,
  `--smart-swap: var(--motion-reduced)` and `--smart-shake-name: none` inline. The CSS reads those variables.
  Before hydration the server has written the full-motion values inline, so the
  `@media (prefers-reduced-motion: reduce)` block sets the same variables with `!important` and the OS
  setting wins from first paint.
- Evidence: Vitest checks the inline variables in both modes. Playwright checks
  `getComputedStyle(button).animationName`:
  - `smart-shake` on error with full motion;
  - `none` with the toggle on;
  - `none` again with the toggle off under `page.emulateMedia({ reducedMotion: 'reduce' })`.

### In the capstone

The `.smart-press` class lends the 100 ms press transform (hover lift, `scale3d(0.97, 0.97, 1)`) to three
buttons. Their accessible names and logic are unchanged:

- Disburse on `/`;
- the copilot's Send;
- "Approve & Execute Payout" in the tool card.

Their colour transitions stay at 150 ms. The full six-state machine runs on `/motion-lab` only. Wiring it
into the real Disburse would duplicate the form's own `inFlight` lock and its `201` / `409` panels, so that is
left as a TODO for a later brief.

---

## 4 · Where this departs from the brief, and why

| Brief | Shipped | Reason |
| --- | --- | --- |
| Crimson `DC2626` error surface | `rose-700` (`#be123c`) under white | CLAUDE.md §12 rule 1 bans the red family and raw hex. Rose is the approved "bounce" hue, and white on `rose-700` passes AA. |
| Success surface `059669` | `bg-accent` (`#059669`) under `ink` text | White on `059669` is 3.77:1 and fails AA. Ink on it is 4.74:1 (§9.4). |
| Spinner | the `.copilot-dot` trio in `currentColor` | §12 rule 4 allows one looping animation. The dots are it, and they are static under reduced motion. |
| Focus ring colour | the `accent` token (`ring-accent`) | Same ring as the rest of the app; no raw hex. |
| Durations over 150 ms | scoped exception | Lenon's call; written into CLAUDE.md §12 and the design system doc in the same commit. |
| Telemetry "compositor layer status" | live `transitionProperty` audit | It is measured in the browser, not hard-coded. |

---

## 5 · Checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | 497/497 across 27 files (24 new) |
| `npm run build` | exit 0; `/motion-lab` prerendered as static |
| `npx playwright test e2e/motion-lab.spec.ts` | 5/5 |
| `/motion-lab` at 375 px and 1280 px | no horizontal overflow (`e2e/fold.mjs` route list) |
