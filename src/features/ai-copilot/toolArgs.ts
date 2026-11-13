/** FE-07: reading tool arguments while their JSON is still streaming in. Pure, so it is tested on its own. */

/**
 * Reads arguments out of input JSON that is still arriving. A value followed
 * by `,` or `}` is complete; the trailing one is still being written.
 */
export function partialArguments(text: string): { readonly done: ReadonlyMap<string, unknown>; readonly writing: { key: string; raw: string } | null } {
  const done = new Map<string, unknown>()
  for (const match of text.matchAll(/"(\w+)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)\s*[,}]/g)) {
    const [, key, raw] = match
    if (key === undefined || raw === undefined) continue
    try {
      done.set(key, JSON.parse(raw))
    } catch {
      // A half-escaped string: leave it for the next delta.
    }
  }
  const tail = /"(\w+)"\s*:\s*("?(?:[^"\\,}]|\\.)*)$/.exec(text)
  const writing = tail?.[1] !== undefined && !done.has(tail[1]) ? { key: tail[1], raw: (tail[2] ?? '').replace(/^"/, '') } : null
  return { done, writing }
}
