// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColorPicker } from '../src/components/ColorPicker'
import { colorContrast, formatColor, hsvaToHex, parseColor } from '../src/lib/color'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement
afterEach(() => { act(() => root?.unmount()); root = undefined; host?.remove(); vi.restoreAllMocks() })
const find = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!
const click = async (element: HTMLElement) => { await act(async () => element.click()) }
const key = async (element: HTMLElement, key: string) => { await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))) }
async function renderPicker(props: Partial<React.ComponentProps<typeof ColorPicker>> = {}, controlled = false) {
  host = document.body.appendChild(document.createElement('div')); host.className = 'layer-app'
  root = createRoot(host)
  function Controlled() {
    const [value, setValue] = useState(props.value ?? '#ff000080')
    return <ColorPicker label="Fill" {...props} value={value} onChange={(next) => { setValue(next); props.onChange?.(next) }} />
  }
  await act(async () => root!.render(controlled ? <Controlled /> : <ColorPicker label="Fill" value="#ff0000" onChange={vi.fn()} {...props} />))
  await click(find('button'))
}
async function type(text: string) {
  const input = find<HTMLInputElement>('input')
  await act(async () => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}
async function pointer(element: EventTarget, type: string, x = 50, y = 50, pointerId = 1) {
  await act(async () => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
    Object.defineProperty(event, 'pointerId', { value: pointerId })
    element.dispatchEvent(event)
  })
}

describe('color parsing', () => {
  it.each(['#12', '#12345', '#1234567', '#123456789', '#ggg', 'rgb(12, nope, 5)', 'rgb(256 0 0)', 'rgb(-1 0 0)', 'rgba(1, 2, 3, 2)', 'hsl(0 101% 40%)', 'hsl(0 50 40)', 'red garbage', 'rgb(1 2 3 4)', 'rgb(1 2 3 / 1)tail'])('rejects %s without partial parsing', (text) => {
    expect(parseColor(text)).toBeNull()
  })
  it.each([['#abc', '#aabbcc'], ['#abcd', '#aabbccdd'], ['#12345678', '#12345678'], ['transparent', '#00000000'], ['rgb(255 0 0 / 50%)', '#ff000080'], ['rgba(255, 0, 0, .5)', '#ff000080'], ['hsl(120deg 100% 50% / 25%)', '#00ff0040'], ['rgb(100% 0% 0%)', '#ff0000']])('parses %s', (text, hex) => {
    expect(hsvaToHex(parseColor(text)!)).toBe(hex)
  })
  it('preserves omitted alpha for edits, uses explicit alpha, and round-trips formats', () => {
    expect(parseColor('#123', 'hex', .3)?.a).toBe(.3)
    expect(parseColor('120°, 100%, 50%', 'hsl', .3)?.a).toBe(.3)
    expect(parseColor('12, 24, 36', 'rgb', .3)?.a).toBe(.3)
    expect(parseColor('#123f', 'hex', .3)?.a).toBe(1)
    for (const format of ['hex', 'rgb', 'hsl'] as const) {
      const color = parseColor('#54abce80')!
      expect(hsvaToHex(parseColor(formatColor(color, format), format)!)).toBe('#54abce80')
    }
    expect(colorContrast(parseColor('transparent')!, '#ffffff')).toBe('1.00')
    expect(colorContrast(parseColor('#000')!, '#ffffff')).toBe('21.00')
  })
})

describe('ColorPicker', () => {
  it('portals into the scoped app and restores focus while containing Escape', async () => {
    await renderPicker()
    const dialog = find('[role="dialog"]')
    expect(dialog.parentElement).toBe(host)
    expect(find('.color-picker').contains(dialog)).toBe(false)
    expect(dialog.style.zIndex).toBe('2600')
    expect(Number.parseFloat(dialog.style.left)).toBeGreaterThanOrEqual(8)
    expect(Number.parseFloat(dialog.style.top)).toBeGreaterThanOrEqual(8)
    const editorEscape = vi.fn(); document.addEventListener('keydown', editorEscape)
    await type('#00ff00')
    await key(find('input'), 'Escape')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(find('button'))
    expect(editorEscape).not.toHaveBeenCalled()
    document.removeEventListener('keydown', editorEscape)
  })
  it('bounds the popup at the viewport edge and repositions on resize', async () => {
    await renderPicker()
    const dialog = find('[role="dialog"]')
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ width: 288, height: 400 } as DOMRect)
    vi.spyOn(find('.color-picker-trigger'), 'getBoundingClientRect').mockReturnValue({ left: 950, right: 1060, top: 700, bottom: 732 } as DOMRect)
    await act(async () => window.dispatchEvent(new Event('resize')))
    expect(Number.parseFloat(dialog.style.left) + 288).toBeLessThanOrEqual(window.innerWidth - 8)
    expect(Number.parseFloat(dialog.style.top) + 400).toBeLessThanOrEqual(window.innerHeight - 8)
  })
  it('keeps drafts until commit and reports invalid input without changing the color', async () => {
    const onChange = vi.fn(); const onStart = vi.fn(); const onEnd = vi.fn()
    await renderPicker({ onChange, onStart, onEnd })
    await type('#12345'); await key(find('input'), 'Enter')
    expect(onChange).not.toHaveBeenCalled(); expect(find('input').getAttribute('aria-invalid')).toBe('true')
    await type('#00ff0080')
    expect(onChange).not.toHaveBeenCalled()
    await key(find('input'), 'Enter')
    await act(async () => find<HTMLInputElement>('input').blur())
    expect(onChange).toHaveBeenCalledExactlyOnceWith('#00ff0080')
    expect(onStart).toHaveBeenCalledTimes(1); expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith('Changed fill color')
  })
  it('commits blur, supports segmented formats, and retains alpha across RGB and swatches', async () => {
    const onChange = vi.fn()
    await renderPicker({ onChange }, true)
    await click(Array.from(host.querySelectorAll('button')).find((el) => el.textContent === 'RGB')!)
    await type('0, 255, 0')
    await act(async () => find<HTMLInputElement>('input').blur())
    expect(onChange).toHaveBeenLastCalledWith('#00ff0080')
    await click(find('[aria-label="Set color to #F8371A"]'))
    expect(onChange).toHaveBeenLastCalledWith('#f8371a80')
    expect(host.querySelector('select')).toBeNull()
    await click(find('[aria-label="Set transparent"]'))
    expect(onChange).toHaveBeenLastCalledWith('#f8371a00')
  })
  it('preserves hue at black and HSV precision through controlled prop echoes', async () => {
    await renderPicker({ value: '#00000080' }, true)
    await key(find('[aria-label="Fill hue"]'), 'ArrowRight')
    await key(find('[aria-label="Fill saturation and brightness"]'), 'ArrowRight')
    await key(find('[aria-label="Fill saturation and brightness"]'), 'ArrowUp')
    expect(find('[aria-label="Fill hue"]').getAttribute('aria-valuenow')).toBe('1')
    expect(find('[aria-label="Fill saturation and brightness"]').getAttribute('aria-valuenow')).toBe('1')
    expect(find('[aria-label="Fill opacity"]').getAttribute('aria-valuenow')).toBe('50')
    await key(find('[aria-label="Fill opacity"]'), 'Home')
    expect(find('[aria-label="Fill opacity"]').getAttribute('aria-valuenow')).toBe('0')
  })
  it('receives external RGB/HSL values without overwriting active draft', async () => {
    await renderPicker()
    await type('#123')
    await act(async () => root!.render(<ColorPicker label="Fill" value="hsl(240 100% 50% / 25%)" onChange={vi.fn()} />))
    expect(find<HTMLInputElement>('input').value).toBe('#123')
    expect(find('[aria-label="Fill hue"]').getAttribute('aria-valuenow')).toBe('240')
    expect(find('[aria-label="Fill opacity"]').getAttribute('aria-valuenow')).toBe('25')
  })
  it.each(['pointerup', 'pointercancel', 'lostpointercapture', 'unmount', 'escape', 'blur'])('ends a captured drag once on %s and cleans up', async (ending) => {
    const onChange = vi.fn(); const onStart = vi.fn(); const onEnd = vi.fn()
    await renderPicker({ onChange, onStart, onEnd }, true)
    const slider = find('[aria-label="Fill saturation and brightness"]')
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect)
    const capture = vi.fn(); const release = vi.fn()
    Object.assign(slider, { setPointerCapture: capture, hasPointerCapture: () => true, releasePointerCapture: release })
    await pointer(slider, 'pointerdown', 50, 50)
    await pointer(window, 'pointermove', 75, 25)
    const calls = onChange.mock.calls.length
    await pointer(window, 'pointermove', 100, 0, 2)
    expect(onChange).toHaveBeenCalledTimes(calls)
    if (ending === 'unmount') { await act(async () => root!.unmount()); root = undefined }
    else if (ending === 'escape') await key(slider, 'Escape')
    else if (ending === 'blur') await act(async () => window.dispatchEvent(new Event('blur')))
    else await pointer(ending === 'lostpointercapture' ? slider : window, ending, 75, 25)
    expect(capture).toHaveBeenCalledWith(1); expect(release).toHaveBeenCalledWith(1)
    expect(onStart).toHaveBeenCalledTimes(1); expect(onEnd).toHaveBeenCalledTimes(1)
    const finishedCalls = onChange.mock.calls.length
    await pointer(window, 'pointermove', 100, 100)
    expect(onChange).toHaveBeenCalledTimes(finishedCalls)
  })
})
