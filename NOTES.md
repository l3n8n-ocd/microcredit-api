# NOTES · Accessible component fundamentals (FE-03 / FE-05)

> Week 4 · Frontend AI Engineering · Lenon D. Adriano · 2026-11-12
> Live: <https://microcredit-api-beta.vercel.app/playground>

Three components built by hand against the W3C ARIA Authoring Practices Guide (APG), the shadcn/ui
versions of two of them installed next to them, and a line-by-line account of what the library does
that the hand-built code does not.

| What | Where |
| --- | --- |
| Hand-built components | [`playground/ModalDialog.tsx`](./playground/ModalDialog.tsx), [`playground/Tabs.tsx`](./playground/Tabs.tsx), [`playground/Disclosure.tsx`](./playground/Disclosure.tsx) |
| shadcn/ui components | [`src/components/ui/dialog.tsx`](./src/components/ui/dialog.tsx), [`src/components/ui/tabs.tsx`](./src/components/ui/tabs.tsx) |
| Both, in the browser | [`/playground`](https://microcredit-api-beta.vercel.app/playground) ([`src/app/playground/page.tsx`](./src/app/playground/page.tsx)) |
| Keyboard tests | [`playground/__tests__/playground.test.tsx`](./playground/__tests__/playground.test.tsx) (40 tests) and section 4 of [`e2e/fold.mjs`](./e2e/fold.mjs) (11 checks in Chromium) |

Line numbers for Radix refer to the files installed in `node_modules` at these versions:
`@radix-ui/react-dialog` 1.3.1, `@radix-ui/react-tabs` 1.2.1, `@radix-ui/react-focus-scope` 1.3.1,
`@radix-ui/react-dismissable-layer` 1.2.1, `@radix-ui/react-roving-focus` 1.2.1,
`@radix-ui/react-presence` 1.1.11, `@radix-ui/react-slot` 1.5.0, `aria-hidden` 1.2.6,
`react-remove-scroll` 2.7.2, `react-remove-scroll-bar` 2.3.8. All paths below are under
`node_modules/<package>/dist/`.

---

## 1 · What was built, against which pattern

Each component implements what its APG pattern requires and nothing more. That is deliberate: the
extras a production dialog needs are exactly the gaps in §3.

### Modal dialog — APG "Dialog (Modal)"

| APG requirement | `playground/ModalDialog.tsx` |
| --- | --- |
| `role="dialog"`, `aria-modal="true"` | lines 141–142 |
| Name from the title, description from the text | `aria-labelledby` line 143, `aria-describedby` line 144, IDs from `useId()` lines 66–67 |
| Focus moves into the dialog when it opens | lines 77–78: `initialFocusRef`, else the first tabbable element, else the dialog itself |
| Tab and Shift+Tab cycle inside | lines 116–126: Shift+Tab on the first wraps to the last, Tab on the last wraps to the first |
| Escape closes | lines 97–100 |
| Focus returns to the element that opened it | `document.activeElement` saved before focus moves (line 75), restored in the effect cleanup (line 83) |

Two decisions worth naming:

- **The key listener is on `document`, not on the dialog** (line 130). A click on the dimmed backdrop
  moves focus to `<body>`. A listener on the dialog would never see the next Tab, and focus would walk
  into the page behind. The `outside` check (line 115) pulls it back.
- **Focus restore is an effect cleanup** (lines 82–84). Escape, Cancel and a successful submit all end
  the same way: `open` turns false, the cleanup runs. There is one code path, not three.

### Tabs — APG "Tabs", automatic activation

| APG requirement | `playground/Tabs.tsx` |
| --- | --- |
| `role="tablist"`, labelled, `aria-orientation="horizontal"` | lines 80–82 |
| `role="tab"` with `aria-selected` and `aria-controls` | lines 95–98 |
| Roving tabindex: selected tab `0`, the rest `-1` | line 100 |
| `role="tabpanel"` with `aria-labelledby`, focusable | lines 118–123 |
| ArrowRight / ArrowLeft with wrap-around | lines 50–55 |
| Home / End | lines 56–61 |
| Selection follows focus | lines 71–72 |

**Roving tabindex** is the concept to keep: the whole tablist is one stop in the page's Tab order, and
the arrow keys move inside it. That is why Tab goes from the selected tab straight to its panel.

### Disclosure — APG "Disclosure (Show/Hide)"

| APG requirement | `playground/Disclosure.tsx` |
| --- | --- |
| A button | `<button type="button">`, line 31 |
| `aria-expanded` | line 32 |
| `aria-controls` → the content's `id` | lines 33 and 43, ID from `useId()` line 26 |
| Enter and Space toggle | native button behaviour: there is no key handler |

No key handler is the point. A real `<button>` already activates on Enter and Space. Writing
`onKeyDown` for a `<div role="button">` is where disclosure bugs come from.

---

## 2 · The shadcn/ui install

The files in `src/components/ui/` are shadcn's `new-york-v4` registry source, fetched on 2026-11-12
from `https://ui.shadcn.com/r/styles/new-york-v4/dialog.json` and `tabs.json`. They were not pasted in
unchanged, because unchanged they break this repo's rules. Every change:

| In the generated file | In this repo | Why |
| --- | --- | --- |
| `import { Dialog as DialogPrimitive } from "radix-ui"` | `import * as DialogPrimitive from "@radix-ui/react-dialog"` (same for Tabs) | The registry now imports the unified `radix-ui` package. The assignment asks for the two primitives themselves. Same code either way |
| `import { cn } from "cn"` | `import { cn } from "@/lib/utils"` | The CLI rewrites this on install. [`src/lib/utils.ts`](./src/lib/utils.ts) is the standard `clsx` + `tailwind-merge` helper |
| `bg-background`, `text-muted-foreground`, `bg-muted`, `ring-ring`, `text-foreground`, `bg-black/50` | `bg-white`, `text-slate-600`, `bg-slate-100`, `ring-accent`, `text-ink`, `bg-ink/50` | shadcn's colour tokens do not exist here. `CLAUDE.md` §12 rule 1 allows the Identity Kit tokens and five Tailwind families |
| `data-[state=open]:bg-accent` on the close button | `data-[state=open]:bg-slate-100` | **Name collision.** shadcn's `accent` is a neutral hover grey. This repo's `accent` is `#059669`. Unchanged, the close button turns emerald while the dialog is open |
| `data-[state=open]:animate-in`, `fade-in-0`, `zoom-in-95`, and the `closed` set | removed | They need the `tw-animate-css` plugin, which is not installed, and `CLAUDE.md` §12 rule 4 bans `animate-*` |
| `dark:` variants in `tabs.tsx` | removed | One theme |
| `DialogFooter`'s `showCloseButton` | removed | It imports shadcn's `Button`, which this assignment does not install |

Behaviour was not touched. The shadcn files are styling wrappers: every behaviour in §3 lives in the
Radix primitives.

Dependencies added: `@radix-ui/react-dialog`, `@radix-ui/react-tabs`, `clsx`, `tailwind-merge`,
`class-variance-authority`, `lucide-react`, and `@testing-library/user-event` for the tests.

---

## 3 · Five gaps: what Radix handles that the hand-built code does not

Each gap has a test named `Gap N` in
[`playground.test.tsx`](./playground/__tests__/playground.test.tsx) that shows the same situation on
both sides, so these notes cannot drift from the code.

### Gap 1 · The page behind the dialog is still readable by a screen reader

**Hand-built.** The trap works on `keydown` (line 130). It stops Tab. It does not stop a screen
reader's browse mode or touch exploration, which move a virtual cursor and send no Tab key. The only
signal is `aria-modal="true"` (line 142), which asks assistive tech to treat the rest of the page as
inert. Support for that has been uneven across screen readers, which is why a library does not rely on
it alone.

**Radix.** `react-dialog/index.mjs:165`: `if (content) return hideOthers(content)`. `hideOthers` is in
`aria-hidden/es2015/index.js:124`. It walks up from the dialog marking the ancestors to keep (line 52),
then sets `aria-hidden="true"` on every other branch, and undoes exactly what it set on close. The same
package exports `inertOthers` (line 143), which uses the `inert` attribute instead. Radix also sets
`pointer-events: none` on `<body>` while the dialog is open (`disableOutsidePointerEvents`,
`react-dialog/index.mjs:173`).

**The test.** With the hand-built dialog open, `getByRole('button', { name: 'Before' })` finds the
button behind it. With the shadcn dialog open, the same query finds nothing: the button is still in the
DOM but under an `aria-hidden="true"` ancestor. On Escape it is back.

**What a fix takes.** A portal first (Gap 2): you can only hide "everything else" cleanly when the
dialog is not inside it.

### Gap 2 · No portal, no scroll lock, no scrollbar compensation

**Hand-built.** The dialog renders where it is called, as a `position: fixed` layer with `z-50` (line
138). Two consequences:

- An ancestor with `transform`, `filter` or `contain` becomes the containing block for `fixed`, and an
  ancestor stacking context caps the `z-index`. Inside such an ancestor the dialog is clipped or sits
  under other content. On `/playground` there is no such ancestor, so it looks right. That is luck, not
  design.
- The page behind still scrolls, by wheel, touch or keyboard.

**Radix.**

- Portal: `react-portal/index.mjs:17` renders with `ReactDOM.createPortal` into `document.body` by
  default.
- Scroll lock: `react-dialog/index.mjs:125–126` wraps the overlay in `RemoveScroll`.
  `react-remove-scroll/es2015/SideEffect.js:139–141` adds non-passive `wheel`, `touchmove` and
  `touchstart` listeners on `document`. The `touchmove` one covers iOS Safari, where
  `overflow: hidden` on `<body>` has not been a reliable lock.
- Layout shift: `react-remove-scroll-bar/es2015/utils.js:21–22` measures
  `window.innerWidth - document.documentElement.clientWidth`. `component.js:13` then sets
  `overflow: hidden` and `padding-right` of that width on `<body>`, and `constants.js:8` exposes it as
  `--removed-body-scroll-bar-size` for fixed headers.

**Correction to the brief.** The gap is measured, not a fixed 15 px. It is about 15–17 px with classic
scrollbars and 0 with overlay scrollbars (macOS default, mobile).

**The test.** Hand-built: the dialog is inside the React container and `<body>` has no lock. shadcn:
the dialog's parent is `<body>`, `<body>` has `data-scroll-locked`, and an injected `<style>` contains
`overflow: hidden` and `--removed-body-scroll-bar-size`.

### Gap 3 · Outside presses, and more than one layer

**Hand-built.** There is no dismissal on an outside press at all. The backdrop (line 138) has no
handler: Escape, Cancel and Approve are the only ways out. That was the safe simplification, because
the obvious version is wrong:

```tsx
<div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
```

A `click` fires on the nearest common ancestor of where the button went down and where it came up.
Press inside the reason field, drag out to select text, release over the backdrop: the common ancestor
is the backdrop, and the dialog closes with the user's text in it.

**Radix.** The decision is made when the press starts.
`react-dismissable-layer/index.mjs:191` (`usePointerDownOutside`) listens for `pointerdown` on the
document. Line 200 keeps `isPointerInsideReactTreeRef`, set by a capture-phase handler inside the layer.
Line 241 dismisses only `if (event.target && !isPointerInsideReactTreeRef.current)`. Where the pointer
is released does not matter. On top of that the Dialog ignores a right-click or Ctrl-click outside
(`react-dialog/index.mjs:179–182`), and in modal mode cancels dismissal by focus moving outside (lines
184–187), while still exposing `onPointerDownOutside`, `onFocusOutside` and `onInteractOutside` so a
consumer can `preventDefault()` any of them.

**Layers.** Radix keeps every open layer in one registry (`react-dismissable-layer/index.mjs:17–18`). Only
the top one answers Escape: `isHighestLayer`, lines 90 and 102. Focus traps stack the same way:
`react-focus-scope/index.mjs:246–262` is a stack where adding a scope pauses the one under it and
removing it resumes that one, and line 125 makes a paused scope ignore Tab.

The hand-built dialog has neither. Each open `ModalDialog` adds its own `document` listener (line 130).
By reading the code, not by test: with a second dialog open on top of the first, one Escape would run
both `onClose` callbacks, and both traps would act on the same Tab.

**The test.** Hand-built: a click on the backdrop leaves the dialog open. shadcn: press in the field,
drag to the overlay, release: still open. Click the overlay: closed.

### Gap 4 · Tabs: right-to-left, disabled tabs, manual activation

**Hand-built.** `Tabs.tsx` lines 50–61 hard-code ArrowRight as "next" and ArrowLeft as "previous".
`TabItem` has no `disabled` field. Selection always follows focus (lines 71–72).

**Radix.**

- Direction: `react-roving-focus/index.mjs:222`, `getDirectionAwareKey`, swaps ArrowLeft and ArrowRight
  when `dir` is `rtl`. In a right-to-left tablist the next tab is on the left.
- Orientation: `getFocusIntent` (line 227) ignores Up/Down in a horizontal list and Left/Right in a
  vertical one. The key map (lines 212–221) also sends PageUp and PageDown to the first and last tab.
- Disabled: `react-tabs/index.mjs:112` registers a trigger with `focusable: !disabled`, and
  `react-roving-focus/index.mjs:114` filters the candidates to focusable items before picking the next
  one. A disabled tab is stepped over. It cannot trap the arrow keys.
- Activation: `react-tabs/index.mjs:37` defaults `activationMode` to automatic. Lines 143–147 select on
  focus only when it is not `manual`. Manual mode is for panels that are slow to render: arrows move
  focus, Enter or Space selects.
- Wrap-around is a prop: `loop = true` at `react-tabs/index.mjs:74`.

**Correction to the brief.** Radix does not detect `dir="rtl"` from the DOM. The direction comes from
the `dir` prop on `Tabs`, or from a `DirectionProvider` (`react-tabs/index.mjs:40`,
`useDirection(dir)`). A page that sets `<html dir="rtl">` and forgets the prop gets the hand-built
behaviour.

**The test.** Hand-built inside `<div dir="rtl">`: ArrowLeft still goes to the previous tab. shadcn with
`dir="rtl"`: ArrowLeft goes to the next. A disabled middle tab is skipped both ways. With
`activationMode="manual"`, ArrowRight moves focus and `aria-selected` stays put until Enter.

### Gap 5 · Composition: `asChild`, refs, handlers, exit animations

**IDs are not a gap.** The brief lists hydration-safe IDs here. Both sides use `React.useId`:
`ModalDialog.tsx` lines 66–67, `Tabs.tsx` line 37, `Disclosure.tsx` line 26, and Radix at
`react-dialog/index.mjs:56–58` through `react-id/index.mjs:9`, which wraps `React.useId` (line 7).
`/playground` is statically rendered and hydrates without an ID mismatch.

The real gaps are these.

**The trigger knows nothing about the dialog.** `ModalDialog` has no trigger part. The consumer renders
a plain button and owns `open`. Radix's trigger adds `aria-haspopup="dialog"`, `aria-expanded` and
`aria-controls` (`react-dialog/index.mjs:83–85`), so a screen reader announces that the button opens a
dialog and whether it is open.

**`asChild` merges instead of wrapping.** With `<DialogTrigger asChild><button …/></DialogTrigger>`,
Radix renders the consumer's button and merges onto it. `react-slot/index.mjs:78`, `mergeProps`: for a
prop matching `/^on[A-Z]/` it calls the child's handler and then its own (lines 83–90), joins
`className` (line 96), merges `style` (line 94). Refs are combined by
`react-compose-refs/index.mjs:14`, so the consumer's `ref` and Radix's `triggerRef` both point at the
node (`react-dialog/index.mjs:78`). Internally `composeEventHandlers`
(`@radix-ui/primitive/index.mjs:6–9`) skips Radix's handler when the consumer called
`preventDefault()`.

The hand-built components accept no `className`, no `ref` and no extra props. A consumer cannot restyle
them, attach a ref, or intercept an event without editing the file.

**Focus return does not depend on `document.activeElement`.** Radix returns focus to that `triggerRef`
(`react-dialog/index.mjs:176`). The hand-built dialog saves `document.activeElement` (line 75). Safari
on macOS does not focus a button on mouse click, so there the saved element is `<body>`. `returnFocusRef` (line
76) is the opt-in fix, and the `/playground` example passes it. A keyboard user always has focus on the
trigger, so the keyboard path was never affected.

**Exit animations.** `ModalDialog.tsx` line 134 is `if (!open) return null`: the node is gone in the
same render. Radix wraps content in `Presence` (`react-dialog/index.mjs:109` and 154).
`react-presence/index.mjs:104–106` listens for `animationstart`, `animationcancel` and `animationend`,
and its state machine has an `unmountSuspended` state (lines 38–40) that keeps the node mounted with
`data-state="closed"` until the CSS animation finishes. Two honest limits: it waits on CSS
*animations*, not transitions, and this repo removed shadcn's animation classes, so nothing here
animates today.

**The test.** A consumer button with its own `onClick`, `className` and `ref` inside
`DialogTrigger asChild`: one DOM node, the consumer's class kept, the consumer's handler called once,
the dialog opened, the ref still pointing at the button, and `aria-haspopup`, `aria-expanded`,
`aria-controls` and `data-state` present. The hand-built trigger has none of those attributes.

---

## 4 · Things found that were not on the list

**Against the hand-built code**

- `tabbableWithin` (`ModalDialog.tsx` lines 24–35) is a selector list. It counts an element that is
  `display: none` or inside a closed `<details>` as tabbable. Radix walks the tree with a `TreeWalker`
  and checks visibility (`react-focus-scope/index.mjs:197` and 222–223). It also watches `focusin`,
  `focusout` and DOM mutations (lines 78–80), so it recovers when the focused element is removed.

**Against the generated shadcn code**

- `TabsContent` is `outline-none` ([`src/components/ui/tabs.tsx`](./src/components/ui/tabs.tsx) line
  95), and Radix makes the panel focusable (`tabIndex: 0`, `react-tabs/index.mjs:177`). A keyboard user
  Tabs onto the panel and sees no focus indicator. The `/playground` example adds a focus ring back
  through `className`. The hand-built panel has one by default (`Tabs.tsx` line 125).
- The `accent` token collision in §2. A generated file can be syntactically fine and still wrong in a
  project whose tokens share a name.

**A behavioural difference, measured**

- Radix moves tab focus inside a `setTimeout` (`react-roving-focus/index.mjs:202`). The hand-built tabs
  call `.focus()` in the key handler (line 72). The first Chromium run of the e2e sent five keys faster
  than that timer runs: the shadcn tabs computed each move from a stale position and ended on the wrong
  tab, while the hand-built tabs passed. No person types that fast, so this is a test-writing lesson
  more than a defect: against Radix, wait for focus to settle before the next key.

**A third option, not built**

- The platform has `<dialog>` with `showModal()`. It makes the rest of the page inert, renders in the
  top layer above every stacking context, and closes on Escape, which removes Gaps 1 and most of 2
  without a library. The assignment asks for the ARIA pattern, so it is not used here.

---

## 5 · What I would do in the product

- **Dialog: use the library.** Four of the five gaps are in the dialog, and each one is a way for a
  real user to be stuck or lost. Hand-rolling it means re-deriving `aria-hidden`, `react-remove-scroll`
  and a layer stack.
- **Tabs: either.** The hand-built version is 132 lines and correct for a left-to-right app with no
  disabled tabs. The moment the app needs RTL or a disabled tab, switch.
- **Disclosure: hand-built.** It is a button and two attributes. A dependency adds nothing.

None of this touches the claim on the home page. `/playground` is coursework, last in the nav, and
adds nothing above **Disburse**: the fold check still reads 712 px of 740 px at 360 px wide.

---

## 6 · How it was verified

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors, `strict` |
| `npm run lint` | 0 warnings (`typescript/no-explicit-any` is an error) |
| `npm test` | 384 passed in 16 files (344 before; 40 new) |
| `npm run build` | passed; `/playground` is static |
| `npm run test:e2e` | 59 checks passed, 13 of them new: `/playground` at 375 px and 1280 px with 0 px overflow, and 11 keyboard-only checks in Chromium |

The 40 tests: 10 for the dialog, 7 for the tabs, 2 for the disclosure, 2 running the same keyboard
contract against shadcn/ui, 5 pinning the gaps above, and 14 on type safety (no `any`, no
`@ts-ignore`, no lint-disable comment in any of the 13 source files).

They use `@testing-library/user-event`, not `fireEvent`. `user.tab()` follows the real tab order and
moves focus only when the component did not call `preventDefault()`, so a trap that misses an edge
fails the way it would on a keyboard.

**Mutation checks.** Sixteen one-line breaks were applied one at a time, and each made at least one
test fail: Tab not wrapping on the last element; Shift+Tab not wrapping on the first; escaped focus not
pulled back; Escape ignored; no initial focus; no focus restore; `aria-modal` removed; ArrowRight not
wrapping; ArrowLeft not wrapping; End going to the first tab; every tab a Tab stop; arrows moving focus
without selecting; a non-focusable panel; `aria-expanded` stuck; the disclosure panel never hidden; an
`any` type added.
