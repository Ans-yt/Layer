import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from './Icon'
import { formatNumber, normalizeNumber, parseNumericInput } from '../lib/numeric'
import './number-field.css'

type PointerLockTarget = HTMLElement & {
  requestPointerLock?: (options?: { unadjustedMovement?: boolean }) => void | Promise<void>
}

type PointerLockState = 'idle' | 'requesting' | 'locked' | 'fallback'

interface NumberFieldProps {
  label: string
  value: number
  onValueChange: (value: number) => void
  onTransformStart?: () => void
  onTransformEnd?: (label?: string) => void
  min?: number
  max?: number
  step?: number
  decimals?: number
  changeLabel?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
  /** Show the persistent scrubbing explanation for a standalone field. */
  showHint?: boolean
}

interface InteractionSession {
  originalValue: number
  started: boolean
}

interface Modifiers {
  shiftKey?: boolean
  altKey?: boolean
}

const POINTER_LOCK_FALLBACK = 'Pointer lock unavailable — bounded drag active.'

export function NumberField({
  label,
  value,
  onValueChange,
  onTransformStart,
  onTransformEnd,
  min,
  max,
  step = 1,
  decimals,
  changeLabel,
  ariaLabel,
  disabled = false,
  className = '',
  showHint = false,
}: NumberFieldProps) {
  const inputId = useId()
  const hintId = `${inputId}-hint`
  const initialValue = normalizeNumber(value, 0, min, max, decimals)
  const [draft, setDraft] = useState(() => formatNumber(initialValue, decimals))
  const [editing, setEditing] = useState(false)
  const [pointerLockState, setPointerLockState] = useState<PointerLockState>('idle')
  const [virtualCursor, setVirtualCursor] = useState<{ x: number; y: number } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const currentValueRef = useRef(initialValue)
  const editingRef = useRef(false)
  const sessionRef = useRef<InteractionSession | null>(null)
  const scrubActiveRef = useRef(false)
  const holdActiveRef = useRef(false)
  const keyboardActiveRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const scrubTargetRef = useRef<PointerLockTarget | null>(null)
  const pointerLockActiveRef = useRef(false)
  const pointerLockRequestedRef = useRef(false)
  const lastPointerXRef = useRef(0)
  const virtualCursorRef = useRef({ x: 0, y: 0 })
  const repeatTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const repeatIntervalRef = useRef<ReturnType<typeof window.setInterval> | null>(null)
  const pointerLockFallbackTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const suppressClickRef = useRef(false)
  const suppressClickTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const finishInteractionRef = useRef<(cancel?: boolean) => void>(() => undefined)
  const handlePointerMoveRef = useRef<(event: PointerEvent) => void>(() => undefined)
  const markPointerLockRef = useRef<() => void>(() => undefined)
  const useBoundedPointerRef = useRef<() => void>(() => undefined)

  const normalizedPropValue = normalizeNumber(value, currentValueRef.current, min, max, decimals)
  const labelForHistory = changeLabel ?? `Changed ${label}`

  useEffect(() => {
    currentValueRef.current = normalizedPropValue
    if (!editingRef.current && !sessionRef.current) setDraft(formatNumber(normalizedPropValue, decimals))
  }, [decimals, normalizedPropValue])

  const clearRepeat = useCallback(() => {
    if (repeatTimeoutRef.current !== null) window.clearTimeout(repeatTimeoutRef.current)
    if (repeatIntervalRef.current !== null) window.clearInterval(repeatIntervalRef.current)
    repeatTimeoutRef.current = null
    repeatIntervalRef.current = null
  }, [])

  const clearPointerLockFallback = useCallback(() => {
    if (pointerLockFallbackTimeoutRef.current !== null) window.clearTimeout(pointerLockFallbackTimeoutRef.current)
    pointerLockFallbackTimeoutRef.current = null
  }, [])

  const ensureSession = useCallback(() => {
    if (!sessionRef.current) sessionRef.current = { originalValue: currentValueRef.current, started: false }
    if (!sessionRef.current.started) {
      onTransformStart?.()
      sessionRef.current.started = true
    }
    return sessionRef.current
  }, [onTransformStart])

  const applyValue = useCallback((nextValue: number) => {
    const next = normalizeNumber(nextValue, currentValueRef.current, min, max, decimals)
    if (Object.is(next, currentValueRef.current)) return false
    ensureSession()
    currentValueRef.current = next
    onValueChange(next)
    return true
  }, [decimals, ensureSession, max, min, onValueChange])

  const finishSession = useCallback((cancel = false) => {
    const session = sessionRef.current
    if (!session) {
      editingRef.current = false
      setEditing(false)
      setDraft(formatNumber(currentValueRef.current, decimals))
      return
    }

    sessionRef.current = null
    editingRef.current = false
    setEditing(false)

    if (cancel && session.started) {
      currentValueRef.current = session.originalValue
      setDraft(formatNumber(session.originalValue, decimals))
      onValueChange(session.originalValue)
    } else {
      setDraft(formatNumber(currentValueRef.current, decimals))
    }

    if (session.started) onTransformEnd?.(cancel ? `Cancelled ${labelForHistory}` : labelForHistory)
  }, [decimals, labelForHistory, onTransformEnd, onValueChange])

  const finishInteraction = useCallback((cancel = false) => {
    const target = scrubTargetRef.current
    scrubActiveRef.current = false
    holdActiveRef.current = false
    keyboardActiveRef.current = false
    pointerLockRequestedRef.current = false
    pointerLockActiveRef.current = false
    clearPointerLockFallback()
    scrubTargetRef.current = null
    clearRepeat()

    if (target && pointerIdRef.current !== null) {
      try { target.releasePointerCapture?.(pointerIdRef.current) } catch { /* capture may already be released */ }
    }
    pointerIdRef.current = null

    if (target && document.pointerLockElement === target) {
      try { document.exitPointerLock?.() } catch { /* browser may have released it already */ }
    }

    setPointerLockState('idle')
    setVirtualCursor(null)
    finishSession(cancel)
  }, [clearPointerLockFallback, clearRepeat, finishSession])

  const wrapCoordinate = (valueToWrap: number, size: number) => {
    if (!Number.isFinite(size) || size <= 0) return 0
    return ((valueToWrap % size) + size) % size
  }

  const markPointerLock = useCallback(() => {
    if (!scrubActiveRef.current) return
    clearPointerLockFallback()
    pointerLockActiveRef.current = true
    pointerLockRequestedRef.current = false
    setPointerLockState('locked')
  }, [clearPointerLockFallback])

  const useBoundedPointer = useCallback(() => {
    if (!scrubActiveRef.current) return
    clearPointerLockFallback()
    pointerLockActiveRef.current = false
    pointerLockRequestedRef.current = false
    setPointerLockState('fallback')
  }, [clearPointerLockFallback])

  const requestScrubPointerLock = useCallback((target: PointerLockTarget) => {
    const request = target.requestPointerLock
    if (!request) {
      useBoundedPointer()
      return
    }

    pointerLockRequestedRef.current = true
    setPointerLockState('requesting')

    const requestWithOptions = (options?: { unadjustedMovement?: boolean }) => {
      try {
        const result = request.call(target, options)
        if (result && typeof (result as Promise<void>).then === 'function') {
          void Promise.resolve(result).then(markPointerLock).catch((error: unknown) => {
            const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name?: unknown }).name) : ''
            if (options && name === 'NotSupportedError') requestWithOptions()
            else useBoundedPointer()
          })
        } else {
          clearPointerLockFallback()
          pointerLockFallbackTimeoutRef.current = window.setTimeout(() => {
            if (pointerLockRequestedRef.current && !pointerLockActiveRef.current) useBoundedPointer()
          }, 500)
        }
      } catch (error: unknown) {
        const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name?: unknown }).name) : ''
        if (options && name === 'NotSupportedError') requestWithOptions()
        else useBoundedPointer()
      }
    }

    requestWithOptions({ unadjustedMovement: true })
  }, [clearPointerLockFallback, markPointerLock, useBoundedPointer])

  const adjustBy = useCallback((direction: 1 | -1, modifiers: Modifiers = {}) => {
    const scale = modifiers.shiftKey ? 10 : modifiers.altKey ? 0.1 : 1
    applyValue(currentValueRef.current + direction * Math.max(Number.EPSILON, step) * scale)
  }, [applyValue, step])

  const scrubBy = useCallback((deltaX: number, modifiers: Modifiers = {}) => {
    const scale = modifiers.shiftKey ? 4 : modifiers.altKey ? 0.25 : 1
    applyValue(currentValueRef.current + (deltaX / 4) * Math.max(Number.EPSILON, step) * scale)
  }, [applyValue, step])

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (scrubActiveRef.current) {
      if (pointerIdRef.current !== null && event.pointerId !== undefined && event.pointerId !== pointerIdRef.current) return
      const locked = pointerLockActiveRef.current
      const deltaX = locked && Number.isFinite(event.movementX) ? event.movementX : event.clientX - lastPointerXRef.current
      lastPointerXRef.current = event.clientX

      if (locked) {
        const width = window.innerWidth || document.documentElement.clientWidth || 1
        const height = window.innerHeight || document.documentElement.clientHeight || 1
        virtualCursorRef.current = {
          x: wrapCoordinate(virtualCursorRef.current.x + (Number.isFinite(event.movementX) ? event.movementX : deltaX), width),
          y: wrapCoordinate(virtualCursorRef.current.y + (Number.isFinite(event.movementY) ? event.movementY : 0), height),
        }
        setVirtualCursor({ ...virtualCursorRef.current })
      }
      scrubBy(deltaX, event)
      return
    }

    if (holdActiveRef.current) {
      // Pointer movement does not change a held stepper; pointerup still ends it.
    }
  }, [scrubBy])

  const handleScrubPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    inputRef.current?.blur()
    const target = event.currentTarget as PointerLockTarget
    scrubTargetRef.current = target
    scrubActiveRef.current = true
    pointerIdRef.current = event.pointerId
    lastPointerXRef.current = event.clientX
    const width = window.innerWidth || document.documentElement.clientWidth || 1
    const height = window.innerHeight || document.documentElement.clientHeight || 1
    virtualCursorRef.current = { x: wrapCoordinate(event.clientX, width), y: wrapCoordinate(event.clientY, height) }
    setVirtualCursor({ ...virtualCursorRef.current })
    try { target.setPointerCapture?.(event.pointerId) } catch { /* pointer capture is optional */ }
    requestScrubPointerLock(target)
  }, [disabled, requestScrubPointerLock])

  const startHeldStep = useCallback((direction: 1 | -1, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    suppressClickRef.current = true
    if (suppressClickTimeoutRef.current !== null) window.clearTimeout(suppressClickTimeoutRef.current)
    suppressClickTimeoutRef.current = window.setTimeout(() => { suppressClickRef.current = false }, 0)
    holdActiveRef.current = true
    pointerIdRef.current = event.pointerId
    try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* pointer capture is optional */ }
    adjustBy(direction, event)
    clearRepeat()
    repeatTimeoutRef.current = window.setTimeout(() => {
      repeatIntervalRef.current = window.setInterval(() => adjustBy(direction, event), 65)
    }, 360)
  }, [adjustBy, clearRepeat, disabled])

  const handleStepClick = useCallback((direction: 1 | -1, event: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (disabled) return
    adjustBy(direction, event)
    finishInteraction(false)
  }, [adjustBy, disabled, finishInteraction])

  const handleInputFocus = useCallback(() => {
    editingRef.current = true
    setEditing(true)
    setDraft(formatNumber(currentValueRef.current, decimals))
  }, [decimals])

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    editingRef.current = true
    setEditing(true)
    setDraft(event.currentTarget.value)
    const next = parseNumericInput(event.currentTarget.value, currentValueRef.current, min, max, decimals)
    if (next !== null) applyValue(next)
  }, [applyValue, decimals, max, min])

  const handleInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      finishInteraction(true)
      inputRef.current?.blur()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      finishInteraction(false)
      inputRef.current?.blur()
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      keyboardActiveRef.current = true
      adjustBy(event.key === 'ArrowUp' ? 1 : -1, event)
    }
  }, [adjustBy, finishInteraction])

  finishInteractionRef.current = finishInteraction
  handlePointerMoveRef.current = handlePointerMove
  markPointerLockRef.current = markPointerLock
  useBoundedPointerRef.current = useBoundedPointer

  useEffect(() => {
    const onPointerUp = () => {
      if (scrubActiveRef.current || holdActiveRef.current) finishInteractionRef.current(false)
    }
    const onPointerCancel = () => {
      if (scrubActiveRef.current || holdActiveRef.current) finishInteractionRef.current(true)
    }
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (keyboardActiveRef.current && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) finishInteractionRef.current(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && (scrubActiveRef.current || holdActiveRef.current || keyboardActiveRef.current)) {
        event.preventDefault()
        finishInteractionRef.current(true)
      }
    }
    const onBlur = () => finishInteractionRef.current(false)
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') finishInteractionRef.current(false) }
    const onPointerLockChange = () => {
      if (!scrubActiveRef.current) return
      const target = scrubTargetRef.current
      if (target && document.pointerLockElement === target) {
        markPointerLockRef.current()
      } else if (pointerLockActiveRef.current) {
        finishInteractionRef.current(false)
      } else if (pointerLockRequestedRef.current) {
        useBoundedPointerRef.current()
      }
    }
    const onPointerLockError = () => {
      if (!scrubActiveRef.current) return
      if (pointerLockActiveRef.current) finishInteractionRef.current(false)
      else useBoundedPointerRef.current()
    }

    const onPointerMove = (event: PointerEvent) => handlePointerMoveRef.current(event)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('visibilitychange', onVisibilityChange)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('pointerlockerror', onPointerLockError)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('pointerlockerror', onPointerLockError)
      finishInteractionRef.current(true)
      if (suppressClickTimeoutRef.current !== null) window.clearTimeout(suppressClickTimeoutRef.current)
    }
  }, [])

  const hint = pointerLockState === 'fallback' ? POINTER_LOCK_FALLBACK : 'Drag the label horizontally · Shift coarse · Alt fine'
  const hasHint = showHint || pointerLockState === 'fallback'
  const displayValue = editing ? draft : formatNumber(normalizedPropValue, decimals)
  const controlClass = ['number-field', className].filter(Boolean).join(' ')
  const virtualCursorStyle: CSSProperties | undefined = virtualCursor ? { left: virtualCursor.x, top: virtualCursor.y } : undefined

  return <div className={controlClass} data-pointer-lock-state={pointerLockState}>
    <div className="number-field-head">
      <label className="number-field-label" htmlFor={inputId} onPointerDown={handleScrubPointerDown}>
        <span>{label}</span><Icon name="move" size={11} strokeWidth={1.6} />
      </label>
    </div>
    <div className="number-field-control">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode={decimals === 0 ? 'numeric' : 'decimal'}
        role="spinbutton"
        aria-label={ariaLabel ?? label}
        aria-valuenow={normalizedPropValue}
        aria-valuemin={min}
        aria-valuemax={max}
         aria-describedby={hasHint ? hintId : undefined}
        value={displayValue}
        onFocus={handleInputFocus}
        onChange={handleInputChange}
        onBlur={() => finishInteraction(false)}
        onKeyDown={handleInputKeyDown}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      <div className="number-field-steppers" aria-label={`${ariaLabel ?? label} step controls`}>
        <button className="number-field-step" type="button" onPointerDown={(event) => startHeldStep(1, event)} onClick={(event) => handleStepClick(1, event)} aria-label={`Increase ${ariaLabel ?? label}`} disabled={disabled}>
          <Icon name="chevron-down" size={12} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button className="number-field-step" type="button" onPointerDown={(event) => startHeldStep(-1, event)} onClick={(event) => handleStepClick(-1, event)} aria-label={`Decrease ${ariaLabel ?? label}`} disabled={disabled}>
          <Icon name="chevron-down" size={12} />
        </button>
      </div>
    </div>
     {hasHint && <span className={`number-field-hint ${pointerLockState === 'fallback' ? 'is-fallback' : ''}`} id={hintId} aria-live="polite">{hint}</span>}
    {pointerLockState === 'locked' && virtualCursor && <span className="number-field-virtual-cursor" style={virtualCursorStyle} aria-hidden="true" />}
  </div>
}

export type { NumberFieldProps }
