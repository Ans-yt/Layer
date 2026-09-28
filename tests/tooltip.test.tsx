// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { placeTooltip, TooltipLayer } from '../src/components/TooltipLayer'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.useRealTimers() })

function render() {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root!.render(<div className="layer-app"><button aria-describedby="existing" data-tooltip="AI parameters" data-tooltip-shortcut="Ctrl Enter">Settings</button><TooltipLayer /></div>))
  return host.querySelector('button')!
}

describe('editor tooltips', () => {
  it('delays hover hints, portals outside panels, and preserves ARIA descriptions', async () => {
    vi.useFakeTimers()
    const button = render()
    act(() => button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    act(() => vi.advanceTimersByTime(350))
    const tip = document.querySelector('[role="tooltip"]')!
    expect(tip.parentElement).toBe(document.body)
    expect(tip.textContent).toBe('AI parametersCtrl Enter')
    expect(button.getAttribute('aria-describedby')).toContain(tip.id)
    expect(button.hasAttribute('title')).toBe(false)
    act(() => button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(button.getAttribute('aria-describedby')).toBe('existing')
  })

  it('opens on keyboard focus and Escape dismisses without affecting the canvas', () => {
    const button = render()
    const canvasEscape = vi.fn()
    host!.addEventListener('keydown', canvasEscape)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      button.focus()
    })
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
    act(() => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(canvasEscape).not.toHaveBeenCalled()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('cleans up a tooltip when a panel becomes hidden', async () => {
    vi.useFakeTimers()
    const button = render()
    act(() => { button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })); vi.advanceTimersByTime(350) })
    await act(async () => { button.parentElement!.hidden = true; await Promise.resolve() })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(button.getAttribute('aria-describedby')).toBe('existing')
  })

  it('flips and clamps at the viewport edges', () => {
    const viewport = { width: 320, height: 600 }
    const anchor = { left: 280, right: 320, top: 0, bottom: 40, width: 40, height: 40 }
    expect(placeTooltip(anchor, { width: 160, height: 30 }, viewport, 'top')).toEqual({ side: 'bottom', left: 152, top: 48 })
    expect(placeTooltip(anchor, { width: 160, height: 30 }, viewport, 'right').side).toBe('left')
  })
})
