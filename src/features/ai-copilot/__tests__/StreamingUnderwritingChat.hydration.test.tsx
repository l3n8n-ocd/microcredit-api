import { act } from '@testing-library/react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatTransport } from '../chatTransport.ts'
import { STORAGE_KEY } from '../conversationStore.ts'
import { StreamingUnderwritingChat } from '../StreamingUnderwritingChat.tsx'

/**
 * The chat is server-rendered as part of `/underwriting`, then hydrated. On
 * the server there is no localStorage, so it renders an empty conversation;
 * the stored one must appear once the browser takes over.
 *
 * The bug this pins down: during hydration the placeholder session saved its
 * empty conversation, which deleted the stored one before the real session
 * could load it. It only showed once the page hydrated cleanly: while the page
 * had a hydration mismatch, React re-rendered everything from scratch in the
 * browser and the restore happened to work.
 */

const STORED = [
  {
    id: 'm1',
    role: 'user',
    parts: [{ type: 'text', text: 'Explain the ledger.' }],
    createdAt: '2026-11-12T00:00:00.000Z',
    outcome: 'complete',
  },
  {
    id: 'm2',
    role: 'assistant',
    parts: [{ type: 'text', text: 'One balanced entry.' }],
    createdAt: '2026-11-12T00:00:01.000Z',
    outcome: 'complete',
    engine: { kind: 'local', label: 'local rule engine' },
  },
]

const neverCalled: ChatTransport = () => Promise.reject(new Error('no request expected'))

function Chat() {
  return (
    <StreamingUnderwritingChat
      starterPrompts={[{ id: 'a', label: 'Starter', prompt: 'Starter prompt' }]}
      engine={{ kind: 'local', label: 'local rule engine' }}
      transport={neverCalled}
    />
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.body.innerHTML = ''
})

describe('StreamingUnderwritingChat after server rendering', () => {
  it('restores the stored conversation on hydration, without a mismatch', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(STORED))

    const html = renderToString(<Chat />)
    expect(html).not.toContain('Explain the ledger.') // the server cannot see localStorage
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    const recoverable: unknown[] = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let root: Root | undefined
    await act(async () => {
      root = hydrateRoot(container, <Chat />, { onRecoverableError: (error) => recoverable.push(error) })
    })

    expect(recoverable).toEqual([])
    expect(container.textContent).toContain('Explain the ledger.')
    expect(container.textContent).toContain('One balanced entry.')
    // Hydrating did not delete what it was about to restore.
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')).toHaveLength(2)

    act(() => root?.unmount())
  })
})
