import type { DesignElement, LayoutRules, Page } from './model'
import type { Rect, Size } from './geometry'

/** Structural extensions: old documents need no migration. Coordinates are parent-local. */
export type ExtendedLayoutRules = LayoutRules & {
  columns?: number
  columnCount?: number
  minItemWidth?: number
  position?: 'auto' | 'absolute'
}
export type LayoutRulePatch = Partial<ExtendedLayoutRules> & { [key: string]: unknown }
/** minWidth/maxWidth select a viewport range; size constraints belong inside layout. */
export type LayoutOverride = Partial<Omit<DesignElement, 'id' | 'parentId' | 'layout'>> & {
  minWidth?: number
  maxWidth?: number
  layout?: LayoutRulePatch
  rules?: LayoutRulePatch
  mode?: LayoutRules['mode']
  gap?: number
  padding?: number
}
export interface LayoutOptions {
  width?: number
  height?: number
  pagePadding?: number
  /** Deprecated: deliberately ignored. Responsive layout never scales the design. */
  scaleFreeElements?: boolean
  /** Optional text metrics keep the calculation pure and support real font advances. */
  measureText?: (text: string, element: DesignElement) => number
}
export interface ResolvedElementLayout extends Rect {
  id: string
  element: DesignElement
  rect: Rect
  parentId?: string
  rules: ExtendedLayoutRules
  visible: boolean
}
export interface LayoutResult {
  width: number
  height: number
  page: { width: number; height: number }
  elements: Record<string, ResolvedElementLayout>
  rects: Record<string, Rect>
  orderedIds: string[]
  get(id: string): ResolvedElementLayout | undefined
}
const n = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const defaults = (): ExtendedLayoutRules => ({ mode: 'free', gap: 0, padding: 0, align: 'start', justify: 'start', wrap: false, widthRule: 'fixed', heightRule: 'fixed', overflow: 'visible' })
const constrain = (value: number, rules: ExtendedLayoutRules, axis: 'width' | 'height') => {
  const min = Math.max(0, n(axis === 'width' ? rules.minWidth : rules.minHeight))
  const max = Math.max(min, n(axis === 'width' ? rules.maxWidth : rules.maxHeight, Infinity))
  return Math.min(max, Math.max(min, value))
}

function responsivePatches(element: DesignElement, width: number, page?: Pick<Page, 'breakpoints'>): Record<string, unknown>[] {
  const source = element as DesignElement & { responsive?: unknown; breakpoints?: unknown }
  const layout = element.layout as LayoutRules & { responsive?: unknown; breakpoints?: unknown } | undefined
  const matches: { min: number; order: number; patch: Record<string, unknown> }[] = []
  let order = 0
  for (const container of [source.responsive, source.breakpoints, layout?.responsive, layout?.breakpoints]) {
    const entries = Array.isArray(container) ? container.map((entry) => [undefined, entry] as const) : Object.entries(record(container) ?? {})
    for (const [key, value] of entries) {
      const patch = record(value)
      if (!patch) continue
      const namedBreakpoint = typeof patch.breakpoint === 'string' ? patch.breakpoint : undefined
      const breakpoint = page?.breakpoints.find((bp) => bp.id === key || bp.name.toLowerCase() === key?.toLowerCase() || bp.id === namedBreakpoint || bp.name.toLowerCase() === namedBreakpoint?.toLowerCase())
      const keyWidth = key !== undefined && /^\d+$/.test(key) ? Number(key) : breakpoint?.width
      const min = n(patch.minWidth, keyWidth ?? 0)
      const max = n(patch.maxWidth, Infinity)
      if (width >= min && width <= max) matches.push({ min, order: order++, patch })
    }
  }
  for (const [key, value] of Object.entries(element.overrides ?? {})) {
    const objectRange = /^(?:@)?(\d+)$/.exec(key)
    const objectBreakpoint = page?.breakpoints.find((bp) => bp.id === key || bp.name.toLowerCase() === key.toLowerCase())
    if ((objectRange || objectBreakpoint) && record(value)) {
      const min = objectRange ? Number(objectRange[1]) : objectBreakpoint?.width ?? 0
      if (width >= min) matches.push({ min, order: order++, patch: record(value)! })
      continue
    }
    const match = /^(?:@|width:|min-width:)?(\d+)[.:](.+)$/.exec(key)
    if (match && width >= Number(match[1])) matches.push({ min: Number(match[1]), order: order++, patch: { [match[2]]: value } })
  }
  return matches.sort((a, b) => a.min - b.min || a.order - b.order).map(({ patch }) => patch)
}

export function resolveResponsiveElement(element: DesignElement, width: number, page?: Pick<Page, 'breakpoints'>): DesignElement {
  let result: DesignElement = { ...element, layout: element.layout ? { ...element.layout } : undefined }
  const layoutKeys = new Set(['mode', 'gap', 'padding', 'align', 'justify', 'wrap', 'widthRule', 'heightRule', 'overflow', 'columns', 'columnCount', 'minItemWidth', 'position'])
  for (const source of responsivePatches(element, width, page)) {
    const { minWidth: _min, maxWidth: _max, rules, layout, id: _id, parentId: _parent, ...props } = source
    const layoutPatch = { ...record(rules), ...record(layout) }
    for (const key of Object.keys(props)) {
      if (layoutKeys.has(key)) { layoutPatch[key] = props[key]; delete props[key] }
      else if (key.startsWith('layout.')) { layoutPatch[key.slice(7)] = props[key]; delete props[key] }
    }
    result = { ...result, ...props, layout: { ...defaults(), ...result.layout, ...layoutPatch } } as DesignElement
  }
  return result
}

export function resolveResponsiveRules(element: DesignElement, width: number, page?: Pick<Page, 'breakpoints'>): ExtendedLayoutRules {
  const resolved = resolveResponsiveElement(element, width, page)
  const rules = { ...defaults(), ...resolved.layout }
  return { ...rules, gap: Math.max(0, n(rules.gap)), padding: Math.max(0, n(rules.padding)) }
}

/** Uniformly distribute space, redistributing when a child's min/max clamps. */
function distributeFill(total: number, indexes: number[], sizes: number[], rules: ExtendedLayoutRules[], axis: 'width' | 'height') {
  const active = new Set(indexes)
  let remaining = Math.max(0, total)
  while (active.size) {
    const share = remaining / active.size
    let clamped = false
    for (const index of [...active]) {
      const size = constrain(share, rules[index], axis)
      if (Math.abs(size - share) > .0001) { sizes[index] = size; remaining -= size; active.delete(index); clamped = true }
    }
    if (!clamped) { for (const index of active) sizes[index] = constrain(Math.max(0, share), rules[index], axis); break }
  }
}

function justify(count: number, available: number, used: number, gap: number, mode: LayoutRules['justify']) {
  const free = Math.max(0, available - used)
  if (mode === 'center') return { start: free / 2, gap }
  if (mode === 'end') return { start: free, gap }
  if (mode === 'space-between' && count > 1) return { start: 0, gap: gap + free / (count - 1) }
  if (mode === 'space-around' && count > 0) return { start: free / count / 2, gap: gap + free / count }
  return { start: 0, gap }
}

interface Box extends Size { children: { element: DesignElement; rect: Rect; box: Box }[] }

export function computeLayout(page: Page, widthOrOptions: number | LayoutOptions = page.width): LayoutResult {
  const options = typeof widthOrOptions === 'number' ? { width: widthOrOptions } : widthOrOptions
  const width = Math.max(1, n(options.width, page.width))
  const viewportHeight = Math.max(1, n(options.height, page.height))
  const effective = page.elements.map((element) => resolveResponsiveElement(element, width, page))
  const map = new Map(effective.map((element) => [element.id, element]))
  // A malformed cycle is broken deterministically at the first document node.
  const parentMap = new Map(effective.map((element) => [element.id, map.has(element.parentId ?? '') ? element.parentId : undefined]))
  for (const element of effective) {
    const seen = new Set([element.id])
    let parent = parentMap.get(element.id)
    while (parent) {
      if (seen.has(parent)) { parentMap.set(element.id, undefined); break }
      seen.add(parent); parent = parentMap.get(parent)
    }
  }
  const children = new Map<string | undefined, DesignElement[]>()
  for (const element of effective) {
    const parent = parentMap.get(element.id)
    children.set(parent, [...(children.get(parent) ?? []), element])
  }
  const ruleMap = new Map(effective.map((element) => [element.id, { ...defaults(), ...element.layout, gap: Math.max(0, n(element.layout?.gap)), padding: Math.max(0, n(element.layout?.padding)) } as ExtendedLayoutRules]))
  const textWidth = (text: string, element: DesignElement) => options.measureText ? Math.max(0, options.measureText(text, element)) : Array.from(text).reduce((sum, char) => sum + n(element.fontSize, 16) * (/\s/.test(char) ? .28 : /[MW@#]/.test(char) ? .85 : /[il.,!'|]/.test(char) ? .28 : /[^\u0000-\u00ff]/.test(char) ? 1 : .56), 0) + Math.max(0, text.length - 1) * n(element.letterSpacing)
  function textSize(element: DesignElement, availableWidth?: number): Size {
    if (!element.text) return { width: 0, height: 0 }
    const lines = element.text.split('\n')
    const intrinsicWidth = Math.max(0, ...lines.map((line) => textWidth(line, element)))
    let count = lines.length
    if (element.wrap !== 'auto' && availableWidth !== undefined && availableWidth > 0) {
      count = 0
      for (const line of lines) {
        let current = ''; let lineCount = 1
        for (const token of line.split(/(\s+)/)) {
          if (textWidth(current + token, element) <= availableWidth) current += token
          else {
            if (current.trim()) { lineCount++; current = '' }
            for (const char of token) {
              if (current && textWidth(current + char, element) > availableWidth) { lineCount++; current = '' }
              current += char
            }
          }
        }
        count += lineCount
      }
    }
    return { width: intrinsicWidth, height: count * n(element.fontSize, 16) * n(element.lineHeight, 1.35) }
  }

  function measure(element: DesignElement, available: Size, forced: Partial<Size> = {}, path = new Set<string>()): Box {
    const rules = ruleMap.get(element.id)!
    if (path.has(element.id)) return { width: n(element.width), height: n(element.height), children: [] }
    const nextPath = new Set(path).add(element.id)
    const pad = rules.padding
    const childList = (children.get(element.id) ?? []).filter((child) => child.visible !== false)
    const flow = childList.filter((child) => ruleMap.get(child.id)!.position !== 'absolute')
    const absolute = childList.filter((child) => ruleMap.get(child.id)!.position === 'absolute')
    const naturalText = textSize(element)
    const leaf = childList.length === 0
    const naturalWidth = naturalText.width + (element.type === 'text' ? 0 : pad * 2)
    let w = forced.width ?? (rules.widthRule === 'fill' ? available.width : rules.widthRule === 'fit' ? leaf ? naturalWidth || n(element.width) : available.width : n(element.width))
    let h = forced.height ?? (rules.heightRule === 'fill' ? available.height : rules.heightRule === 'fit' ? 0 : n(element.height))
    w = constrain(Math.max(0, w), rules, 'width'); h = constrain(Math.max(0, h), rules, 'height')
    let innerW = Math.max(0, w - pad * 2)
    const heightAuto = rules.heightRule === 'fit' && forced.height === undefined
    const widthAuto = rules.widthRule === 'fit' && forced.width === undefined
    const innerH = Math.max(0, (heightAuto ? available.height : h) - pad * 2)
    const placements: Box['children'] = []

    if (rules.mode === 'free') {
      for (const child of childList) {
        const remaining = { width: Math.max(0, w - n(child.x)), height: Math.max(0, (heightAuto ? available.height : h) - n(child.y)) }
        const box = measure(child, remaining, {}, nextPath)
        placements.push({ element: child, rect: { x: n(child.x), y: n(child.y), width: box.width, height: box.height }, box })
      }
    } else if (rules.mode === 'grid') {
      const natural = flow.map((child) => measure(child, { width: innerW, height: innerH }, {}, nextPath))
      const minimum = Math.max(1, n(rules.minItemWidth, Math.max(1, ...flow.map((child, i) => ruleMap.get(child.id)!.widthRule === 'fill' ? n(ruleMap.get(child.id)!.minWidth, 160) : natural[i].width))))
      const columns = Math.max(1, Math.min(1000, Math.floor(n(rules.columns, n(rules.columnCount, Math.max(1, Math.floor((innerW + rules.gap) / (minimum + rules.gap))))))))
      if (widthAuto) { w = constrain(Math.min(available.width, Math.min(columns, flow.length) * minimum + Math.max(0, Math.min(columns, flow.length) - 1) * rules.gap + pad * 2), rules, 'width'); innerW = Math.max(0, w - pad * 2) }
      const cellWidth = Math.max(0, (innerW - (columns - 1) * rules.gap) / columns)
      const boxes = flow.map((child) => {
        const r = ruleMap.get(child.id)!
        return measure(child, { width: cellWidth, height: innerH }, { width: r.widthRule === 'fill' || rules.align === 'stretch' ? constrain(cellWidth, r, 'width') : undefined }, nextPath)
      })
      const rows = Math.ceil(flow.length / columns)
      const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(0, ...boxes.slice(row * columns, (row + 1) * columns).map((box) => box.height)))
      let y = pad
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const index = row * columns + column; const child = flow[index]
          if (!child) break
          const r = ruleMap.get(child.id)!
          const box = r.heightRule === 'fill' ? measure(child, { width: cellWidth, height: rowHeights[row] }, { width: boxes[index].width, height: rowHeights[row] }, nextPath) : boxes[index]
          const xOffset = rules.align === 'center' ? (cellWidth - box.width) / 2 : rules.align === 'end' ? cellWidth - box.width : 0
          placements.push({ element: child, rect: { x: pad + column * (cellWidth + rules.gap) + xOffset, y, width: box.width, height: box.height }, box })
        }
        y += rowHeights[row] + rules.gap
      }
    } else {
      const row = rules.mode === 'row'
      const mainAxis = row ? 'width' : 'height'; const crossAxis = row ? 'height' : 'width'
      const mainAuto = row ? widthAuto : heightAuto
      const crossAuto = row ? heightAuto : widthAuto
      const availableMain = row ? innerW : innerH
      const availableCross = row ? innerH : innerW
      const initial = flow.map((child) => {
        const r = ruleMap.get(child.id)!
        const forcedCross = r[crossAxis === 'width' ? 'widthRule' : 'heightRule'] === 'fill' && !crossAuto || rules.align === 'stretch' && !crossAuto ? constrain(availableCross, r, crossAxis) : undefined
        return measure(child, { width: innerW, height: innerH }, { [crossAxis]: forcedCross }, nextPath)
      })
      const lines: number[][] = []; let line: number[] = []; let used = 0
      flow.forEach((child, i) => {
        const r = ruleMap.get(child.id)!
        const fill = r[mainAxis === 'width' ? 'widthRule' : 'heightRule'] === 'fill'
        const base = fill && !mainAuto ? constrain(0, r, mainAxis) : initial[i][mainAxis]
        if (rules.wrap && line.length && used + rules.gap + base > availableMain) { lines.push(line); line = []; used = 0 }
        used += (line.length ? rules.gap : 0) + base; line.push(i)
      })
      if (line.length) lines.push(line)
      let crossCursor = pad
      for (const indexes of lines) {
        const sizes = indexes.map((i) => initial[i][mainAxis])
        const rs = indexes.map((i) => ruleMap.get(flow[i].id)!)
        const fillIndexes = indexes.flatMap((_i, j) => rs[j][mainAxis === 'width' ? 'widthRule' : 'heightRule'] === 'fill' ? [j] : [])
        if (!mainAuto && fillIndexes.length) {
          const fixed = sizes.reduce((sum, size, j) => sum + (fillIndexes.includes(j) ? 0 : size), 0)
          distributeFill(availableMain - fixed - Math.max(0, indexes.length - 1) * rules.gap, fillIndexes, sizes, rs, mainAxis)
        }
        const boxes = indexes.map((i, j) => measure(flow[i], { width: innerW, height: innerH }, { [mainAxis]: sizes[j], [crossAxis]: initial[i][crossAxis] && (rs[j][crossAxis === 'width' ? 'widthRule' : 'heightRule'] === 'fill' || rules.align === 'stretch') && !crossAuto ? availableCross : undefined }, nextPath))
        const naturalCross = Math.max(0, ...boxes.map((box) => box[crossAxis]))
        const lineCross = lines.length === 1 && !crossAuto ? availableCross : naturalCross
        const total = sizes.reduce((sum, size) => sum + size, 0) + Math.max(0, indexes.length - 1) * rules.gap
        const offsets = justify(indexes.length, mainAuto ? total : availableMain, total, rules.gap, rules.justify)
        let mainCursor = pad + offsets.start
        indexes.forEach((i, j) => {
          const child = flow[i]; let box = boxes[j]
          if (rules.align === 'stretch' || rs[j][crossAxis === 'width' ? 'widthRule' : 'heightRule'] === 'fill') box = measure(child, { width: innerW, height: innerH }, { [mainAxis]: sizes[j], [crossAxis]: constrain(lineCross, rs[j], crossAxis) }, nextPath)
          const crossOffset = rules.align === 'center' ? (lineCross - box[crossAxis]) / 2 : rules.align === 'end' ? lineCross - box[crossAxis] : 0
          const rect = { x: row ? mainCursor : crossCursor + crossOffset, y: row ? crossCursor + crossOffset : mainCursor, width: box.width, height: box.height }
          placements.push({ element: child, rect, box }); mainCursor += sizes[j] + offsets.gap
        })
        crossCursor += naturalCross + rules.gap
      }
    }
    if (rules.mode !== 'free') for (const child of absolute) {
      const box = measure(child, { width: Math.max(0, w - child.x), height: Math.max(0, h - child.y) }, {}, nextPath)
      placements.push({ element: child, rect: { x: child.x, y: child.y, width: box.width, height: box.height }, box })
    }
    const measuredText = textSize(element, Math.max(1, w - (element.type === 'text' ? 0 : pad * 2)))
    if (widthAuto) w = constrain(placements.length ? Math.max(0, ...placements.map(({ rect }) => rect.x + rect.width)) + pad : naturalWidth || n(element.width), rules, 'width')
    if (heightAuto) h = constrain(placements.length ? Math.max(0, ...placements.map(({ rect }) => rect.y + rect.height)) + pad : measuredText.height + (element.type === 'text' ? 0 : pad * 2) || n(element.height), rules, 'height')
    return { width: w, height: h, children: placements }
  }

  const result: Record<string, ResolvedElementLayout> = Object.create(null)
  const rects: Record<string, Rect> = Object.create(null)
  const orderedIds: string[] = []
  let contentBottom = viewportHeight
  function place(element: DesignElement, rect: Rect, box: Box, shown: boolean, contributes = true) {
    const visible = shown && element.visible !== false
    const rules = ruleMap.get(element.id)!
    result[element.id] = { id: element.id, element, parentId: parentMap.get(element.id), rules, rect, ...rect, visible }
    rects[element.id] = rect; orderedIds.push(element.id)
    if (visible && contributes) contentBottom = Math.max(contentBottom, rect.y + rect.height + n(options.pagePadding))
    for (const child of box.children) place(child.element, { ...child.rect, x: rect.x + child.rect.x, y: rect.y + child.rect.y }, child.box, visible, contributes && rules.overflow === 'visible')
    for (const child of children.get(element.id) ?? []) if (!result[child.id]) {
      const hiddenBox = measure(child, { width: rect.width, height: rect.height })
      place(child, { x: rect.x + n(child.x), y: rect.y + n(child.y), width: hiddenBox.width, height: hiddenBox.height }, hiddenBox, false, false)
    }
  }
  for (const element of children.get(undefined) ?? []) {
    const x = n(element.x); const y = n(element.y)
    // Keep the authored right inset when a root opts into fill.
    const rightInset = Math.max(0, page.width - n(element.x) - n(element.width))
    const box = measure(element, { width: Math.max(0, width - x - rightInset), height: Math.max(0, viewportHeight - y) })
    place(element, { x, y, width: box.width, height: box.height }, box, true)
  }
  return { width, height: Math.max(1, contentBottom), page: { width, height: Math.max(1, contentBottom) }, elements: result, rects, orderedIds, get: (id) => result[id] }
}

export const resolveLayout = computeLayout
export const layoutPage = computeLayout
export const calculateLayout = computeLayout
export const getResolvedElement = (layout: LayoutResult, id: string) => layout.elements[id]
export const getResolvedRect = (layout: LayoutResult, id: string) => layout.rects[id]
export const getLayoutRects = (page: Page, options: number | LayoutOptions = page.width) => computeLayout(page, options).rects
export const toParentLocalRect = (rect: Rect, parent?: Rect): Rect => ({ ...rect, x: rect.x - (parent?.x ?? 0), y: rect.y - (parent?.y ?? 0) })
export const toPageGlobalRect = (rect: Rect, parent?: Rect): Rect => ({ ...rect, x: rect.x + (parent?.x ?? 0), y: rect.y + (parent?.y ?? 0) })
export const isLayoutContainer = (element: DesignElement): boolean => Boolean(element.layout && element.layout.mode !== 'free')
