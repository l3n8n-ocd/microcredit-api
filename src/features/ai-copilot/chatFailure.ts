/** FE-08: how a failed reply is named in the UI. Pure helpers, shared by the banner and its tests. */
import type { ChatFailure } from './chatReducer.ts'

/** A short, stable code for the banner and for bug reports. */
export function failureCode(failure: Pick<ChatFailure, 'kind' | 'status'>): string {
  switch (failure.kind) {
    case 'offline':
      return 'ERR_OFFLINE'
    case 'rate-limit':
      return 'HTTP_429'
    case 'malformed':
      return 'ERR_MALFORMED_FRAME'
    case 'mid-stream':
      return 'ERR_MID_STREAM'
    case 'closed':
      return 'ERR_STREAM_CLOSED'
    case 'empty':
      return 'ERR_EMPTY_REPLY'
    case 'server':
      return 'ERR_SERVER'
    case 'http':
      return failure.status === null ? 'ERR_REQUEST' : `HTTP_${failure.status}`
  }
}

/** The failed prompt as the Retry button names it: at most 48 characters, cut at a word boundary. */
export function shortPrompt(text: string, max = 48): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  // Cut at the last word boundary when there is one in the second half, so the label never ends mid-word.
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

