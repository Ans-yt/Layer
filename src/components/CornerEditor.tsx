import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from './Icon'
import type { DesignElement } from '../lib/model'
import { clampCutValue, CORNER_NAMES, mirrorCorners, snapCutValue, zeroCorners, type CornerName } from '../lib/corner-values'

interface Props {
  element: DesignElement
  onChange: (patch: Partial<DesignElement>) => void
  onStart: () => void
  onEnd: (label?: string) => void
  onClose: () => void
  mode?: 'radius' | 'cut'
}

const corners: CornerName[] = [...CORNER_NAMES]
const labels: Record<CornerName, string> = { topLeft: 'TL', topRight: 'TR', bottomRight: 'BR', bottomLeft: 'BL' }
const canvas = { left: 12, top: 12, width: 216, height: 126 }

const radiusLabel = (values: DesignElement['corners']) => {
  const first = values.topLeft
  return corners.every((corner) => values[corner] === first) ? first : Math.min(...corners.map((corner) => values[corner]))
}

export function CornerEditor({ element, onChange, onStart, onEnd, onClose, mode = 'radius' }: Props) {
  const [values, setValues] = useState(mode === 'cut' ? (element.cutCorners ?? zeroCorners()) : element.corners)
  const [mirrorX, setMirrorX] = useState(true)
  const [mirrorY, setMirrorY] = useState(false)
  const [snap, setSnap] = useState(mode === 'cut')
  const previewRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ corner: CornerName; pointerId: number } | null>(null)

  useEffect(() => setValues(mode === 'cut' ? (element.cutCorners ?? zeroCorners()) : element.corners), [element.corners, element.cutCorners, mode])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose])

  const scale = useMemo(() => Math.min(canvas.width / Math.max(1, element.width), canvas.height / Math.max(1, element.height)), [element.height, element.width])
  const displayRadius = (corner: CornerName) => Math.min(Math.max(0, values[corner] * scale), Math.min(canvas.width, canvas.height) / 2 - 2)
  const handlePosition = (corner: CornerName) => {
    const radius = displayRadius(corner)
    const right = corner.includes('Right')
    const bottom = corner.includes('bottom')
    if (mode === 'cut') return { left: canvas.left + (right ? canvas.width - radius : radius), top: canvas.top + (bottom ? canvas.height - radius : radius) }
    return { left: canvas.left + (right ? canvas.width - radius : radius), top: canvas.top + (bottom ? canvas.height - radius : radius) }
  }

  const valueFromPointer = (corner: CornerName, event: PointerEvent) => {
    const bounds = previewRef.current?.getBoundingClientRect()
    if (!bounds) return values[corner]
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    const right = corner.includes('Right')
    const bottom = corner.includes('bottom')
    const dx = right ? canvas.left + canvas.width - x : x - canvas.left
    const dy = bottom ? canvas.top + canvas.height - y : y - canvas.top
    const max = Math.min(element.width, element.height) / 2
    const raw = Math.min(Math.max(0, dx), Math.max(0, dy), max)
    return mode === 'cut' && snap ? snapCutValue(raw) : Math.round(raw)
  }

  const applyCorner = (corner: CornerName, rawValue: number, end = false) => {
    const value = mode === 'cut' ? clampCutValue(snap ? snapCutValue(rawValue) : rawValue, element.width, element.height) : Number.isFinite(rawValue) ? Math.max(0, Math.min(Math.min(element.width, element.height) / 2, Math.round(rawValue))) : 0
    const next = mirrorCorners(values, corner, value, mirrorX, mirrorY)
    setValues(next)
    onChange(mode === 'cut' ? { cutCorners: next } : { corners: next, radius: radiusLabel(next) })
    if (end) onEnd(mode === 'cut' ? 'Edited cut corners' : 'Edited corner radius')
  }

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      applyCorner(drag.corner, valueFromPointer(drag.corner, event))
    }
    const finish = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      dragRef.current = null
      onEnd(mode === 'cut' ? 'Edited cut corners' : 'Edited corner radius')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish) }
  })

  const startCornerDrag = (corner: CornerName, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { corner, pointerId: event.pointerId }
    onStart()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* capture is optional */ }
  }

  const setPreset = (value: number) => {
    onStart()
    const next = { topLeft: value, topRight: value, bottomRight: value, bottomLeft: value }
    setValues(next)
    onChange(mode === 'cut' ? { cutCorners: next } : { corners: next, radius: value })
    onEnd(mode === 'cut' ? 'Set cut corner preset' : 'Set corner radius')
  }

  const cutPoints = `${canvas.left + values.topLeft * scale},${canvas.top} ${canvas.left + canvas.width - values.topRight * scale},${canvas.top} ${canvas.left + canvas.width},${canvas.top + values.topRight * scale} ${canvas.left + canvas.width},${canvas.top + canvas.height - values.bottomRight * scale} ${canvas.left + canvas.width - values.bottomRight * scale},${canvas.top + canvas.height} ${canvas.left + values.bottomLeft * scale},${canvas.top + canvas.height} ${canvas.left},${canvas.top + canvas.height - values.bottomLeft * scale} ${canvas.left},${canvas.top + values.topLeft * scale}`
  const title = mode === 'cut' ? 'Cut the corners' : 'Round the corners'
  const label = mode === 'cut' ? 'cut' : 'radius'
  return <div className="corner-editor-layer" role="presentation"><section className={`corner-editor ${mode === 'cut' ? 'cut-editor' : ''}`} role="dialog" aria-label={`${title} editor`}>
    <div className="corner-editor-heading"><div><span className="panel-kicker">{mode === 'cut' ? 'CUT TOOL · CTRL/CMD C' : 'CORNER EDITOR · CTRL/CMD M'}</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label={`Close ${label} editor`}><Icon name="close" size={15} /></button></div>
    <p className="corner-editor-intro">{mode === 'cut' ? 'Drag a chamfer handle. Each value is a straight diagonal cut, not a rounded corner. Snap keeps measurements tidy.' : 'Drag a corner handle or line. Mirror X keeps left and right sides aligned; Mirror Y keeps top and bottom aligned.'}</p>
    <div className="corner-editor-preview" ref={previewRef}>
      {mode === 'cut' ? <svg className="cut-editor-shape" viewBox="0 0 240 150" aria-hidden="true"><polygon points={cutPoints} /></svg> : <div className="corner-editor-shape" style={{ left: canvas.left, top: canvas.top, width: canvas.width, height: canvas.height, borderRadius: `${displayRadius('topLeft')}px ${displayRadius('topRight')}px ${displayRadius('bottomRight')}px ${displayRadius('bottomLeft')}px` }} />}
      {corners.map((corner) => { const position = handlePosition(corner); return <button key={corner} className={`corner-editor-handle corner-editor-${corner}`} style={position} onPointerDown={(event) => startCornerDrag(corner, event)} aria-label={`Adjust ${labels[corner]} ${label}`} data-tooltip={`${labels[corner]} · ${values[corner]}px`}><span /></button> })}
      <span className="corner-editor-measure">{mode === 'cut' ? 'Snap ' : ''}{mode === 'cut' && snap ? '4px · ' : ''}{radiusLabel(values)} px</span>
    </div>
    <div className="corner-editor-toggles"><button className={`toggle-button ${mirrorX ? 'active' : ''}`} onClick={() => setMirrorX((current) => !current)}><Icon name="align-center" size={12} /> Mirror X</button><button className={`toggle-button ${mirrorY ? 'active' : ''}`} onClick={() => setMirrorY((current) => !current)}><Icon name="distribute" size={12} /> Mirror Y</button>{mode === 'cut' && <button className={`toggle-button ${snap ? 'active' : ''}`} onClick={() => setSnap((current) => !current)}><Icon name="target" size={12} /> Snap 4px</button>}</div>
    <div className="corner-editor-values">{corners.map((corner) => <label key={corner}><span>{labels[corner]}</span><input type="number" min="0" max={Math.floor(Math.min(element.width, element.height) / 2)} step={mode === 'cut' ? 4 : 1} value={Math.round(values[corner])} onChange={(event) => { onStart(); applyCorner(corner, Number(event.target.value), true) }} /></label>)}</div>
    <div className="corner-editor-footer"><span>Presets</span><button className="breakpoint-chip" onClick={() => setPreset(0)}>{mode === 'cut' ? 'None' : 'Square'}</button><button className="breakpoint-chip" onClick={() => setPreset(mode === 'cut' ? 12 : 12)}>12</button><button className="breakpoint-chip" onClick={() => setPreset(mode === 'cut' ? 24 : 24)}>24</button><button className="breakpoint-chip" onClick={() => setPreset(Math.floor(Math.min(element.width, element.height) / 2))}>{mode === 'cut' ? 'Max chamfer' : 'Pill'}</button></div>
  </section></div>
}
