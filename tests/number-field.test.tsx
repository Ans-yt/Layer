// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NumberField } from '../src/components/NumberField'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  vi.useRealTimers()
})

async function renderField(props: Partial<React.ComponentProps<typeof NumberField>> = {}) {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => {
    root?.render(<NumberField label="X" value={10} onValueChange={vi.fn()} {...props} />)
  })
  return host
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('NumberField', () => {
  it('parses typed values without NaN and groups a typing session', async () => {
    const onValueChange = vi.fn()
    const onTransformStart = vi.fn()
    const onTransformEnd = vi.fn()
    const rendered = await renderField({ onValueChange, onTransformStart, onTransformEnd, min: 0, max: 100, decimals: 0 })
    const input = rendered.querySelector('input[role="spinbutton"]') as HTMLInputElement

    await act(async () => {
      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      setInputValue(input, '42')
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    })

    expect(onValueChange).toHaveBeenCalledWith(42)
    expect(onValueChange.mock.calls.every(([next]) => Number.isFinite(next))).toBe(true)
    expect(onTransformStart).toHaveBeenCalledTimes(1)
    expect(onTransformEnd).toHaveBeenCalledTimes(1)
    expect(onTransformEnd).toHaveBeenCalledWith('Changed X')
  })

  it('clamps custom stepper input and repeats while the arrow is held', async () => {
    vi.useFakeTimers()
    const onValueChange = vi.fn()
    const onTransformStart = vi.fn()
    const onTransformEnd = vi.fn()
    const rendered = await renderField({ value: 9, min: 0, max: 10, onValueChange, onTransformStart, onTransformEnd })
    const increase = rendered.querySelector('button[aria-label="Increase X"]') as HTMLButtonElement

    await act(async () => {
      increase.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      vi.advanceTimersByTime(430)
      vi.advanceTimersByTime(130)
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
    })

    expect(onValueChange).toHaveBeenCalled()
    expect(onValueChange.mock.calls.at(-1)?.[0]).toBe(10)
    expect(onTransformStart).toHaveBeenCalledTimes(1)
    expect(onTransformEnd).toHaveBeenCalledTimes(1)
  })

  it('falls back to bounded drag when pointer lock is denied and ends one undo session', async () => {
    const onValueChange = vi.fn()
    const onTransformStart = vi.fn()
    const onTransformEnd = vi.fn()
    const rendered = await renderField({ onValueChange, onTransformStart, onTransformEnd })
    const scrub = rendered.querySelector('.number-field-label') as HTMLLabelElement
    Object.defineProperty(scrub, 'requestPointerLock', { configurable: true, value: () => Promise.reject(new Error('denied')) })

    await act(async () => {
      scrub.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 20 }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rendered.textContent).toContain('Pointer lock unavailable')

    await act(async () => {
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 120, clientY: 20 }))
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 120, clientY: 20 }))
    })

    expect(onValueChange).toHaveBeenCalledWith(15)
    expect(onTransformStart).toHaveBeenCalledTimes(1)
    expect(onTransformEnd).toHaveBeenCalledTimes(1)
  })

  it('releases pointer lock and cleans up if the lock is lost', async () => {
    const originalPointerLockElement = Object.getOwnPropertyDescriptor(document, 'pointerLockElement')
    const originalExitPointerLock = Object.getOwnPropertyDescriptor(document, 'exitPointerLock')
    const exitPointerLock = vi.fn()
    let lockedElement: Element | null = null
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => lockedElement })
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: exitPointerLock })

    try {
      const onValueChange = vi.fn()
      const onTransformStart = vi.fn()
      const onTransformEnd = vi.fn()
      const rendered = await renderField({ onValueChange, onTransformStart, onTransformEnd })
       const scrub = rendered.querySelector('.number-field-label') as HTMLLabelElement
      Object.defineProperty(scrub, 'requestPointerLock', {
        configurable: true,
        value: () => {
          lockedElement = scrub
          return Promise.resolve()
        },
      })

      await act(async () => {
        scrub.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 20 }))
        await Promise.resolve()
      })
      expect(rendered.querySelector('[data-pointer-lock-state="locked"]')).toBeTruthy()

      await act(async () => {
        const move = new MouseEvent('pointermove', { bubbles: true, clientX: 105, clientY: 20 })
        Object.defineProperty(move, 'movementX', { configurable: true, value: 5 })
        Object.defineProperty(move, 'movementY', { configurable: true, value: 0 })
        window.dispatchEvent(move)
        lockedElement = null
        document.dispatchEvent(new Event('pointerlockchange'))
      })

      expect(exitPointerLock).not.toHaveBeenCalled()
      expect(rendered.querySelector('[data-pointer-lock-state="idle"]')).toBeTruthy()
      expect(onTransformStart).toHaveBeenCalledTimes(1)
      expect(onTransformEnd).toHaveBeenCalledTimes(1)
    } finally {
      if (originalPointerLockElement) Object.defineProperty(document, 'pointerLockElement', originalPointerLockElement)
      else delete (document as { pointerLockElement?: Element | null }).pointerLockElement
      if (originalExitPointerLock) Object.defineProperty(document, 'exitPointerLock', originalExitPointerLock)
      else delete (document as { exitPointerLock?: () => void }).exitPointerLock
    }
  })

  it('restores the original value on Escape and still closes the active session', async () => {
    const onValueChange = vi.fn()
    const onTransformStart = vi.fn()
    const onTransformEnd = vi.fn()
    const rendered = await renderField({ onValueChange, onTransformStart, onTransformEnd })
    const input = rendered.querySelector('input[role="spinbutton"]') as HTMLInputElement

    await act(async () => {
      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      setInputValue(input, '30')
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    })

    expect(onValueChange).toHaveBeenLastCalledWith(10)
    expect(onTransformStart).toHaveBeenCalledTimes(1)
    expect(onTransformEnd).toHaveBeenCalledWith('Cancelled Changed X')
  })
})
