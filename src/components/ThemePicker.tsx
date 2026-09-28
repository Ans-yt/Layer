import { useEffect, useRef } from 'react'
import { Icon } from './Icon'
import { THEMES, type ThemeId } from '../lib/themes'
import { ColorPicker } from './ColorPicker'
import './theme.css'

interface ThemePickerProps {
  value: ThemeId
  onChange: (value: ThemeId) => void
  compact?: boolean
}

const moveFocus = (current: HTMLButtonElement, direction: 1 | -1 | 'first' | 'last') => {
  const group = current.closest('[role="radiogroup"]')
  const buttons = group ? [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')] : []
  if (!buttons.length) return
  const index = buttons.indexOf(current)
  const nextIndex = direction === 'first' ? 0 : direction === 'last' ? buttons.length - 1 : (index + direction + buttons.length) % buttons.length
  buttons[nextIndex]?.focus()
}

export function ThemePicker({ value, onChange, compact = false }: ThemePickerProps) {
  return <div className={`theme-picker ${compact ? 'compact' : ''}`} role="radiogroup" aria-label="Editor theme">
    {THEMES.map((theme) => {
      const selected = value === theme.id
      return <button
        key={theme.id}
        type="button"
        className={`theme-card ${selected ? 'active' : ''}`}
        role="radio"
        aria-checked={selected}
        tabIndex={selected ? 0 : -1}
        onClick={() => onChange(theme.id)}
        onKeyDown={(event) => {
          if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'Home' ? 'first' : 'last'
          moveFocus(event.currentTarget, direction)
          const next = document.activeElement
          if (next instanceof HTMLButtonElement && next.dataset.themeId) onChange(next.dataset.themeId as ThemeId)
        }}
        data-theme-id={theme.id}
      >
        <span className="theme-preview" aria-hidden="true">{theme.colors.map((color, index) => <i key={`${theme.id}-${index}`} style={{ background: color }} />)}<b style={{ color: theme.colors[2] }}>Aa</b></span>
        <span className="theme-card-copy"><strong>{theme.name}</strong><small>{theme.description}</small></span>
        {selected && <Icon name="check-circle" size={15} />}
      </button>
    })}
  </div>
}

export function ThemeChooser({ value, onChange, onClose, canvasBackground, onCanvasBackground }: { value: ThemeId; onChange: (value: ThemeId) => void; onClose: () => void; canvasBackground?: string; onCanvasBackground?: (value: string) => void }) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusFirst = () => {
      const first = dialogRef.current?.querySelector<HTMLButtonElement>('[role="radio"]')
      first?.focus({ preventScroll: true })
    }
    const frame = window.requestAnimationFrame(focusFirst)
    const onKeyDown = (event: KeyboardEvent) => {
      if (!dialogRef.current?.contains(event.target as Node)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus({ preventScroll: true })
    }
  }, [])

  return <div className="theme-chooser-backdrop" onPointerDown={() => closeRef.current()}>
    <section ref={dialogRef} className="theme-chooser" role="dialog" aria-modal="true" aria-labelledby="theme-chooser-title" onPointerDown={(event) => event.stopPropagation()}>
      <div className="theme-chooser-heading"><div><span className="panel-kicker">MAKE IT YOURS</span><h2 id="theme-chooser-title">Choose a workspace theme</h2><p>Switch the editor chrome without changing the design you are building.</p></div><button type="button" className="icon-button" onClick={() => closeRef.current()} aria-label="Close theme chooser"><Icon name="close" size={15} /></button></div>
       <ThemePicker value={value} onChange={onChange} />
       {canvasBackground && onCanvasBackground && <div className="theme-canvas-surface"><div><strong>Canvas surface</strong><small>Theme changes stay in the chrome. Pick the artboard background separately.</small></div><ColorPicker label="Canvas background" value={canvasBackground} onChange={onCanvasBackground} /></div>}
      <div className="theme-chooser-footer"><span>Change it later from Connections → Themes.</span><button type="button" className="primary-button" onClick={() => closeRef.current()}>Use {THEMES.find((theme) => theme.id === value)?.name ?? 'theme'} <Icon name="arrow-right" size={14} /></button></div>
    </section>
  </div>
}
