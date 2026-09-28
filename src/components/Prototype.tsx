import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import type { DesignElement, Interaction, Page, Project } from '../lib/model'
import { computeLayout } from '../lib/layout'
import { containsRect, isDescendant, type Rect } from '../lib/geometry'
import { ShapeVisual, shapeClipPath, shapeUsesRoundCorners } from '../lib/shapes'
import { cutClipPath, zeroCorners } from '../lib/corner-values'
import { Icon } from './Icon'

export type FormStatus = 'idle' | 'loading' | 'success' | 'error'

export interface PrototypeProps {
  page?: Page
  document?: Project
  project?: Project
  width?: number
  height?: number
  reducedMotion?: boolean
  previewState?: Record<string, boolean>
  className?: string
  style?: CSSProperties
  onNavigate?: (pageId: string, interaction?: Interaction) => void
  onPreviewNavigate?: (pageId: string, interaction?: Interaction) => void
  onExternal?: (url: string, interaction?: Interaction) => void
  onStateChange?: (elementId: string, state: string | boolean) => void
  onFormState?: (elementId: string, state: FormStatus) => void
  /** Optional host observation hook. The callback is invoked once per saved action. */
  onElementAction?: (element: DesignElement, interaction?: Interaction) => void
}

type PrototypeFields = {
  textColor?: string
  imageFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'
  imagePosition?: string
  required?: boolean
  inputType?: string
  value?: string
  placeholder?: string
  href?: string
  content?: string
  body?: string
  open?: boolean
  options?: unknown[]
  panels?: unknown[]
  activeIndex?: number
  activeTab?: string
  animation?: { x?: number; y?: number; scale?: number; opacity?: number }
  [key: string]: unknown
}
type RuntimeElement = DesignElement & PrototypeFields
type AnimationState = { token: number; interaction: Interaction }
type TabOption = { id: string; label: string; panelId?: string; content?: string; interaction?: Interaction }

const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const fields = (element: DesignElement): RuntimeElement => element as RuntimeElement
const safeText = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback

/** Accept only safe, useful URLs from imported document data. */
export const sanitizePrototypeUrl = (value: unknown, kind: 'image' | 'external' = 'external'): string | undefined => {
  if (typeof value !== 'string') return undefined
  const url = value.trim()
  if (!url || /^(?:javascript|vbscript|file|about|data:text\/html):/i.test(url)) return undefined
  if (kind === 'image') {
    if (/^data:image\/svg\+xml;base64,/i.test(url)) {
      try {
        const decoded = typeof atob === 'function' ? atob(url.slice(url.indexOf(',') + 1)) : ''
        return /<script\b|\bon[a-z]+\s*=|javascript\s*:/i.test(decoded) ? undefined : url
      } catch { return undefined }
    }
    if (/^data:image\/svg\+xml,/i.test(url)) {
      try {
        const decoded = decodeURIComponent(url.slice(url.indexOf(',') + 1))
        return /<script\b|\bon[a-z]+\s*=|javascript\s*:/i.test(decoded) ? undefined : url
      } catch { return undefined }
    }
    if (/^(?:data:image\/(?:png|jpe?g|gif|webp);base64,|blob:|https?:\/\/|(?:\.\.?\/|\/)[^\s]+$)/i.test(url)) return url
    return undefined
  }
  return /^(?:https?:|mailto:|tel:|(?:\.\.?\/|\/)[^\s]+$)/i.test(url) ? url : undefined
}

export const sanitizePrototypeColor = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback
  const color = value.trim()
  return /^(?:#[0-9a-f]{3,8}|transparent|currentcolor|[a-z]{1,24}|rgba?\([^;{}]+\)|hsla?\([^;{}]+\))$/i.test(color) ? color : fallback
}

const safeFont = (value: unknown): string | undefined => typeof value === 'string' ? value.replace(/["'<>\\{};]/g, '').trim().slice(0, 120) || undefined : undefined
const safeEasing = (value: unknown): string => typeof value === 'string' && /^(?:linear|ease(?:-in|-out|-in-out)?|step-(?:start|end)|steps\([^;{}]+\)|cubic-bezier\([^;{}]+\))$/i.test(value.trim()) ? value.trim() : 'ease-out'
const getActions = (element: DesignElement, trigger: Interaction['trigger']): Interaction[] => element.interactions.filter((interaction) => interaction.trigger === trigger)
const pageMap = (page: Page): Map<string, DesignElement> => new Map(page.elements.map((element) => [element.id, element]))
const isDescendantInPage = (page: Page, id: string, ancestorId: string): boolean => isDescendant(id, ancestorId, page)

const descendants = (page: Page, parentId: string): DesignElement[] => page.elements.filter((element) => element.id === parentId || isDescendantInPage(page, element.id, parentId))

const isVisibleInTree = (element: DesignElement, page: Page, visibility: Record<string, boolean>, previewState: Record<string, boolean>, tabStates: Record<string, string> = {}, accordionStates: Record<string, boolean> = {}, seen = new Set<string>()): boolean => {
  if (seen.has(element.id)) return true
  if (previewState[element.id] === false || visibility[element.id] === false) return false
  // An explicit runtime `true` is allowed to reveal a saved hidden layer;
  // hidden ancestors still gate every descendant.
  if ((element.visible === false || (element.type === 'modal' && fields(element).open === false)) && visibility[element.id] !== true) return false
  if (!element.parentId) return true
  const parent = pageMap(page).get(element.parentId)
  if (parent?.type === 'tabs') {
    const options = tabOptions(parent)
    const selected = tabStates[parent.id] ?? fields(parent).activeTab ?? options[Math.max(0, Math.min(options.length - 1, finite(fields(parent).activeIndex, 0)))].id
    const panel = options.find((option) => option.panelId === element.id)
    if (panel && panel.id !== selected) return false
  }
  if (parent?.type === 'accordion' && accordionStates[parent.id] !== true) return false
  return parent ? isVisibleInTree(parent, page, visibility, previewState, tabStates, accordionStates, new Set(seen).add(element.id)) : true
}

const findTarget = (page: Page, interaction: Interaction): DesignElement | undefined => {
  const targetId = interaction.targetId ?? (interaction.action === 'set-state' || interaction.action === 'toggle-visibility' || interaction.action === 'scroll' ? interaction.value : undefined)
  return targetId ? pageMap(page).get(targetId) : undefined
}

const reducedMotionFromEnvironment = (requested?: boolean): boolean => requested === true || (requested === undefined && typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)

const interactionHas = (element: DesignElement, action: Interaction['action']): boolean => element.interactions.some((interaction) => interaction.action === action)

function tabOptions(element: DesignElement): TabOption[] {
  const raw = fields(element).options
  if (Array.isArray(raw) && raw.length) return raw.map((value, index) => {
    if (typeof value === 'string') return { id: `tab-${index}`, label: value }
    const entry = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const interaction = entry.interaction && typeof entry.interaction === 'object' ? entry.interaction as Interaction : undefined
    return { id: safeText(entry.id, `tab-${index}`), label: safeText(entry.label ?? entry.name, `Tab ${index + 1}`), panelId: typeof entry.panelId === 'string' ? entry.panelId : undefined, content: typeof entry.content === 'string' ? entry.content : undefined, interaction }
  })
  const labels = safeText(element.text).split(/\s{2,}|\s*\|\s*|\r?\n/).map((value) => value.trim()).filter(Boolean)
  return labels.length > 1 ? labels.map((label, index) => ({ id: `tab-${index}`, label })) : [{ id: 'tab-0', label: safeText(element.text, 'Tab') }]
}

const childText = (page: Page, parentId: string): string => page.elements.filter((element) => element.parentId === parentId && element.text).map((element) => element.text).join('\n')

export function Prototype({ page, document: documentProp, project, width, height, reducedMotion, previewState = {}, className = '', style, onNavigate, onPreviewNavigate, onExternal, onStateChange, onFormState, onElementAction }: PrototypeProps) {
  const projectDocument = documentProp ?? project
  const initialPage = page ?? projectDocument?.pages.find((candidate) => candidate.id === projectDocument.activePageId) ?? projectDocument?.pages[0]
  const [activePageId, setActivePageId] = useState(initialPage?.id ?? '')
  const activePage = projectDocument?.pages.find((candidate) => candidate.id === activePageId) ?? page ?? initialPage
  const [visibility, setVisibility] = useState<Record<string, boolean>>({})
  const [states, setStates] = useState<Record<string, string | boolean>>({})
  const [tabStates, setTabStates] = useState<Record<string, string>>({})
  const [accordionStates, setAccordionStates] = useState<Record<string, boolean>>({})
  const [animations, setAnimations] = useState<Record<string, AnimationState>>({})
  const [formStatuses, setFormStatuses] = useState<Record<string, FormStatus>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const modalRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const timers = useRef<number[]>([])
  const firedScroll = useRef(new Set<string>())
  const loadedPages = useRef(new Set<string>())
  const callbacks = useRef({ onNavigate, onPreviewNavigate, onExternal, onStateChange, onFormState, onElementAction })
  callbacks.current = { onNavigate, onPreviewNavigate, onExternal, onStateChange, onFormState, onElementAction }
  const motionReduced = reducedMotionFromEnvironment(reducedMotion)
  const viewportWidth = Math.max(1, finite(width, activePage?.width ?? 960))
  const layout = useMemo(() => activePage ? computeLayout(activePage, { width: viewportWidth, height }) : null, [activePage, height, viewportWidth])

  useEffect(() => { if (initialPage?.id) setActivePageId(initialPage.id) }, [initialPage?.id])
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), [])
  useEffect(() => { firedScroll.current.clear() }, [activePage?.id])

  const setStatus = (id: string, status: FormStatus) => { setFormStatuses((current) => ({ ...current, [id]: status })); callbacks.current.onFormState?.(id, status) }
  const findFormFor = (element: DesignElement): DesignElement | undefined => {
    if (!activePage || !layout) return undefined
    const parentForm = activePage.elements.find((candidate) => candidate.type === 'form' && isDescendantInPage(activePage, element.id, candidate.id))
    if (parentForm) return parentForm
    const rect = layout.rects[element.id]
    if (!rect) return undefined
    return activePage.elements.filter((candidate) => candidate.type === 'form' && layout.rects[candidate.id] && containsRect(layout.rects[candidate.id], rect, .01)).sort((a, b) => (layout.rects[a.id].width * layout.rects[a.id].height) - (layout.rects[b.id].width * layout.rects[b.id].height))[0]
  }
  const formControls = (form: DesignElement): DesignElement[] => activePage?.elements.filter((candidate) => candidate.type === 'input' && findFormFor(candidate)?.id === form.id) ?? []
  const formError = (element: DesignElement): string | undefined => validationErrors[element.id]

  const targetNode = (id?: string): HTMLElement | null => id && rootRef.current ? Array.from(rootRef.current.querySelectorAll<HTMLElement>('[data-prototype-id]')).find((node) => node.dataset.prototypeId === id) ?? null : null

  const triggerAnimation = (element: DesignElement, interaction: Interaction) => {
    if (motionReduced) return
    setAnimations((current) => ({ ...current, [element.id]: { token: (current[element.id]?.token ?? 0) + 1, interaction } }))
    const duration = Math.max(1, finite(interaction.duration, 500)); const delay = Math.max(0, finite(interaction.delay))
    const infinite = interaction.repeat !== undefined && interaction.repeat < 0
    if (!infinite) {
      const repeats = interaction.repeat === undefined ? 1 : Math.max(1, Math.floor(interaction.repeat))
      const timer = window.setTimeout(() => setAnimations((current) => { const next = { ...current }; delete next[element.id]; return next }), delay + duration * repeats + 60)
      timers.current.push(timer)
    }
  }

  const submitForm = (form: DesignElement) => {
    const controls = formControls(form)
    const invalid = controls.map((control) => {
      const value = values[control.id] ?? fields(control).value ?? ''
      if (fields(control).required && !value.trim()) return { control, message: `${control.name || 'This field'} is required.` }
      if (String(fields(control).inputType ?? '').toLowerCase() === 'email' && value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return { control, message: `${control.name || 'Email'} must be a valid email address.` }
      return undefined
    }).find((item): item is { control: DesignElement; message: string } => Boolean(item))
    if (invalid) {
      setValidationErrors((current) => ({ ...current, [form.id]: invalid.message, [invalid.control.id]: invalid.message })); setStatus(form.id, 'error')
      targetNode(invalid.control.id)?.focus(); return
    }
    setValidationErrors((current) => { const next = { ...current }; delete next[form.id]; controls.forEach((control) => delete next[control.id]); return next })
    setStatus(form.id, 'loading')
    const interaction = getActions(form, 'click').find((candidate) => candidate.action === 'submit-form') ?? form.interactions.find((candidate) => candidate.action === 'submit-form')
    const error = /^(?:error|fail)/i.test(safeText(interaction?.value))
    const timer = window.setTimeout(() => setStatus(form.id, error ? 'error' : 'success'), motionReduced ? 0 : Math.max(50, finite(interaction?.delay, 350)))
    timers.current.push(timer)
  }

  const executeInteraction = (element: DesignElement, interaction: Interaction, event?: Event) => {
    if (!activePage) return
    callbacks.current.onElementAction?.(element, interaction)
    const target = findTarget(activePage, interaction)
    switch (interaction.action) {
      case 'navigate': {
        const pageId = interaction.pageId ?? interaction.targetId ?? interaction.value
        const validPage = Boolean(pageId && projectDocument?.pages.some((candidate) => candidate.id === pageId))
        if (validPage && pageId) { setActivePageId(pageId); (callbacks.current.onNavigate ?? callbacks.current.onPreviewNavigate)?.(pageId, interaction) }
        break
      }
      case 'external': {
        const url = sanitizePrototypeUrl(interaction.value ?? interaction.targetId, 'external'); if (!url) break
        if (callbacks.current.onExternal) callbacks.current.onExternal(url, interaction)
        else if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
        break
      }
      case 'scroll': targetNode(target?.id ?? interaction.value)?.scrollIntoView?.({ behavior: motionReduced ? 'auto' : 'smooth', block: 'start' }); break
      case 'toggle-visibility': {
        const targetId = target?.id ?? element.id
        const currentlyVisible = visibility[targetId] ?? (target ? target.visible !== false && !(target.type === 'modal' && fields(target).open === false) : true)
        const next = !currentlyVisible
        setVisibility((current) => ({ ...current, [targetId]: next })); callbacks.current.onStateChange?.(targetId, next); break
      }
      case 'set-state': {
        const targetId = target?.id ?? element.id; const state = interaction.value ?? 'active'
        setStates((current) => ({ ...current, [targetId]: state })); callbacks.current.onStateChange?.(targetId, state); break
      }
      case 'submit-form': { const form = element.type === 'form' ? element : findFormFor(element); if (form) submitForm(form); break }
      case 'animate': triggerAnimation(target ?? element, interaction); break
    }
    event?.stopPropagation()
  }
  const runInteractions = (element: DesignElement, trigger: Interaction['trigger'], event?: Event) => getActions(element, trigger).forEach((interaction) => executeInteraction(element, interaction, event))

  useEffect(() => {
    if (!activePage) return
    if (loadedPages.current.has(activePage.id)) return
    loadedPages.current.add(activePage.id)
    activePage.elements.forEach((element) => getActions(element, 'page-load').forEach((interaction) => executeInteraction(element, interaction)))
    // Intentional trigger-on-page-change effect; callbacks are held in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id])

  useEffect(() => {
    if (!activePage || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      const id = (entry.target as HTMLElement).dataset.prototypeId; if (!id || firedScroll.current.has(id)) return
      const element = activePage.elements.find((candidate) => candidate.id === id); if (!element) return
      firedScroll.current.add(id); runInteractions(element, 'scroll-into-view')
    }), { threshold: .12 })
    rootRef.current?.querySelectorAll<HTMLElement>('[data-prototype-id]').forEach((node) => observer.observe(node))
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id, layout])

  useEffect(() => {
    if (!activePage) return
    Object.entries(modalRefs.current).forEach(([id, node]) => { const element = activePage.elements.find((candidate) => candidate.id === id); if (node && element && isVisibleInTree(element, activePage, visibility, previewState, tabStates, accordionStates)) node.focus() })
  }, [activePage?.id, visibility, previewState])

  const modalKeyDown = (event: KeyboardEvent, element: DesignElement) => {
    if (event.key === 'Escape') { setVisibility((current) => ({ ...current, [element.id]: false })); event.stopPropagation(); return }
    if (event.key !== 'Tab') return
    const node = modalRefs.current[element.id]; if (!node) return
    const focusable = Array.from(node.querySelectorAll<HTMLElement>('button,a,input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter((item) => !item.hasAttribute('disabled'))
    if (!focusable.length) return
    const first = focusable[0]; const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const setInputValue = (element: DesignElement, value: string) => { setValues((current) => ({ ...current, [element.id]: value })); setValidationErrors((current) => { const next = { ...current }; delete next[element.id]; return next }) }

  const renderBody = (element: DesignElement): ReactNode => {
    if (!activePage) return null
    const runtime = fields(element); const text = safeText(runtime.text ?? runtime.content); const image = sanitizePrototypeUrl(runtime.src, 'image'); const status = formStatuses[element.id] ?? 'idle'; const form = findFormFor(element); const formId = form ? `prototype-form-${form.id}` : undefined
    if (element.type === 'image' && image) return <img src={image} alt={safeText(element.alt)} draggable={false} style={{ width: '100%', height: '100%', objectFit: runtime.imageFit ?? 'cover', objectPosition: runtime.imagePosition ?? 'center', display: 'block', pointerEvents: 'none' }} />
    if (element.type === 'icon' && image) return <img src={image} alt={safeText(element.alt ?? element.iconName, 'Icon')} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: runtime.imagePosition ?? 'center', padding: 12, display: 'block', pointerEvents: 'none' }} />
    if (element.type === 'icon') return <Icon name="icon" size={Math.max(18, Math.min(56, finite(element.width, 48) * .35))} />
    if (element.type === 'input') return <><input id={`prototype-input-${element.id}`} form={formId} type={runtime.inputType ?? 'text'} aria-label={element.name} aria-invalid={Boolean(formError(element))} aria-describedby={formError(element) ? `prototype-error-${element.id}` : undefined} placeholder={runtime.placeholder ?? text} value={values[element.id] ?? runtime.value ?? ''} required={Boolean(runtime.required)} onChange={(event) => setInputValue(element, event.target.value)} onFocus={(event) => runInteractions(element, 'focus', event.nativeEvent)} onClick={(event) => runInteractions(element, 'click', event.nativeEvent)} style={{ width: '100%', height: '100%', border: 0, background: 'transparent', color: 'inherit', outline: 'none', padding: 12, font: 'inherit' }} />{formError(element) && <span id={`prototype-error-${element.id}`} role="alert" style={{ position: 'absolute', top: '100%', left: 0, color: '#b42318', fontSize: 12 }}>{formError(element)}</span>}</>
    if (element.type === 'button') {
      const submits = interactionHas(element, 'submit-form') || Boolean(form)
      const click = (event: ReactMouseEvent<HTMLButtonElement>) => {
        // Native form submission invokes the owning form exactly once. Run
        // other button actions here, but leave submit-form to onSubmit.
        if (submits) getActions(element, 'click').filter((interaction) => interaction.action !== 'submit-form').forEach((interaction) => executeInteraction(element, interaction, event.nativeEvent))
        else runInteractions(element, 'click', event.nativeEvent)
      }
      return <button type={submits ? 'submit' : 'button'} form={submits ? formId : undefined} onClick={click} style={{ width: '100%', height: '100%', border: 0, background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>{text}</button>
    }
    if (element.type === 'form') return <form id={`prototype-form-${element.id}`} noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); const submitActions = getActions(element, 'click').filter((interaction) => interaction.action === 'submit-form'); if (submitActions.length) submitActions.forEach((interaction) => executeInteraction(element, interaction, event.nativeEvent)); else submitForm(element) }} style={{ width: '100%', height: '100%' }}><span>{text}</span>{status !== 'idle' && <output aria-live="polite" data-form-status={status} style={{ display: 'block' }}>{status === 'loading' ? 'Submitting…' : status === 'success' ? 'Submitted.' : 'Check the form and try again.'}</output>}{validationErrors[element.id] && <output id={`prototype-error-${element.id}`} role="alert" style={{ display: 'block', color: '#b42318' }}>{validationErrors[element.id]}</output>}</form>
    if (element.type === 'tabs') {
      const options = tabOptions(element); const active = tabStates[element.id] ?? runtime.activeTab ?? options[Math.max(0, Math.min(options.length - 1, finite(runtime.activeIndex, 0)))].id; const selected = options.find((option) => option.id === active) ?? options[0]
      return <div role="tablist" aria-label={element.name} style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', height: '100%' }}><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{options.map((option) => <button key={option.id} type="button" role="tab" aria-selected={option.id === selected.id} tabIndex={option.id === selected.id ? 0 : -1} onClick={(event) => { setTabStates((current) => ({ ...current, [element.id]: option.id })); if (option.interaction) executeInteraction(element, option.interaction, event.nativeEvent); else runInteractions(element, 'click', event.nativeEvent) }} style={{ border: 0, background: option.id === selected.id ? 'currentColor' : 'transparent', color: option.id === selected.id ? sanitizePrototypeColor(element.fill, '#111') : 'inherit', padding: '6px 10px', cursor: 'pointer' }}>{option.label}</button>)}</div><div role="tabpanel" aria-label={selected.label}>{selected.content ?? safeText(runtime.panels?.find((panel) => typeof panel === 'object' && panel && (panel as Record<string, unknown>).id === selected.id && typeof (panel as Record<string, unknown>).content === 'string' ? (panel as Record<string, unknown>).content : undefined) ?? '')}</div></div>
    }
    if (element.type === 'accordion') {
      const open = accordionStates[element.id] ?? states[element.id] === 'open'; const body = runtime.body ?? runtime.content ?? childText(activePage, element.id)
      return <details open={open} onToggle={(event) => { const value = (event.currentTarget as HTMLDetailsElement).open; setAccordionStates((current) => ({ ...current, [element.id]: value })) }} style={{ width: '100%', height: '100%' }}><summary>{text || element.name}</summary><div>{safeText(body)}</div></details>
    }
    if (element.type === 'modal') return <div role="dialog" aria-label={element.name} aria-modal="true" tabIndex={-1} style={{ width: '100%', height: '100%' }}><button type="button" aria-label="Close" onClick={(event) => { event.stopPropagation(); setVisibility((current) => ({ ...current, [element.id]: false })) }}>×</button><div>{text}</div></div>
    if (element.type === 'nav') return <nav aria-label={element.name}>{text}</nav>
    if (element.type === 'line' || element.curve) return null
    return text || (['circle', 'rect', 'frame', 'image'].includes(element.type) ? '' : element.type.toUpperCase())
  }

  if (!activePage || !layout) return null
  const visibleElements = activePage.elements.filter((element) => isVisibleInTree(element, activePage, visibility, previewState, tabStates, accordionStates))
  const keyframes = visibleElements.map((element) => {
    const animation = fields(element).animation ?? (animations[element.id] || interactionHas(element, 'animate') ? { x: 0, y: 6, scale: .98, opacity: 0 } : undefined); if (!animation) return ''
    const name = `layerMotion_${element.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`; const target = animations[element.id]?.interaction; const from = { x: finite(animation.x), y: finite(animation.y), scale: finite(animation.scale, 1), opacity: clamp(finite(animation.opacity, 0), 0, 1) }
    return `@keyframes ${name}{from{opacity:${from.opacity};transform:translate(${from.x}px,${from.y}px) scale(${from.scale})}to{opacity:1;transform:translate(0,0) scale(1)}}${target ? `[data-prototype-id="${element.id.replace(/"/g, '')}"]{animation-name:${name};animation-duration:${Math.max(1, finite(target.duration, 500))}ms;animation-delay:${Math.max(0, finite(target.delay))}ms;animation-timing-function:${safeEasing(target.easing)};animation-iteration-count:${target.repeat !== undefined && target.repeat < 0 ? 'infinite' : target.repeat === undefined ? 1 : Math.max(1, Math.floor(target.repeat))}}` : ''}`
  }).join('')
  const renderElement = (element: DesignElement, parent?: DesignElement): ReactNode => {
      const resolved = layout.elements[element.id]; if (!resolved) return null
       const shape = element.type === 'rect' || element.type === 'frame' ? element.shape ?? 'rectangle' : undefined; const shapeClip = shapeClipPath(shape); const runtime = fields(element); const animation = animations[element.id]; const fill = sanitizePrototypeColor(element.fill, 'transparent'); const stroke = sanitizePrototypeColor(element.stroke, 'transparent'); const textColor = sanitizePrototypeColor(runtime.textColor, element.type === 'button' ? '#101010' : '#f4f1e8'); const corners = element.type === 'circle' || shape === 'round' ? '50%' : shape === 'pill' ? '999px' : `${finite(element.corners?.topLeft)}px ${finite(element.corners?.topRight)}px ${finite(element.corners?.bottomRight)}px ${finite(element.corners?.bottomLeft)}px`; const modal = element.type === 'modal';
       const baseStyle: CSSProperties = { position: 'absolute', left: resolved.x, top: resolved.y, width: resolved.width, height: resolved.height, display: 'flex', alignItems: element.type === 'button' ? 'center' : 'flex-start', justifyContent: element.type === 'button' ? 'center' : 'flex-start', overflow: element.layout?.overflow === 'hidden' || Boolean(shapeClip) || shapeUsesRoundCorners(shape) ? 'hidden' : 'visible', opacity: clamp(finite(element.opacity, 1), 0, 1), background: element.type === 'line' || element.curve || fill === 'transparent' ? undefined : fill, border: stroke === 'transparent' ? undefined : `${Math.max(0, finite(element.strokeWidth, 1))}px solid ${stroke}`, borderRadius: corners, clipPath: shapeClip, color: textColor, fontFamily: safeFont(element.fontFamily), fontSize: finite(element.fontSize, 16), fontWeight: finite(element.fontWeight, 500), lineHeight: finite(element.lineHeight, 1.35), letterSpacing: finite(element.letterSpacing), textAlign: element.textAlign, whiteSpace: element.wrap === 'fixed' ? 'pre-wrap' : 'nowrap', zIndex: activePage.elements.indexOf(element) + 1, cursor: element.type === 'button' || getActions(element, 'click').length > 0 ? 'pointer' : undefined }
       const parentRect = parent ? layout.rects[parent.id] : undefined
       baseStyle.left = resolved.x - (parentRect?.x ?? 0)
       baseStyle.top = resolved.y - (parentRect?.y ?? 0)
       baseStyle.transform = `rotate(${finite(element.rotation)}deg)`
       baseStyle.boxSizing = 'border-box'
       const cuts = { ...(element.cutCorners ?? zeroCorners()) }
       for (const key of Object.keys(cuts) as Array<keyof typeof cuts>) cuts[key] = clamp(finite(cuts[key]), 0, Math.min(resolved.width, resolved.height) / 2)
       if (!shapeClip && Object.values(cuts).some((value) => value > 0)) baseStyle.clipPath = cutClipPath(cuts)
       const hasChildren = visibleElements.some((child) => child.parentId === element.id)
       const rounded = element.type === 'circle' || Object.values(element.corners ?? {}).some((value) => value > 0)
       if (element.type === 'image' || element.type === 'icon' || (hasChildren && rounded)) baseStyle.overflow = 'hidden'
       if (element.layout?.overflow === 'scroll') baseStyle.overflow = 'auto'
      if (element.shadow) baseStyle.boxShadow = `${finite(element.shadow.x)}px ${finite(element.shadow.y)}px ${finite(element.shadow.blur)}px ${finite(element.shadow.spread)}px ${sanitizePrototypeColor(element.shadow.color, '#000')}${Math.round(clamp(finite(element.shadow.opacity), 0, 1) * 255).toString(16).padStart(2, '0')}`
      if (element.pattern?.enabled) { const color = sanitizePrototypeColor(element.pattern.color, 'rgba(255,255,255,.18)'); const spacing = Math.max(1, finite(element.pattern.spacing, 16)); baseStyle.backgroundImage = element.pattern.type === 'dots' ? `radial-gradient(${color} 1px, transparent 1px)` : element.pattern.type === 'grid' ? `linear-gradient(${color} 1px, transparent 1px),linear-gradient(90deg,${color} 1px,transparent 1px)` : `repeating-linear-gradient(${finite(element.pattern.rotation)}deg,${color} 0,${color} 1px,transparent 1px,transparent ${spacing}px)`; baseStyle.backgroundSize = `${spacing}px ${spacing}px` }
      if (animation && motionReduced) baseStyle.animation = 'none'
      const vector = element.type === 'line' || element.curve ? <svg aria-hidden="true" viewBox={`0 0 ${Math.max(1, resolved.width)} ${Math.max(1, resolved.height)}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}><path d={element.curve ? `M 0 0 C ${finite(element.curve.x1)} ${finite(element.curve.y1)}, ${finite(element.curve.x2)} ${finite(element.curve.y2)}, ${resolved.width} ${resolved.height}` : `M 0 ${resolved.height / 2} L ${resolved.width} ${resolved.height / 2}`} fill="none" stroke={stroke === 'transparent' ? fill : stroke} strokeWidth={Math.max(.5, finite(element.strokeWidth, 1))} vectorEffect="non-scaling-stroke" /></svg> : null
      const form = findFormFor(element); const formId = form ? `prototype-form-${form.id}` : undefined
      const svgShape = ['rect', 'frame', 'circle'].includes(element.type) && !element.curve
      const contentStyle: CSSProperties = { ...baseStyle, position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity: undefined, transform: undefined, animation: undefined, zIndex: undefined, ...(svgShape ? { background: undefined, border: undefined } : {}) }
      Object.assign(baseStyle, { overflow: 'visible', clipPath: undefined, borderRadius: undefined, background: undefined, backgroundImage: undefined, border: undefined, boxShadow: undefined })
      return <div key={element.id} ref={modal ? (node) => { modalRefs.current[element.id] = node } : undefined} id={`prototype-${element.id}`} data-prototype-id={element.id} data-state={String(states[element.id] ?? element.state ?? 'default')} className={`prototype-element prototype-${element.type}`} style={baseStyle} tabIndex={modal ? -1 : element.type === 'input' || element.type === 'button' ? undefined : getActions(element, 'click').length > 0 || getActions(element, 'focus').length > 0 ? 0 : undefined} onClick={(event) => { if (element.type !== 'button' && element.type !== 'input') runInteractions(element, 'click', event.nativeEvent) }} onMouseEnter={(event) => runInteractions(element, 'hover', event.nativeEvent)} onFocus={(event) => runInteractions(element, 'focus', event.nativeEvent)} onKeyDown={(event) => { if (modal) modalKeyDown(event, element); if ((event.key === 'Enter' || event.key === ' ') && element.type !== 'input') { event.preventDefault(); runInteractions(element, 'click', event.nativeEvent) } }}>
        {svgShape && <ShapeVisual element={{ ...element, fill, stroke }} width={resolved.width} height={resolved.height} />}
        <div className="prototype-content" style={contentStyle}>{vector}{renderBody(element)}{formError(element) && element.type !== 'input' && <span role="alert" style={{ color: '#b42318' }}>{formError(element)}</span>}{modal && <span aria-hidden="true" data-form-owner={formId} />}{visibleElements.filter((child) => child.parentId === element.id).map((child) => renderElement(child, element))}</div>
      </div>
  }
  return <div ref={rootRef} className={`prototype-root ${className}`.trim()} style={{ position: 'relative', width: viewportWidth, minHeight: layout.height, overflow: 'hidden', background: sanitizePrototypeColor(activePage.background, '#fff'), color: '#111', ...style }} onKeyDown={(event) => { if (event.key === 'Escape') activePage.elements.filter((element) => element.type === 'modal').forEach((element) => setVisibility((current) => ({ ...current, [element.id]: false }))) }}>
    {keyframes && <style>{keyframes}</style>}
    {visibleElements.filter((element) => !element.parentId || !activePage.elements.some((parent) => parent.id === element.parentId)).map((element) => renderElement(element))}
  </div>
}

export default Prototype
