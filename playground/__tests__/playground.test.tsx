import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../src/components/ui/dialog.tsx'
import {
  Tabs as ShadcnTabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../src/components/ui/tabs.tsx'
import { ShadcnLifecycleTabs, ShadcnOverrideDialog } from '../../src/features/playground/ShadcnExamples.tsx'
import {
  DisbursementOverrideModal,
  IdempotencyDisclosure,
  LoanLifecycleTabs,
  ModalDialog,
  Tabs,
} from '../index.ts'

/**
 * Keyboard-only tests. `user-event` is used instead of `fireEvent` on purpose:
 * `user.tab()` walks the real tab order (tabindex, disabled, hidden) and only
 * moves focus if the component did not call `preventDefault()`. So a trap that
 * forgets an edge, or a roving tabindex with two `0`s, fails here the way it
 * would under a real keyboard.
 */

afterEach(() => {
  cleanup()
})

const focused = (): Element | null => document.activeElement

/** Page content on both sides of the component, so "focus left the dialog" has somewhere to go. */
function Page({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <button type="button">Before</button>
      {children}
      <button type="button">After</button>
    </>
  )
}

const HAND_BUILT_TRIGGER = 'Review cap override (hand-built)'
const SHADCN_TRIGGER = 'Review cap override (shadcn/ui)'
const DIALOG_NAME = 'Approve daily-cap override'

async function openWithKeyboard(user: ReturnType<typeof userEvent.setup>, triggerName: string): Promise<HTMLElement> {
  const trigger = screen.getByRole('button', { name: triggerName })
  while (focused() !== trigger) await user.tab()
  await user.keyboard('{Enter}')
  return trigger
}

// ─────────────────────────────────────────────────────────────────────────────
describe('ModalDialog — W3C APG Dialog (Modal), hand-built', () => {
  it('opens from the keyboard with role, aria-modal, a name and a description', async () => {
    const user = userEvent.setup()
    render(<Page><DisbursementOverrideModal /></Page>)
    expect(screen.queryByRole('dialog')).toBeNull()

    await openWithKeyboard(user, HAND_BUILT_TRIGGER)

    const dialog = screen.getByRole('dialog', { name: DIALOG_NAME })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
    const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
    expect(title?.textContent).toBe(DIALOG_NAME)
    expect(description?.textContent).toContain('Loan L-1042 asks for ₱60,000.00 against a ₱50,000.00 daily cap')
  })

  it('moves focus into the dialog on open, to the first tabbable element', async () => {
    const user = userEvent.setup()
    render(<Page><DisbursementOverrideModal /></Page>)
    await openWithKeyboard(user, HAND_BUILT_TRIGGER)
    expect(focused()).toBe(screen.getByLabelText('Reason for override'))
  })

  it('traps Tab: after the last element it wraps to the first, and never reaches the page', async () => {
    const user = userEvent.setup()
    render(<Page><DisbursementOverrideModal /></Page>)
    await openWithKeyboard(user, HAND_BUILT_TRIGGER)
    const dialog = screen.getByRole('dialog')
    const field = screen.getByLabelText('Reason for override')
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    const approve = within(dialog).getByRole('button', { name: 'Approve override' })

    expect(focused()).toBe(field)
    await user.tab()
    expect(focused()).toBe(cancel)
    await user.tab()
    expect(focused()).toBe(approve)
    await user.tab() // Tab on the LAST element
    expect(focused()).toBe(field)

    // Two more full laps: focus is inside the dialog at every step.
    for (let press = 0; press < 6; press += 1) {
      await user.tab()
      expect(dialog.contains(focused())).toBe(true)
    }
  })

  it('traps Shift+Tab: before the first element it wraps to the last', async () => {
    const user = userEvent.setup()
    render(<Page><DisbursementOverrideModal /></Page>)
    await openWithKeyboard(user, HAND_BUILT_TRIGGER)
    const dialog = screen.getByRole('dialog')

    await user.tab({ shift: true }) // Shift+Tab on the FIRST element
    expect(focused()).toBe(within(dialog).getByRole('button', { name: 'Approve override' }))
    await user.tab({ shift: true })
    expect(focused()).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.tab({ shift: true })
    expect(focused()).toBe(screen.getByLabelText('Reason for override'))
  })

  it('pulls focus back in if it has slipped out of the dialog', async () => {
    const user = userEvent.setup()
    render(<Page><DisbursementOverrideModal /></Page>)
    await openWithKeyboard(user, HAND_BUILT_TRIGGER)
    const dialog = screen.getByRole('dialog')

    // A click on the dimmed backdrop leaves focus on <body>.
    act(() => (focused() as HTMLElement).blur())
    expect(focused()).toBe(document.body)
    await user.tab()
    expect(focused()).toBe(screen.getByLabelText('Reason for override'))

    act(() => (focused() as HTMLElement).blur())
    await user.tab({ shift: true })
    expect(focused()).toBe(within(dialog).getByRole('button', { name: 'Approve override' }))
  })

  it('closes on Escape and returns focus to the button that opened it', async () => {
    const user = userEvent.setup()
    render(<Page><DisbursementOverrideModal /></Page>)
    const trigger = await openWithKeyboard(user, HAND_BUILT_TRIGGER)
    await user.tab() // somewhere in the middle of the dialog

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focused()).toBe(trigger)
  })

  it('returns focus to the exact trigger when there is more than one (document.activeElement is saved on open)', async () => {
    function TwoTriggers() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open from the first button</button>
          <button type="button" onClick={() => setOpen(true)}>Open from the second button</button>
          <ModalDialog open={open} onClose={() => setOpen(false)} title="Confirm" description="One action.">
            <button type="button" onClick={() => setOpen(false)}>Done</button>
          </ModalDialog>
        </>
      )
    }
    const user = userEvent.setup()
    render(<TwoTriggers />)

    for (const name of ['Open from the second button', 'Open from the first button']) {
      const trigger = await openWithKeyboard(user, name)
      expect(focused()).toBe(screen.getByRole('button', { name: 'Done' }))
      await user.keyboard('{Escape}')
      expect(focused()).toBe(trigger)
    }
  })

  it('returns focus on every way of closing: Cancel, and a successful submit', async () => {
    const user = userEvent.setup()
    render(<Page><DisbursementOverrideModal /></Page>)

    const trigger = await openWithKeyboard(user, HAND_BUILT_TRIGGER)
    await user.tab() // Cancel
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focused()).toBe(trigger)

    await user.keyboard('{Enter}') // open again
    await user.keyboard('Cap raised for the December restock.')
    await user.tab()
    await user.tab() // Approve override
    await user.keyboard(' ') // Space activates a button too
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focused()).toBe(trigger)
    expect(screen.getByRole('status').textContent).toBe('Override recorded for L-1042. Demo only: no payout was sent.')
  })

  it('binds the reason field: label, aria-invalid, hint, and an alert that takes focus back to the field', async () => {
    const user = userEvent.setup()
    render(<Page><DisbursementOverrideModal /></Page>)
    await openWithKeyboard(user, HAND_BUILT_TRIGGER)
    const field = screen.getByLabelText('Reason for override')
    expect(field.getAttribute('aria-invalid')).toBe('false')
    const hintId = field.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(hintId)?.textContent).toContain('At least 10 characters')

    await user.keyboard('too short')
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}') // Approve with an invalid reason

    expect(screen.getByRole('dialog')).toBeDefined() // still open
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toContain('at least 10 characters')
    expect(field.getAttribute('aria-describedby')).toBe(`${hintId} ${screen.getByRole('alert').id}`)
    expect(focused()).toBe(field)
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('honours initialFocusRef, and keeps focus on the dialog itself when it has nothing tabbable', async () => {
    function WithInitialFocus() {
      const [open, setOpen] = useState(false)
      const safeRef = useRef<HTMLButtonElement>(null)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Delete draft</button>
          <ModalDialog open={open} onClose={() => setOpen(false)} title="Delete?" description="This cannot be undone." initialFocusRef={safeRef}>
            <button type="button">Delete</button>
            <button type="button" ref={safeRef}>Keep it</button>
          </ModalDialog>
        </>
      )
    }
    function TextOnly() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Show notice</button>
          <ModalDialog open={open} onClose={() => setOpen(false)} title="Notice" description="Read only.">
            <p>No controls here.</p>
          </ModalDialog>
        </>
      )
    }
    const user = userEvent.setup()

    const first = render(<WithInitialFocus />)
    await openWithKeyboard(user, 'Delete draft')
    expect(focused()).toBe(screen.getByRole('button', { name: 'Keep it' })) // the safe choice, not the first one
    first.unmount()

    render(<Page><TextOnly /></Page>)
    const trigger = await openWithKeyboard(user, 'Show notice')
    const dialog = screen.getByRole('dialog')
    expect(focused()).toBe(dialog)
    await user.tab()
    expect(focused()).toBe(dialog) // nowhere to go, and not out to the page
    await user.keyboard('{Escape}')
    expect(focused()).toBe(trigger)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Tabs — W3C APG Tabs, hand-built', () => {
  const tab = (name: string): HTMLElement => screen.getByRole('tab', { name })
  const selectedNames = (): string[] =>
    screen.getAllByRole('tab').filter((item) => item.getAttribute('aria-selected') === 'true').map((item) => item.textContent ?? '')

  it('has the tablist, tab and tabpanel roles wired to each other', () => {
    render(<LoanLifecycleTabs />)
    const tablist = screen.getByRole('tablist', { name: 'Loan lifecycle and ledger (hand-built)' })
    expect(tablist.getAttribute('aria-orientation')).toBe('horizontal')
    expect(screen.getAllByRole('tab').map((item) => item.textContent)).toEqual(['Lifecycle', 'Ledger', 'Concurrency'])

    for (const item of screen.getAllByRole('tab')) {
      const panel = document.getElementById(item.getAttribute('aria-controls') ?? '')
      expect(panel?.getAttribute('role')).toBe('tabpanel')
      expect(panel?.getAttribute('aria-labelledby')).toBe(item.id)
      expect(panel?.getAttribute('tabindex')).toBe('0')
      // Only the selected tab's panel is shown.
      expect(panel?.hidden).toBe(item.getAttribute('aria-selected') !== 'true')
    }
    expect(screen.getByRole('tabpanel', { name: 'Lifecycle' }).textContent).toContain('10 states')
  })

  it('uses a roving tabindex: exactly one tab is a Tab stop, and it is the selected one', async () => {
    const user = userEvent.setup()
    render(<LoanLifecycleTabs />)
    const stops = (): string[] =>
      screen.getAllByRole('tab').filter((item) => item.getAttribute('tabindex') === '0').map((item) => item.textContent ?? '')
    expect(stops()).toEqual(['Lifecycle'])
    expect(screen.getAllByRole('tab').map((item) => item.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])

    tab('Lifecycle').focus()
    await user.keyboard('{ArrowRight}')
    expect(stops()).toEqual(['Ledger'])
    expect(selectedNames()).toEqual(['Ledger'])
  })

  it('ArrowRight moves focus and selection, and wraps from the last tab to the first', async () => {
    const user = userEvent.setup()
    render(<LoanLifecycleTabs />)
    tab('Lifecycle').focus()

    await user.keyboard('{ArrowRight}')
    expect(focused()).toBe(tab('Ledger'))
    expect(selectedNames()).toEqual(['Ledger'])
    expect(screen.getByRole('tabpanel', { name: 'Ledger' }).textContent).toContain('Σ debits ₱5,000.00 === Σ credits ₱5,000.00')

    await user.keyboard('{ArrowRight}')
    expect(focused()).toBe(tab('Concurrency'))
    await user.keyboard('{ArrowRight}') // last → first
    expect(focused()).toBe(tab('Lifecycle'))
    expect(selectedNames()).toEqual(['Lifecycle'])
  })

  it('ArrowLeft moves back, and wraps from the first tab to the last', async () => {
    const user = userEvent.setup()
    render(<LoanLifecycleTabs />)
    tab('Lifecycle').focus()

    await user.keyboard('{ArrowLeft}') // first → last
    expect(focused()).toBe(tab('Concurrency'))
    expect(selectedNames()).toEqual(['Concurrency'])
    await user.keyboard('{ArrowLeft}')
    expect(focused()).toBe(tab('Ledger'))
    expect(selectedNames()).toEqual(['Ledger'])
  })

  it('Home jumps to the first tab and End to the last', async () => {
    const user = userEvent.setup()
    render(<LoanLifecycleTabs />)
    tab('Lifecycle').focus()

    await user.keyboard('{End}')
    expect(focused()).toBe(tab('Concurrency'))
    expect(selectedNames()).toEqual(['Concurrency'])
    await user.keyboard('{Home}')
    expect(focused()).toBe(tab('Lifecycle'))
    expect(selectedNames()).toEqual(['Lifecycle'])
    await user.keyboard('{ArrowRight}{End}{End}')
    expect(focused()).toBe(tab('Concurrency'))
  })

  it('Tab goes from the selected tab straight to its panel, skipping the other tabs', async () => {
    const user = userEvent.setup()
    render(<Page><LoanLifecycleTabs /></Page>)

    await user.tab()
    expect(focused()).toBe(screen.getByRole('button', { name: 'Before' }))
    await user.tab()
    expect(focused()).toBe(tab('Lifecycle')) // the whole tablist is one stop
    await user.keyboard('{ArrowRight}')
    await user.tab()
    expect(focused()).toBe(screen.getByRole('tabpanel', { name: 'Ledger' })) // not the Concurrency tab
    await user.tab()
    expect(focused()).toBe(screen.getByRole('button', { name: 'After' }))

    await user.tab({ shift: true })
    await user.tab({ shift: true })
    expect(focused()).toBe(tab('Ledger')) // back in on the selected tab, not the first one
  })

  it('still selects with a click, respects defaultTabId, and renders nothing for an empty list', async () => {
    const user = userEvent.setup()
    const items = [
      { id: 'a', label: 'Alpha', content: 'Panel A' },
      { id: 'b', label: 'Beta', content: 'Panel B' },
    ]
    const view = render(<Tabs label="Demo" tabs={items} defaultTabId="b" />)
    expect(selectedNames()).toEqual(['Beta'])
    await user.click(tab('Alpha'))
    expect(selectedNames()).toEqual(['Alpha'])
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel A')
    view.unmount()

    const empty = render(<Tabs label="Empty" tabs={[]} />)
    expect(empty.container.innerHTML).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Disclosure — W3C APG Disclosure (Show/Hide), hand-built', () => {
  const SUMMARY = 'Why a retry cannot pay a borrower twice'

  it('is a real button whose aria-controls points at the content', () => {
    render(<IdempotencyDisclosure />)
    const button = screen.getByRole('button', { name: SUMMARY })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')

    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '')
    expect(panel).not.toBeNull()
    expect(panel?.hidden).toBe(true)
    expect(panel?.textContent).toContain('Idempotency-Key')
  })

  it('toggles aria-expanded and the content with Enter and with Space', async () => {
    const user = userEvent.setup()
    render(<Page><IdempotencyDisclosure /></Page>)
    const button = screen.getByRole('button', { name: SUMMARY })
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '')
    if (panel === null) throw new Error('aria-controls points at nothing')

    await user.tab()
    await user.tab()
    expect(focused()).toBe(button)

    await user.keyboard('{Enter}')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(panel.hidden).toBe(false)
    expect(within(panel).getByText('409 VERSION_MISMATCH')).toBeDefined()

    await user.keyboard(' ')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(panel.hidden).toBe(true)

    await user.keyboard(' ')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Enter}')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(focused()).toBe(button) // focus never moves
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('shadcn/ui (Radix) passes the same keyboard contract', () => {
  it('Dialog: opens from the keyboard, traps Tab both ways, closes on Escape, returns focus', async () => {
    const user = userEvent.setup()
    render(<Page><ShadcnOverrideDialog /></Page>)
    const trigger = await openWithKeyboard(user, SHADCN_TRIGGER)

    const dialog = await screen.findByRole('dialog', { name: DIALOG_NAME })
    expect(focused()).toBe(screen.getByLabelText('Reason for override'))
    for (let press = 0; press < 9; press += 1) {
      await user.tab()
      expect(dialog.contains(focused())).toBe(true)
    }
    for (let press = 0; press < 9; press += 1) {
      await user.tab({ shift: true })
      expect(dialog.contains(focused())).toBe(true)
    }

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focused()).toBe(trigger)
  })

  it('Tabs: arrows wrap, Home and End jump, Tab goes to the panel', async () => {
    const user = userEvent.setup()
    render(<Page><ShadcnLifecycleTabs /></Page>)
    const tab = (name: string): HTMLElement => screen.getByRole('tab', { name })
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('horizontal')

    await user.tab()
    await user.tab()
    expect(focused()).toBe(tab('Lifecycle'))
    await user.keyboard('{ArrowLeft}')
    expect(focused()).toBe(tab('Concurrency'))
    expect(tab('Concurrency').getAttribute('aria-selected')).toBe('true')
    await user.keyboard('{ArrowRight}')
    expect(focused()).toBe(tab('Lifecycle'))
    await user.keyboard('{End}')
    expect(focused()).toBe(tab('Concurrency'))
    await user.keyboard('{Home}{ArrowRight}')
    expect(focused()).toBe(tab('Ledger'))
    await user.tab()
    expect(focused()).toBe(screen.getByRole('tabpanel', { name: 'Ledger' }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
/**
 * The five gaps in NOTES.md, as tests. Each one shows the same situation on
 * both sides: what the hand-built component does, and what Radix does.
 * These pin the gaps down so the notes cannot drift from the code.
 */
describe('NOTES.md gaps, pinned as tests', () => {
  it('Gap 1 — background: Radix hides the rest of the page from assistive tech; the hand-built dialog does not', async () => {
    const user = userEvent.setup()

    const handBuilt = render(<Page><DisbursementOverrideModal /></Page>)
    await openWithKeyboard(user, HAND_BUILT_TRIGGER)
    // Still in the accessibility tree: a screen reader's browse mode can walk out to it.
    expect(screen.getByRole('button', { name: 'Before' })).toBeDefined()
    expect(document.querySelector('[aria-hidden="true"]:not(span)')).toBeNull()
    handBuilt.unmount()

    render(<Page><ShadcnOverrideDialog /></Page>)
    await openWithKeyboard(user, SHADCN_TRIGGER)
    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Before' })).toBeNull() // gone from the accessibility tree
    const before = screen.getByRole('button', { name: 'Before', hidden: true }) // still in the DOM
    expect(before.closest('[aria-hidden="true"]')).not.toBeNull()

    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Before' })).toBeDefined() // restored on close
  })

  it('Gap 2 — portal and scroll lock: Radix renders under <body> and locks page scroll; the hand-built dialog does neither', async () => {
    const user = userEvent.setup()

    const handBuilt = render(<Page><DisbursementOverrideModal /></Page>)
    await openWithKeyboard(user, HAND_BUILT_TRIGGER)
    expect(handBuilt.container.contains(screen.getByRole('dialog'))).toBe(true) // inline, inside the app's tree
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false)
    handBuilt.unmount()

    const shadcn = render(<Page><ShadcnOverrideDialog /></Page>)
    await openWithKeyboard(user, SHADCN_TRIGGER)
    const dialog = await screen.findByRole('dialog')
    expect(shadcn.container.contains(dialog)).toBe(false) // portalled out of the app's tree
    expect(dialog.parentElement).toBe(document.body)
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(true)
    const injectedStyles = Array.from(document.querySelectorAll('style')).map((style) => style.textContent ?? '').join('\n')
    expect(injectedStyles).toContain('--removed-body-scroll-bar-size')
    expect(injectedStyles).toMatch(/overflow:\s*hidden/)

    await user.keyboard('{Escape}')
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false)
  })

  it('Gap 3 — outside press: Radix closes on a press that STARTS outside, and not on a drag that ends there', async () => {
    const user = userEvent.setup()

    const handBuilt = render(<Page><DisbursementOverrideModal /></Page>)
    await openWithKeyboard(user, HAND_BUILT_TRIGGER)
    // The backdrop has no role of its own: it is the element that holds the dialog.
    await user.click(screen.getByRole('dialog').parentElement ?? document.body)
    expect(screen.getByRole('dialog')).toBeDefined() // no outside-press dismissal at all
    handBuilt.unmount()

    render(<Page><ShadcnOverrideDialog /></Page>)
    await openWithKeyboard(user, SHADCN_TRIGGER)
    // The overlay has no role: it is rendered right before the dialog, in the same portal.
    const overlay = (await screen.findByRole('dialog')).previousElementSibling
    if (overlay === null) throw new Error('overlay not rendered')
    // Radix attaches its document listener on the next tick.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

    // Press inside the text field, drag out, release over the overlay (selecting text).
    await user.pointer([
      { keys: '[MouseLeft>]', target: screen.getByLabelText('Reason for override') },
      { target: overlay },
      { keys: '[/MouseLeft]' },
    ])
    expect(screen.getByRole('dialog')).toBeDefined() // still open

    // A press that starts on the overlay closes it.
    await user.click(overlay)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Gap 4 — tabs: Radix flips the arrows for dir="rtl", skips disabled tabs and supports manual activation', async () => {
    const user = userEvent.setup()
    const tab = (name: string): HTMLElement => screen.getByRole('tab', { name })

    // Hand-built, inside a right-to-left page: ArrowLeft still means "previous", which is now the wrong way visually.
    const handBuilt = render(<div dir="rtl"><LoanLifecycleTabs /></div>)
    tab('Lifecycle').focus()
    await user.keyboard('{ArrowLeft}')
    expect(focused()).toBe(tab('Concurrency')) // went to the previous tab (wrapped), not the next
    handBuilt.unmount()

    // Radix with dir="rtl": ArrowLeft means "next".
    const rtl = render(
      <ShadcnTabs defaultValue="one" dir="rtl">
        <TabsList aria-label="RTL">
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
          <TabsTrigger value="three">Three</TabsTrigger>
        </TabsList>
        <TabsContent value="one">1</TabsContent>
        <TabsContent value="two">2</TabsContent>
        <TabsContent value="three">3</TabsContent>
      </ShadcnTabs>,
    )
    tab('One').focus()
    await user.keyboard('{ArrowLeft}')
    expect(focused()).toBe(tab('Two'))
    await user.keyboard('{ArrowRight}')
    expect(focused()).toBe(tab('One'))
    rtl.unmount()

    // Disabled tab in the middle: skipped in both directions.
    const disabled = render(
      <ShadcnTabs defaultValue="one">
        <TabsList aria-label="Disabled">
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two" disabled>Two</TabsTrigger>
          <TabsTrigger value="three">Three</TabsTrigger>
        </TabsList>
        <TabsContent value="one">1</TabsContent>
        <TabsContent value="two">2</TabsContent>
        <TabsContent value="three">3</TabsContent>
      </ShadcnTabs>,
    )
    tab('One').focus()
    await user.keyboard('{ArrowRight}')
    expect(focused()).toBe(tab('Three'))
    await user.keyboard('{ArrowLeft}')
    expect(focused()).toBe(tab('One'))
    disabled.unmount()

    // Manual activation: arrows move focus only; Enter or Space selects.
    render(
      <ShadcnTabs defaultValue="one" activationMode="manual">
        <TabsList aria-label="Manual">
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">1</TabsContent>
        <TabsContent value="two">2</TabsContent>
      </ShadcnTabs>,
    )
    tab('One').focus()
    await user.keyboard('{ArrowRight}')
    expect(focused()).toBe(tab('Two'))
    expect(tab('One').getAttribute('aria-selected')).toBe('true') // focus moved, selection did not
    await user.keyboard('{Enter}')
    expect(tab('Two').getAttribute('aria-selected')).toBe('true')
  })

  it('Gap 5 — composition: asChild keeps the consumer\'s handler and ref, and adds state to the trigger', async () => {
    const onClick = vi.fn()
    function Composed() {
      const ref = useRef<HTMLButtonElement>(null)
      return (
        <Dialog>
          <DialogTrigger asChild>
            <button type="button" ref={ref} onClick={onClick} className="my-own-class">
              Open composed dialog
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Composed</DialogTitle>
            <DialogDescription>Trigger rendered by the consumer.</DialogDescription>
            <button type="button" onClick={() => ref.current?.setAttribute('data-ref-works', 'yes')}>
              Use the ref
            </button>
          </DialogContent>
        </Dialog>
      )
    }
    const user = userEvent.setup()
    render(<Composed />)
    const trigger = screen.getByRole('button', { name: 'Open composed dialog' })

    // One DOM node: ours. Radix added its attributes to it instead of wrapping it.
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger.className).toContain('my-own-class')
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('data-state')).toBe('closed')

    await user.click(trigger)
    expect(onClick).toHaveBeenCalledTimes(1) // our handler ran
    const dialog = await screen.findByRole('dialog') // and so did Radix's
    expect(trigger.getAttribute('data-state')).toBe('open')
    expect(trigger.getAttribute('aria-controls')).toBe(dialog.id)
    expect(dialog.getAttribute('data-state')).toBe('open')

    await user.click(screen.getByRole('button', { name: 'Use the ref' }))
    expect(trigger.getAttribute('data-ref-works')).toBe('yes') // our ref still points at the button

    // The hand-built trigger is a plain button: nothing on it says it opens a dialog.
    cleanup()
    render(<DisbursementOverrideModal />)
    const plain = screen.getByRole('button', { name: HAND_BUILT_TRIGGER })
    expect(plain.hasAttribute('aria-haspopup')).toBe(false)
    expect(plain.hasAttribute('aria-expanded')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('type safety', () => {
  /**
   * `tsc --strict` and oxlint's `no-explicit-any` are the real gate. This is a
   * second, readable check over the source text: no `any` type, and none of
   * the comments that switch a checker off.
   */
  const root = process.cwd()
  const sources = [
    ...readdirSync(path.join(root, 'playground')).filter((name) => /\.tsx?$/.test(name)).map((name) => path.join('playground', name)),
    'src/components/ui/dialog.tsx',
    'src/components/ui/tabs.tsx',
    'src/features/playground/ShadcnExamples.tsx',
    'src/app/playground/page.tsx',
    'src/lib/utils.ts',
  ]

  /** Drops comments and string literals, so prose such as "for any number" is not flagged. */
  const codeOnly = (source: string): string =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""')

  it('covers the component files', () => {
    expect(sources).toContain(path.join('playground', 'ModalDialog.tsx'))
    expect(sources).toContain(path.join('playground', 'Tabs.tsx'))
    expect(sources).toContain(path.join('playground', 'Disclosure.tsx'))
    expect(sources.length).toBeGreaterThanOrEqual(12)
  })

  it.each(sources)('%s has no `any` and no checker-disabling comment', (file) => {
    const source = readFileSync(path.join(root, file), 'utf8')
    expect(source).not.toMatch(/@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|oxlint-disable/)
    const anyUses = codeOnly(source).split('\n').filter((line) => /(?<![\w$.-])any(?![\w$-])/.test(line))
    expect(anyUses).toEqual([])
  })
})
