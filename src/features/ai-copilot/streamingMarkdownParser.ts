/**
 * Streaming-safe Markdown parser (Mentor Tip 4). Pure: text in, a block tree out.
 *
 * A model streams Markdown in pieces, so at any instant the text may end in the
 * middle of a construct: an opened code fence with no closing fence, `**bol`
 * with no closing `**`, or the first backtick of what will become a fence. A
 * normal Markdown renderer shows those as raw symbols for a few frames and then
 * re-flows the whole message when the closing marker lands. That is the flicker.
 *
 * This parser treats "not closed yet" as a normal state:
 *   - an unclosed fence IS a code block (`open: true`), from its first line;
 *   - while streaming, an unclosed `**` or backtick is rendered as bold / code
 *     up to the end of the text, so the style is already right when it closes;
 *   - a trailing fragment that can only be the start of a marker (a lone `*`,
 *     one or two backticks, `#`, `-`) is held back until the next token decides it.
 *
 * Supported subset: paragraphs, `#` headings, `-` / `1.` lists, fenced code,
 * `**bold**`, and inline code. Everything else is shown as plain text. The
 * output is data, never HTML, so nothing a model emits can inject markup.
 */

export type InlineLeaf =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'code'; readonly text: string }

export type Inline = InlineLeaf | { readonly type: 'bold'; readonly children: readonly InlineLeaf[] }

export type Block =
  | { readonly type: 'paragraph'; readonly inline: readonly Inline[] }
  | { readonly type: 'heading'; readonly level: number; readonly inline: readonly Inline[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly (readonly Inline[])[] }
  | { readonly type: 'code'; readonly lang: string; readonly code: string; readonly open: boolean }
  | { readonly type: 'table'; readonly header: readonly (readonly Inline[])[]; readonly rows: readonly (readonly (readonly Inline[])[])[] }

const FENCE_OPEN = /^\s*```\s*([\w+-]*)\s*$/
const FENCE_CLOSE = /^\s*```\s*$/
const HEADING = /^(#{1,4})\s+(.*)$/
const LIST_ITEM = /^\s*([-*]|\d+\.)\s+(.*)$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_RULE = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/

/** GFM cells: split on `|` that is not escaped as `\|`, then unescape. */
function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll('\\|', '|'))
}
/** A last line that so far is only the beginning of a block marker. */
const PARTIAL_BLOCK_MARKER = /^\s*(`{1,2}|#{1,4}|[-*]|\d+\.?)$/
const PARTIAL_FENCE_CLOSE = /^\s*`{1,2}$/

function parseLeaves(text: string, open: boolean): InlineLeaf[] {
  const leaves: InlineLeaf[] = []
  let plain = ''
  let index = 0
  const flush = (): void => {
    if (plain !== '') leaves.push({ type: 'text', text: plain })
    plain = ''
  }
  while (index < text.length) {
    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1)
      if (end === -1 && !open) {
        // Finished text with a stray backtick: it is a literal character.
        plain += '`'
        index += 1
        continue
      }
      flush()
      const inner = end === -1 ? text.slice(index + 1) : text.slice(index + 1, end)
      if (inner !== '') leaves.push({ type: 'code', text: inner })
      index = end === -1 ? text.length : end + 1
      continue
    }
    plain += text[index] ?? ''
    index += 1
  }
  flush()
  return leaves
}

/**
 * `open` is true only for the text that is still being written. There, an
 * unclosed marker extends to the end; in finished text it is a literal.
 */
export function parseInline(text: string, open: boolean): Inline[] {
  // Hold back a lone trailing `*`: it is almost always the first half of `**`.
  const source = open && /(^|[^*])\*$/.test(text) ? text.slice(0, -1) : text
  const nodes: Inline[] = []
  let index = 0
  while (index < source.length) {
    const start = source.indexOf('**', index)
    const tick = source.indexOf('`', index)
    // Inline code wins when it starts first, so `a ** b` inside backticks stays code.
    if (tick !== -1 && (start === -1 || tick < start)) {
      const end = source.indexOf('`', tick + 1)
      const stop = end === -1 ? source.length : end + 1
      nodes.push(...parseLeaves(source.slice(index, stop), open))
      index = stop
      continue
    }
    if (start === -1) {
      nodes.push(...parseLeaves(source.slice(index), open))
      break
    }
    nodes.push(...parseLeaves(source.slice(index, start), false))
    const end = source.indexOf('**', start + 2)
    if (end === -1 && !open) {
      nodes.push({ type: 'text', text: source.slice(start) })
      break
    }
    const inner = end === -1 ? source.slice(start + 2) : source.slice(start + 2, end)
    if (inner !== '') nodes.push({ type: 'bold', children: parseLeaves(inner, open && end === -1) })
    index = end === -1 ? source.length : end + 2
  }
  return mergeAdjacentText(nodes)
}

/** Joins neighbouring text nodes, so one run of plain text is one React text node. */
function mergeAdjacentText(nodes: readonly Inline[]): Inline[] {
  const merged: Inline[] = []
  for (const node of nodes) {
    const previous = merged.at(-1)
    if (node.type === 'text' && previous?.type === 'text') {
      merged[merged.length - 1] = { type: 'text', text: previous.text + node.text }
    } else {
      merged.push(node)
    }
  }
  return merged
}

function isInsideOpenFence(lines: readonly string[]): boolean {
  let inside = false
  for (const line of lines) {
    if (inside ? FENCE_CLOSE.test(line) : FENCE_OPEN.test(line)) inside = !inside
  }
  return inside
}

export function parseStreamingMarkdown(source: string, streaming: boolean): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')

  // Hold back a trailing fragment that might become a marker ("``" → "```").
  if (streaming && lines.length > 0 && !isInsideOpenFence(lines.slice(0, -1))) {
    if (PARTIAL_BLOCK_MARKER.test(lines.at(-1) ?? '')) lines.pop()
  }

  const blocks: Block[] = []
  const lastLine = lines.length - 1
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    const fence = FENCE_OPEN.exec(line)
    if (fence !== null) {
      // The language tag is shown once its line is complete, so "t" never flashes before "ts".
      const lang = streaming && index === lastLine ? '' : (fence[1] ?? '')
      const body: string[] = []
      let closed = false
      index += 1
      while (index < lines.length) {
        const current = lines[index] ?? ''
        index += 1
        if (FENCE_CLOSE.test(current)) {
          closed = true
          break
        }
        body.push(current)
      }
      // The closing fence arrives one backtick at a time. Keep those out of the code.
      if (!closed && streaming && PARTIAL_FENCE_CLOSE.test(body.at(-1) ?? '')) body.pop()
      blocks.push({ type: 'code', lang, code: body.join('\n'), open: !closed })
      continue
    }

    if (line.trim() === '') {
      index += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      blocks.push({
        type: 'heading',
        level: (heading[1] ?? '#').length,
        inline: parseInline(heading[2] ?? '', streaming && index === lastLine),
      })
      index += 1
      continue
    }

    // A GFM table: a header row, then a |---| rule, then rows. Only once the rule has arrived.
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[index + 1] ?? '')) {
      const header = tableCells(line).map((cell) => parseInline(cell, false))
      const rows: Inline[][][] = []
      index += 2
      while (index < lines.length && TABLE_ROW.test(lines[index] ?? '')) {
        rows.push(tableCells(lines[index] ?? '').map((cell) => parseInline(cell, streaming && index === lastLine)))
        index += 1
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    const firstItem = LIST_ITEM.exec(line)
    if (firstItem !== null) {
      const ordered = /\d/.test(firstItem[1] ?? '')
      const items: Inline[][] = []
      while (index < lines.length) {
        const item = LIST_ITEM.exec(lines[index] ?? '')
        if (item === null || /\d/.test(item[1] ?? '') !== ordered) break
        items.push(parseInline(item[2] ?? '', streaming && index === lastLine))
        index += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const paragraph: string[] = []
    let touchesEnd = false
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (current.trim() === '' || FENCE_OPEN.test(current) || HEADING.test(current) || LIST_ITEM.test(current)) break
      paragraph.push(current.trim())
      touchesEnd = index === lastLine
      index += 1
    }
    blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join(' '), streaming && touchesEnd) })
  }

  return blocks
}
