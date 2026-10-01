// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetsPanel } from '../src/components/AssetsPanel'
import { ReviewPanel } from '../src/components/ReviewPanel'
import { ThemeChooser, ThemePicker } from '../src/components/ThemePicker'
import { THEMES } from '../src/lib/themes'
import { createInitialProject } from '../src/lib/model'
import { checkerTextColor, contrastRatio } from '../src/components/ReviewPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  vi.restoreAllMocks()
})

function render(node: ReactNode) {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root!.render(node))
}

function click(label: string) {
  const target = [...(host?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes(label))
  expect(target).toBeTruthy()
  act(() => (target as HTMLButtonElement).click())
}

describe('workspace themes', () => {
  it('exposes all six named palettes with the required rose and espresso references', () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(['black', 'white', 'ocean', 'deep-blue', 'espresso', 'rose'])
    expect(THEMES.find((theme) => theme.id === 'espresso')?.colors).toEqual(expect.arrayContaining(['#3E2723', '#EAC6D0', '#EDE6DA']))
    expect(THEMES.find((theme) => theme.id === 'rose')?.colors).toEqual(expect.arrayContaining(['#F9DCEC', '#C7B3BE', '#9C8A95', '#70626B', '#4A4147']))
  })

  it('focuses the chooser on open, supports arrow selection, and restores the trigger', () => {
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => { callback(0); return 1 } })
    function Harness() {
      const [open, setOpen] = useState(false)
      return <><button type="button" onClick={() => setOpen(true)}>Open themes</button>{open && <ThemeChooser value="black" onChange={vi.fn()} onClose={() => setOpen(false)} />}</>
    }
    render(<Harness />)
    click('Open themes')
    const radios = [...host!.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    expect(radios).toHaveLength(6)
    expect(document.activeElement).toBe(radios[0])
    act(() => radios[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(radios[1])
    act(() => radios[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(host!.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement?.textContent).toContain('Open themes')
  })

  it('keeps keyboard navigation within the selected radio group', () => {
    const onChange = vi.fn()
    render(<ThemePicker value="black" onChange={onChange} />)
    const first = host!.querySelector<HTMLButtonElement>('[role="radio"]')!
    act(() => { first.focus(); first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })) })
    expect(document.activeElement?.getAttribute('data-theme-id')).toBe('rose')
    expect(onChange).toHaveBeenCalledWith('rose')
  })

  it('keeps the chooser mounted while Escape closes its portaled background picker', () => {
    const onReset = vi.fn()
    render(<ThemeChooser value="black" onChange={vi.fn()} onClose={vi.fn()} canvasBackground="#123456" canvasBackgroundProvenance="custom" onCanvasBackground={vi.fn()} onResetCanvasBackground={onReset} />)
    click('123456')
    const picker = document.body.querySelector<HTMLElement>('.color-picker-floating')
    expect(picker?.style.zIndex).toBe('2600')
    act(() => picker?.querySelector<HTMLElement>('[role="slider"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(host!.querySelector('.theme-chooser')).toBeTruthy()
    expect(document.body.querySelector('.color-picker-floating')).toBeNull()
    click('Use theme default')
    expect(onReset).toHaveBeenCalledOnce()
  })
})

describe('asset and review panels', () => {
  it('uses the rendered button foreground for contrast checks', () => {
    expect(checkerTextColor({ type: 'button' })).toBe('#0b0c0e')
    expect(contrastRatio(checkerTextColor({ type: 'button' }), '#f5b847')).toBeGreaterThan(10)
    expect(contrastRatio('#f4f1e8', '#f5b847')).toBeLessThan(2)
  })

  it('renders real starter previews and preserves optional token apply semantics', async () => {
    const project = createInitialProject()
    const onApply = vi.fn()
    render(<AssetsPanel project={project} onUpdate={vi.fn()} onCommit={vi.fn()} onInsertElement={vi.fn()} onUpload={vi.fn()} onNotify={vi.fn()} onApplyStyle={onApply} />)
    await act(async () => { await Promise.resolve() })
    expect(host!.querySelector('.starter-layout-preview')).toBeTruthy()
    click('Tokens')
    expect(host!.querySelector('.token-field')).toBeTruthy()
    const apply = [...host!.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Apply')
    expect(apply).toBeTruthy()
    act(() => (apply as HTMLButtonElement).click())
    expect(onApply).toHaveBeenCalledWith('style-amber')
  })

  it('shows an explicit OCR install action without starting a download on render', () => {
    const project = createInitialProject()
    render(<ReviewPanel project={project} page={project.pages[0]} onUpdate={vi.fn()} onNotify={vi.fn()} onExport={vi.fn()} onCopy={vi.fn()} />)
    expect(host!.querySelector('.ocr-card')).toBeTruthy()
    expect([...host!.querySelectorAll('button')].some((button) => button.textContent?.includes('Install OCR worker'))).toBe(true)
    expect(host!.querySelector('.ocr-progress-block')).toBeNull()
  })
})
