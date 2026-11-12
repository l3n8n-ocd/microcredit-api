import { useMemo } from 'react'
import { parseStreamingMarkdown, type Block, type Inline, type InlineLeaf } from './streamingMarkdownParser.ts'

/**
 * Renders the block tree from `parseStreamingMarkdown` as React elements.
 *
 * Why this does not flicker: blocks are keyed by position, and a stream only
 * ever appends. Block 0 stays block 0, so React keeps its DOM node and patches
 * the text inside it. An unclosed fence is already a `<pre>` on its first line,
 * so when the closing fence lands nothing is re-mounted and nothing jumps.
 *
 * No `dangerouslySetInnerHTML`: model output becomes text nodes only.
 */

const INLINE_CODE = 'rounded bg-slate-200 px-1 py-0.5 font-mono text-[0.85em] text-ink'

function Leaf({ leaf }: { readonly leaf: InlineLeaf }) {
  return leaf.type === 'code' ? <code className={INLINE_CODE}>{leaf.text}</code> : leaf.text
}

function InlineNodes({ nodes }: { readonly nodes: readonly Inline[] }) {
  return nodes.map((node, index) =>
    node.type === 'bold' ? (
      <strong key={index} className="font-semibold">
        {node.children.map((child, childIndex) => (
          <Leaf key={childIndex} leaf={child} />
        ))}
      </strong>
    ) : (
      <Leaf key={index} leaf={node} />
    ),
  )
}

function BlockView({ block }: { readonly block: Block }) {
  switch (block.type) {
    case 'code':
      return (
        <div className="overflow-hidden rounded-md border border-main bg-main" data-code-open={block.open ? 'true' : 'false'}>
          {block.lang !== '' && (
            <div className="border-b border-slate-600 px-3 py-1 font-mono text-xs text-slate-300">{block.lang}</div>
          )}
          {/* The block scrolls sideways inside itself, so a long line never widens the page at 375px. */}
          <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-canvas" tabIndex={0}>
            <code>{block.code}</code>
          </pre>
        </div>
      )
    case 'heading': {
      // The page owns h1 and the panel owns h2, so Markdown headings start at h3.
      const Tag = block.level <= 2 ? 'h3' : 'h4'
      return (
        <Tag className="font-semibold text-ink">
          <InlineNodes nodes={block.inline} />
        </Tag>
      )
    }
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag className={`space-y-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineNodes nodes={item} />
            </li>
          ))}
        </Tag>
      )
    }
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-300">
                {block.header.map((cell, index) => (
                  <th key={index} scope="col" className="py-1 pr-4 font-semibold">
                    <InlineNodes nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-slate-200">
                  {row.map((cell, index) => (
                    <td key={index} className="py-1 pr-4 align-top">
                      <InlineNodes nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'paragraph':
      return (
        <p>
          <InlineNodes nodes={block.inline} />
        </p>
      )
  }
}

export interface StreamingMarkdownProps {
  readonly text: string
  /** True while tokens are still arriving. Turns on the "not closed yet" handling. */
  readonly streaming: boolean
}

export function StreamingMarkdown({ text, streaming }: StreamingMarkdownProps) {
  const blocks = useMemo(() => parseStreamingMarkdown(text, streaming), [text, streaming])
  return (
    <div className="space-y-3 wrap-anywhere">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  )
}
