import type { DesignElement, Page } from './model'

/** A small, DOM-free geometry vocabulary shared by the editor and the renderer. */
export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Rect extends Point, Size {}

export type SnapAxis = 'x' | 'y'
export type SnapKind =
  | 'edge'
  | 'center'
  | 'page'
  | 'parent'
  | 'padding'
  | 'grid'
  | 'guide'
  | 'baseline'
  | 'size'
  | 'equal-gap'

export interface SnapGuide {
  axis: SnapAxis
  position: number
  kind: SnapKind
  /** The element that supplied the guide, when applicable. */
  sourceId?: string
  /** A human-readable label shown by a canvas implementation. */
  label?: string
  /** Lower values win ties. */
  priority?: number
  /** Stable source order used as a final tie breaker. */
  order?: number
}

export interface SnapResult {
  rect: Rect
  delta: Point
  guides: SnapGuide[]
  vertical: number[]
  horizontal: number[]
}

export interface SnapOptions {
  /** Tolerance in page units. Canvas callers normally pass pixels / zoom. */
  tolerance?: number
  movingIds?: Iterable<string>
  includePage?: boolean
  includeEdges?: boolean
  includeCenters?: boolean
  includeParent?: boolean
  includePadding?: boolean
  includeGrid?: boolean
  gridSize?: number
  includeGuides?: boolean
  userGuides?: number[] | { axis: SnapAxis; position: number; label?: string }[]
  includeBaselines?: boolean
  includeEqualGaps?: boolean
  /** The parent of the moving rectangle, if it is known. */
  parentId?: string
  /** Disable all candidates while a modifier key is held. */
  bypass?: boolean
}

export interface ResizeOptions {
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  aspectRatio?: number
  preserveAspect?: boolean
  /** Keep the opposite edge fixed for a centered resize. */
  centered?: boolean
}

export type CornerName = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft'

type ElementWithOptionalGuideData = DesignElement & {
  baseline?: number
  textBaseline?: number
  guide?: { axis: SnapAxis; position: number; label?: string }
  guides?: { axis: SnapAxis; position: number; label?: string }[]
}

const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const nonNegative = (value: unknown, fallback = 0): number => Math.max(0, finite(value, fallback))

export const right = (rect: Rect): number => rect.x + rect.width
export const bottom = (rect: Rect): number => rect.y + rect.height
export const centerX = (rect: Rect): number => rect.x + rect.width / 2
export const centerY = (rect: Rect): number => rect.y + rect.height / 2

export const normalizeRect = (rect: Rect): Rect => {
  const x2 = rect.x + rect.width
  const y2 = rect.y + rect.height
  const x = Math.min(rect.x, x2)
  const y = Math.min(rect.y, y2)
  return { x, y, width: Math.abs(x2 - rect.x), height: Math.abs(y2 - rect.y) }
}

export const rectFromElement = (element: Pick<DesignElement, 'x' | 'y' | 'width' | 'height'>): Rect => ({
  x: finite(element.x), y: finite(element.y), width: nonNegative(element.width), height: nonNegative(element.height),
})

export const translateRect = (rect: Rect, dx: number, dy: number): Rect => ({ ...rect, x: rect.x + dx, y: rect.y + dy })

export const expandRect = (rect: Rect, amount: number | { x?: number; y?: number; left?: number; top?: number; right?: number; bottom?: number }): Rect => {
  if (typeof amount === 'number') return { x: rect.x - amount, y: rect.y - amount, width: rect.width + amount * 2, height: rect.height + amount * 2 }
  const left = finite(amount.left, finite(amount.x))
  const top = finite(amount.top, finite(amount.y))
  const rightInset = finite(amount.right, finite(amount.x))
  const bottomInset = finite(amount.bottom, finite(amount.y))
  return { x: rect.x - left, y: rect.y - top, width: rect.width + left + rightInset, height: rect.height + top + bottomInset }
}

export const rectUnion = (rects: Iterable<Rect>): Rect | null => {
  let result: Rect | null = null
  for (const rect of rects) {
    const next = normalizeRect(rect)
    if (!result) { result = next; continue }
    const x = Math.min(result.x, next.x)
    const y = Math.min(result.y, next.y)
    const x2 = Math.max(right(result), right(next))
    const y2 = Math.max(bottom(result), bottom(next))
    result = { x, y, width: x2 - x, height: y2 - y }
  }
  return result
}

export const containsPoint = (rect: Rect, point: Point, inclusive = true): boolean => {
  const normalized = normalizeRect(rect)
  const rightEdge = right(normalized)
  const bottomEdge = bottom(normalized)
  return inclusive
    ? point.x >= normalized.x && point.x <= rightEdge && point.y >= normalized.y && point.y <= bottomEdge
    : point.x > normalized.x && point.x < rightEdge && point.y > normalized.y && point.y < bottomEdge
}

export const intersectsRect = (a: Rect, b: Rect, touching = false): boolean => {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const rightEdge = Math.min(right(a), right(b))
  const bottomEdge = Math.min(bottom(a), bottom(b))
  return touching ? rightEdge >= left && bottomEdge >= top : rightEdge > left && bottomEdge > top
}

export const containsRect = (outer: Rect, inner: Rect, tolerance = 0): boolean =>
  inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance && right(inner) <= right(outer) + tolerance && bottom(inner) <= bottom(outer) + tolerance

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const elementMap = (elementsOrPage: Pick<Page, 'elements'> | DesignElement[]): Map<string, DesignElement> => {
  const elements = Array.isArray(elementsOrPage) ? elementsOrPage : elementsOrPage.elements
  return new Map(elements.map((element) => [element.id, element]))
}

/** Returns true when `candidateId` is a descendant of `ancestorId`. */
export const isDescendant = (candidateId: string, ancestorId: string, elementsOrPage: Pick<Page, 'elements'> | DesignElement[]): boolean => {
  const map = elementMap(elementsOrPage)
  let current = map.get(candidateId)
  const seen = new Set<string>()
  while (current?.parentId && !seen.has(current.parentId)) {
    if (current.parentId === ancestorId) return true
    seen.add(current.parentId)
    current = map.get(current.parentId)
  }
  return false
}

/**
 * Resolve an element's local hierarchy position into page-global coordinates.
 * Free-standing elements are already page-global. Cycles are treated as a
 * broken parent link so malformed imported documents cannot recurse forever.
 */
export const getAbsoluteRect = (element: DesignElement, elementsOrPage: Pick<Page, 'elements'> | DesignElement[]): Rect => {
  const map = elementMap(elementsOrPage)
  let x = finite(element.x)
  let y = finite(element.y)
  let current = element
  const seen = new Set<string>([element.id])
  while (current.parentId && !seen.has(current.parentId)) {
    const parent = map.get(current.parentId)
    if (!parent) break
    x += finite(parent.x)
    y += finite(parent.y)
    current = parent
    seen.add(current.id)
  }
  return { x, y, width: nonNegative(element.width), height: nonNegative(element.height) }
}

export const getAbsolutePoint = (element: DesignElement, point: Point, elementsOrPage: Pick<Page, 'elements'> | DesignElement[]): Point => {
  const rect = getAbsoluteRect(element, elementsOrPage)
  const own = rectFromElement(element)
  return { x: rect.x + point.x - own.x, y: rect.y + point.y - own.y }
}

export const getAbsoluteRects = (page: Pick<Page, 'elements'>): Record<string, Rect> => Object.fromEntries(page.elements.map((element) => [element.id, getAbsoluteRect(element, page)]))

export const getSelectionBounds = (elements: DesignElement[], elementsOrPage?: Pick<Page, 'elements'> | DesignElement[]): Rect | null => {
  const source = elementsOrPage ?? elements
  return rectUnion(elements.map((element) => getAbsoluteRect(element, source)))
}

export const selectionBounds = getSelectionBounds

export const rotatePoint = (point: Point, center: Point, degrees: number): Point => {
  const radians = degrees * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

export const rotateVector = (vector: Point, degrees: number): Point => rotatePoint(vector, { x: 0, y: 0 }, degrees)

/** Distance from a rounded-rectangle corner, measured in the element's local axes. */
export const cornerRadiusFromPoint = (rect: Rect, corner: CornerName, point: Point, rotation = 0): number => {
  const center = { x: centerX(rect), y: centerY(rect) }
  const local = rotatePoint(point, center, -rotation)
  const cornerPoint: Point = { x: corner.includes('Right') ? right(rect) : rect.x, y: corner.includes('bottom') ? bottom(rect) : rect.y }
  return clamp(Math.hypot(local.x - cornerPoint.x, local.y - cornerPoint.y), 0, Math.min(rect.width, rect.height) / 2)
}

export const rotatedBounds = (rect: Rect, degrees: number): Rect => {
  if (!degrees) return { ...rect }
  const center = { x: centerX(rect), y: centerY(rect) }
  const corners = [
    { x: rect.x, y: rect.y }, { x: right(rect), y: rect.y },
    { x: right(rect), y: bottom(rect) }, { x: rect.x, y: bottom(rect) },
  ].map((point) => rotatePoint(point, center, degrees))
  return rectUnion(corners.map((point) => ({ ...point, width: 0, height: 0 }))) ?? rect
}

export const angleFromCenter = (point: Point, center: Point, offset = 90): number => Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI + offset

export const resizeRect = (start: Rect, handle: string, dx: number, dy: number, options: ResizeOptions = {}): Rect => {
  const minWidth = Math.max(0, finite(options.minWidth, 1))
  const minHeight = Math.max(0, finite(options.minHeight, 1))
  const maxWidth = Math.max(minWidth, finite(options.maxWidth, Number.POSITIVE_INFINITY))
  const maxHeight = Math.max(minHeight, finite(options.maxHeight, Number.POSITIVE_INFINITY))
  const rightEdge = right(start)
  const bottomEdge = bottom(start)
  let x = start.x
  let y = start.y
  let width = start.width
  let height = start.height

  if (handle.includes('e')) width = clamp(start.width + dx, minWidth, maxWidth)
  if (handle.includes('s')) height = clamp(start.height + dy, minHeight, maxHeight)
  if (handle.includes('w')) { width = clamp(start.width - dx, minWidth, maxWidth); x = rightEdge - width }
  if (handle.includes('n')) { height = clamp(start.height - dy, minHeight, maxHeight); y = bottomEdge - height }

  const ratio = finite(options.aspectRatio, start.height ? start.width / start.height : 0)
  if (options.preserveAspect && ratio > 0 && (handle.includes('e') || handle.includes('w') || handle.includes('n') || handle.includes('s'))) {
    const horizontal = Math.abs(dx) >= Math.abs(dy)
    if (horizontal) {
      height = clamp(width / ratio, minHeight, maxHeight)
      if (handle.includes('n')) y = bottomEdge - height
      else if (options.centered) y = start.y + (start.height - height) / 2
    } else {
      width = clamp(height * ratio, minWidth, maxWidth)
      if (handle.includes('w')) x = rightEdge - width
      else if (options.centered) x = start.x + (start.width - width) / 2
    }
  }
  if (options.centered) {
    if (handle.includes('e') && !handle.includes('w')) x = start.x - (width - start.width) / 2
    if (handle.includes('w') && !handle.includes('e')) x = start.x - (width - start.width) / 2
    if (handle.includes('s') && !handle.includes('n')) y = start.y - (height - start.height) / 2
    if (handle.includes('n') && !handle.includes('s')) y = start.y - (height - start.height) / 2
  }
  return { x, y, width, height }
}

/** Resize a rotated element from local-axis pointer deltas while preserving the opposite local edge. */
export const resizeRotatedRect = (start: Rect, rotation: number, handle: string, pageDx: number, pageDy: number, options: ResizeOptions = {}): Rect => {
  const localDelta = rotateVector({ x: pageDx, y: pageDy }, -rotation)
  const local = resizeRect({ x: 0, y: 0, width: start.width, height: start.height }, handle, localDelta.x, localDelta.y, options)
  const topLeftDelta = rotateVector({ x: local.x, y: local.y }, rotation)
  return { x: start.x + topLeftDelta.x, y: start.y + topLeftDelta.y, width: local.width, height: local.height }
}

export const getElementBaseline = (element: ElementWithOptionalGuideData, rect: Rect): number => {
  if (Number.isFinite(element.textBaseline)) return rect.y + Number(element.textBaseline)
  if (Number.isFinite(element.baseline)) return rect.y + Number(element.baseline)
  const fontSize = finite(element.fontSize, 16)
  const lineHeight = finite(element.lineHeight, 1.35)
  return rect.y + Math.min(rect.height, fontSize * lineHeight * 0.8)
}

const uniqueSorted = (values: number[]): number[] => Array.from(new Set(values.filter(Number.isFinite).map((value) => Math.round(value * 1000) / 1000))).sort((a, b) => a - b)

const addGuide = (guides: SnapGuide[], guide: SnapGuide) => {
  if (!Number.isFinite(guide.position)) return
  guides.push({ ...guide, priority: guide.priority ?? 10, order: guide.order ?? guides.length })
}

const optionalGuides = (element: ElementWithOptionalGuideData, rect: Rect, order: number): SnapGuide[] => {
  const result: SnapGuide[] = []
  const source = element.guides ?? (element.guide ? [element.guide] : [])
  source.forEach((guide, index) => addGuide(result, { ...guide, kind: 'guide', sourceId: element.id, order: order + index }))
  return result
}

const normalizeUserGuides = (userGuides: SnapOptions['userGuides']): { axis: SnapAxis; position: number; label?: string }[] => {
  if (!userGuides) return []
  return userGuides.flatMap((guide) => typeof guide === 'number'
    ? [{ axis: 'x' as const, position: guide }, { axis: 'y' as const, position: guide }]
    : [{ axis: guide.axis, position: finite(guide.position), label: guide.label }])
}

const defaultOptions = (options: SnapOptions): Required<Pick<SnapOptions, 'tolerance' | 'includePage' | 'includeEdges' | 'includeCenters' | 'includeParent' | 'includePadding' | 'includeGrid' | 'gridSize' | 'includeGuides' | 'includeBaselines' | 'includeEqualGaps' | 'bypass'>> => ({
  tolerance: Math.max(0, finite(options.tolerance, 8)), includePage: options.includePage !== false,
  includeEdges: options.includeEdges !== false, includeCenters: options.includeCenters !== false,
  includeParent: options.includeParent !== false, includePadding: options.includePadding !== false,
  includeGrid: Boolean(options.includeGrid), gridSize: Math.max(1, finite(options.gridSize, 8)),
  includeGuides: options.includeGuides !== false, includeBaselines: options.includeBaselines !== false,
  includeEqualGaps: options.includeEqualGaps !== false, bypass: Boolean(options.bypass),
})

/** Build deterministic alignment candidates, excluding the entire moving subtree. */
export const buildSnapGuides = (page: Pick<Page, 'width' | 'height' | 'elements'>, movingIds: Iterable<string> = [], options: SnapOptions = {}): SnapGuide[] => {
  const config = defaultOptions(options)
  if (config.bypass) return []
  const moving = new Set(movingIds)
  const elements = page.elements
  const rects = new Map(elements.map((element) => [element.id, getAbsoluteRect(element, page)]))
  const excluded = (element: DesignElement): boolean => moving.has(element.id) || Array.from(moving).some((id) => isDescendant(element.id, id, page)) || Array.from(moving).some((id) => isDescendant(id, element.id, page))
  const guides: SnapGuide[] = []
  const addAxisRect = (rect: Rect, sourceId: string | undefined, kind: SnapKind, order: number, priority: number) => {
    if (config.includeEdges) {
      addGuide(guides, { axis: 'x', position: rect.x, sourceId, kind, order, priority })
      addGuide(guides, { axis: 'x', position: right(rect), sourceId, kind, order, priority })
      addGuide(guides, { axis: 'y', position: rect.y, sourceId, kind, order, priority })
      addGuide(guides, { axis: 'y', position: bottom(rect), sourceId, kind, order, priority })
    }
    if (config.includeCenters) {
      addGuide(guides, { axis: 'x', position: centerX(rect), sourceId, kind: 'center', order, priority })
      addGuide(guides, { axis: 'y', position: centerY(rect), sourceId, kind: 'center', order, priority })
    }
  }

  elements.forEach((element, index) => {
    if (!element.visible || excluded(element)) return
    const rect = rects.get(element.id)
    if (!rect) return
    addAxisRect(rect, element.id, 'edge', index, 20)
    if (config.includeBaselines && (element.type === 'text' || element.type === 'button' || element.text)) addGuide(guides, { axis: 'y', position: getElementBaseline(element, rect), sourceId: element.id, kind: 'baseline', priority: 15, order: index })
    if (config.includeGuides) optionalGuides(element, rect, index).forEach((guide) => addGuide(guides, { ...guide, priority: 8 }))
  })

  if (config.includePage) addAxisRect({ x: 0, y: 0, width: finite(page.width), height: finite(page.height) }, undefined, 'page', -20, 30)

  const parent = options.parentId ? elements.find((element) => element.id === options.parentId) : undefined
  if (config.includeParent && parent) {
    const parentRect = rects.get(parent.id)
    if (parentRect) {
      addAxisRect(parentRect, parent.id, 'parent', -10, 25)
      if (config.includePadding) {
        const padding = finite(parent.layout?.padding, 0)
        const padded = expandRect({ x: parentRect.x + padding, y: parentRect.y + padding, width: Math.max(0, parentRect.width - padding * 2), height: Math.max(0, parentRect.height - padding * 2) }, 0)
        addAxisRect(padded, parent.id, 'padding', -9, 12)
      }
    }
  }

  if (config.includeGrid) {
    // Grid lines are generated around the document bounds instead of eagerly
    // allocating every line, which keeps large pages inexpensive.
    for (let value = 0; value <= finite(page.width); value += config.gridSize) addGuide(guides, { axis: 'x', position: value, kind: 'grid', priority: 40, order: value })
    for (let value = 0; value <= finite(page.height); value += config.gridSize) addGuide(guides, { axis: 'y', position: value, kind: 'grid', priority: 40, order: value })
  }
  if (config.includeGuides) normalizeUserGuides(options.userGuides).forEach((guide, index) => addGuide(guides, { ...guide, kind: 'guide', priority: 5, order: -1000 + index }))

  if (config.includeEqualGaps) {
    // Equal-gap guides are derived from pairs on the same axis. A moving edge
    // can therefore land at the same gap on either side without self-snapping.
    const stationary = elements.filter((element) => element.visible && !excluded(element)).map((element) => ({ element, rect: rects.get(element.id)! })).filter((item) => item.rect)
    for (const left of stationary) for (const rightItem of stationary) {
      if (left.element.id === rightItem.element.id) continue
      const sameBand = Math.abs(centerY(left.rect) - centerY(rightItem.rect)) <= Math.max(left.rect.height, rightItem.rect.height) * 0.75
      if (sameBand) {
        const gap = rightItem.rect.x - right(left.rect)
        if (gap >= 0) {
          addGuide(guides, { axis: 'x', position: right(rightItem.rect) + gap, sourceId: `${left.element.id}:${rightItem.element.id}`, kind: 'equal-gap', priority: 35, order: elements.length + 1 })
          addGuide(guides, { axis: 'x', position: right(left.rect) - gap, sourceId: `${left.element.id}:${rightItem.element.id}`, kind: 'equal-gap', priority: 35, order: elements.length + 2 })
        }
      }
      const sameColumn = Math.abs(centerX(left.rect) - centerX(rightItem.rect)) <= Math.max(left.rect.width, rightItem.rect.width) * 0.75
      if (sameColumn) {
        const gap = rightItem.rect.y - bottom(left.rect)
        if (gap >= 0) {
          addGuide(guides, { axis: 'y', position: bottom(rightItem.rect) + gap, sourceId: `${left.element.id}:${rightItem.element.id}`, kind: 'equal-gap', priority: 35, order: elements.length + 3 })
          addGuide(guides, { axis: 'y', position: bottom(left.rect) - gap, sourceId: `${left.element.id}:${rightItem.element.id}`, kind: 'equal-gap', priority: 35, order: elements.length + 4 })
        }
      }
    }
  }
  return guides
}

const candidateAnchors = (rect: Rect, axis: SnapAxis): { value: number; name: string }[] => axis === 'x'
  ? [{ value: rect.x, name: 'left' }, { value: centerX(rect), name: 'center' }, { value: right(rect), name: 'right' }]
  : [{ value: rect.y, name: 'top' }, { value: centerY(rect), name: 'center' }, { value: bottom(rect), name: 'bottom' }]

/** Snap a rectangle with stable tie breaking and return the visible guide lines. */
export const snapRect = (rect: Rect, page: Pick<Page, 'width' | 'height' | 'elements'>, options: SnapOptions = {}): SnapResult => {
  const config = defaultOptions(options)
  if (config.bypass) return { rect: { ...rect }, delta: { x: 0, y: 0 }, guides: [], vertical: [], horizontal: [] }
  const guides = buildSnapGuides(page, options.movingIds, options)
  const choose = (axis: SnapAxis): { delta: number; guide: SnapGuide; anchor: string } | null => {
    const candidates = guides.filter((guide) => guide.axis === axis)
    const matches = candidateAnchors(rect, axis).flatMap((anchor) => candidates.map((guide) => ({
      delta: guide.position - anchor.value, guide, anchor: anchor.name,
    }))).filter((candidate) => Math.abs(candidate.delta) <= config.tolerance)
    matches.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || (a.guide.priority ?? 10) - (b.guide.priority ?? 10) || (a.guide.order ?? 0) - (b.guide.order ?? 0) || a.guide.position - b.guide.position || a.anchor.localeCompare(b.anchor))
    return matches[0] ?? null
  }
  const x = choose('x')
  const y = choose('y')
  const snapped = { ...rect, x: rect.x + (x?.delta ?? 0), y: rect.y + (y?.delta ?? 0) }
  const matched = [x?.guide, y?.guide].filter((guide): guide is SnapGuide => Boolean(guide))
  return {
    rect: snapped,
    delta: { x: x?.delta ?? 0, y: y?.delta ?? 0 },
    guides: matched,
    vertical: uniqueSorted(matched.filter((guide) => guide.axis === 'x').map((guide) => guide.position)),
    horizontal: uniqueSorted(matched.filter((guide) => guide.axis === 'y').map((guide) => guide.position)),
  }
}

export const snapMove = snapRect
export const getSnapGuides = buildSnapGuides
export const moveRect = translateRect
export const pointInRect = containsPoint
export const rectsOverlap = intersectsRect
export const getBounds = getSelectionBounds
export const getAbsolutePosition = getAbsolutePoint

/** Snap only the edges being dragged during a resize. The opposite edges stay fixed. */
export const snapResizeRect = (rect: Rect, start: Rect, handle: string, page: Pick<Page, 'width' | 'height' | 'elements'>, options: SnapOptions = {}): SnapResult => {
  const config = defaultOptions(options)
  if (config.bypass) return { rect: { ...rect }, delta: { x: 0, y: 0 }, guides: [], vertical: [], horizontal: [] }
  const guides = buildSnapGuides(page, options.movingIds, options)
  const find = (axis: SnapAxis, value: number): { delta: number; guide: SnapGuide } | null => {
    const matches = guides.filter((guide) => guide.axis === axis).map((guide) => ({ delta: guide.position - value, guide })).filter((item) => Math.abs(item.delta) <= config.tolerance)
    matches.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || (a.guide.priority ?? 10) - (b.guide.priority ?? 10) || (a.guide.order ?? 0) - (b.guide.order ?? 0) || a.guide.position - b.guide.position)
    return matches[0] ?? null
  }
  let next = { ...rect }
  const matched: SnapGuide[] = []
  const moving = new Set(options.movingIds ?? [])
  const stationary = page.elements
    .filter((element) => element.visible && !moving.has(element.id) && !Array.from(moving).some((id) => isDescendant(element.id, id, page) || isDescendant(id, element.id, page)))
    .map((element, index) => ({ element, rect: getAbsoluteRect(element, page), index }))
  const sizeMatch = (axis: SnapAxis, value: number): { delta: number; width: number; guide: SnapGuide } | null => {
    const matches = stationary.map(({ element, rect: candidate, index }) => {
      const size = axis === 'x' ? candidate.width : candidate.height
      return { delta: size - value, width: size, guide: { axis, position: axis === 'x' ? right(candidate) : bottom(candidate), kind: 'size' as const, sourceId: element.id, priority: 10, order: index } }
    }).filter((item) => Math.abs(item.delta) <= config.tolerance)
    matches.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || (a.guide.order ?? 0) - (b.guide.order ?? 0) || a.guide.position - b.guide.position)
    return matches[0] ?? null
  }
  if (handle.includes('e')) {
    const match = find('x', right(next))
    if (match) { next.width = Math.max(0, match.guide.position - next.x); matched.push(match.guide) }
    else {
      const equal = sizeMatch('x', next.width)
      if (equal) { next.width = equal.width; matched.push(equal.guide) }
    }
  } else if (handle.includes('w')) {
    const match = find('x', next.x)
    if (match) { next.width = Math.max(0, right(next) - match.guide.position); next.x = match.guide.position; matched.push(match.guide) }
    else {
      const equal = sizeMatch('x', next.width)
      if (equal) { next.width = equal.width; next.x = right(next) - equal.width; matched.push({ ...equal.guide, position: next.x }) }
    }
  }
  if (handle.includes('s')) {
    const match = find('y', bottom(next))
    if (match) { next.height = Math.max(0, match.guide.position - next.y); matched.push(match.guide) }
    else {
      const equal = sizeMatch('y', next.height)
      if (equal) { next.height = equal.width; matched.push(equal.guide) }
    }
  } else if (handle.includes('n')) {
    const match = find('y', next.y)
    if (match) { next.height = Math.max(0, bottom(next) - match.guide.position); next.y = match.guide.position; matched.push(match.guide) }
    else {
      const equal = sizeMatch('y', next.height)
      if (equal) { next.height = equal.width; next.y = bottom(next) - equal.width; matched.push({ ...equal.guide, position: next.y }) }
    }
  }
  return { rect: next, delta: { x: next.x - rect.x, y: next.y - rect.y }, guides: matched, vertical: uniqueSorted(matched.filter((guide) => guide.axis === 'x').map((guide) => guide.position)), horizontal: uniqueSorted(matched.filter((guide) => guide.axis === 'y').map((guide) => guide.position)) }
}

export const rectToStyle = (rect: Rect): { left: number; top: number; width: number; height: number } => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })
