import { act, cleanup, render, screen } from '@testing-library/react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'
import { PENDING_IDEMPOTENCY_KEY, useIdempotencyKey } from './hooks/index.ts'

/**
 * `/` is a static page: Next renders `<App />` (a 'use client' island) to HTML
 * at build time, and the browser hydrates that HTML. If the two renders print
 * different text, React throws away the server HTML and logs error #418.
 *
 * The bug this pins down: `useState(createKey)` made a random Idempotency-Key
 * during render, so the server's key and the browser's key never matched, and
 * the static HTML carried one key for every visitor.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('/ hydrates without a mismatch', () => {
  it('bakes no Idempotency-Key into the server HTML', () => {
    const html = renderToString(<App />)
    expect(html).not.toMatch(UUID)
    expect(html).toContain(PENDING_IDEMPOTENCY_KEY)
  })

  it('hydrates the server HTML with no recoverable error, then shows a real key', async () => {
    const html = renderToString(<App />)
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    const recoverable: unknown[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let root: Root | undefined
    await act(async () => {
      root = hydrateRoot(container, <App />, { onRecoverableError: (error) => recoverable.push(error) })
    })

    expect(recoverable).toEqual([])
    expect(consoleError).not.toHaveBeenCalled()
    // After hydration the placeholder is gone and every printed key is a UUID v4.
    const printedKeys = Array.from(container.querySelectorAll('dt'))
      .filter((term) => term.textContent === 'Idempotency-Key')
      .map((term) => term.nextElementSibling?.textContent ?? '')
    expect(printedKeys.length).toBeGreaterThanOrEqual(2)
    for (const key of printedKeys) expect(key).toMatch(UUID)

    act(() => root?.unmount())
  })
})

describe('useIdempotencyKey', () => {
  function Probe({ createKey }: { readonly createKey: () => string }) {
    const [key, renew] = useIdempotencyKey(createKey)
    return (
      <button type="button" onClick={renew}>
        {key}
      </button>
    )
  }

  it('creates the key at mount outside hydration, and renew() starts a new intent', () => {
    let calls = 0
    const createKey = (): string => `key-${(calls += 1)}`
    render(<Probe createKey={createKey} />)

    const button = screen.getByRole('button')
    expect(button.textContent).toBe('key-1')
    act(() => button.click())
    expect(button.textContent).toBe('key-2')
    // Re-rendering alone never makes a new key: only renew() does.
    act(() => button.click())
    expect(button.textContent).toBe('key-3')
    expect(calls).toBe(3)
  })
})
