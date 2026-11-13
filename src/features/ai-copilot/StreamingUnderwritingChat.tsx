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
import { CHAT_TURN_RESERVE, SkeletonCard } from '../../components/ui/SkeletonCard.tsx'
import type { ToolName } from '../../lib/ai/tools.ts'
import {
  CHAT_LIMITS,
  SABOTAGE_MODES,
  type ChatStreamEvent,
  type DirectToolCall,
  type EngineInfo,
  type SabotageMode,
} from './chatProtocol.ts'
import { chatReducer, createInitialState, isBusy, toWireHistory, type ChatFailure } from './chatReducer.ts'
import { ChatRequestError, fetchChatTransport, type ChatTransport } from './chatTransport.ts'
import { failureCode, shortPrompt } from './chatFailure.ts'
import { messageText, toolPartsOf, type ChatFailureKind, type ChatMessage, type StarterPrompt, type ToolDecision } from './chatTypes.ts'
import { clearConversation, loadConversation, saveConversation } from './conversationStore.ts'
import { StreamingMarkdown } from './StreamingMarkdown.tsx'
import { ToolInvocationCard } from './ToolInvocationCard.tsx'

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
const DRILL_HINT_ID = 'copilot-drill-hint'

/** FE-08: a pending reply with no first token after this long shows the layout-matched skeleton. */
export const SLOW_REPLY_MS = 1500

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
  /** FE-07 tool chips (`TOOL_PROMPTS`). One may carry a drill, e.g. `tool-error`. */
  readonly toolPrompts?: readonly StarterPrompt[]
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
  return <ChatSession key={hydrated ? 'browser' : 'server'} {...props} initialMessages={stored} persist={hydrated} />
}

/**
 * Tip 3. Rendered INSIDE the assistant bubble's body container, which is the
 * same element the first token is written into. It is one text line tall
 * (`h-6`, matching `leading-6`) and block-level, so swapping it for the first
 * line of the reply changes no geometry: no flicker, no jump.
 */
function ThinkingIndicator() {
  return (
    // Block-level `flex`, not `inline-flex`: an inline box sits on the text baseline and made the line ~27 px,
    // so the first token (a 24 px line) pulled the bubble up 3 px. Measured by e2e/fe08.mjs (FE-08).
    <span className="flex h-6 items-center gap-2 text-slate-600" data-testid="thinking-indicator">
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

/** What an assistant bubble needs to drive its tool cards. */
interface ToolHandlers {
  readonly onDecision: (messageId: string, toolCallId: string, decision: ToolDecision) => void
  readonly onToolRetry: (toolName: ToolName, input: Record<string, unknown>, changes: string) => void
  /** True while any reply is streaming: a tool retry waits for it. */
  readonly busy: boolean
}

function AssistantMessage({ message, tools }: { readonly message: ChatMessage; readonly tools: ToolHandlers }) {
  const text = messageText(message)
  const pending = message.outcome === 'pending'
  const hasTools = toolPartsOf(message).length > 0
  const waiting = pending && text === '' && !hasTools
  /**
   * FE-08: past 1.5 s with no token, "thinking" becomes a skeleton. Once shown,
   * the body keeps the skeleton's height (`CHAT_TURN_RESERVE`), so the first
   * tokens fill the reserved box instead of shrinking it.
   */
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!waiting || slow) return
    const timer = setTimeout(() => setSlow(true), SLOW_REPLY_MS)
    return () => clearTimeout(timer)
  }, [waiting, slow])

  return (
    <>
      {/* One container for the whole life of the reply: thinking → (skeleton) → first token → full text. */}
      <div className={slow ? CHAT_TURN_RESERVE : 'min-h-6'} data-testid="assistant-body">
        {waiting ? (
          slow ? <SkeletonCard variant="chat-turn" /> : <ThinkingIndicator />
        ) : text === '' && !hasTools ? (
          <p className="text-slate-600">No reply text.</p>
        ) : (
          // Text and tool cards in the order they streamed. A stopped or failed reply keeps the tolerant parsing.
          message.parts.map((part, index) =>
            part.type === 'tool' ? (
              <ToolInvocationCard
                key={part.toolCallId}
                part={part}
                live={pending}
                onDecision={(decision) => tools.onDecision(message.id, part.toolCallId, decision)}
                onRetry={tools.onToolRetry}
                retryDisabled={tools.busy}
              />
            ) : part.text === '' ? null : (
              <StreamingMarkdown key={`text-${index}`} text={part.text} streaming={message.outcome !== 'complete'} />
            ),
          )
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

function MessageItem({ message, tools }: { readonly message: ChatMessage; readonly tools: ToolHandlers }) {
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
          <AssistantMessage message={message} tools={tools} />
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
  readonly onPick: (prompt: StarterPrompt) => void
  /** `wrap` in the empty state; `strip` is one row that scrolls sideways inside itself. */
  readonly layout: 'wrap' | 'strip'
  /** Accessible name of the list. */
  readonly label?: string
}

function StarterChips({ prompts, disabled, onPick, layout, label = 'Starter prompts' }: StarterChipsProps) {
  if (prompts.length === 0) return null
  return (
    <ul
      aria-label={label}
      className={layout === 'wrap' ? 'flex flex-wrap gap-2' : 'flex gap-2 overflow-x-auto pb-1 whitespace-nowrap'}
    >
      {prompts.map((starter) => (
        <li key={starter.id} className="shrink-0">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(starter)}
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

/**
 * FE-08 first-run state: onboarding, not apology. It says what the copilot
 * checks, then offers four prompts that run in one click.
 */
function OnboardingCard({
  prompts,
  toolPrompts,
  disabled,
  onPick,
}: Omit<StarterChipsProps, 'layout' | 'label'> & { readonly toolPrompts: readonly StarterPrompt[] }) {
  return (
    <div className="mx-auto max-w-xl py-2" data-testid="copilot-onboarding">
      <h3 className="text-base font-semibold text-ink">What this copilot checks</h3>
      <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
        <li>
          <span className="font-semibold text-ink">Centavo ledger math.</span> Amounts are integer centavos (
          <code className="font-mono">₱1.00 = 100</code>) and every journal entry must hold{' '}
          <code className="font-mono">Σ debits === Σ credits</code>.
        </li>
        <li>
          <span className="font-semibold text-ink">The 10 loan states.</span> Whether a move like{' '}
          <code className="font-mono">APPROVED → DISBURSED</code> is legal, and what{' '}
          <code className="font-mono">Idempotency-Key</code> and <code className="font-mono">If-Match</code> do on a
          double-click.
        </li>
        <li>
          <span className="font-semibold text-ink">GCash / Maya alternative data.</span> How utility bills, supplier
          invoices and load cadence add up to a 0–1000 trust score.
        </li>
      </ul>
      <p className="mt-4 text-sm font-semibold text-ink">Run one now:</p>
      <div className="mt-2">
        <StarterChips prompts={prompts} disabled={disabled} onPick={onPick} layout="wrap" />
      </div>
      {toolPrompts.length > 0 && (
        <>
          <p className="mt-4 text-sm font-semibold text-ink">Or call a tool and watch its card move through its 4 states:</p>
          <div className="mt-2">
            <StarterChips prompts={toolPrompts} disabled={disabled} onPick={onPick} layout="wrap" label="Tool demos" />
          </div>
        </>
      )}
    </div>
  )
}

const FAILURE_TITLE: Readonly<Record<ChatFailureKind, string>> = {
  offline: 'No connection. Nothing was sent.',
  'rate-limit': 'Rate limit reached (HTTP 429).',
  malformed: 'A reply frame was not valid JSON.',
  'mid-stream': 'The reply stopped part-way.',
  closed: 'The connection closed before the reply finished.',
  empty: 'The copilot returned an empty reply.',
  server: 'The copilot could not produce a reply.',
  http: 'The request failed.',
}

/** Seconds left of `Retry-After`, counted from when the banner appeared. 0 when there is none. */
function useCountdown(seconds: number | null): number {
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(startedAt)
  const remaining = seconds === null ? 0 : Math.max(0, seconds - Math.floor((now - startedAt) / 1000))
  const finished = remaining === 0
  useEffect(() => {
    if (finished) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [finished])
  return remaining
}

interface FailureBannerProps {
  readonly failure: ChatFailure
  /** The text of the user turn Retry will send again. */
  readonly prompt: string
  readonly onRetry: () => void
}

/**
 * FE-08 inline failure card. It says what broke, keeps a code to quote, and
 * offers one Retry that names the prompt it will re-send. Retry is locked while
 * it runs (`disabled` + `aria-busy`) and, after a 429, until `Retry-After` ends.
 * It enters with the same 150 ms fade/rise as a message (off under reduced motion).
 */
function FailureBanner({ failure, prompt, onRetry }: FailureBannerProps) {
  const remaining = useCountdown(failure.kind === 'rate-limit' ? failure.retryAfterSeconds : null)
  const countdownId = `copilot-retry-after-${failure.assistantId}`
  const label = `Retry failed prompt: “${shortPrompt(prompt)}”`
  return (
    <div
      role="alert"
      data-testid="failure-banner"
      data-kind={failure.kind}
      className={`mt-4 rounded-md border border-l-4 border-slate-300 border-l-rose-600 bg-white px-3 py-3 text-sm text-ink ${ENTER_MOTION}`}
    >
      <p className="font-semibold">
        <span aria-hidden="true">⚠ </span>
        {FAILURE_TITLE[failure.kind]}
        {failure.partial && ' The partial answer above is kept.'}
      </p>
      <p className="mt-1 text-slate-700">{failure.message}</p>
      <p className="mt-1 font-mono text-xs text-slate-600">
        code <span data-testid="failure-code">{failureCode(failure)}</span>
      </p>
      {remaining > 0 && (
        <p id={countdownId} className="mt-1 font-mono text-xs text-slate-700">
          Retry-After: {remaining} s
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        disabled={failure.retrying || remaining > 0}
        aria-busy={failure.retrying ? 'true' : 'false'}
        aria-describedby={remaining > 0 ? countdownId : undefined}
        title={prompt}
        className={`mt-3 inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border border-main bg-main px-3 text-left text-sm font-semibold text-white transition-colors duration-150 ease-out hover:bg-slate-700 disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-600 motion-reduce:transition-none ${FOCUS_RING}`}
      >
        {failure.retrying ? (
          <>
            <span aria-hidden="true" className="inline-flex items-center gap-1">
              <span className="copilot-dot" />
              <span className="copilot-dot" />
              <span className="copilot-dot" />
            </span>
            Retrying “{shortPrompt(prompt)}”…
          </>
        ) : (
          <span className="wrap-anywhere">{label}</span>
        )}
      </button>
    </div>
  )
}

type DrillChoice = SabotageMode | 'off'

interface SabotageToolbarProps {
  readonly armed: DrillChoice
  readonly onArm: (choice: DrillChoice) => void
  readonly disabled: boolean
  readonly onCrash: () => void
  /** FE-07: sends a tool call whose input fails its schema, in one click. Absent when no tool-error chip is configured. */
  readonly onToolError?: () => void
}

/**
 * FE-08 drill toolbar: arm one failure for the next Send, without DevTools.
 * One shot: it disarms itself when the request goes out, so Retry is clean.
 */
function SabotageToolbar({ armed, onArm, disabled, onCrash, onToolError }: SabotageToolbarProps) {
  return (
    <details className="border-b border-slate-200 bg-canvas px-3 sm:px-4" data-testid="sabotage-toolbar">
      <summary className={`flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-ink ${FOCUS_RING}`}>
        Sabotage &amp; Resilience Drill Toolbar
        <span className="font-mono text-xs font-normal text-slate-600">{armed === 'off' ? 'off' : `armed: ${armed}`}</span>
      </summary>
      <fieldset className="pb-3">
        <legend className="text-xs font-semibold text-ink">Break the next request</legend>
        <p id={DRILL_HINT_ID} className="mt-1 text-xs text-slate-600">
          Applies to the next Send only, then turns off. Retry always goes out clean. Drills answer from the local
          engine, never a paid model.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['off', ...SABOTAGE_MODES] as const).map((choice) => {
            const radioId = `copilot-drill-${choice}`
            return (
              <div key={choice} className="flex items-center">
                <input
                  id={radioId}
                  type="radio"
                  name="copilot-drill"
                  value={choice}
                  checked={armed === choice}
                  disabled={disabled}
                  onChange={() => onArm(choice)}
                  aria-invalid="false"
                  aria-describedby={DRILL_HINT_ID}
                  className="peer sr-only"
                />
                <label
                  htmlFor={radioId}
                  className="flex min-h-9 cursor-pointer items-center rounded border border-slate-300 bg-white px-2 font-mono text-xs text-ink peer-checked:border-amber-600 peer-checked:bg-amber-50 peer-checked:font-semibold peer-disabled:cursor-not-allowed peer-disabled:text-slate-500 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                >
                  {choice === 'off' ? 'off (normal)' : choice}
                </label>
              </div>
            )
          })}
        </div>
        {onToolError !== undefined && (
          <button
            type="button"
            onClick={onToolError}
            disabled={disabled}
            className={`mt-3 mr-2 min-h-11 rounded-md border border-amber-600 bg-white px-3 text-sm font-semibold text-ink hover:bg-amber-50 disabled:text-slate-500 ${FOCUS_RING}`}
          >
            Trigger Tool Execution Error (<code className="font-mono">output-error</code>)
          </button>
        )}
        <button
          type="button"
          onClick={onCrash}
          className={`mt-3 min-h-11 rounded-md border border-amber-600 bg-white px-3 text-sm font-semibold text-ink hover:bg-amber-50 ${FOCUS_RING}`}
        >
          Throw a render error (tests <code className="font-mono">underwriting/error.tsx</code>)
        </button>
      </fieldset>
    </details>
  )
}

/** Throws during render, so the nearest route `error.tsx` catches it. Mounted only by the drill button. */
function RenderErrorDrill(): never {
  throw new Error('Sabotage drill: render error thrown inside the AI Copilot.')
}

/** An empty assistant bubble: it shows "thinking" until its first token (Tip 3). */
function newPendingReply(createdAt: string): ChatMessage {
  return { id: crypto.randomUUID(), role: 'assistant', parts: [{ type: 'text', text: '' }], createdAt, outcome: 'pending' }
}

interface ChatSessionProps extends StreamingUnderwritingChatProps {
  readonly initialMessages: readonly ChatMessage[]
  /**
   * False for the placeholder session rendered on the server and during
   * hydration. It starts empty because it cannot see localStorage, so it must
   * not save: saving its empty list would delete the stored conversation
   * before the browser session loads it.
   */
  readonly persist: boolean
}

function ChatSession({
  starterPrompts,
  toolPrompts = [],
  engine,
  transport = fetchChatTransport,
  initialMessages,
  persist,
}: ChatSessionProps) {
  const [state, dispatch] = useReducer(chatReducer, initialMessages, createInitialState)
  const [draft, setDraft] = useState('')
  /** Tip 1: drives the "Jump to latest" pill. Set from scroll events only. */
  const [isAtBottom, setIsAtBottom] = useState(true)
  /** Tip 1: the log's geometry after the previous commit, and a one-shot "follow no matter what". */
  const lastGeometryRef = useRef({ scrollHeight: 0, clientHeight: 0 })
  const forceFollowRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /**
   * Tip 2: the controller of the request in flight, or null. One per request, never reused.
   * FE-08: it is also the in-flight lock. It is set before the first `await`, so a
   * second click in the same frame (before `disabled` renders) sees it and does nothing.
   */
  const abortRef = useRef<AbortController | null>(null)
  /** FE-08: the drill armed for the next Send. One shot. */
  const [drill, setDrill] = useState<DrillChoice>('off')
  /** FE-08: the "Throw a render error" drill. */
  const [crash, setCrash] = useState(false)
  /** FE-08: Send pressed with nothing but whitespace. */
  const [emptyError, setEmptyError] = useState(false)

  const busy = isBusy(state.status)
  const tooLong = draft.length > CHAT_LIMITS.maxUserChars
  const canSend = !busy && !tooLong && draft.trim() !== ''
  const hasMessages = state.messages.length > 0
  const inputError = tooLong || emptyError
  const failedPrompt = useMemo(() => {
    const failure = state.failure
    const user = failure === null ? undefined : state.messages.find((message) => message.id === failure.userId)
    return user === undefined ? null : messageText(user)
  }, [state.failure, state.messages])

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
    if (persist && !busy) saveConversation(state.messages)
  }, [persist, busy, state.messages])

  /** Leaving the page cancels the request in flight. */
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  // ── Tip 2: send / stop ────────────────────────────────────────────────────

  /**
   * Runs one request for the assistant bubble `assistantId`. Shared by Send and
   * Retry. Every failure is dispatched with a kind, so the banner can name it.
   */
  const runRequest = useCallback(
    (
      assistantId: string,
      history: ReturnType<typeof toWireHistory>,
      sabotage: SabotageMode | null,
      toolCall: DirectToolCall | null = null,
    ): void => {
      // Failure before send: no connection, or the network-drop drill. Nothing goes out.
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      if (offline || sabotage === 'network-drop') {
        dispatch({
          type: 'FAIL',
          id: assistantId,
          kind: 'offline',
          message:
            sabotage === 'network-drop'
              ? 'Sabotage drill (network-drop): the request failed before it left the browser. Your question is kept.'
              : 'The browser reports no network connection. Your question is kept; retry when you are back online.',
        })
        return
      }

      const controller = new AbortController()
      abortRef.current = controller
      const release = (): void => {
        if (abortRef.current === controller) abortRef.current = null
      }

      let settled = false
      const onEvent = (event: ChatStreamEvent): void => {
        // Every action carries this run's assistant ID. After Stop, the reducer
        // no longer has it as `activeId`, so late events from this run are dropped.
        switch (event.type) {
          case 'meta':
            dispatch({ type: 'META', id: assistantId, engine: event.engine })
            break
          case 'token':
            dispatch({ type: 'TOKEN', id: assistantId, text: event.text })
            break
          case 'done':
            settled = true
            release()
            dispatch({ type: 'DONE', id: assistantId, finishReason: event.finishReason })
            break
          case 'error':
            settled = true
            release()
            dispatch({ type: 'FAIL', id: assistantId, message: event.message })
            break
          default:
            // FE-07 tool lifecycle frames. `at` is taken here so the reducer stays pure.
            dispatch({ type: 'TOOL', id: assistantId, event, at: Date.now() })
            break
        }
      }

      transport({
        messages: history,
        signal: controller.signal,
        onEvent,
        ...(sabotage === null ? {} : { sabotage }),
        ...(toolCall === null ? {} : { toolCall }),
      }).then(
        () => {
          release()
          if (!settled && !controller.signal.aborted) {
            dispatch({
              type: 'FAIL',
              id: assistantId,
              kind: 'closed',
              message: 'The connection closed before the reply finished.',
            })
          }
        },
        (error: unknown) => {
          release()
          // An abort is the user pressing Stop: already handled, not an error.
          if (controller.signal.aborted) return
          if (error instanceof ChatRequestError) {
            dispatch({
              type: 'FAIL',
              id: assistantId,
              message: error.message,
              kind: error.kind,
              status: error.status,
              retryAfterSeconds: error.retryAfterSeconds,
            })
            return
          }
          const message = error instanceof Error && error.message !== '' ? error.message : 'The copilot request failed.'
          dispatch({ type: 'FAIL', id: assistantId, kind: 'http', message })
        },
      )
    },
    [transport],
  )

  const send = useCallback(
    (raw: string, options: { readonly drill?: SabotageMode; readonly toolCall?: DirectToolCall } = {}): void => {
      const text = raw.trim()
      if (text === '') {
        // FE-08 edge case: whitespace only is never sent, and the field says why.
        setEmptyError(true)
        inputRef.current?.focus()
        return
      }
      // `abortRef` is the synchronous lock: a second Enter in the same frame stops here.
      if (busy || abortRef.current !== null || text.length > CHAT_LIMITS.maxUserChars) return

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
      const assistant = newPendingReply(createdAt)
      const history = toWireHistory([...state.messages, user])
      // A chip that is itself a drill wins; otherwise the armed drill (one shot) applies.
      const sabotage = options.drill ?? (drill === 'off' ? null : drill)

      // Sending is an explicit "take me to the latest", even if the user had scrolled up.
      forceFollowRef.current = true
      setIsAtBottom(true)
      setDraft('')
      setEmptyError(false)
      setDrill('off')
      dispatch({ type: 'SUBMIT', user, assistant })
      // The question survives a reload even if the tab closes mid-reply.
      saveConversation([...state.messages, user])
      runRequest(assistant.id, history, sabotage, options.toolCall ?? null)
    },
    [busy, state.messages, drill, runRequest],
  )

  /** A chip: its prompt, and its drill if it carries one. */
  const pick = (starter: StarterPrompt): void => send(starter.prompt, starter.drill === undefined ? {} : { drill: starter.drill })

  /** FE-07 tool handlers for the cards. */
  const toolHandlers: ToolHandlers = {
    busy,
    onDecision: (messageId, toolCallId, decision) => dispatch({ type: 'TOOL_DECISION', messageId, toolCallId, decision }),
    // "Retry Tool Call with Sanitized Inputs": a new turn that runs exactly that tool with the fixed input.
    onToolRetry: (toolName, input, changes) =>
      send(`Retry ${toolName} with sanitized inputs (${changes}).`, { toolCall: { toolName, input } }),
  }
  const toolErrorChip = toolPrompts.find((prompt) => prompt.drill === 'tool-error')

  /**
   * FE-08 "Retry with a brain": re-sends only the failed turn's prompt, writes
   * the new reply into the failed reply's slot, and never runs twice. The
   * `abortRef` lock is set inside `runRequest` before any await, so a double
   * click in one frame sends one request.
   */
  const retry = (): void => {
    const failure = state.failure
    if (failure === null || failure.retrying || abortRef.current !== null) return
    const index = state.messages.findIndex((message) => message.id === failure.userId)
    if (index === -1) return
    const assistant = newPendingReply(new Date().toISOString())
    forceFollowRef.current = true
    setIsAtBottom(true)
    dispatch({ type: 'RETRY', assistant })
    runRequest(assistant.id, toWireHistory(state.messages.slice(0, index + 1)), null)
  }

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
    setEmptyError(false)
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

      <SabotageToolbar
        armed={drill}
        onArm={setDrill}
        disabled={busy}
        onCrash={() => setCrash(true)}
        {...(toolErrorChip === undefined ? {} : { onToolError: () => pick(toolErrorChip) })}
      />
      {crash && <RenderErrorDrill />}

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
          // FE-08: `overscroll-contain` stops iOS rubber-banding the page while the log scrolls under the auto-scroll pin.
          className={`h-full overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-4 sm:px-4 ${FOCUS_RING}`}
        >
          {hasMessages ? (
            <ol className="space-y-4">
              {state.messages.map((message) => (
                <MessageItem key={message.id} message={message} tools={toolHandlers} />
              ))}
            </ol>
          ) : (
            <OnboardingCard prompts={starterPrompts} toolPrompts={toolPrompts} disabled={busy} onPick={pick} />
          )}
          {state.failure !== null && failedPrompt !== null && (
            <FailureBanner
              key={`${state.failure.assistantId}-${state.failure.retrying ? 'retrying' : 'failed'}`}
              failure={state.failure}
              prompt={failedPrompt}
              onRetry={retry}
            />
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
        // FE-08: the bottom inset keeps the input clear of the iPhone home indicator when the page runs edge to edge.
        className="border-t border-slate-200 bg-canvas px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4"
        noValidate
      >
        {hasMessages && (
          <div className="mb-2">
            <StarterChips prompts={[...starterPrompts, ...toolPrompts]} disabled={busy} onPick={pick} layout="strip" />
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
            onChange={(event) => {
              setDraft(event.target.value)
              setEmptyError(false)
            }}
            onKeyDown={handleKeyDown}
            aria-invalid={inputError ? 'true' : 'false'}
            aria-describedby={inputError ? `${HINT_ID} ${ERROR_ID}` : HINT_ID}
            placeholder="e.g. Can a REJECTED loan be DISBURSED?"
            className={`min-h-11 min-w-0 flex-1 resize-none rounded-md border bg-white px-3 py-2 text-base text-ink placeholder:text-slate-500 sm:text-sm ${
              inputError ? 'border-rose-600' : 'border-slate-500'
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
        {inputError && (
          <p id={ERROR_ID} role="alert" className="mt-1 text-xs font-semibold text-rose-800">
            {tooLong
              ? `${draft.length} of ${CHAT_LIMITS.maxUserChars} characters. Shorten the message to send it.`
              : 'Type a question first. Spaces and line breaks alone are not sent.'}
          </p>
        )}
      </form>
    </section>
  )
}
