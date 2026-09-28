import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './tooltip.css'

type Side = 'top' | 'bottom' | 'left' | 'right'
interface Tip { anchor: HTMLElement; text: string; shortcut?: string; side: Side }
type Box = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>

export function placeTooltip(anchor: Box, size: { width: number; height: number }, viewport: { width: number; height: number }, preferred: Side) {
  const gap = 8
  const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
  const room = { top: anchor.top, bottom: viewport.height - anchor.bottom, left: anchor.left, right: viewport.width - anchor.right }
  const required = (side: Side) => (side === 'top' || side === 'bottom' ? size.height : size.width) + gap * 2
  const side = room[preferred] < required(preferred) && room[opposite[preferred]] > room[preferred] ? opposite[preferred] : preferred
  let left = anchor.left + (anchor.width - size.width) / 2
  let top = anchor.top + (anchor.height - size.height) / 2
  if (side === 'top') top = anchor.top - size.height - gap
  if (side === 'bottom') top = anchor.bottom + gap
  if (side === 'left') left = anchor.left - size.width - gap
  if (side === 'right') left = anchor.right + gap
  return { left: Math.max(gap, Math.min(left, viewport.width - size.width - gap)), top: Math.max(gap, Math.min(top, viewport.height - size.height - gap)), side }
}

/** One portal for editor hints: never changes the anchor's layout or gets
 * clipped by scrolling panels. Labels are plain text, not document HTML. */
export function TooltipLayer() {
  const id = useId()
  const [tip, setTip] = useState<Tip | null>(null)
  const [position, setPosition] = useState<ReturnType<typeof placeTooltip> | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current: HTMLElement | null = null
    let showTimer: ReturnType<typeof setTimeout> | undefined
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    let keyboardFocus: HTMLElement | null = null
    let keyboardInput = false
    const cancelTimers = () => { clearTimeout(showTimer); clearTimeout(hideTimer) }
    const close = () => { cancelTimers(); current = null; keyboardFocus = null; setTip(null); setPosition(null) }
    const anchorFor = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('.layer-app [data-tooltip]') : null
    const inBubble = (target: EventTarget | null) => target instanceof Node && Boolean(bubbleRef.current?.contains(target))
    const valid = (anchor: HTMLElement) => anchor.isConnected && !anchor.closest('[hidden], .is-collapsed')

    const schedule = (anchor: HTMLElement, immediate = false) => {
      clearTimeout(hideTimer)
      if (current === anchor && !immediate) return
      clearTimeout(showTimer)
      current = anchor
      setTip(null)
      setPosition(null)
      const show = () => {
        if (current !== anchor || !valid(anchor)) return
        const text = anchor.dataset.tooltip?.trim()
        if (!text) return
        const requested = anchor.dataset.tooltipSide
        const side: Side = requested === 'left' || requested === 'right' || requested === 'top' || requested === 'bottom' ? requested : anchor.closest('.left-rail') ? 'right' : 'top'
        setTip({ anchor, text, side, shortcut: anchor.dataset.tooltipShortcut })
      }
      if (immediate) show()
      else showTimer = setTimeout(show, 350)
    }

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons) return
      if (inBubble(event.target)) { clearTimeout(hideTimer); return }
      const anchor = anchorFor(event.target)
      if (anchor) schedule(anchor)
    }
    const onOut = (event: PointerEvent) => {
      if (!current || keyboardFocus === current) return
      if (anchorFor(event.relatedTarget) === current || inBubble(event.relatedTarget)) return
      if (anchorFor(event.target) !== current && !inBubble(event.target)) return
      clearTimeout(showTimer)
      hideTimer = setTimeout(close, 120)
    }
    const onFocus = (event: FocusEvent) => {
      const anchor = anchorFor(event.target)
      if (anchor && keyboardInput) { keyboardFocus = anchor; schedule(anchor, true) }
    }
    const onBlur = (event: FocusEvent) => { if (anchorFor(event.target) === current) close() }
    const onPress = () => { keyboardInput = false; close() }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') keyboardInput = true
      if (event.key === 'Escape' && current) {
        close()
        // Dismiss the hint, not the canvas selection or an underlying dialog.
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const observer = new MutationObserver(() => { if (current && !valid(current)) close() })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] })
    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('pointerout', onOut, true)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    document.addEventListener('pointerdown', onPress, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      cancelTimers(); observer.disconnect()
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('pointerout', onOut, true)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [])

  useLayoutEffect(() => {
    if (!tip || !bubbleRef.current) return
    const viewport = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight }
    setPosition(placeTooltip(tip.anchor.getBoundingClientRect(), bubbleRef.current.getBoundingClientRect(), viewport, tip.side))
    const describedBy = new Set(tip.anchor.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean))
    describedBy.add(id)
    tip.anchor.setAttribute('aria-describedby', [...describedBy].join(' '))
    return () => {
      const remaining = tip.anchor.getAttribute('aria-describedby')?.split(/\s+/).filter((value) => value && value !== id) ?? []
      if (remaining.length) tip.anchor.setAttribute('aria-describedby', remaining.join(' '))
      else tip.anchor.removeAttribute('aria-describedby')
    }
  }, [id, tip])

  return tip ? createPortal(<div ref={bubbleRef} id={id} role="tooltip" className="layer-tooltip" data-side={position?.side} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
    <span>{tip.text}</span>{tip.shortcut && <kbd>{tip.shortcut}</kbd>}
  </div>, document.body) : null
}
