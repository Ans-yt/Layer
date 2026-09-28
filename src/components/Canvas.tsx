import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Icon } from './Icon'
import { Prototype, sanitizePrototypeUrl } from './Prototype'
import type { DesignElement, Page, Project, ProjectSettings, ViewState } from '../lib/model'
import type { Tool } from '../App'
import { computeLayout } from '../lib/layout'
import { cornerRadiusFromPoint, getAbsoluteRect, getSelectionBounds, resizeRotatedRect, rotatePoint, snapMove, snapResizeRect, type Rect, type SnapGuide } from '../lib/geometry'
import { cutClipPath, zeroCorners } from '../lib/corner-values'
import { ShapeVisual, preserveSnappedAspect, shapeClipPath, shapeUsesRoundCorners } from '../lib/shapes'
import './shape-handles.css'

export interface CanvasContextMenu { clientX: number; clientY: number; targetId?: string; targetName?: string; selectedIds: string[] }
export interface CanvasSelectionRect { startX: number; startY: number; endX: number; endY: number; mode?: 'left' | 'right' }

export interface CanvasProps {
  page: Page
  project?: Project
  view: ViewState
  selectedIds: string[]
  activeTool: Tool
  previewState: Record<string, boolean>
  settings: ProjectSettings
  selectionRect: CanvasSelectionRect | null
  onSelect: (id: string, additive?: boolean, toggle?: boolean) => void
  onClearSelection: () => void
  onSelectionRect: (rect: CanvasSelectionRect | null, additive?: boolean) => void
  onSetSelectionRect: (rect: CanvasSelectionRect | null) => void
  onContextMenu: (menu: CanvasContextMenu) => void
  onTransformStart: () => void
  onTransform: (id: string, patch: Partial<DesignElement>) => void
  onTransformEnd: (label?: string) => void
  onPreviewAction: (element: DesignElement) => void
  onPreviewNavigate?: (pageId: string) => void
  onPan: (x: number, y: number) => void
  /** Optional for older hosts; newer hosts should pass it to make wheel zoom persistent. */
  onZoom?: (zoom: number) => void
  onCut?: (id: string) => void
  /** Optional user guides supplied by a host or a future guide manager. */
  userGuides?: number[] | { axis: 'x' | 'y'; position: number; label?: string }[]
}

type DragKind = 'move' | 'resize' | 'rotate' | 'curve' | 'corner' | 'pan' | 'marquee' | 'right-marquee'

interface Drag {
  kind: DragKind
  pointerId: number
  startClientX: number
  startClientY: number
  startPage: { x: number; y: number }
  startPanX: number
  startPanY: number
  startZoom: number
  startElements: DesignElement[]
  startRects: Record<string, Rect>
  selectedIds: string[]
  targetId?: string
  handle?: string
  contextTarget?: { id?: string; name?: string }
  suppressContextMenu?: boolean
  moved: boolean
  transformStarted?: boolean
}

interface VisibleGuides { vertical: number[]; horizontal: number[]; labels: { text: string; x?: number; y?: number }[] }

const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const emptyGuides = (): VisibleGuides => ({ vertical: [], horizontal: [], labels: [] })

const localPatch = (page: Page, element: DesignElement, rect: Rect, layoutRects: Record<string, Rect>): Partial<DesignElement> => {
  const parentRect = element.parentId ? layoutRects[element.parentId] : undefined
  return { x: rect.x - (parentRect?.x ?? 0), y: rect.y - (parentRect?.y ?? 0), width: rect.width, height: rect.height }
}

const elementMap = (page: Page) => new Map(page.elements.map((element) => [element.id, element]))

const isEffectivelyVisible = (element: DesignElement, page: Page): boolean => {
  const map = elementMap(page)
  let current: DesignElement | undefined = element
  const seen = new Set<string>()
  while (current) {
    if (!current.visible) return false
    if (current.parentId && !seen.has(current.parentId)) {
      seen.add(current.parentId); current = map.get(current.parentId)
    } else break
  }
  return true
}

const guidePresentation = (result: { guides: SnapGuide[]; vertical: number[]; horizontal: number[] }, rect: Rect): VisibleGuides => {
  const labels: { text: string; x?: number; y?: number }[] = []
  for (const guide of result.guides) {
    const label = guide.label ?? (guide.kind === 'grid' ? 'grid' : guide.kind === 'baseline' ? 'baseline' : guide.kind === 'equal-gap' ? 'equal gap' : `${Math.round(guide.position)} px`)
    if (guide.axis === 'x') labels.push({ text: label, x: guide.position, y: rect.y - 12 })
    else labels.push({ text: label, x: rect.x + rect.width + 8, y: guide.position })
  }
  return { vertical: result.vertical, horizontal: result.horizontal, labels }
}

export function Canvas({ page, project, view, selectedIds, activeTool, previewState, settings, selectionRect, onSelect, onClearSelection, onSelectionRect, onSetSelectionRect, onContextMenu, onTransformStart, onTransform, onTransformEnd, onPreviewAction, onPreviewNavigate, onPan, onZoom, onCut, userGuides }: CanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [guides, setGuides] = useState<VisibleGuides>(emptyGuides)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const editOriginalRef = useRef('')
  const editDirtyRef = useRef(false)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const textClickRef = useRef<{ id: string; time: number; x: number; y: number } | null>(null)

  const responsiveWidth = view.mode === 'preview' ? Math.max(1, view.viewportWidth || page.width) : page.width
  const layout = useMemo(() => computeLayout(page, { width: responsiveWidth }), [page, responsiveWidth])
  const artboardHeight = Math.max(page.height, layout.height)
  const selected = useMemo(() => page.elements.filter((element) => selectedIds.includes(element.id)), [page.elements, selectedIds])
  const currentRef = useRef({ page, view, selectedIds, settings, userGuides, onSelect, onClearSelection, onSelectionRect, onSetSelectionRect, onContextMenu, onTransformStart, onTransform, onTransformEnd, onPreviewAction, onPan, onZoom, onCut, layout })
  currentRef.current = { page, view, selectedIds, settings, userGuides, onSelect, onClearSelection, onSelectionRect, onSetSelectionRect, onContextMenu, onTransformStart, onTransform, onTransformEnd, onPreviewAction, onPan, onZoom, onCut, layout }

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input,textarea,select,button,[contenteditable="true"]')) return
      setSpaceHeld(true); event.preventDefault()
    }
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceHeld(false) }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp) }
  }, [])

  const pagePoint = (clientX: number, clientY: number, state = currentRef.current.view): { x: number; y: number } => {
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const zoom = Math.max(0.01, finite(state.zoom, 1))
    return { x: (clientX - rect.left - state.panX) / zoom, y: (clientY - rect.top - state.panY) / zoom }
  }

  const isLocked = (element: DesignElement, sourcePage: Page): boolean => {
    if (element.locked) return true
    const map = new Map(sourcePage.elements.map((candidate) => [candidate.id, candidate]))
    let parentId = element.parentId
    const seen = new Set<string>()
    while (parentId && !seen.has(parentId)) {
      const parent = map.get(parentId)
      if (!parent) break
      if (parent.locked) return true
      seen.add(parentId); parentId = parent.parentId
    }
    return false
  }

  const snapOptions = (movingIds: string[], target?: DesignElement, event?: Pick<PointerEvent, 'altKey'>) => {
    const state = currentRef.current
    const projectSettings = state.settings as ProjectSettings & { userGuides?: CanvasProps['userGuides'] }
    return {
      tolerance: 9 / Math.max(0.01, state.view.zoom), movingIds,
      includePage: projectSettings.snapEdges !== false, includeEdges: projectSettings.snapEdges !== false, includeCenters: projectSettings.snapCenters !== false, includeParent: true, includePadding: true,
      includeGrid: Boolean(projectSettings.snapGrid), gridSize: Math.max(1, finite(projectSettings.gridSize, 8)),
      includeGuides: true, userGuides: state.userGuides ?? projectSettings.userGuides,
      includeBaselines: true, includeEqualGaps: projectSettings.snapGaps !== false,
      parentId: target?.parentId, bypass: Boolean(event?.altKey) || projectSettings.snap === false,
    }
  }

  const setGuideResult = (result: { guides: SnapGuide[]; vertical: number[]; horizontal: number[] }, rect: Rect) => setGuides(guidePresentation(result, rect))

  const moveElements = (drag: Drag, event: PointerEvent) => {
    const state = currentRef.current
    const point = pagePoint(event.clientX, event.clientY)
    const dx = point.x - drag.startPage.x
    const dy = point.y - drag.startPage.y
    const target = drag.targetId ? state.page.elements.find((element) => element.id === drag.targetId) : undefined
    const baseTarget = target ? drag.startRects[target.id] : undefined
    if (!target || !baseTarget) return
    const movingRects = drag.selectedIds.map((id) => drag.startRects[id]).filter((rect): rect is Rect => Boolean(rect))
    const groupRect = getSelectionBounds(movingRects.map((rect, index) => ({ id: `selection-${index}`, type: 'rect', name: '', x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: 0, opacity: 1, visible: true, locked: false, fill: 'transparent', stroke: 'transparent', strokeWidth: 0, radius: 0, corners: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }, interactions: [] } as DesignElement)))
    const translatedTarget = { ...baseTarget, x: baseTarget.x + dx, y: baseTarget.y + dy }
    const translatedGroup = groupRect ? { ...groupRect, x: groupRect.x + dx, y: groupRect.y + dy } : translatedTarget
    const snapped = snapMove(translatedGroup, state.page, snapOptions(drag.selectedIds, target, event))
    const deltaX = (snapped.rect.x - (groupRect?.x ?? baseTarget.x))
    const deltaY = (snapped.rect.y - (groupRect?.y ?? baseTarget.y))
    for (const element of drag.startElements) {
      if (!drag.selectedIds.includes(element.id) || isLocked(element, state.page)) continue
      const start = drag.startRects[element.id]
      if (!start) continue
      const nextRect = { ...start, x: start.x + deltaX, y: start.y + deltaY }
      state.onTransform(element.id, localPatch(state.page, element, nextRect, state.layout.rects))
    }
    setGuideResult(snapped, snapped.rect)
  }

  const resizeElement = (drag: Drag, event: PointerEvent) => {
    const state = currentRef.current
    const target = drag.targetId ? state.page.elements.find((element) => element.id === drag.targetId) : undefined
    const start = drag.targetId ? drag.startRects[drag.targetId] : undefined
    const startElement = drag.targetId ? drag.startElements.find((element) => element.id === drag.targetId) : undefined
    if (!target || !start || !startElement || !drag.handle || isLocked(target, state.page)) return
    const point = pagePoint(event.clientX, event.clientY)
    const pointerDelta = { x: point.x - drag.startPage.x, y: point.y - drag.startPage.y }
    // Resize handles are authored in the element's local axes. Applying the
    // page delta directly makes a rotated card grow in the wrong direction.
    const preserveAspect = event.shiftKey || Boolean(target.aspectRatioLocked)
    const ratio = start.height ? start.width / start.height : 1
    const minHeight = target.type === 'line' ? 1 : 2
    const resizeOptions = { minWidth: preserveAspect ? Math.max(2, minHeight * ratio) : 2, minHeight: preserveAspect ? Math.max(minHeight, 2 / ratio) : minHeight, preserveAspect, aspectRatio: ratio }
    // Side handles use only their local axis, even when the pointer drifts sideways.
    const localDelta = rotatePoint(pointerDelta, { x: 0, y: 0 }, -finite(startElement.rotation))
    if (drag.handle === 'n' || drag.handle === 's') localDelta.x = 0
    if (drag.handle === 'e' || drag.handle === 'w') localDelta.y = 0
    const delta = rotatePoint(localDelta, { x: 0, y: 0 }, finite(startElement.rotation))
    const proposed = resizeRotatedRect(start, finite(startElement.rotation, 0), drag.handle, delta.x, delta.y, resizeOptions)
    // Axis aligned elements get full edge/size snapping. For rotated layers,
    // local-axis geometry is authoritative and snapping is limited to the
    // explicitly requested modifier path rather than distorting the handle.
    const rawSnap = finite(startElement.rotation, 0) === 0 ? snapResizeRect(proposed, start, drag.handle, state.page, snapOptions([target.id], target, event)) : { rect: proposed, delta: { x: 0, y: 0 }, guides: [], vertical: [], horizontal: [] }
    const snapped = resizeOptions.preserveAspect ? preserveSnappedAspect(rawSnap, proposed, start, drag.handle) : rawSnap
    state.onTransform(target.id, localPatch(state.page, target, snapped.rect, state.layout.rects))
    setGuideResult(snapped, snapped.rect)
  }

  const rotateElement = (drag: Drag, event: PointerEvent) => {
    const state = currentRef.current
    const target = drag.targetId ? state.page.elements.find((element) => element.id === drag.targetId) : undefined
    const start = drag.targetId ? drag.startElements.find((element) => element.id === drag.targetId) : undefined
    const startRect = drag.targetId ? drag.startRects[drag.targetId] : undefined
    if (!target || !start || !startRect || isLocked(target, state.page)) return
    const point = pagePoint(event.clientX, event.clientY)
    const angle = Math.atan2(point.y - (startRect.y + startRect.height / 2), point.x - (startRect.x + startRect.width / 2)) * 180 / Math.PI + 90
    const snapped = event.shiftKey ? angle : Math.round(angle / 5) * 5
    state.onTransform(target.id, { rotation: snapped })
    setGuides(emptyGuides())
  }

  const curveElement = (drag: Drag, event: PointerEvent) => {
    const state = currentRef.current
    const target = drag.targetId ? state.page.elements.find((element) => element.id === drag.targetId) : undefined
    const start = drag.targetId ? drag.startElements.find((element) => element.id === drag.targetId) : undefined
    const rect = drag.targetId ? drag.startRects[drag.targetId] : undefined
    if (!target || !start || !rect || !drag.handle || isLocked(target, state.page)) return
    const point = pagePoint(event.clientX, event.clientY)
    const localPoint = rotatePoint(point, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, -finite(start.rotation, 0))
    const relativeX = clamp(localPoint.x - rect.x, -rect.width, rect.width * 2)
    const relativeY = clamp(localPoint.y - rect.y, -rect.height, rect.height * 2)
    const curve = start.curve ?? { x1: rect.width * .25, y1: rect.height * .25, x2: rect.width * .75, y2: rect.height * .75 }
    state.onTransform(target.id, { curve: drag.handle === 'curve-1' ? { ...curve, x1: relativeX, y1: relativeY } : { ...curve, x2: relativeX, y2: relativeY } })
    setGuides(emptyGuides())
  }

  const cornerElement = (drag: Drag, event: PointerEvent) => {
    const state = currentRef.current
    const target = drag.targetId ? state.page.elements.find((element) => element.id === drag.targetId) : undefined
    const start = drag.targetId ? drag.startElements.find((element) => element.id === drag.targetId) : undefined
    if (!target || !start || !drag.handle || isLocked(target, state.page)) return
    const point = pagePoint(event.clientX, event.clientY)
    const rect = drag.targetId ? drag.startRects[drag.targetId] : undefined
    if (!rect) return
    const radius = cornerRadiusFromPoint(rect, drag.handle.replace('corner-', '') as 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft', point, finite(start.rotation, 0))
    state.onTransform(target.id, { corners: { ...start.corners, [drag.handle.replace('corner-', '')]: radius } })
    setGuides(emptyGuides())
  }

  const movePointer = (event: PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const state = currentRef.current
    const crossedThreshold = Math.abs(event.clientX - drag.startClientX) > 3 || Math.abs(event.clientY - drag.startClientY) > 3
    if (crossedThreshold) drag.moved = true
    if (drag.moved && !drag.transformStarted && ['move', 'resize', 'rotate', 'curve', 'corner'].includes(drag.kind)) { state.onTransformStart(); drag.transformStarted = true }
    if (!drag.moved && ['move', 'resize', 'rotate', 'curve', 'corner'].includes(drag.kind)) return
    if (drag.kind === 'pan') { state.onPan(drag.startPanX + event.clientX - drag.startClientX, drag.startPanY + event.clientY - drag.startClientY); return }
    const point = pagePoint(event.clientX, event.clientY)
    if (drag.kind === 'marquee' || drag.kind === 'right-marquee') { state.onSetSelectionRect({ startX: drag.startPage.x, startY: drag.startPage.y, endX: point.x, endY: point.y, mode: drag.kind === 'right-marquee' ? 'right' : 'left' }); return }
    if (drag.kind === 'move') { moveElements(drag, event); return }
    if (drag.kind === 'resize') { resizeElement(drag, event); return }
    if (drag.kind === 'rotate') { rotateElement(drag, event); return }
    if (drag.kind === 'curve') { curveElement(drag, event); return }
    if (drag.kind === 'corner') cornerElement(drag, event)
  }

  const finishPointer = (event: PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const state = currentRef.current
    try { hostRef.current?.releasePointerCapture(event.pointerId) } catch { /* capture may already have been released by the browser */ }
    if (drag.kind === 'marquee' || drag.kind === 'right-marquee') {
      const point = pagePoint(event.clientX, event.clientY)
      const rect: CanvasSelectionRect = { startX: drag.startPage.x, startY: drag.startPage.y, endX: point.x, endY: point.y, mode: drag.kind === 'right-marquee' ? 'right' : 'left' }
      if (drag.moved) state.onSelectionRect(rect, event.shiftKey || event.ctrlKey || event.metaKey)
      else if (drag.kind === 'right-marquee' && !drag.suppressContextMenu) {
        const targetId = drag.contextTarget?.id
        const menuSelectedIds = targetId && !state.selectedIds.includes(targetId) ? [targetId] : state.selectedIds
        state.onContextMenu({ clientX: event.clientX, clientY: event.clientY, targetId, targetName: drag.contextTarget?.name, selectedIds: menuSelectedIds })
      }
      // App's selection callback briefly records the applied rectangle while it
      // computes hits. Clear after that callback so a marquee never lingers.
      state.onSetSelectionRect(null)
    } else if (drag.kind === 'move' || drag.kind === 'resize' || drag.kind === 'rotate' || drag.kind === 'curve' || drag.kind === 'corner') {
      if (drag.transformStarted) state.onTransformEnd(drag.kind === 'resize' ? 'Resized layer' : drag.kind === 'rotate' ? 'Rotated layer' : drag.kind === 'move' ? 'Moved layer' : 'Edited layer')
    }
    dragRef.current = null
    setGuides(emptyGuides())
  }

  const beginPointer = (event: ReactPointerEvent, target?: DesignElement, handle?: string) => {
    const state = currentRef.current
    event.stopPropagation()
    if (event.button === 1 || activeTool === 'hand' || spaceHeld) {
      event.preventDefault()
      dragRef.current = { kind: 'pan', pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPage: { x: 0, y: 0 }, startPanX: state.view.panX, startPanY: state.view.panY, startZoom: state.view.zoom, startElements: [], startRects: {}, selectedIds: [], moved: false }
      try { hostRef.current?.setPointerCapture(event.pointerId) } catch { /* unsupported in older test DOMs */ }
      return
    }
    const point = pagePoint(event.clientX, event.clientY)
    if (event.button === 2) {
      event.preventDefault()
      const modifier = event.ctrlKey || event.metaKey
      if (target && modifier) state.onSelect(target.id, true, true)
      else if (target && !state.selectedIds.includes(target.id)) state.onSelect(target.id)
      dragRef.current = { kind: 'right-marquee', pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPage: point, startPanX: state.view.panX, startPanY: state.view.panY, startZoom: state.view.zoom, startElements: [], startRects: {}, selectedIds: state.selectedIds, contextTarget: target ? { id: target.id, name: target.name } : {}, suppressContextMenu: modifier, moved: false }
      try { hostRef.current?.setPointerCapture(event.pointerId) } catch { /* unsupported in older test DOMs */ }
      return
    }
    if (state.view.mode === 'preview' && target) { event.preventDefault(); state.onPreviewAction(target); return }
    if (handle && target) {
      event.preventDefault()
      if (isLocked(target, state.page)) { state.onSelect(target.id, event.shiftKey, event.shiftKey); return }
      const startRects = Object.fromEntries(state.page.elements.map((element) => [element.id, layout.rects[element.id] ?? getAbsoluteRect(element, state.page)]))
      dragRef.current = { kind: handle === 'rotate' ? 'rotate' : handle.startsWith('curve-') ? 'curve' : handle.startsWith('corner-') ? 'corner' : 'resize', pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPage: point, startPanX: state.view.panX, startPanY: state.view.panY, startZoom: state.view.zoom, startElements: state.page.elements.filter((element) => state.selectedIds.includes(element.id) || element.id === target.id).map((element) => ({ ...element, corners: { ...element.corners }, curve: element.curve ? { ...element.curve } : undefined })), startRects, selectedIds: state.selectedIds.includes(target.id) ? state.selectedIds : [target.id], targetId: target.id, handle, moved: false }
      try { hostRef.current?.setPointerCapture(event.pointerId) } catch { /* unsupported in older test DOMs */ }
      return
    }
    if (target) {
      const wasSelected = state.selectedIds.includes(target.id)
      if (target.locked || isLocked(target, state.page)) { state.onSelect(target.id, event.shiftKey, event.shiftKey); return }
      if (event.shiftKey) state.onSelect(target.id, true, true)
      // Clicking any member of an existing multi-selection starts a group
      // drag; it must not collapse the selection before the pointer moves.
      else if (!wasSelected) state.onSelect(target.id)
      const nextIds = event.shiftKey ? (wasSelected ? state.selectedIds.filter((id) => id !== target.id) : [...state.selectedIds, target.id]) : wasSelected ? state.selectedIds : [target.id]
      if (event.shiftKey && wasSelected) return
      const startElements = state.page.elements.filter((element) => nextIds.includes(element.id))
      const startRects = Object.fromEntries(state.page.elements.map((element) => [element.id, layout.rects[element.id] ?? getAbsoluteRect(element, state.page)]))
      dragRef.current = { kind: 'move', pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPage: point, startPanX: state.view.panX, startPanY: state.view.panY, startZoom: state.view.zoom, startElements: startElements.map((element) => ({ ...element })), startRects, selectedIds: nextIds, targetId: target.id, moved: false }
      try { hostRef.current?.setPointerCapture(event.pointerId) } catch { /* unsupported in older test DOMs */ }
      return
    }
    event.preventDefault()
    if (!event.shiftKey) state.onClearSelection()
    dragRef.current = { kind: 'marquee', pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPage: point, startPanX: state.view.panX, startPanY: state.view.panY, startZoom: state.view.zoom, startElements: [], startRects: {}, selectedIds: state.selectedIds, moved: false }
    try { hostRef.current?.setPointerCapture(event.pointerId) } catch { /* unsupported in older test DOMs */ }
  }

  const wheel = (event: React.WheelEvent) => {
    event.preventDefault()
    const state = currentRef.current
    if (event.ctrlKey || event.metaKey) {
      const rect = hostRef.current?.getBoundingClientRect()
      if (!rect) return
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top
      const oldZoom = Math.max(.05, state.view.zoom)
      const nextZoom = clamp(oldZoom * Math.exp(-event.deltaY * .0015), .1, 4)
      const pageX = (localX - state.view.panX) / oldZoom
      const pageY = (localY - state.view.panY) / oldZoom
      state.onPan(localX - pageX * nextZoom, localY - pageY * nextZoom)
      state.onZoom?.(nextZoom)
      return
    }
    state.onPan(state.view.panX - finite(event.deltaX), state.view.panY - finite(event.deltaY))
  }

  const renderElement = (element: DesignElement, parent?: DesignElement): ReactNode => {
    const state = currentRef.current
    const visual = element as DesignElement & { textColor?: string; imageFit?: CSSProperties['objectFit']; imagePosition?: string }
    const rect = layout.rects[element.id] ?? getAbsoluteRect(element, page)
    const parentRect = parent ? (layout.rects[parent.id] ?? getAbsoluteRect(parent, page)) : undefined
    const hasChildren = page.elements.some((candidate) => candidate.parentId === element.id)
    const shape = element.type === 'rect' || element.type === 'frame' ? element.shape ?? 'rectangle' : undefined
    const svgShape = ['rect', 'frame', 'circle'].includes(element.type) && !element.curve
    const shapeClip = shapeClipPath(shape)
    const hasRoundedCorners = element.type === 'circle' || shapeUsesRoundCorners(shape) || [element.corners?.topLeft, element.corners?.topRight, element.corners?.bottomRight, element.corners?.bottomLeft].some((corner) => finite(corner) > 0)
    const imageSrc = sanitizePrototypeUrl(element.src, 'image')
    const isSelected = selectedIds.includes(element.id)
    const hiddenByPreview = previewState[element.id] === false
    const corners = element.type === 'circle' || shape === 'round' ? '50%' : shape === 'pill' ? '999px' : `${finite(element.corners?.topLeft)}px ${finite(element.corners?.topRight)}px ${finite(element.corners?.bottomRight)}px ${finite(element.corners?.bottomLeft)}px`
    const rawCutCorners = element.cutCorners ?? zeroCorners()
    const cutLimit = Math.max(0, Math.min(rect.width, rect.height) / 2)
    const cutCorners = {
      topLeft: clamp(finite(rawCutCorners.topLeft), 0, cutLimit),
      topRight: clamp(finite(rawCutCorners.topRight), 0, cutLimit),
      bottomRight: clamp(finite(rawCutCorners.bottomRight), 0, cutLimit),
      bottomLeft: clamp(finite(rawCutCorners.bottomLeft), 0, cutLimit),
    }
    const style: CSSProperties = {
      ['--canvas-handle-zoom' as string]: view.zoom,
      left: rect.x - (parentRect?.x ?? 0), top: rect.y - (parentRect?.y ?? 0), width: rect.width, height: rect.height,
      opacity: hiddenByPreview ? 0 : finite(element.opacity, 1),
      transform: `rotate(${finite(element.rotation)}deg)`,
      background: element.type === 'line' || element.curve ? undefined : element.fill === 'transparent' ? undefined : element.fill,
      border: element.stroke === 'transparent' ? undefined : `${Math.max(0, finite(element.strokeWidth, 1))}px solid ${element.stroke}`,
      borderRadius: corners,
      clipPath: shapeClip ?? (Object.values(cutCorners).some((value) => finite(value) > 0) ? cutClipPath(cutCorners) : undefined),
      boxShadow: element.shadow ? `${finite(element.shadow.x)}px ${finite(element.shadow.y)}px ${finite(element.shadow.blur)}px ${finite(element.shadow.spread)}px ${element.shadow.color}${Math.round(clamp(finite(element.shadow.opacity, 0), 0, 1) * 255).toString(16).padStart(2, '0')}` : undefined,
      color: typeof visual.textColor === 'string' ? visual.textColor : element.type === 'button' ? '#0b0c0e' : '#f4f1e8', fontFamily: element.fontFamily, fontSize: element.fontSize, fontWeight: element.fontWeight,
      lineHeight: element.lineHeight, letterSpacing: element.letterSpacing, textAlign: element.textAlign,
      // DOM order remains the only stacking order. Selection must never pull a
      // layer above a later sibling just because it is selected.
      whiteSpace: element.wrap === 'fixed' ? 'pre-wrap' : 'nowrap', zIndex: page.elements.indexOf(element) + 1,
      pointerEvents: element.visible === false ? 'none' : undefined,
      overflow: element.layout?.overflow === 'scroll' ? 'auto' : element.layout?.overflow === 'hidden' || Boolean(shapeClip) || (hasChildren && hasRoundedCorners) || element.type === 'image' || element.type === 'icon' ? 'hidden' : 'visible',
      animation: previewState[`animate:${element.id}`] ? `layerPulse ${element.interactions.find((interaction) => interaction.action === 'animate')?.duration ?? 500}ms ease-out` : undefined,
    }
    if (element.pattern?.enabled) {
      const patternColor = element.pattern.color
      style.backgroundImage = element.pattern.type === 'dots' ? `radial-gradient(${patternColor} 1px, transparent 1px)` : element.pattern.type === 'grid' ? `linear-gradient(${patternColor} 1px, transparent 1px), linear-gradient(90deg, ${patternColor} 1px, transparent 1px)` : `repeating-linear-gradient(${finite(element.pattern.rotation)}deg, ${patternColor} 0, ${patternColor} 1px, transparent 1px, transparent ${Math.max(1, finite(element.pattern.spacing, 16))}px)`
      style.backgroundSize = `${Math.max(1, finite(element.pattern.spacing, 16))}px ${Math.max(1, finite(element.pattern.spacing, 16))}px`
      style.backgroundBlendMode = 'screen'; style.backgroundColor = element.fill
    }
    const hasCutCorners = Object.values(cutCorners).some((value) => finite(value) > 0)
    const wrapVisual = hasCutCorners || svgShape || style.overflow !== 'visible'
    const outerStyle: CSSProperties = wrapVisual ? { ...style, background: undefined, backgroundColor: undefined, backgroundImage: undefined, border: undefined, borderRadius: undefined, boxShadow: undefined, clipPath: undefined, overflow: 'visible' } : style
    const contentStyle: CSSProperties = wrapVisual ? { ...style, position: 'absolute', display: 'flex', alignItems: 'inherit', justifyContent: 'inherit', boxSizing: 'border-box', left: 0, top: 0, width: '100%', height: '100%', transform: 'none', opacity: undefined, animation: undefined, zIndex: undefined, ...(svgShape ? { background: undefined, backgroundColor: undefined, border: undefined } : {}) } : {}
    const handleSize = 7 / Math.max(.01, view.zoom)
    const rotationSize = 19 / Math.max(.01, view.zoom)
    const resizeHandleStyle = (handle: string): CSSProperties => {
      const half = handleSize / 2
      const result: CSSProperties = { width: handleSize, height: handleSize }
      if (handle.includes('n')) result.top = -half
      else if (handle.includes('s')) result.bottom = -half
      else { result.top = '50%'; result.transform = 'translateY(-50%)' }
      if (handle.includes('w')) result.left = -half
      else if (handle.includes('e')) result.right = -half
      else { result.left = '50%'; result.transform = `${result.transform ?? ''} translateX(-50%)`.trim() }
      return result
    }
    const curvePath = element.curve ? `M 0 0 C ${finite(element.curve.x1)} ${finite(element.curve.y1)}, ${finite(element.curve.x2)} ${finite(element.curve.y2)}, ${Math.max(0, rect.width)} ${Math.max(0, rect.height)}` : `M 0 ${Math.max(0, rect.height / 2)} L ${Math.max(0, rect.width)} ${Math.max(0, rect.height / 2)}`
    const vectorVisual = element.type === 'line' || element.curve ? <svg aria-hidden="true" viewBox={`0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}><path d={curvePath} fill="none" stroke={element.stroke === 'transparent' ? element.fill : element.stroke} strokeWidth={Math.max(.5, finite(element.strokeWidth, 1))} vectorEffect="non-scaling-stroke" /></svg> : null
    const childPointer = (event: ReactPointerEvent) => {
      // Preview owns its native click/focus events. Never start a canvas drag
      // or call the legacy host action from a preview pointerdown.
      if (view.mode === 'preview') { event.stopPropagation(); return }
      if (activeTool === 'cut' && event.button === 0) { event.preventDefault(); event.stopPropagation(); state.onSelect(element.id); state.onCut?.(element.id); return }
      if (event.button === 0 && (element.type === 'text' || element.text)) {
        const previous = textClickRef.current
        const now = performance.now()
        if (previous && previous.id === element.id && now - previous.time < 480 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 12) {
          event.preventDefault(); event.stopPropagation(); textClickRef.current = null; beginTextEdit(); return
        }
        textClickRef.current = { id: element.id, time: now, x: event.clientX, y: event.clientY }
      }
      beginPointer(event, element)
    }
    const beginTextEdit = () => {
      if (!element.text || isLocked(element, page)) return
      setEditingTextId(element.id); setEditingText(element.text); editOriginalRef.current = element.text; editDirtyRef.current = false; state.onSelect(element.id)
      window.requestAnimationFrame(() => editRef.current?.focus())
    }
    const finishTextEdit = (cancel = false) => {
      if (editingTextId !== element.id) return
      if (cancel) { setEditingText(editOriginalRef.current); setEditingTextId(null); editDirtyRef.current = false; return }
      if (editDirtyRef.current) { state.onTransformStart(); state.onTransform(element.id, { text: editingText }); state.onTransformEnd('Edited text'); }
      setEditingTextId(null); editDirtyRef.current = false
    }
    return <div key={element.id} className={`canvas-element element-${element.type} ${isSelected ? 'selected' : ''} ${element.locked ? 'locked' : ''} ${previewState[`animate:${element.id}`] ? 'animating' : ''}`} data-element-id={element.id} style={outerStyle} onPointerDown={childPointer} onDoubleClick={(event) => { event.stopPropagation(); if (element.type === 'text' || element.text) beginTextEdit() }} onContextMenu={(event) => event.preventDefault()}>
      {svgShape && <ShapeVisual element={element} width={rect.width} height={rect.height} />}
      {wrapVisual ? <div className="element-content" style={contentStyle}>
      {editingTextId === element.id ? <textarea ref={editRef} className="inline-canvas-text-editor" value={editingText} aria-label={`Edit ${element.name}`} onChange={(event) => { editDirtyRef.current = true; setEditingText(event.target.value) }} onBlur={() => finishTextEdit()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); finishTextEdit(true) } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finishTextEdit() } }} style={{ color: style.color, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, textAlign: style.textAlign }} /> : vectorVisual}{editingTextId !== element.id && (element.type === 'image' && imageSrc ? <img src={imageSrc} alt={element.alt ?? ''} draggable={false} style={{ objectFit: visual.imageFit, objectPosition: visual.imagePosition }} /> : element.type === 'icon' && imageSrc ? <img src={imageSrc} alt={element.alt ?? element.iconName ?? 'Icon'} draggable={false} style={{ objectFit: visual.imageFit ?? 'contain', objectPosition: visual.imagePosition }} /> : element.type === 'icon' ? <Icon name="icon" size={Math.min(56, Math.max(18, rect.width * .35))} /> : element.type === 'line' || element.curve ? null : element.text ?? '')}
      {page.elements.filter((candidate) => candidate.parentId === element.id && isEffectivelyVisible(candidate, page)).map((child) => renderElement(child, element))}
      </div> : <>
      {editingTextId === element.id ? <textarea ref={editRef} className="inline-canvas-text-editor" value={editingText} aria-label={`Edit ${element.name}`} onChange={(event) => { editDirtyRef.current = true; setEditingText(event.target.value) }} onBlur={() => finishTextEdit()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); finishTextEdit(true) } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finishTextEdit() } }} style={{ color: style.color, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, textAlign: style.textAlign }} /> : vectorVisual}{editingTextId !== element.id && (element.type === 'image' && imageSrc ? <img src={imageSrc} alt={element.alt ?? ''} draggable={false} style={{ objectFit: visual.imageFit, objectPosition: visual.imagePosition }} /> : element.type === 'icon' && imageSrc ? <img src={imageSrc} alt={element.alt ?? element.iconName ?? 'Icon'} draggable={false} style={{ objectFit: visual.imageFit ?? 'contain', objectPosition: visual.imagePosition }} /> : element.type === 'icon' ? <Icon name="icon" size={Math.min(56, Math.max(18, rect.width * .35))} /> : element.type === 'line' || element.curve ? null : element.text ?? '')}
      {page.elements.filter((candidate) => candidate.parentId === element.id && isEffectivelyVisible(candidate, page)).map((child) => renderElement(child, element))}
      </>}
      {isSelected && view.mode === 'design' && <><div className="selection-outline" /><div className="rotation-handle" style={{ width: rotationSize, height: rotationSize }} onPointerDown={(event) => { event.stopPropagation(); beginPointer(event, element, 'rotate') }}><Icon name="rotate" size={12 / Math.max(.01, view.zoom)} /></div>{handles.map((handle) => <div key={handle} className={`resize-handle handle-${handle}`} style={resizeHandleStyle(handle)} onPointerDown={(event) => { event.stopPropagation(); beginPointer(event, element, handle) }} />)}{element.curve && <><div className="curve-handle curve-handle-1" data-handle="curve-1" style={{ position: 'absolute', left: element.curve.x1, top: element.curve.y1, width: handleSize, height: handleSize, borderRadius: '50%', background: 'var(--blue)', border: '1px solid #0b0c0e', transform: 'translate(-50%, -50%)', cursor: 'crosshair', zIndex: 16 }} onPointerDown={(event) => { event.stopPropagation(); beginPointer(event, element, 'curve-1') }} /><div className="curve-handle curve-handle-2" data-handle="curve-2" style={{ position: 'absolute', left: element.curve.x2, top: element.curve.y2, width: handleSize, height: handleSize, borderRadius: '50%', background: 'var(--blue)', border: '1px solid #0b0c0e', transform: 'translate(-50%, -50%)', cursor: 'crosshair', zIndex: 16 }} onPointerDown={(event) => { event.stopPropagation(); beginPointer(event, element, 'curve-2') }} /></>}{(['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const).map((corner) => <div key={corner} className={`corner-handle corner-${corner}`} data-handle={`corner-${corner}`} style={{ position: 'absolute', left: corner.includes('Left') ? 3.5 / Math.max(.01, view.zoom) : undefined, right: corner.includes('Right') ? 3.5 / Math.max(.01, view.zoom) : undefined, top: corner.includes('top') ? 3.5 / Math.max(.01, view.zoom) : undefined, bottom: corner.includes('bottom') ? 3.5 / Math.max(.01, view.zoom) : undefined, width: handleSize, height: handleSize, borderRadius: '50%', background: 'var(--blue)', border: '1px solid #0b0c0e', cursor: 'crosshair', zIndex: 16 }} onPointerDown={(event) => { event.stopPropagation(); beginPointer(event, element, `corner-${corner}`) }} />)}</>}
      {element.layout && element.layout.mode !== 'free' && isSelected && view.mode === 'design' && <span className="layout-badge"><Icon name="grid" size={11} /> {element.layout.mode}</span>}
    </div>
  }

  const visibleElements = page.elements.filter((element) => !element.parentId && isEffectivelyVisible(element, page))
  const previewSettings = settings as ProjectSettings & { reducedMotion?: boolean }
  return <div ref={hostRef} className={`canvas-viewport ${spaceHeld || activeTool === 'hand' ? 'is-panning' : ''} ${view.mode === 'preview' ? 'preview-mode' : ''}`} onPointerDown={(event) => { if (view.mode !== 'preview') beginPointer(event) }} onPointerMove={(event) => movePointer(event.nativeEvent)} onPointerUp={(event) => finishPointer(event.nativeEvent)} onPointerCancel={(event) => finishPointer(event.nativeEvent)} onWheel={wheel} onContextMenu={(event) => event.preventDefault()} onDragStart={(event) => event.preventDefault()}>
    <div className="canvas-grid" />
    <div className="canvas-coordinates coord-top">{[0, 200, 400, 600, 800, 1000, 1200, 1400].filter((value) => value < responsiveWidth).map((value) => <span key={value} style={{ left: view.panX + value * view.zoom }}>{value}</span>)}</div>
    <div className="canvas-coordinates coord-left">{[0, 200, 400, 600, 800].filter((value) => value < page.height).map((value) => <span key={value} style={{ top: view.panY + value * view.zoom }}>{value}</span>)}</div>
    <div className="artboard-shadow" style={{ left: view.panX, top: view.panY, width: responsiveWidth * view.zoom, height: artboardHeight * view.zoom }} />
    <div className="artboard" style={{ left: view.panX, top: view.panY, width: responsiveWidth, height: artboardHeight, transform: `scale(${view.zoom})`, background: page.background }}>
      {view.mode === 'preview' ? <Prototype document={project} page={page} width={responsiveWidth} reducedMotion={Boolean(previewSettings.reducedMotion)} previewState={previewState} onNavigate={onPreviewNavigate} /> : visibleElements.map((element) => renderElement(element))}
      {selectionRect && <div className={`marquee marquee-${selectionRect.mode ?? 'left'}`} style={{ left: Math.min(selectionRect.startX, selectionRect.endX), top: Math.min(selectionRect.startY, selectionRect.endY), width: Math.abs(selectionRect.endX - selectionRect.startX), height: Math.abs(selectionRect.endY - selectionRect.startY) }} />}
      {guides.vertical.map((value, index) => <div key={`v-${index}`} className="alignment-guide vertical" style={{ left: value }}><span>{guides.labels.find((label) => label.x === value)?.text}</span></div>)}
      {guides.horizontal.map((value, index) => <div key={`h-${index}`} className="alignment-guide horizontal" style={{ top: value }}><span>{guides.labels.find((label) => label.y === value)?.text}</span></div>)}
    </div>
    {view.mode === 'preview' && <div className="preview-badge"><Icon name="play" size={13} /> Preview · saved interactions are active</div>}
    {selected.length > 0 && view.mode === 'design' && <div className="selection-readout" style={{ left: view.panX + (Math.min(...selected.map((element) => (layout.rects[element.id]?.x ?? element.x))) * view.zoom), top: view.panY + ((Math.min(...selected.map((element) => (layout.rects[element.id]?.y ?? element.y))) - 34) * view.zoom) }}>{selected.length} selected</div>}
  </div>
}

export { Canvas as default }
