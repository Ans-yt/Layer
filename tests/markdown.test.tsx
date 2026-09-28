// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown } from '../src/components/Markdown'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

async function renderMarkdown(source: string) {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root?.render(<Markdown source={source} />))
  return host
}

describe('Markdown chat rendering', () => {
  it('renders common formatting without injecting HTML', async () => {
    const rendered = await renderMarkdown('# Notes\n\n**Bold** and `code` with [docs](https://example.com).\n\n- one\n- two')
    expect(rendered.querySelector('h1')?.textContent).toBe('Notes')
    expect(rendered.querySelector('strong')?.textContent).toBe('Bold')
    expect(rendered.querySelector('code')?.textContent).toBe('code')
    expect(rendered.querySelectorAll('li')).toHaveLength(2)
    expect(rendered.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    expect(rendered.querySelector('script')).toBeNull()
  })

  it('supports fenced code, task lists, tables, and safe-link fallback', async () => {
    const rendered = await renderMarkdown('```ts\nconst answer = 42\n```\n\n- [x] Done\n\n| Name | Value |\n| --- | --- |\n| Layer | 42 |\n\n[unsafe](javascript:alert(1))')
    expect(rendered.querySelector('pre code')?.textContent).toContain('const answer = 42')
    expect(rendered.querySelector('input[type="checkbox"]')).toBeTruthy()
    expect(rendered.querySelectorAll('table tr')).toHaveLength(2)
    expect(rendered.querySelector('a')).toBeNull()
    expect(rendered.textContent).toContain('[unsafe](javascript:alert(1))')
  })
})
