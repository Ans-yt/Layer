import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from './Icon'

export interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
  description?: string
}

interface SelectFieldProps {
  value: string | number
  options: SelectOption[]
  onChange: (value: string) => void
  ariaLabel?: string
  disabled?: boolean
  className?: string
  placeholder?: string
}

/**
 * A small, keyboard-friendly select that stays inside Layer's visual system.
 * Native option popovers inherit the browser/OS theme and can flash white;
 * this menu is deliberately rendered as ordinary Layer controls instead.
 */
export function SelectField({ value, options, onChange, ariaLabel, disabled = false, className = '', placeholder = 'Choose…' }: SelectFieldProps) {
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const normalized = String(value)
  const selected = options.find((option) => option.value === normalized)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === normalized)))

  useEffect(() => {
    const selectedIndex = options.findIndex((option) => option.value === normalized)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
  }, [normalized, options])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const choose = (option: SelectOption) => {
    if (disabled || option.disabled) return
    onChange(option.value)
    setOpen(false)
    trigger.current?.focus()
  }

  const moveActive = (direction: 1 | -1, wrap = true) => {
    if (!options.length) return
    let index = activeIndex
    for (let step = 0; step < options.length; step += 1) {
      index += direction
      if (wrap) index = (index + options.length) % options.length
      else if (index < 0 || index >= options.length) return
      if (!options[index]?.disabled) {
        setActiveIndex(index)
        return
      }
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown') { event.preventDefault(); if (!open) setOpen(true); else moveActive(1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); if (!open) setOpen(true); else moveActive(-1); return }
    if (event.key === 'Home') { event.preventDefault(); setActiveIndex(options.findIndex((option) => !option.disabled)); return }
    if (event.key === 'End') { event.preventDefault(); setActiveIndex([...options].reverse().findIndex((option) => !option.disabled) < 0 ? activeIndex : options.length - 1); return }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) { setOpen(true); return }
      const option = options[activeIndex]
      if (option) choose(option)
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  const label = selected?.label ?? placeholder
  return <div ref={root} className={`select-field ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()}>
    <button ref={trigger} type="button" role="combobox" className="select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && options[activeIndex] ? `${listId}-${options[activeIndex].value}` : undefined} disabled={disabled} onClick={() => setOpen((current) => !current)} onKeyDown={handleKeyDown}>
      <span className="select-trigger-label">{label}</span><Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
    </button>
    {open && <div className="select-menu" id={listId} role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <button key={option.value} id={`${listId}-${option.value}`} type="button" role="option" aria-selected={option.value === normalized} className={`select-option ${index === activeIndex ? 'is-active' : ''} ${option.value === normalized ? 'is-selected' : ''}`} disabled={option.disabled} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}>
        <span className="select-option-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>{option.value === normalized && <Icon name="check" size={13} />}
      </button>)}
    </div>}
  </div>
}

export function selectOptions(values: Array<[string, string]>): SelectOption[] {
  return values.map(([value, label]) => ({ value, label }))
}
