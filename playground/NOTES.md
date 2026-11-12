# playground/ · notes

The full write-up is [`NOTES.md`](../NOTES.md) at the repo root. This file is the short version, so the
folder explains itself.

## What is here

| File | What it is | APG pattern |
| --- | --- | --- |
| [`ModalDialog.tsx`](./ModalDialog.tsx) | Modal dialog: `role="dialog"`, `aria-modal`, focus in on open, Tab / Shift+Tab trap, Escape, focus back to the trigger | Dialog (Modal) |
| [`Tabs.tsx`](./Tabs.tsx) | Tabs with a roving tabindex: ArrowRight / ArrowLeft wrap, Home / End, Tab to the panel | Tabs |
| [`Disclosure.tsx`](./Disclosure.tsx) | A `<button>` with `aria-expanded` and `aria-controls` | Disclosure (Show/Hide) |
| [`examples.tsx`](./examples.tsx), [`OverrideForm.tsx`](./OverrideForm.tsx), [`panels.tsx`](./panels.tsx), [`content.ts`](./content.ts) | The MicroCredit-themed demos on `/playground`. The form and panels are shared with the shadcn/ui twins in [`src/features/playground/ShadcnExamples.tsx`](../src/features/playground/ShadcnExamples.tsx) |
| [`__tests__/playground.test.tsx`](./__tests__/playground.test.tsx) | 40 keyboard-only tests | |

No component library is imported in this folder. The three components use React and nothing else.

## The five gaps, in one line each

Each is explained with file and line references in [`NOTES.md` §3](../NOTES.md#3--five-gaps-what-radix-handles-that-the-hand-built-code-does-not),
and pinned by a test named `Gap N`.

| # | Hand-built | shadcn/ui (Radix) |
| --- | --- | --- |
| 1 | Traps Tab only. A screen reader's browse mode can still read the page behind. | `hideOthers` sets `aria-hidden` on everything outside the dialog. |
| 2 | Rendered in place, page still scrolls. | Portal to `<body>`, scroll locked (including `touchmove`), scrollbar width padded back. |
| 3 | No outside-press dismissal; no awareness of a second dialog. | Dismissal decided on `pointerdown`, so a drag that ends outside does not close; a layer stack and paused focus scopes for nesting. |
| 4 | Arrow keys fixed for left-to-right; no disabled tabs; automatic activation only. | `dir="rtl"` flips the arrows, disabled tabs are skipped, `activationMode="manual"`. |
| 5 | No trigger part, no `className` / `ref` / extra props, unmounts at once. | `asChild` merges handlers, classes and refs onto the consumer's element; `Presence` holds the node for an exit animation. IDs are **not** a gap: both use `React.useId`. |

## Run it

```bash
npm test
```

```bash
npm run build && npm run test:e2e
```

Or open <https://microcredit-api-beta.vercel.app/playground> and put the mouse down.
