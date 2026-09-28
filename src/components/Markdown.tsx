import { Fragment } from 'react'
import type { ReactNode } from 'react'

interface MarkdownProps {
  source: string
  className?: string
}

const safeHref = (value: string): string | undefined => {
  const href = value.trim()
  if (/^(?:https?:|mailto:|tel:|\/|\.\.?\/|#)/i.test(href)) return href
  return undefined
}

const trimUrlPunctuation = (value: string): { url: string; suffix: string } => {
  const match = value.match(/([.,;:!?]+)$/)
  return match ? { url: value.slice(0, -match[1].length), suffix: match[1] } : { url: value, suffix: '' }
}

const splitTableRow = (line: string): string[] => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
const isTableDivider = (line: string): boolean => splitTableRow(line).length > 0 && splitTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell))

const inline = (source: string, keyPrefix = 'inline'): ReactNode[] => {
  const nodes: ReactNode[] = []
  let remaining = source
  let index = 0
  const tokenPattern = /(`+[^`\n]+`+|\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|https?:\/\/[^\s<]+)/

  while (remaining) {
    const match = remaining.match(tokenPattern)
    if (!match || match.index === undefined) {
      nodes.push(remaining)
      break
    }
    if (match.index > 0) nodes.push(remaining.slice(0, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${index++}`

    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.replace(/^`+|`+$/g, '')}</code>)
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)$/)
      const href = link ? safeHref(link[2]) : undefined
      nodes.push(href ? <a key={key} href={href} target={/^https?:/i.test(href) ? '_blank' : undefined} rel={/^https?:/i.test(href) ? 'noreferrer' : undefined}>{inline(link![1], key)}</a> : token)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>)
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{inline(token.slice(2, -2), key)}</del>)
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>)
    } else {
      const { url, suffix } = trimUrlPunctuation(token)
      const href = safeHref(url)
      nodes.push(href ? <Fragment key={key}><a href={href} target="_blank" rel="noreferrer">{url}</a>{suffix}</Fragment> : token)
    }
    remaining = remaining.slice(token.length + (match.index ?? 0))
  }
  return nodes
}

const inlineWithBreaks = (source: string, keyPrefix: string): ReactNode[] => source.split('\n').flatMap((line, index, lines) => [
  <Fragment key={`${keyPrefix}-line-${index}`}>{inline(line, `${keyPrefix}-${index}`)}</Fragment>,
  ...(index < lines.length - 1 ? [<br key={`${keyPrefix}-break-${index}`} />] : []),
])

const renderBlocks = (source: string, keyPrefix = 'block'): ReactNode[] => {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let blockIndex = 0
  let index = 0
  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(<p key={`${keyPrefix}-p-${blockIndex}`}>{inlineWithBreaks(paragraph.join('\n'), `${keyPrefix}-p-${blockIndex}`)}</p>)
    blockIndex += 1
    paragraph = []
  }

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { flushParagraph(); index += 1; continue }

    const fence = line.match(/^\s{0,3}```\s*([\w+-]*)\s*$/)
    if (fence) {
      flushParagraph()
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s{0,3}```\s*$/.test(lines[index])) { code.push(lines[index]); index += 1 }
      if (index < lines.length) index += 1
      const language = fence[1] ? `language-${fence[1]}` : undefined
      blocks.push(<pre key={`${keyPrefix}-code-${index}`}><code className={language}>{code.join('\n')}</code></pre>)
      continue
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      flushParagraph()
      const Tag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[heading[1].length - 1]
      blocks.push(<Tag key={`${keyPrefix}-heading-${index}`}>{inline(heading[2], `${keyPrefix}-heading-${index}`)}</Tag>)
      index += 1
      continue
    }

    if (/^\s{0,3}(?:\*\s*){3,}$/.test(line) || /^\s{0,3}(?:-\s*){3,}$/.test(line) || /^\s{0,3}(?:_\s*){3,}$/.test(line)) {
      flushParagraph(); blocks.push(<hr key={`${keyPrefix}-rule-${index}`} />); index += 1; continue
    }

    if (/^\s{0,3}> ?/.test(line)) {
      flushParagraph()
      const quote: string[] = []
      while (index < lines.length && /^\s{0,3}> ?/.test(lines[index])) { quote.push(lines[index].replace(/^\s{0,3}> ?/, '')); index += 1 }
      blocks.push(<blockquote key={`${keyPrefix}-quote-${index}`}>{renderBlocks(quote.join('\n'), `${keyPrefix}-quote-${index}`)}</blockquote>)
      continue
    }

    const list = line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/)
    if (list) {
      flushParagraph()
      const ordered = /^\d/.test(list[1])
      const items: { text: string; checked?: boolean }[] = []
      while (index < lines.length) {
        const item = lines[index].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/)
        if (!item || (/^\d/.test(item[1]) !== ordered)) break
        const task = item[2].match(/^\[([ xX])\]\s+(.*)$/)
        items.push(task ? { text: task[2], checked: task[1].toLowerCase() === 'x' } : { text: item[2] })
        index += 1
      }
      const List = ordered ? 'ol' : 'ul'
      blocks.push(<List key={`${keyPrefix}-list-${index}`}>{items.map((item, itemIndex) => <li key={`${keyPrefix}-item-${itemIndex}`}>{item.checked !== undefined && <input type="checkbox" checked={item.checked} readOnly aria-label={item.checked ? 'Completed task' : 'Incomplete task'} />}<span>{inline(item.text, `${keyPrefix}-item-${itemIndex}`)}</span></li>)}</List>)
      continue
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      flushParagraph()
      const headers = splitTableRow(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(splitTableRow(lines[index])); index += 1 }
      blocks.push(<div className="markdown-table-wrap" key={`${keyPrefix}-table-${index}`}><table><thead><tr>{headers.map((cell, cellIndex) => <th key={`${keyPrefix}-th-${cellIndex}`}>{inline(cell, `${keyPrefix}-th-${cellIndex}`)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${keyPrefix}-tr-${rowIndex}`}>{headers.map((_, cellIndex) => <td key={`${keyPrefix}-td-${rowIndex}-${cellIndex}`}>{inline(row[cellIndex] ?? '', `${keyPrefix}-td-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody></table></div>)
      continue
    }

    paragraph.push(line)
    index += 1
  }
  flushParagraph()
  return blocks
}

export function Markdown({ source, className = '' }: MarkdownProps) {
  return <div className={['markdown-body', className].filter(Boolean).join(' ')}>{renderBlocks(source)}</div>
}

export type { MarkdownProps }
