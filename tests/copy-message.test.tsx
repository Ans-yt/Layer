// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopyMessageButton } from '../src/components/CopyMessageButton'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})
function render(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined })
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root.render(<CopyMessageButton text="**Original Markdown**" />))
  return host.querySelector('button')!
}

describe('message copying', () => {
  it('copies the original Markdown and confirms only after clipboard success', async () => {
    let resolve!: () => void
    const writeText = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    const button = render(writeText)
    act(() => button.click())
    expect(button.disabled).toBe(true)
    expect(host.textContent).not.toContain('Message copied.')
    await act(async () => resolve())
    expect(writeText).toHaveBeenCalledExactlyOnceWith('**Original Markdown**')
    expect(button.textContent).toBe('Copied')
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Message copied.')
  })
  it('shows a recovery message if clipboard permission is denied', async () => {
    const button = render(vi.fn().mockRejectedValue(new Error('denied')))
    await act(async () => button.click())
    expect(host.querySelector('[role="status"]')?.textContent).toContain('copy it manually')
    expect(button.disabled).toBe(false)
  })
  it('does not fabricate success if clipboard support is missing', async () => {
    const button = render()
    await act(async () => button.click())
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Copy unavailable')
  })
  it('ignores a pending result when the message changes', async () => {
    let resolve!: () => void
    const button = render(() => new Promise<void>((done) => { resolve = done }))
    act(() => button.click())
    act(() => root.render(<CopyMessageButton text="A different message" />))
    await act(async () => resolve())
    expect(button.textContent).toBe('Copy')
    expect(host.querySelector('[role="status"]')?.textContent).toBe('')
  })
})
