// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CHAT_RATE_LIMIT, clientKey, createRateLimiter, describeWait } from '../rate-limit.ts'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/** A limiter on a clock the test moves by hand. */
function withClock(rules = CHAT_RATE_LIMIT, maxKeys?: number) {
  let time = 1_000_000
  const limiter = createRateLimiter(rules, { now: () => time, ...(maxKeys === undefined ? {} : { maxKeys }) })
  return {
    limiter,
    advance: (ms: number) => {
      time += ms
    },
  }
}

describe('createRateLimiter — sliding window', () => {
  it('allows 10 requests in a minute and rejects the 11th with the seconds left', () => {
    const { limiter, advance } = withClock()
    for (let request = 1; request <= 10; request += 1) {
      expect(limiter.check('203.0.113.7')).toEqual({ ok: true })
      advance(1_000)
    }
    // 10 s have passed since the first request, so its slot frees in 50 s.
    expect(limiter.check('203.0.113.7')).toEqual({ ok: false, retryAfterSeconds: 50 })
  })

  it('frees one slot at a time as the oldest request leaves the window', () => {
    const { limiter, advance } = withClock()
    for (let request = 1; request <= 10; request += 1) {
      limiter.check('a')
      advance(1_000)
    }
    advance(49_999) // 59.999 s after the first request
    expect(limiter.check('a').ok).toBe(false)
    advance(1) // exactly one minute: the first request is out of the window
    expect(limiter.check('a')).toEqual({ ok: true })
    // Only one slot opened. The next one opens a second later.
    expect(limiter.check('a')).toEqual({ ok: false, retryAfterSeconds: 1 })
  })

  it('cannot be doubled by a burst on each side of a clock-minute boundary', () => {
    const { limiter, advance } = withClock()
    advance(50_000)
    for (let request = 1; request <= 10; request += 1) limiter.check('a')
    advance(15_000) // a fixed-window counter would have reset here
    expect(limiter.check('a').ok).toBe(false)
  })

  it('does not count rejected requests, so hammering does not extend the wait', () => {
    const { limiter, advance } = withClock()
    for (let request = 1; request <= 10; request += 1) limiter.check('a')
    for (let attempt = 1; attempt <= 500; attempt += 1) expect(limiter.check('a').ok).toBe(false)
    advance(MINUTE)
    expect(limiter.check('a')).toEqual({ ok: true })
  })

  it('keeps clients independent', () => {
    const { limiter } = withClock()
    for (let request = 1; request <= 10; request += 1) limiter.check('a')
    expect(limiter.check('a').ok).toBe(false)
    expect(limiter.check('b')).toEqual({ ok: true })
  })

  it('enforces the daily cap of 100 even when every minute is under 10', () => {
    const { limiter, advance } = withClock()
    for (let request = 1; request <= 100; request += 1) {
      expect(limiter.check('a')).toEqual({ ok: true })
      advance(10 * MINUTE) // 6 an hour: never near the per-minute limit
    }
    const rejected = limiter.check('a')
    expect(rejected.ok).toBe(false)
    // 1000 minutes have passed, so the first request leaves the day window in 440 minutes.
    if (!rejected.ok) expect(rejected.retryAfterSeconds).toBe(440 * 60)

    advance(DAY)
    expect(limiter.check('a')).toEqual({ ok: true })
  })

  it('bounds memory: the least recently allowed client is evicted past maxKeys', () => {
    const { limiter } = withClock(CHAT_RATE_LIMIT, 3)
    for (const key of ['a', 'b', 'c', 'd', 'e']) limiter.check(key)
    expect(limiter.size()).toBe(3)
    limiter.reset()
    expect(limiter.size()).toBe(0)
  })
})

describe('clientKey', () => {
  it('prefers x-real-ip, then the first hop of x-forwarded-for, then a shared bucket', () => {
    expect(clientKey(new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.7')
    expect(clientKey(new Headers({ 'x-forwarded-for': ' 198.51.100.1 , 10.0.0.1' }))).toBe('198.51.100.1')
    expect(clientKey(new Headers())).toBe('unknown')
  })
})

describe('describeWait', () => {
  it('reads naturally at every scale', () => {
    expect(describeWait(1)).toBe('1 second')
    expect(describeWait(50)).toBe('50 seconds')
    expect(describeWait(600)).toBe('about 10 minutes')
    expect(describeWait(440 * 60)).toBe('about 8 hours')
  })
})
