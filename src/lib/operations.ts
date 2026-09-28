import type { DesignElement, LayoutRules, Page } from './model'
import { makeElement, uid } from './model'
import { getAbsoluteRect, isDescendant, rectUnion, type Rect } from './geometry'
import { computeLayout } from './layout'

export type ReorderDirection = 'up' | 'down' | 'forward' | 'backward' | 'front' | 'back'

export interface OperationOptions {
  groupId?: string
  groupName?: string
  groupPadding?: number
  offset?: number | { x: number; y: number }
  idFactory?: (sourceId: string, index: number) => string
  interactionIdFactory?: (sourceId: string, index: number) => string
}

export interface OperationResult {
  page: Page
  selectedIds: string[]
  idMap: Record<string, string>
  groupId?: string
}

const clone = <T>(value: T): T => structuredClone(value)
const numberValue = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const byId = (page: Page): Map<string, DesignElement> => new Map(page.elements.map((element) => [element.id, element]))

const parentAbsolute = (page: Page, parentId?: string): Rect | undefined => {
  if (!parentId) return undefined
  const parent = page.elements.find((element) => element.id === parentId)
  return parent ? getAbsoluteRect(parent, page) : undefined
}

const globalToLocal = (page: Page, x: number, y: number, parentId?: string): { x: number; y: number } => {
  const parent = parentAbsolute(page, parentId)
  return { x: x - (parent?.x ?? 0), y: y - (parent?.y ?? 0) }
}

const ancestorIds = (page: Page, id: string): string[] => {
  const map = byId(page)
  const result: string[] = []
  const seen = new Set<string>()
  let current = map.get(id)
  while (current?.parentId && !seen.has(current.parentId)) {
    result.push(current.parentId)
    seen.add(current.parentId)
    current = map.get(current.parentId)
  }
  return result
}

export const isLockedByAncestor = (page: Page, id: string): boolean => {
  const map = byId(page)
  let current = map.get(id)
  const seen = new Set<string>()
  while (current?.parentId && !seen.has(current.parentId)) {
    const parent = map.get(current.parentId)
    if (!parent) return false
    if (parent.locked) return true
    seen.add(current.parentId)
    current = parent
  }
  return false
}

const selectedRoots = (page: Page, ids: Iterable<string>): DesignElement[] => {
  const set = new Set(ids)
  return page.elements.filter((element) => set.has(element.id) && !ancestorIds(page, element.id).some((ancestor) => set.has(ancestor)))
}

const descendants = (page: Page, id: string): DesignElement[] => page.elements.filter((element) => element.id === id || isDescendant(element.id, id, page))

const subtreeIds = (page: Page, ids: Iterable<string>): Set<string> => {
  const result = new Set<string>()
  for (const id of ids) descendants(page, id).forEach((element) => result.add(element.id))
  return result
}

const hasLockedBranch = (page: Page, rootId: string): boolean => descendants(page, rootId).some((element) => element.locked || isLockedByAncestor(page, element.id))

const uniqueId = (page: Page, preferred: string): string => {
  const used = new Set(page.elements.map((element) => element.id))
  if (!used.has(preferred)) return preferred
  let index = 2
  while (used.has(`${preferred}-${index}`)) index += 1
  return `${preferred}-${index}`
}

const defaultCloneIdFactory = (page: Page): ((sourceId: string, index: number) => string) => {
  const used = new Set(page.elements.map((element) => element.id))
  return (sourceId) => {
    const base = `${sourceId}-copy`
    let candidate = base
    let suffix = 2
    while (used.has(candidate)) candidate = `${base}-${suffix++}`
    used.add(candidate)
    return candidate
  }
}

const insertionIndexForRoots = (page: Page, roots: DesignElement[]): number => {
  const indexes = roots.map((root) => page.elements.findIndex((element) => element.id === root.id)).filter((index) => index >= 0)
  return indexes.length ? Math.min(...indexes) : page.elements.length
}

const boundingBox = (page: Page, elements: DesignElement[]): Rect | null => rectUnion(elements.map((element) => getAbsoluteRect(element, page)))

/** Group selected roots into a deterministic group and preserve page-global placement. */
export const groupElements = (page: Page, ids: Iterable<string>, options: OperationOptions = {}): Page => {
  const next = clone(page)
  const roots = selectedRoots(next, ids)
  if (roots.length < 2 || roots.some((element) => element.locked || isLockedByAncestor(next, element.id))) return next
  const box = boundingBox(next, roots)
  if (!box) return next
  const commonParent = roots.every((root) => root.parentId === roots[0].parentId) ? roots[0].parentId : undefined
  const padding = Math.max(0, numberValue(options.groupPadding, 0))
  const groupId = uniqueId(next, options.groupId ?? `group-${roots.map((root) => root.id).join('-')}`)
  const groupGlobal = { x: box.x - padding, y: box.y - padding }
  const local = globalToLocal(next, groupGlobal.x, groupGlobal.y, commonParent)
  const group = makeElement('group', {
    id: groupId,
    name: options.groupName ?? 'Group',
    parentId: commonParent,
    x: local.x,
    y: local.y,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
    fill: 'transparent',
    stroke: '#536174',
    layout: { ...(makeElement('group').layout as LayoutRules), mode: 'free' },
  })
  const before = new Map(next.elements.map((element) => [element.id, getAbsoluteRect(element, next)]))
  for (const root of roots) {
    const global = before.get(root.id)
    if (!global) continue
    const child = next.elements.find((element) => element.id === root.id)
    if (!child) continue
    child.parentId = group.id
    child.x = global.x - groupGlobal.x
    child.y = global.y - groupGlobal.y
  }
  const index = insertionIndexForRoots(next, roots)
  // Keep the roots in the flat document: they become the group's children.
  // Only the new container is inserted into the layer order.
  const without = next.elements.slice()
  const insertAt = Math.min(index, without.length)
  without.splice(insertAt, 0, group)
  next.elements = without
  return next
}

export const groupSelection = groupElements
export const group = groupElements
export const groupLayers = groupElements

export const groupElementsWithResult = (page: Page, ids: Iterable<string>, options: OperationOptions = {}): OperationResult => {
  const selected = Array.from(ids)
  const next = groupElements(page, selected, options)
  const originalIds = new Set(page.elements.map((element) => element.id))
  const groupId = next.elements.find((element) => !originalIds.has(element.id) && element.type === 'group')?.id
  return { page: next, selectedIds: groupId ? [groupId] : selected, idMap: {}, groupId }
}

/** Ungroup direct children while preserving their page-global positions. */
export const ungroupElements = (page: Page, groupIds: Iterable<string>): Page => {
  const next = clone(page)
  const ids = new Set(groupIds)
  const groups = next.elements.filter((element) => ids.has(element.id) && element.type === 'group' && !element.locked && !isLockedByAncestor(next, element.id))
  if (!groups.length) return next
  const snapshots = new Map(next.elements.map((element) => [element.id, getAbsoluteRect(element, next)]))
  const groupSet = new Set(groups.map((group) => group.id))
  for (const group of groups) {
    const parentId = group.parentId
    for (const child of next.elements.filter((element) => element.parentId === group.id)) {
      const global = snapshots.get(child.id)
      if (!global) continue
      child.parentId = parentId
      const local = globalToLocal(next, global.x, global.y, parentId)
      child.x = local.x
      child.y = local.y
    }
  }
  next.elements = next.elements.filter((element) => !groupSet.has(element.id))
  return next
}

export const ungroupSelection = ungroupElements
export const ungroup = ungroupElements
export const ungroupLayers = ungroupElements

/** Remove selected roots and their descendants; locked branches are left intact. */
export const deleteElements = (page: Page, ids: Iterable<string>): Page => {
  const next = clone(page)
  const roots = selectedRoots(next, ids).filter((element) => !element.locked && !isLockedByAncestor(next, element.id) && !hasLockedBranch(next, element.id))
  if (!roots.length) return next
  const remove = subtreeIds(next, roots.map((root) => root.id))
  next.elements = next.elements.filter((element) => !remove.has(element.id))
  return next
}

export const removeElements = deleteElements
export const deleteSelection = deleteElements
export const deleteLayers = deleteElements

/** Clone complete subtrees and remap every descendant parent/interactions ID. */
export const cloneSubtrees = (page: Page, ids: Iterable<string>, options: OperationOptions = {}): OperationResult => {
  const next = clone(page)
  const roots = selectedRoots(next, ids).filter((element) => !element.locked && !isLockedByAncestor(next, element.id))
  if (!roots.length) return { page: next, selectedIds: [], idMap: {} }
  const offset = typeof options.offset === 'number' ? { x: options.offset, y: options.offset } : options.offset ?? { x: 24, y: 24 }
  const idFactory = options.idFactory ?? defaultCloneIdFactory(next)
  const interactionFactory = options.interactionIdFactory ?? ((sourceId: string, index: number) => `${sourceId}-copy-${index + 1}`)
  const idMap: Record<string, string> = {}
  const generatedIds = new Set(next.elements.map((element) => element.id))
  let idIndex = 0
  const rootSet = new Set(roots.map((root) => root.id))
  const sourceElements = next.elements.filter((element) => roots.some((root) => element.id === root.id || isDescendant(element.id, root.id, next)))
  for (const source of sourceElements) {
    let generated = idFactory(source.id, idIndex++)
    let suffix = 2
    while (generatedIds.has(generated)) generated = `${generated}-${suffix++}`
    generatedIds.add(generated)
    idMap[source.id] = generated
  }
  const generatedInteractionIds = new Set(next.elements.flatMap((element) => element.interactions.map((interaction) => interaction.id)))
  const copies = sourceElements.map((source) => {
    const copy = clone(source)
    copy.id = idMap[source.id]
    copy.parentId = source.parentId && idMap[source.parentId] ? idMap[source.parentId] : source.parentId
    if (rootSet.has(source.id)) { copy.x += offset.x; copy.y += offset.y }
    copy.interactions = copy.interactions.map((interaction, index) => {
      let generated = interactionFactory(interaction.id, index)
      let suffix = 2
      while (generatedInteractionIds.has(generated)) generated = `${generated}-${suffix++}`
      generatedInteractionIds.add(generated)
      return { ...interaction, id: generated, targetId: interaction.targetId && idMap[interaction.targetId] ? idMap[interaction.targetId] : interaction.targetId }
    })
    copy.name = `${source.name} copy`
    return copy
  })
  next.elements.push(...copies)
  return { page: next, selectedIds: roots.map((root) => idMap[root.id]), idMap }
}

export const cloneSubtree = (page: Page, id: string, options: OperationOptions = {}): OperationResult => cloneSubtrees(page, [id], options)

export const cloneElements = (page: Page, ids: Iterable<string>, options: OperationOptions = {}): Page => cloneSubtrees(page, ids, options).page
export const cloneSelected = cloneElements

/** Move an element to a new parent without changing its page-global position. */
export const nestElement = (page: Page, childId: string, parentId?: string): Page => {
  const next = clone(page)
  const child = next.elements.find((element) => element.id === childId)
  if (!child || child.locked || isLockedByAncestor(next, childId) || childId === parentId || (parentId && isDescendant(parentId, childId, next))) return next
  const parent = parentId ? next.elements.find((element) => element.id === parentId) : undefined
  if (parent && (parent.locked || isLockedByAncestor(next, parent.id))) return next
  const global = getAbsoluteRect(child, next)
  child.parentId = parentId
  const local = globalToLocal(next, global.x, global.y, parentId)
  child.x = local.x
  child.y = local.y
  return next
}

export const nest = nestElement
export const reparentElement = nestElement
export const nestLayer = nestElement

const siblingGroups = (page: Page, ids: Set<string>): Map<string | undefined, DesignElement[]> => {
  const result = new Map<string | undefined, DesignElement[]>()
  for (const element of page.elements) {
    if (!ids.has(element.id)) continue
    const list = result.get(element.parentId) ?? []
    list.push(element)
    result.set(element.parentId, list)
  }
  return result
}

/** Reorder selected sibling blocks without changing document IDs or hierarchy. */
export const reorderElements = (page: Page, ids: Iterable<string>, direction: ReorderDirection): Page => {
  const next = clone(page)
  const selected = new Set(Array.from(ids).filter((id) => {
    const element = next.elements.find((candidate) => candidate.id === id)
    return Boolean(element && !element.locked && !isLockedByAncestor(next, id))
  }))
  const groups = siblingGroups(next, selected)
  if (!groups.size) return next
  const selectedElements = new Set(next.elements.filter((element) => selected.has(element.id)))
  const moveAll = (parentId: string | undefined, toEnd: boolean) => {
    const siblings = next.elements.filter((element) => element.parentId === parentId)
    const picked = siblings.filter((element) => selectedElements.has(element))
    if (!picked.length) return
    const rest = siblings.filter((element) => !selectedElements.has(element))
    const ordered = toEnd ? [...rest, ...picked] : [...picked, ...rest]
    let cursor = 0
    for (let index = 0; index < next.elements.length; index += 1) {
      if (next.elements[index].parentId === parentId) next.elements[index] = ordered[cursor++]
    }
  }
  if (direction === 'front' || direction === 'back') { for (const parentId of groups.keys()) moveAll(parentId, direction === 'front'); return next }
  for (const [parentId] of groups) {
    const siblingIndexes = next.elements.map((element, index) => element.parentId === parentId ? index : -1).filter((index) => index >= 0)
    const selectedIndexes = siblingIndexes.filter((index) => selected.has(next.elements[index].id))
    if (direction === 'forward' || direction === 'up') {
      for (const index of [...selectedIndexes].sort((a, b) => b - a)) {
        const nextIndex = siblingIndexes[siblingIndexes.indexOf(index) + 1]
        if (nextIndex !== undefined && !selected.has(next.elements[nextIndex].id)) [next.elements[index], next.elements[nextIndex]] = [next.elements[nextIndex], next.elements[index]]
      }
    } else {
      for (const index of [...selectedIndexes].sort((a, b) => a - b)) {
        const previousIndex = siblingIndexes[siblingIndexes.indexOf(index) - 1]
        if (previousIndex !== undefined && !selected.has(next.elements[previousIndex].id)) [next.elements[index], next.elements[previousIndex]] = [next.elements[previousIndex], next.elements[index]]
      }
    }
  }
  return next
}

export const reorder = reorderElements
export const moveInStack = reorderElements
export const reorderLayers = reorderElements

/** Apply resolved layout rectangles back into a cloned page using local child coordinates. */
export const applyLayout = (page: Page, widthOrOptions?: number | { width?: number }, parentId?: string, rules?: LayoutRules): Page => {
  const next = clone(page)
  if (parentId && rules) {
    const parent = next.elements.find((element) => element.id === parentId)
    if (parent) parent.layout = clone(rules)
  }
  const layout = computeLayout(next, widthOrOptions ?? next.width)
  for (const element of next.elements) {
    if (parentId && element.id !== parentId && element.parentId !== parentId) continue
    const resolved = layout.elements[element.id]
    if (!resolved) continue
    const parentResolved = element.parentId ? layout.elements[element.parentId] : undefined
    element.x = resolved.x - (parentResolved?.x ?? 0)
    element.y = resolved.y - (parentResolved?.y ?? 0)
    element.width = resolved.width
    element.height = resolved.height
  }
  if (layout.height > next.height) next.height = layout.height
  return next
}

export const layoutElements = applyLayout
export const applyResolvedLayout = applyLayout
export const layout = applyLayout

/** Return a fully detached page suitable for undo/history before an operation. */
export const clonePage = (page: Page): Page => clone(page)

export const operationResult = (page: Page, selectedIds: string[] = [], idMap: Record<string, string> = {}): OperationResult => ({ page: clone(page), selectedIds: [...selectedIds], idMap: { ...idMap } })

// Kept as a named helper for callers that need the stable generated IDs while
// still receiving a plain page from cloneElements.
export const cloneSubtreeIds = (page: Page, ids: Iterable<string>, options: OperationOptions = {}): Record<string, string> => cloneSubtrees(page, ids, options).idMap

// `uid` remains intentionally unused for normal operations: imported files and
// snapshots should produce deterministic IDs. This export documents that a
// caller may opt into the model's regular ID source when desired.
export const randomOperationId = (prefix = 'operation'): string => uid(prefix)
