import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import type { PrototypeProps } from './Prototype'
import { Prototype } from './Prototype'
import { Icon } from './Icon'
import { computeLayout } from '../lib/layout'
import type { DesignElement, Interaction, Page, Project } from '../lib/model'
import './preview-experience.css'

export type PreviewPreset = 'desktop' | 'tablet' | 'phone' | 'wide'
export type PreviewFrame = 'none' | 'monitor' | 'tablet' | 'phone'

export const PREVIEW_PRESETS = {
  desktop: { label: 'Desktop', width: 1096, height: 616, frame: 'monitor' },
  tablet: { label: 'Tablet', width: 768, height: 1024, frame: 'tablet' },
  phone: { label: 'Phone', width: 390, height: 844, frame: 'phone' },
  wide: { label: 'Wide', width: 1440, height: 810, frame: 'monitor' },
} as const satisfies Record<PreviewPreset, { label: string; width: number; height: number; frame: PreviewFrame }>

type PreviewCallbacks = Pick<PrototypeProps, 'onExternal' | 'onStateChange' | 'onFormState' | 'onElementAction'>

export interface PreviewExperienceProps extends PreviewCallbacks {
  /** The same structured document used by the editor. It is never mutated by this component. */
  project: Project
  /** Optional starting page. Navigation continues to use the project's pages. */
  page?: Page
  /** The responsive width to pass to Prototype, such as 1096, 768, 390, or 1440. */
  viewportWidth?: number
  /** Optional layout height override passed through to Prototype. */
  viewportHeight?: number
  /** Explicitly choose a device frame. Otherwise the existing width presets are inferred. */
  preset?: PreviewPreset
  /** An explicit value wins over the project preference and system preference. */
  reducedMotion?: boolean
  /** Runtime visibility/state values owned by the host editor, if any. */
  previewState?: Record<string, boolean>
  /** Called by the close affordance or Escape. */
  onExit: () => void
  /** Called when a saved prototype navigation action changes the active page. */
  onNavigate?: (pageId: string, interaction?: Interaction) => void
  /** Backwards-compatible alias for Prototype's preview navigation callback. */
  onPreviewNavigate?: (pageId: string, interaction?: Interaction) => void
  className?: string
  style?: CSSProperties
}

const finite = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** Infer the matching device frame from Layer's existing responsive widths. */
export const resolvePreviewPreset = (width: number): PreviewPreset => {
  const resolved = Math.max(1, finite(width, PREVIEW_PRESETS.desktop.width))
  if (resolved <= PREVIEW_PRESETS.phone.width) return 'phone'
  if (resolved <= PREVIEW_PRESETS.tablet.width) return 'tablet'
  return 'desktop'
}

const FRAME_INSETS: Record<PreviewFrame, { x: number; top: number; bottom: number; stand: number }> = {
  none: { x: 0, top: 0, bottom: 0, stand: 0 },
  monitor: { x: 22, top: 22, bottom: 22, stand: 72 },
  tablet: { x: 24, top: 28, bottom: 32, stand: 0 },
  phone: { x: 16, top: 38, bottom: 28, stand: 0 },
}

const previewCallbacks = (callbacks: PreviewCallbacks): PreviewCallbacks => callbacks

function DeviceFrame({ kind, children, width, height, bodyHeight, scale, inset }: { kind: Exclude<PreviewFrame, 'none'>; children: ReactNode; width: number; height: number; bodyHeight: number; scale: number; inset: { x: number; top: number; bottom: number; stand: number } }) {
  return <div className={`preview-device preview-device--${kind}`} style={{ width, height, transform: `scale(${scale})`, '--preview-inset-x': `${inset.x}px`, '--preview-inset-top': `${inset.top}px`, '--preview-inset-bottom': `${inset.bottom}px`, '--preview-body-height': `${bodyHeight}px`, '--preview-stand-height': `${inset.stand}px` } as CSSProperties}>
    <div className="preview-device__chassis" style={{ height: bodyHeight }}>
      <svg className="preview-device__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect className="preview-device__body" x="1" y="1" width="98" height="98" rx={kind === 'phone' ? 10 : kind === 'monitor' ? 5 : 7} />
        {kind === 'tablet' ? <><path className="preview-device__camera" d="M49 2.9h2" /><circle className="preview-device__camera-dot" cx="53" cy="2.9" r=".75" /></> : kind === 'phone' ? <><rect className="preview-device__speaker" x="42" y="2.3" width="16" height="1.8" rx=".9" /><circle className="preview-device__camera-dot" cx="62" cy="3.2" r="1" /></> : <circle className="preview-device__camera-dot" cx="50" cy="3.1" r=".65" />}
      </svg>
      <div className="preview-device__screen">{children}</div>
      {kind === 'tablet' && <div className="preview-device__home" aria-hidden="true" />}
      {kind === 'phone' && <div className="preview-device__home" aria-hidden="true" />}
    </div>
    {kind === 'monitor' && <div className="preview-device__stand" aria-hidden="true"><span className="preview-device__stand-neck" /><span className="preview-device__stand-base" /></div>}
  </div>
}

function useReducedMotion(explicit: boolean | undefined, projectPreference: boolean): boolean {
  const [systemPreference, setSystemPreference] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystemPreference(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  return explicit ?? (projectPreference || systemPreference)
}

export function PreviewExperience({ project, page, viewportWidth, viewportHeight, preset, reducedMotion, previewState = {}, onExit, onNavigate, onPreviewNavigate, onExternal, onStateChange, onFormState, onElementAction, className = '', style }: PreviewExperienceProps) {
  const initialPage = page ?? project.pages.find((candidate) => candidate.id === project.activePageId) ?? project.pages[0]
  const [activePageId, setActivePageId] = useState(initialPage?.id ?? '')
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const stageRef = useRef<HTMLElement>(null)
  const exitRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = `layer-preview-title-${useId().replace(/:/g, '')}`
  const activePage = project.pages.find((candidate) => candidate.id === activePageId) ?? page ?? project.pages[0]
  const width = Math.max(1, finite(viewportWidth, activePage?.width ?? PREVIEW_PRESETS.desktop.width))
  const selectedPreset = preset ?? resolvePreviewPreset(width)
  const frame = PREVIEW_PRESETS[selectedPreset].frame
  const inset = FRAME_INSETS[frame]
  const motionReduced = useReducedMotion(reducedMotion, Boolean(project.settings.reducedMotion))
  const screenHeight = Math.max(1, finite(viewportHeight, PREVIEW_PRESETS[selectedPreset].height))
  const layoutHeight = Math.max(screenHeight, activePage ? computeLayout(activePage, { width, height: screenHeight }).height : screenHeight)
  const frameWidth = width + inset.x * 2
  const bodyHeight = screenHeight + inset.top + inset.bottom
  const frameHeight = bodyHeight + inset.stand
  const widthScale = (stageSize.width - 32) / frameWidth
  const heightScale = stageSize.height > 0 ? (stageSize.height - 88) / frameHeight : 1
  const scale = stageSize.width > 0 ? Math.min(1, Math.max(.1, Math.min(widthScale, heightScale))) : 1

  useEffect(() => {
    setActivePageId(page?.id ?? project.activePageId)
  }, [page?.id, project.activePageId])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => setStageSize({ width: stage.clientWidth || window.innerWidth || 0, height: stage.clientHeight || window.innerHeight || 0 })
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(stage)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusTimer = window.setTimeout(() => {
      try { exitRef.current?.focus({ preventScroll: true }) } catch { exitRef.current?.focus() }
    }, 0)
    return () => {
      window.clearTimeout(focusTimer)
      try { previousFocusRef.current?.focus({ preventScroll: true }) } catch { previousFocusRef.current?.focus() }
    }
  }, [])

  const handleNavigate = useCallback((pageId: string, interaction?: Interaction) => {
    setActivePageId(pageId)
    ;(onNavigate ?? onPreviewNavigate)?.(pageId, interaction)
  }, [onNavigate, onPreviewNavigate])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keep editor shortcuts from receiving keys while the presentation owns focus.
    event.stopPropagation()
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    onExit()
  }

  const prototypeProps = previewCallbacks({ onExternal, onStateChange, onFormState, onElementAction })
  const frameBoxStyle = { width: frameWidth * scale, height: frameHeight * scale } as CSSProperties
  const screenStyle = { width, height: layoutHeight, left: 0, top: 0 } as CSSProperties

  return <div className={`preview-experience ${className}`.trim()} data-preview-preset={selectedPreset} data-preview-frame={frame} data-preview-viewport={width} data-reduced-motion={motionReduced ? 'true' : 'false'} style={style} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={handleKeyDown}>
    <h1 className="preview-experience__title" id={titleId}>{project.name} preview</h1>
    <button ref={exitRef} type="button" className="preview-experience__exit" onClick={onExit} aria-label="Exit preview" title="Exit preview"><Icon name="close" size={17} /></button>
    <main ref={stageRef} className="preview-experience__stage" aria-label={`${activePage?.name ?? project.name} webpage preview`}>
      <div className={`preview-experience__frame-box preview-experience__frame-box--${frame}`} style={frameBoxStyle}>
        <DeviceFrame kind={frame} width={frameWidth} height={frameHeight} bodyHeight={bodyHeight} scale={scale} inset={inset}><div className="preview-device__content" style={screenStyle}><Prototype document={project} page={activePage} width={width} height={screenHeight} reducedMotion={motionReduced} previewState={previewState} onNavigate={handleNavigate} {...prototypeProps} /></div></DeviceFrame>
      </div>
    </main>
  </div>
}

export default PreviewExperience
