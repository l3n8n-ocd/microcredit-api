'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { CHAT_LIMITS, type ChatStreamEvent, type EngineInfo } from './chatProtocol.ts'
import { chatReducer, createInitialState, isBusy, toWireHistory } from './chatReducer.ts'
import { fetchChatTransport, type ChatTransport } from './chatTransport.ts'
import { messageText, type ChatMessage, type StarterPrompt } from './chatTypes.ts'
import { clearConversation, loadConversation, saveConversation } from './conversationStore.ts'
import { StreamingMarkdown } from './StreamingMarkdown.tsx'

/**
 * AI Underwriting & Ledger Risk Copilot: the streaming chat UI.
 *
 * Four behaviours carry the component (docs/FE-06_STREAMING_CHAT.md):
 *   Tip 1  smart auto-scroll      pinned to the bottom only while within 48 px of it
 *   Tip 2  Stop as a state machine  one reducer, one AbortController per request
 *   Tip 3  flicker-free handoff   "thinking" and the first token share one DOM node
 *   Tip 4  streaming-safe Markdown  see StreamingMarkdown.tsx
 */

/** Tip 1: how close to the bottom still counts as "following the stream". */
const PIN_THRESHOLD_PX = 48

const INPUT_ID = 'copilot-input'
const HINT_ID = 'copilot-input-hint'
const ERROR_ID = 'copilot-input-error'

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
/** Message entry: 150 ms ease-out (cubic-bezier(0, 0, 0.2, 1)), off under prefers-reduced-motion. */
const ENTER_MOTION =
  'transition-[opacity,translate] duration-150 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none'

const TIME_FORMAT = new Intl.DateTimeFormat('en-PH', { hour: '2-digit', minute: '2-digit' })

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : TIME_FORMAT.format(date)
}

export interface StreamingUnderwritingChatProps {
  /** From `STARTER_PROMPTS` in the server-only model module, passed down by the server page. */
  readonly starterPrompts: readonly StarterPrompt[]
  /** The engine this deployment is configured for. Each reply then reports the engine that wrote it. */
  readonly engine: EngineInfo
  /** Injected in tests. Defaults to `fetch` + SSE against `/api/chat`. */
  readonly transport?: ChatTransport
}

function subscribeToNothing(): () => void {
  return () => {}
}

/**
 * Hydration gate. The server cannot read `localStorage`, so it renders an
 * empty conversation. `useSyncExternalStore` reports `false` on the server and
 * during hydration, then `true`: at that point the session remounts once with
 * the stored messages. No mismatch warning, and no `setState` inside an effect.
 */
export function StreamingUnderwritingChat(props: StreamingUnderwritingChatProps) {
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  )
  const stored = useMemo(() => (hydrated ? loadConversation() : []), [hydrated])
  return <ChatSession key={hydrated ? 'browser' : 'server'} {...props} initialMessages={stored} />
}

/**
 * Tip 3. Rendered INSIDE the assistant bubble's body container, which is the
 * same element the first token is written into. It is one text line tall
 * (`h-6`, matching `leading-6`), so swapping it for the first line of the reply
 * changes no geometry: no flicker, no jump.
 */
function ThinkingIndicator() {
  return (
    <span className="inline-flex h-6 items-center gap-2 text-slate-600" data-testid="thinking-indicator">
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        <span className="copilot-dot" />
        <span className="copilot-dot" />
        <span className="copilot-dot" />
      </span>
      <span className="text-xs">Thinking…</span>
    </span>
  )
}

const BADGE = 'mt-2 inline-block rounded border px-1.5 py-0.5 font-mono text-xs'

function AssistantMessage({ message }: { readonly message: ChatMessage }) {
  const text = messageText(message)
  const pending = message.outcome === 'pending'
  return (
    <>
      {/* One container for the whole life of the reply: thinking → first token → full text. */}
      <div className="min-h-6" data-testid="assistant-body">
        {text === '' && pending ? (
          <ThinkingIndicator />
        ) : text === '' ? (
          <p className="text-slate-600">No reply text.</p>
        ) : (
          // A stopped or failed reply was cut mid-construct, so it keeps the tolerant parsing for good.
          <StreamingMarkdown text={text} streaming={message.outcome !== 'complete'} />
        )}
      </div>
      {message.outcome === 'stopped' && (
        <span className={`${BADGE} border-slate-300 bg-slate-100 text-slate-700`}>[Stopped mid-stream]</span>
      )}
      {message.outcome === 'error' && (
        <span className={`${BADGE} border-rose-300 bg-rose-50 text-rose-800`}>[Reply failed]</span>
      )}
      {message.finishReason !== undefined && (
        <span className={`${BADGE} border-slate-300 bg-slate-100 text-slate-700`}>
          [Ended early: {message.finishReason}]
        </span>
      )}
    </>
  )
}

function MessageItem({ message }: { readonly message: ChatMessage }) {
  const isUser = message.role === 'user'
  const time = formatTime(message.createdAt)
  return (
    <li className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} ${ENTER_MOTION}`} data-role={message.role}>
      <div
        className={`max-w-full min-w-0 rounded-lg px-3 py-2 text-sm leading-6 sm:max-w-[88%] ${
          isUser ? 'bg-main text-white' : 'w-full border border-slate-200 bg-canvas text-ink sm:w-auto'
        }`}
      >
        <span className="sr-only">{isUser ? 'You said: ' : 'Copilot said: '}</span>
        {isUser ? (
          <p className="wrap-anywhere whitespace-pre-wrap">{messageText(message)}</p>
        ) : (
          <AssistantMessage message={message} />
        )}
      </div>
      <p className="mt-1 font-mono text-xs text-slate-600">
        {isUser ? 'you' : (message.engine?.label ?? 'copilot')}
        {time !== '' && (
          <>
            {' · '}
            <time dateTime={message.createdAt}>{time}</time>
          </>
        )}
      </p>
    </li>
  )
}

interface StarterChipsProps {
  readonly prompts: readonly StarterPrompt[]
  readonly disabled: boolean
  readonly onPick: (prompt: string) => void
  /** `wrap` in the empty state; `strip` is one row that scrolls sideways inside itself. */
  readonly layout: 'wrap' | 'strip'
}

function StarterChips({ prompts, disabled, onPick, layout }: StarterChipsProps) {
  return (
    <ul
      aria-label="Starter prompts"
      className={layout === 'wrap' ? 'flex flex-wrap gap-2' : 'flex gap-2 overflow-x-auto pb-1 whitespace-nowrap'}
    >
      {prompts.map((starter) => (
        <li key={starter.id} className="shrink-0">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(starter.prompt)}
            title={starter.prompt}
            className={`min-h-11 rounded-full border border-main bg-white px-3 text-left text-sm text-ink transition-colors duration-150 ease-out hover:bg-slate-100 disabled:border-slate-300 disabled:text-slate-500 motion-reduce:transition-none ${FOCUS_RING}`}
          >
            {starter.label}
          </button>
        </li>
      ))}
    </ul>
  )
}

interface ChatSessionProps extends StreamingUnderwritingChatProps {
  readonly initialMessages: readonly ChatMessage[]
}

function ChatSession({ starterPrompts, engine, transport = fetchChatTransport, initialMessages }: ChatSessionProps) {
  const [state, dispatch] = useReducer(chatReducer, initialMessages, createInitialState)
  const [draft, setDraft] = useState('')
  /** Tip 1: drives the "Jump to latest" pill. Set from scroll events only. */
  const [isAtBottom, setIsAtBottom] = useState(true)
  /** Tip 1: the log's geometry after the previous commit, and a one-shot "follow no matter what". */
  const lastGeometryRef = useRef({ scrollHeight: 0, clientHeight: 0 })
  const forceFollowRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** Tip 2: the controller of the request in flight, or null. One per request, never reused. */
  const abortRef = useRef<AbortController | null>(null)

  const busy = isBusy(state.status)
  const tooLong = draft.length > CHAT_LIMITS.maxUserChars
  const canSend = !busy && !tooLong && draft.trim() !== ''
  const hasMessages = state.messages.length > 0

  // ── Tip 1: smart auto-scroll ──────────────────────────────────────────────

  /** A scroll event (the user's, or ours). It only decides whether the pill shows. */
  const handleScroll = (): void => {
    const element = scrollRef.current
    if (element === null) return
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    setIsAtBottom(distanceFromBottom <= PIN_THRESHOLD_PX)
  }

  /**
   * After every commit that changed the messages, follow the stream ONLY if the
   * user was within 48 px of the bottom BEFORE this commit added content.
   *
   * The decision reads the live `scrollTop`, not a flag set by `onScroll`. The
   * browser delivers scroll events a frame late, while tokens land every ~22 ms:
   * a token committed in that gap would see a stale "still pinned" flag and yank
   * a user who had just scrolled up back to the bottom. Measuring against the
   * previous commit's height has no such gap.
   *
   * Two distances are taken, against the previous and the current viewport
   * height, and the smaller wins. That keeps the pin when the log itself is
   * resized (the on-screen keyboard opening or closing on a phone).
   *
   * `useLayoutEffect` runs before paint, so the new token and the new scroll
   * position reach the screen in the same frame.
   */
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element === null) return
    const previous = lastGeometryRef.current
    const gapBefore = previous.scrollHeight - element.scrollTop
    const distanceBefore = Math.min(gapBefore - previous.clientHeight, gapBefore - element.clientHeight)
    if (forceFollowRef.current || distanceBefore <= PIN_THRESHOLD_PX) element.scrollTop = element.scrollHeight
    forceFollowRef.current = false
    lastGeometryRef.current = { scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }
  }, [state.messages])

  const jumpToLatest = (): void => {
    const element = scrollRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
    setIsAtBottom(true)
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  /** Save at rest (reply finished, stopped, failed or cleared), not on every token. */
  useEffect(() => {
    if (!busy) saveConversation(state.messages)
  }, [busy, state.messages])

  /** Leaving the page cancels the request in flight. */
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  // ── Tip 2: send / stop ────────────────────────────────────────────────────

  const send = useCallback(
    (raw: string): void => {
      const text = raw.trim()
      if (busy || text === '' || text.length > CHAT_LIMITS.maxUserChars) return

      const createdAt = new Date().toISOString()
      const user: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text }],
        createdAt,
        outcome: 'complete',
      }
      // The assistant bubble exists from this moment, empty. It shows "thinking"
      // until the first token is appended to it (Tip 3).
      const assistant: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
        createdAt,
        outcome: 'pending',
      }

      const controller = new AbortController()
      abortRef.current = controller
      const history = toWireHistory([...state.messages, user])

      // Sending is an explicit "take me to the latest", even if the user had scrolled up.
      forceFollowRef.current = true
      setIsAtBottom(true)
      setDraft('')
      dispatch({ type: 'SUBMIT', user, assistant })
      // The question survives a reload even if the tab closes mid-reply.
      saveConversation([...state.messages, user])

      let settled = false
      const onEvent = (event: ChatStreamEvent): void => {
        // Every action carries this run's assistant ID. After Stop, the reducer
        // no longer has it as `activeId`, so late events from this run are dropped.
        switch (event.type) {
          case 'meta':
            dispatch({ type: 'META', id: assistant.id, engine: event.engine })
            break
          case 'token':
            dispatch({ type: 'TOKEN', id: assistant.id, text: event.text })
            break
          case 'done':
            settled = true
            dispatch({ type: 'DONE', id: assistant.id, finishReason: event.finishReason })
            break
          case 'error':
            settled = true
            dispatch({ type: 'FAIL', id: assistant.id, message: event.message })
            break
        }
      }

      transport({ messages: history, signal: controller.signal, onEvent }).then(
        () => {
          if (!settled && !controller.signal.aborted) {
            dispatch({ type: 'FAIL', id: assistant.id, message: 'The connection closed before the reply finished.' })
          }
        },
        (error: unknown) => {
          // An abort is the user pressing Stop: already handled, not an error.
          if (controller.signal.aborted) return
          const message = error instanceof Error && error.message !== '' ? error.message : 'The copilot request failed.'
          dispatch({ type: 'FAIL', id: assistant.id, message })
        },
      )
    },
    [busy, state.messages, transport],
  )

  /**
   * Stop: (1) abort the HTTP request, (2) move the machine to `stopped`, which
   * keeps the partial text and re-enables Send in the same render, (3) put the
   * cursor back in the input. Nothing waits for the network to confirm.
   */
  const stop = (): void => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ type: 'STOP' })
    inputRef.current?.focus()
  }

  const clear = (): void => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ type: 'CLEAR' })
    clearConversation()
    forceFollowRef.current = true
    setIsAtBottom(true)
    inputRef.current?.focus()
  }

  /**
   * One submit button that is Send or Stop depending on `status`. Its `type`
   * never changes: switching a button from "button" to "submit" inside its own
   * click handler would let the same click submit the form a moment later.
   */
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (busy) stop()
    else send(draft)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!busy) send(draft)
  }

  const statusText =
    state.status === 'submitted'
      ? 'Copilot is thinking.'
      : state.status === 'streaming'
        ? 'Copilot is replying.'
        : state.status === 'stopped'
          ? 'Stopped. The partial reply is kept.'
          : state.status === 'idle' && hasMessages
            ? 'Reply complete.'
            : ''

  return (
    <section
      id="copilot"
      aria-labelledby="copilot-heading"
      className="flex h-[min(44rem,calc(100dvh-4rem))] min-h-96 scroll-mt-4 flex-col overflow-hidden rounded-lg border border-main bg-white"
    >
      <header className="flex items-start justify-between gap-3 border-b border-main bg-main px-3 py-3 text-canvas sm:items-center sm:px-4">
        <div className="min-w-0">
          <h2 id="copilot-heading" className="text-base font-semibold">
            AI Underwriting &amp; Ledger Risk Copilot
          </h2>
          <p className="font-mono text-xs text-slate-300">
            <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-accent align-middle" />
            engine: <span data-testid="engine-label">{engine.label}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={clear}
          disabled={!hasMessages}
          aria-label="Clear conversation"
          className={`min-h-11 shrink-0 rounded-md border border-slate-400 px-3 text-sm font-semibold text-canvas transition-colors duration-150 ease-out hover:bg-slate-700 disabled:border-slate-600 disabled:text-slate-400 motion-reduce:transition-none ${FOCUS_RING}`}
        >
          Clear<span className="hidden sm:inline"> conversation</span>
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        {/* role="log" defaults to a polite live region, which would read every token. It is off; the status line below speaks instead. */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          role="log"
          aria-live="off"
          aria-label="Conversation"
          aria-busy={busy ? 'true' : 'false'}
          tabIndex={0}
          className={`h-full overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-4 ${FOCUS_RING}`}
        >
          {hasMessages ? (
            <ol className="space-y-4">
              {state.messages.map((message) => (
                <MessageItem key={message.id} message={message} />
              ))}
            </ol>
          ) : (
            <div className="mx-auto max-w-xl py-4">
              <p className="text-sm text-slate-700">
                Ask how a trust score was built, whether a loan can move{' '}
                <code className="font-mono">APPROVED → DISBURSED</code>, why{' '}
                <code className="font-mono">Σ debits === Σ credits</code>, or what{' '}
                <code className="font-mono">Idempotency-Key</code> and <code className="font-mono">If-Match</code> do on a
                double-click.
              </p>
              <div className="mt-4">
                <StarterChips prompts={starterPrompts} disabled={busy} onPick={send} layout="wrap" />
              </div>
            </div>
          )}
        </div>

        {!isAtBottom && hasMessages && (
          <button
            type="button"
            onClick={jumpToLatest}
            className={`absolute bottom-3 left-1/2 min-h-11 -translate-x-1/2 rounded-full whitespace-nowrap border border-main bg-white px-4 text-sm font-semibold text-ink shadow-md transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none ${FOCUS_RING}`}
          >
            {busy ? '↓ Jump to latest (streaming…)' : '↓ Jump to latest'}
          </button>
        )}
      </div>

      <p role="status" className="sr-only">
        {statusText}
      </p>

      {/* Bottom bar: the last child of a fixed-height flex column, so it stays in view while the log scrolls. */}
      <form
        onSubmit={handleSubmit}
        aria-busy={busy ? 'true' : 'false'}
        className="border-t border-slate-200 bg-canvas px-3 py-3 sm:px-4"
        noValidate
      >
        {state.error !== null && (
          <p role="alert" className="mb-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <span className="font-semibold">Reply failed.</span> {state.error}
          </p>
        )}
        {hasMessages && (
          <div className="mb-2">
            <StarterChips prompts={starterPrompts} disabled={busy} onPick={send} layout="strip" />
          </div>
        )}
        <label htmlFor={INPUT_ID} className="block text-sm font-semibold text-ink">
          Ask the copilot
        </label>
        <div className="mt-1 flex items-end gap-2">
          <textarea
            ref={inputRef}
            id={INPUT_ID}
            name="message"
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-invalid={tooLong ? 'true' : 'false'}
            aria-describedby={tooLong ? `${HINT_ID} ${ERROR_ID}` : HINT_ID}
            placeholder="e.g. Can a REJECTED loan be DISBURSED?"
            className={`min-h-11 min-w-0 flex-1 resize-none rounded-md border bg-white px-3 py-2 text-base text-ink placeholder:text-slate-500 sm:text-sm ${
              tooLong ? 'border-rose-600' : 'border-slate-500'
            } ${FOCUS_RING}`}
          />
          <button
            type="submit"
            disabled={!busy && !canSend}
            data-state={busy ? 'stop' : 'send'}
            className={`min-h-11 w-20 shrink-0 rounded-md border border-main px-3 text-sm font-semibold transition-colors duration-150 ease-out motion-reduce:transition-none ${
              busy
                ? 'bg-white text-ink hover:bg-slate-100'
                : 'bg-main text-white hover:bg-slate-700 disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500'
            } ${FOCUS_RING}`}
          >
            {busy ? (
              <>
                <span aria-hidden="true">■ </span>Stop
              </>
            ) : (
              'Send'
            )}
          </button>
        </div>
        <p id={HINT_ID} className="mt-1 text-xs text-slate-600">
          Enter sends, Shift+Enter adds a line. The conversation is saved in this browser only.
        </p>
        {tooLong && (
          <p id={ERROR_ID} role="alert" className="mt-1 text-xs font-semibold text-rose-800">
            {draft.length} of {CHAT_LIMITS.maxUserChars} characters. Shorten the message to send it.
          </p>
        )}
      </form>
    </section>
  )
}
