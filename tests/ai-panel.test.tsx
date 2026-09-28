// @vitest-environment jsdom
import { act } from 'react'
import type { ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiPanel } from '../src/components/AiPanel'
import { createInitialProject } from '../src/lib/model'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined
afterEach(() => { act(() => root?.unmount()); host?.remove() })

function setup() {
  const project = createInitialProject()
  const props: ComponentProps<typeof AiPanel> = {
    project, page: project.pages[0], selected: [], scope: 'selection', messages: [], busy: false,
    proposal: null, attachmentCount: 0, onScope: vi.fn(), onSend: vi.fn(), onApply: vi.fn(),
    onCancel: vi.fn(), onCancelRequest: vi.fn(), onCapture: vi.fn(), onAttach: vi.fn(), onClearAttachments: vi.fn(), onSettings: vi.fn(),
  }
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  const render = (updates: Partial<typeof props> = {}) => act(() => root!.render(<AiPanel {...props} {...updates} />))
  render()
  const input = host.querySelector('textarea')!
  const type = (text: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return { props, render, input, type }
}

describe('chat panel continuity', () => {
  it('retains a draft and prompt disclosure, restoring focus after parameters', () => {
    const { props, render, input, type } = setup()
    type('Please preserve **this draft**')
    const details = [...host!.querySelectorAll('button')].find((button) => button.textContent === 'Prompt details')!
    const settings = host!.querySelector<HTMLButtonElement>('[aria-label="AI settings"]')!
    act(() => { details.click(); settings.click() })
    expect(props.onSettings).toHaveBeenCalledOnce()
    render({ active: false })
    expect(host!.querySelector('.ai-panel')!.hasAttribute('hidden')).toBe(true)
    render({ active: true })
    expect(input.value).toBe('Please preserve **this draft**')
    expect(host!.querySelector('.prompt-preview')).not.toBeNull()
    expect(document.activeElement).toBe(settings)
  })

  it('does not clear or submit the next draft while a request is running', () => {
    const { props, render, input, type } = setup()
    type('Next request')
    render({ busy: true })
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
    expect(props.onSend).not.toHaveBeenCalled()
    expect(input.value).toBe('Next request')
    const stop = host!.querySelector<HTMLButtonElement>('[aria-label="Stop generating"]')!
    act(() => stop.click())
    expect(props.onCancelRequest).toHaveBeenCalledOnce()
  })

  it('keeps scroll position while reading instead of snapping to streamed updates', () => {
    const { render } = setup()
    const messages = host!.querySelector<HTMLElement>('.ai-messages')!
    Object.defineProperty(messages, 'clientHeight', { value: 300 })
    Object.defineProperty(messages, 'scrollHeight', { value: 1000 })
    act(() => { messages.scrollTop = 80; messages.dispatchEvent(new Event('scroll')) })
    render({ messages: [{ id: 'delta', role: 'assistant', text: 'New words arriving', status: 'working' }] })
    expect(messages.scrollTop).toBe(80)
    const latest = host!.querySelector<HTMLButtonElement>('.ai-jump-latest')!
    act(() => latest.click())
    expect(messages.scrollTop).toBe(1000)
  })
})
