import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { clamp, colorContrast, formatColor, hsvaToHex, parseColor } from '../lib/color'
import type { ColorFormat, Hsva } from '../lib/color'
import { Icon } from './Icon'
import './color-picker.css'

const SWATCHES = ['#F8371A', '#F97C1B', '#FAC81C', '#3FD0B6', '#2CADF6', '#6462FC', '#5a289e', '#f9dcec', '#c7b3be', '#9c8a95', '#70626b', '#4a4147']
type Props = { value: string; onChange: (value: string) => void; label: string; onStart?: () => void; onEnd?: (message: string) => void }
type Plane = 'saturation' | 'hue' | 'alpha'

export function ColorPicker({ value, onChange, label, onStart, onEnd }: Props) {
  const [open, setOpen] = useState(false)
  const [hsv, setHsv] = useState<Hsva>(() => parseColor(value) ?? { h: 0, s: 0, v: 0, a: 1 })
  const [format, setFormat] = useState<ColorFormat>('hex')
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const popover = useRef<HTMLDivElement>(null)
  const current = useRef(hsv); const dirty = useRef<string | null>(null)
  const dragCleanup = useRef<(() => void) | null>(null)
  const callbacks = useRef({ onChange, onStart, onEnd }); callbacks.current = { onChange, onStart, onEnd }
  const id = useId()
  const display = formatColor(hsv, format)

  useEffect(() => {
    const next = parseColor(value)
    // An echoed 8-bit hex must not quantize the working HSV or erase hue at black/gray.
    if (!next || hsvaToHex(next) === hsvaToHex(current.current)) return
    if (!next.s) next.h = current.current.h
    if (!next.v) next.s = current.current.s
    current.current = next; setHsv(next)
  }, [value])

  const update = (next: Hsva) => {
    const previous = hsvaToHex(current.current)
    current.current = next; setHsv(next)
    dirty.current = null; setDraft(null); setInvalid(false)
    const hex = hsvaToHex(next)
    if (hex !== previous) callbacks.current.onChange(hex)
  }
  const commit = () => {
    if (dirty.current === null) return true
    const next = parseColor(dirty.current, format, current.current.a)
    if (!next) { setInvalid(true); return false }
    if (!next.s) next.h = current.current.h
    if (!next.v) next.s = current.current.s
    callbacks.current.onStart?.(); update(next); callbacks.current.onEnd?.(`Changed ${label.toLowerCase()} color`)
    return true
  }
  const close = (restoreFocus = true) => {
    dragCleanup.current?.()
    dirty.current = null; setDraft(null); setInvalid(false); setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }
  const actions = useRef({ close, commit }); actions.current = { close, commit }
  useEffect(() => () => dragCleanup.current?.(), [])

  useLayoutEffect(() => {
    if (!open) return
    const positionPopover = () => {
      const anchor = trigger.current?.getBoundingClientRect(); const box = popover.current?.getBoundingClientRect()
      if (!anchor || !box) return
      const viewport = window.visualViewport
      const x = viewport?.offsetLeft ?? 0; const y = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth; const height = viewport?.height ?? window.innerHeight
      const below = anchor.bottom + 7
      setPosition({ left: clamp(anchor.right - box.width, x + 8, Math.max(x + 8, x + width - box.width - 8)), top: clamp(below + box.height <= y + height - 8 ? below : anchor.top - box.height - 7, y + 8, Math.max(y + 8, y + height - box.height - 8)) })
    }
    positionPopover()
    popover.current?.querySelector<HTMLElement>('[role="slider"]')?.focus()
    window.addEventListener('resize', positionPopover); window.addEventListener('scroll', positionPopover, true)
    window.visualViewport?.addEventListener('resize', positionPopover); window.visualViewport?.addEventListener('scroll', positionPopover)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(positionPopover)
    if (popover.current) observer?.observe(popover.current)
    return () => {
      window.removeEventListener('resize', positionPopover); window.removeEventListener('scroll', positionPopover, true)
      window.visualViewport?.removeEventListener('resize', positionPopover); window.visualViewport?.removeEventListener('scroll', positionPopover)
      observer?.disconnect()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !popover.current?.contains(event.target)) {
        actions.current.commit(); actions.current.close(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
      actions.current.close()
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true) }
  }, [open])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, plane: Plane) => {
    if (event.button !== 0 || dragCleanup.current) return
    event.preventDefault(); event.stopPropagation()
    const target = event.currentTarget; const box = target.getBoundingClientRect(); const pointerId = event.pointerId
    if (!box.width || (plane === 'saturation' && !box.height)) return
    // Finish an outstanding text edit before beginning the drag's transaction.
    commit(); target.focus(); callbacks.current.onStart?.()
    const apply = (x: number, y: number) => {
      const ratio = clamp((x - box.left) / box.width, 0, 1)
      update({ ...current.current, ...(plane === 'saturation' ? { s: ratio * 100, v: clamp(1 - (y - box.top) / box.height, 0, 1) * 100 } : plane === 'hue' ? { h: ratio * 360 } : { a: ratio }) })
    }
    const move = (next: PointerEvent) => { if (next.pointerId === pointerId) apply(next.clientX, next.clientY) }
    const finish = () => {
      if (!dragCleanup.current) return
      dragCleanup.current = null
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', finish)
      target.removeEventListener('lostpointercapture', cancel)
      try { if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId) } catch { /* Capture may already have been released by the browser. */ }
      callbacks.current.onEnd?.(`Changed ${label.toLowerCase()} color`)
    }
    const up = (next: PointerEvent) => { if (next.pointerId === pointerId) { apply(next.clientX, next.clientY); finish() } }
    const cancel = (next: PointerEvent) => { if (next.pointerId === pointerId) finish() }
    dragCleanup.current = finish
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', finish)
    target.addEventListener('lostpointercapture', cancel)
    try { target.setPointerCapture?.(pointerId) } catch { /* Window listeners also support browsers without pointer capture. */ }
    apply(event.clientX, event.clientY)
  }
  const keyAdjust = (event: ReactKeyboardEvent, plane: Plane) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const delta = (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) * (event.shiftKey ? 10 : 1)
    const next = { ...current.current }
    const key = plane === 'saturation' ? (event.key === 'ArrowUp' || event.key === 'ArrowDown' ? 'v' : 's') : plane === 'hue' ? 'h' : 'a'
    const max = key === 'h' ? 360 : key === 'a' ? 1 : 100
    next[key] = event.key === 'Home' ? 0 : event.key === 'End' ? max : clamp(next[key] + delta * (key === 'a' ? .01 : 1), 0, max)
    callbacks.current.onStart?.(); update(next); callbacks.current.onEnd?.(`Changed ${label.toLowerCase()} color`)
  }
  const choose = (next: Hsva) => { callbacks.current.onStart?.(); update(next); callbacks.current.onEnd?.(`Changed ${label.toLowerCase()} color`) }
  const portalHost = root.current?.closest('.layer-app') ?? (typeof document === 'undefined' ? null : document.body)

  return <div className="color-picker color-picker-control" ref={root}>
    <button ref={trigger} type="button" className="color-picker-trigger" aria-label={`${label} color`} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined} onClick={() => { if (open) { commit(); close() } else setOpen(true) }}>
      <span className="color-picker-swatch"><span style={{ background: value }} /></span><span>{value}</span><Icon name="chevron-down" size={12} />
    </button>
    {open && portalHost && createPortal(<div ref={popover} id={id} className="color-picker-popover color-picker-floating" style={{ ...position, zIndex: 2600 }} role="dialog" aria-label={`${label} color picker`} onKeyDown={(event) => event.stopPropagation()} onBlur={(event) => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !root.current?.contains(event.relatedTarget)) { commit(); close(false) }
    }}>
      <div className="color-saturation" role="slider" tabIndex={0} aria-label={`${label} saturation and brightness`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.s)} aria-valuetext={`${Math.round(hsv.s)}% saturation, ${Math.round(hsv.v)}% brightness. Left/right saturation; up/down brightness.`} style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }} onPointerDown={(event) => startDrag(event, 'saturation')} onKeyDown={(event) => keyAdjust(event, 'saturation')}><i style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} /></div>
      <div className="color-hue" role="slider" tabIndex={0} aria-label={`${label} hue`} aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)} onPointerDown={(event) => startDrag(event, 'hue')} onKeyDown={(event) => keyAdjust(event, 'hue')}><i style={{ left: `${hsv.h / 360 * 100}%` }} /></div>
      <div className="color-alpha" role="slider" tabIndex={0} aria-label={`${label} opacity`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.a * 100)} onPointerDown={(event) => startDrag(event, 'alpha')} onKeyDown={(event) => keyAdjust(event, 'alpha')}><span style={{ background: `linear-gradient(to right, transparent, ${hsvaToHex({ ...hsv, a: 1 })})` }} /><i style={{ left: `${hsv.a * 100}%` }} /></div>
      <div className="color-format" role="group" aria-label="Color format">{(['hex', 'hsl', 'rgb'] as const).map((item) => <button key={item} type="button" aria-pressed={format === item} onClick={() => { if (commit()) setFormat(item) }}>{item.toUpperCase()}</button>)}<span>{Math.round(hsv.a * 100)}% opacity</span></div>
      <input className="color-draft" value={draft ?? display} aria-label={`${label} value`} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} spellCheck={false} onChange={(event) => { dirty.current = event.target.value; setDraft(event.target.value); setInvalid(false) }} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} />
      {invalid && <p id={`${id}-error`} className="color-error" role="status">Enter a valid {format.toUpperCase()} color{format === 'hex' ? ' (3, 4, 6 or 8 hex digits).' : ' with channels in range.'}</p>}
      <div className="color-swatches">{SWATCHES.map((swatch) => <button key={swatch} type="button" style={{ background: swatch }} aria-label={`Set color to ${swatch}`} onClick={() => choose({ ...parseColor(swatch)!, a: current.current.a })} />)}<button type="button" className="color-transparent" aria-label="Set transparent" onClick={() => choose({ ...current.current, a: 0 })}>0%</button></div>
      <div className="color-contrast"><span>Contrast</span><b>{colorContrast(hsv, '#0b0c0e')} dark · {colorContrast(hsv, '#ffffff')} light</b></div>
    </div>, portalHost)}
  </div>
}
