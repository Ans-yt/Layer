// Shared by the Node service and the browser. Keep this module browser-safe.
export const ELEMENT_TYPES = new Set(['frame', 'section', 'text', 'rect', 'circle', 'line', 'image', 'icon', 'button', 'input', 'card', 'nav', 'form', 'tabs', 'accordion', 'modal', 'footer', 'group'])
export const OPERATION_NAMES = new Set(['update', 'create', 'delete'])
export const ALLOWED_PATCH_FIELDS = new Set(['name', 'parentId', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'fill', 'stroke', 'strokeWidth', 'radius', 'corners', 'shape', 'shadow', 'pattern', 'text', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'wrap', 'src', 'alt', 'imageFit', 'imagePosition', 'iconName', 'layout', 'notes', 'componentId', 'variant', 'interactions', 'state', 'aspectRatioLocked', 'curve', 'overrides'])
const containers = new Set(['frame', 'section', 'card', 'nav', 'form', 'tabs', 'accordion', 'modal', 'footer', 'group'])
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype'])
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const fail = (message) => { throw new Error(message) }
const assert = (condition, message) => { if (!condition) fail(message) }
const id = (value) => typeof value === 'string' && idPattern.test(value)
const num = (value, min = -1e6, max = 1e6) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const str = (value, max = 10000) => typeof value === 'string' && value.length <= max
const oneOf = (...values) => (value) => values.includes(value)
const bool = (value) => typeof value === 'boolean'
const optionalId = (value) => value === null || value === undefined || id(value)

function safeJson(value, depth = 0) {
  assert(depth <= 12, 'JSON data is nested too deeply.')
  if (value === null || value === undefined || typeof value === 'boolean') return
  if (typeof value === 'string') { assert(value.length <= 4 * 1024 * 1024, 'String exceeds the size limit.'); return }
  if (typeof value === 'number') { assert(Number.isFinite(value), 'Numbers must be finite.'); return }
  if (Array.isArray(value)) { assert(value.length <= 20000, 'Array exceeds the size limit.'); for (const item of value) safeJson(item, depth + 1); return }
  assert(isObject(value), 'Expected plain JSON data.')
  for (const [key, child] of Object.entries(value)) { assert(!forbiddenKeys.has(key), `Forbidden key '${key}'.`); safeJson(child, depth + 1) }
}

function color(value) {
  return str(value, 120) && /^(?:transparent|none|#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.,%+\s/-]+\)|[A-Za-z]{1,30})$/i.test(value)
}

function imageUrl(value) {
  if (!str(value, 4 * 1024 * 1024)) return false
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return true
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}

function externalUrl(value) {
  if (!str(value, 2048)) return false
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}

function objectFields(value, shape, label, required = []) {
  assert(isObject(value), `${label} must be an object.`)
  for (const key of required) assert(key in value, `${label}.${key} is required.`)
  for (const [key, entry] of Object.entries(value)) assert(Object.hasOwn(shape, key) && shape[key](entry), `${label}.${key} is invalid or unsupported.`)
  return true
}

const corners = { topLeft: (v) => num(v, 0), topRight: (v) => num(v, 0), bottomRight: (v) => num(v, 0), bottomLeft: (v) => num(v, 0) }
const layout = { mode: oneOf('free', 'row', 'column', 'grid'), gap: (v) => num(v, 0), padding: (v) => num(v, 0), align: oneOf('start', 'center', 'end', 'stretch', 'space-between'), justify: oneOf('start', 'center', 'end', 'space-between', 'space-around'), wrap: bool, widthRule: oneOf('fixed', 'fill', 'fit'), heightRule: oneOf('fixed', 'fill', 'fit'), minWidth: (v) => num(v, 0), maxWidth: (v) => num(v, 0), minHeight: (v) => num(v, 0), maxHeight: (v) => num(v, 0), overflow: oneOf('visible', 'hidden', 'scroll') }
const shadow = { x: num, y: num, blur: (v) => num(v, 0), spread: num, color, opacity: (v) => num(v, 0, 1) }
const pattern = { enabled: bool, type: oneOf('dots', 'grid', 'stripes', 'noise'), scale: (v) => num(v, 0.01, 10000), spacing: (v) => num(v, 0.01), rotation: num, opacity: (v) => num(v, 0, 1), color }
const curve = { x1: num, y1: num, x2: num, y2: num }
const interaction = { id, trigger: oneOf('click', 'hover', 'focus', 'page-load', 'scroll-into-view'), action: oneOf('navigate', 'external', 'scroll', 'toggle-visibility', 'set-state', 'submit-form', 'animate'), targetId: id, pageId: id, value: (v) => str(v, 4000), duration: (v) => num(v, 0, 600000), delay: (v) => num(v, 0, 600000), easing: (v) => str(v, 80), repeat: (v) => num(v, 0, 1000) }
const fieldRules = {
  name: (v) => str(v, 300), parentId: optionalId, x: num, y: num, width: (v) => num(v, 0), height: (v) => num(v, 0), rotation: num,
  opacity: (v) => num(v, 0, 1), visible: bool, fill: color, stroke: color, strokeWidth: (v) => num(v, 0), radius: (v) => num(v, 0), shape: oneOf('rectangle', 'round', 'triangle', 'diamond', 'hexagon', 'star', 'burst', 'pill'),
  text: str, fontFamily: (v) => str(v, 200) && !/[;{}<>]/.test(v), fontSize: (v) => num(v, 1, 1000), fontWeight: (v) => num(v, 1, 1000), lineHeight: (v) => num(v, 0.1, 100), letterSpacing: (v) => num(v, -1000, 1000), textAlign: oneOf('left', 'center', 'right'), wrap: oneOf('fixed', 'auto'),
  src: imageUrl, alt: (v) => str(v, 2000), imageFit: oneOf('cover', 'contain', 'fill', 'none', 'scale-down'), imagePosition: (v) => str(v, 128) && /^(?:[\d.+% -]+|(?:left|right|center|top|bottom)(?: (?:left|right|center|top|bottom))?)$/.test(v), iconName: (v) => str(v, 200) && /^[a-z0-9_:-]+$/i.test(v), notes: str, componentId: id, variant: (v) => str(v, 200), state: (v) => str(v, 200), aspectRatioLocked: bool,
  corners: (v) => objectFields(v, corners, 'corners'), layout: (v) => objectFields(v, layout, 'layout'), shadow: (v) => objectFields(v, shadow, 'shadow'), pattern: (v) => objectFields(v, pattern, 'pattern'), curve: (v) => objectFields(v, curve, 'curve'),
  interactions: (v) => { assert(Array.isArray(v) && v.length <= 128, 'interactions must contain at most 128 entries.'); const ids = new Set(); for (const item of v) { objectFields(item, interaction, 'interaction', ['id', 'trigger', 'action']); assert(!ids.has(item.id), 'Interaction IDs must be unique.'); ids.add(item.id); if (item.action === 'external') assert(externalUrl(item.value), 'External interaction URL is unsafe.'); }; return true },
  overrides: (v) => { assert(isObject(v) && Object.keys(v).length <= 64, 'overrides must be a bounded object.'); for (const [key, entry] of Object.entries(v)) assert(/^[a-zA-Z][\w-]{0,80}$/.test(key) && !forbiddenKeys.has(key) && (str(entry, 1000) || num(entry) || bool(entry)), 'Invalid override.'); return true },
}

const defaultLayout = { mode: 'free', gap: 16, padding: 24, align: 'start', justify: 'start', wrap: false, widthRule: 'fixed', heightRule: 'fixed', overflow: 'visible' }
const nestedDefaults = { corners: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 }, layout: defaultLayout, shadow: { x: 0, y: 0, blur: 0, spread: 0, color: '#000000', opacity: 0.2 }, pattern: { enabled: false, type: 'dots', scale: 1, spacing: 16, rotation: 0, opacity: 0.2, color: '#f5b847' }, curve: { x1: 0, y1: 0, x2: 1, y2: 1 } }

function normalizePatch(patch, target) {
  assert(isObject(patch) && Object.keys(patch).length > 0, 'patch must be a non-empty plain object.')
  safeJson(patch)
  for (const [field, value] of Object.entries(patch)) assert(ALLOWED_PATCH_FIELDS.has(field) && fieldRules[field](value), `Field '${field}' is invalid or cannot be edited by AI.`)
  const result = structuredClone(patch)
  if (result.parentId === null) delete result.parentId
  for (const field of Object.keys(nestedDefaults)) if (field in result) result[field] = { ...nestedDefaults[field], ...(target[field] || {}), ...result[field] }
  if (patch.parentId === null) result.parentId = undefined
  if (result.layout) {
    assert(result.layout.maxWidth === undefined || result.layout.minWidth === undefined || result.layout.maxWidth >= result.layout.minWidth, 'layout.maxWidth cannot be less than minWidth.')
    assert(result.layout.maxHeight === undefined || result.layout.minHeight === undefined || result.layout.maxHeight >= result.layout.minHeight, 'layout.maxHeight cannot be less than minHeight.')
  }
  return result
}

export function materializeElement(input) {
  assert(isObject(input) && id(input.id) && ELEMENT_TYPES.has(input.type), 'create.element requires a valid id and type.')
  assert(input.locked === undefined || input.locked === false, 'AI-created objects cannot be locked.')
  const radius = input.type === 'circle' ? 999 : 12
  const element = { id: input.id, type: input.type, name: input.type[0].toUpperCase() + input.type.slice(1), x: 0, y: 0, width: 200, height: input.type === 'line' ? 2 : 120, rotation: 0, opacity: 1, visible: true, locked: false, fill: input.type === 'text' ? 'transparent' : '#15181e', stroke: '#343b49', strokeWidth: 1, radius, corners: { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius }, interactions: [] }
  if (containers.has(input.type)) element.layout = { ...defaultLayout }
  const patch = { ...input }; delete patch.id; delete patch.type; delete patch.locked
  if (Object.keys(patch).length) Object.assign(element, normalizePatch(patch, element))
  return element
}

export class OperationValidationError extends Error {
  constructor(errors) { super(errors.map((issue) => `${issue.index}: ${issue.message}`).join('\n')); this.name = 'OperationValidationError'; this.errors = errors }
}

function getPages(document) {
  assert(isObject(document) && Array.isArray(document.pages) && document.pages.length <= 256, 'document.pages must be a bounded array.')
  assert(document.components === undefined || Array.isArray(document.components), 'document.components must be an array.')
  const pageIds = new Set(); const elementIds = new Set()
  for (const page of document.pages) {
    assert(isObject(page) && id(page.id) && !pageIds.has(page.id) && Array.isArray(page.elements) && page.elements.length <= 20000, 'Invalid page or duplicate page ID.')
    pageIds.add(page.id)
    for (const element of page.elements) { assert(isObject(element) && id(element.id) && !elementIds.has(element.id), 'Invalid element or duplicate element ID.'); elementIds.add(element.id) }
    const map = new Map(page.elements.map((el) => [el.id, el]))
    for (const element of page.elements) {
      let current = element; const seen = new Set()
      while (current) { assert(!seen.has(current.id), 'The document contains a parent cycle.'); seen.add(current.id); assert(!current.parentId || map.has(current.parentId), 'The document contains a missing parent.'); current = map.get(current.parentId) }
    }
  }
  return document.pages
}

function normalizeScope(scope, pages) {
  assert(isObject(scope) && ['selection', 'page', 'project'].includes(scope.type), 'scope.type must be selection, page, or project.')
  assert(scope.pageId === undefined || pages.some((page) => page.id === scope.pageId), 'scope.pageId does not exist.')
  assert(scope.ids === undefined || Array.isArray(scope.ids) && scope.ids.length <= 20000 && scope.ids.every(id), 'scope.ids must be element IDs.')
  assert(scope.type === 'project' || scope.pageId, 'Page and selection scopes require pageId.')
  assert(scope.type !== 'selection' || Array.isArray(scope.ids), 'Selection scope requires ids.')
  return { type: scope.type, pageId: scope.pageId, ids: new Set(scope.ids || []) }
}

function inScope(page, elementId, scope) { return scope.type === 'project' || page.id === scope.pageId && (scope.type === 'page' || scope.ids.has(elementId)) }

function protectedInHierarchy(page, element) {
  const map = new Map(page.elements.map((item) => [item.id, item])); const seen = new Set()
  let current = element
  while (current && !seen.has(current.id)) { if (current.locked || current.visible === false) return true; seen.add(current.id); current = map.get(current.parentId) }
  return false
}

function descendantIds(page, id) {
  const ids = new Set([id]); let changed = true
  while (changed) { changed = false; for (const el of page.elements) if (el.parentId && ids.has(el.parentId) && !ids.has(el.id)) { ids.add(el.id); changed = true } }
  return ids
}

function references(document, page, element, scope) {
  if (element.parentId) {
    const parent = page.elements.find((item) => item.id === element.parentId)
    assert(parent && containers.has(parent.type) && !protectedInHierarchy(page, parent), 'Parent must be an unlocked, visible container on the same page.')
    assert(inScope(page, parent.id, scope), 'Parent lies outside the requested scope.')
    assert(!descendantIds(page, element.id).has(parent.id), 'Cannot create a parent cycle.')
  }
  if (element.componentId) assert((document.components || []).some((item) => item.id === element.componentId), 'componentId does not exist.')
  for (const action of element.interactions || []) {
    if (action.pageId) assert(document.pages.some((item) => item.id === action.pageId), 'Interaction pageId does not exist.')
    if (action.targetId) assert(page.elements.some((item) => item.id === action.targetId) || action.targetId === element.id, 'Interaction targetId does not exist on this page.')
    if (action.action === 'navigate') assert(action.pageId, 'Navigation requires pageId.')
  }
}

function applyOne(document, raw, scope) {
  assert(isObject(raw), 'Operation must be a plain object.'); safeJson(raw)
  assert(OPERATION_NAMES.has(raw.op), 'op must be update, create, or delete.')
  const keys = raw.op === 'update' ? ['op', 'id', 'pageId', 'patch'] : raw.op === 'create' ? ['op', 'pageId', 'element'] : ['op', 'id', 'pageId']
  assert(Object.keys(raw).every((key) => keys.includes(key)), 'Unexpected operation fields.')
  const pageId = raw.pageId || scope.pageId
  assert(raw.pageId === undefined || id(raw.pageId), 'Invalid operation pageId.')
  if (raw.op === 'create') {
    const page = document.pages.find((item) => item.id === pageId)
    assert(page && (scope.type === 'project' || page.id === scope.pageId), 'create requires a page in scope.')
    const element = materializeElement(raw.element)
    assert(!document.pages.some((item) => item.elements.some((el) => el.id === element.id)), 'Created element ID is already in use.')
    assert(scope.type !== 'selection' || element.parentId && scope.ids.has(element.parentId), 'Selection scope may create only within a selected container. Use page scope to create a root element.')
    references(document, page, element, scope)
    page.elements.push(element)
    if (scope.type === 'selection') scope.ids.add(element.id)
    return { op: 'create', pageId: page.id, element }
  }
  assert(id(raw.id), 'Operation id is required.')
  const page = document.pages.find((item) => (!pageId || item.id === pageId) && item.elements.some((el) => el.id === raw.id))
  const target = page?.elements.find((item) => item.id === raw.id)
  assert(target && inScope(page, target.id, scope), `Element '${raw.id}' is missing or outside the requested scope.`)
  assert(!protectedInHierarchy(page, target), 'Locked or hidden elements and their descendants are protected.')
  const subtree = descendantIds(page, target.id)
  assert(!page.elements.some((el) => subtree.has(el.id) && (el.locked || el.visible === false)), 'The affected subtree contains a locked or hidden element.')
  if (raw.op === 'update') {
    const patch = normalizePatch(raw.patch, target)
    const merged = { ...target, ...patch }
    // Existing parents are context, not new edit targets. Check parent scope
    // only when reparenting, while still checking the full resulting graph.
    references(document, page, merged, Object.hasOwn(patch, 'parentId') ? scope : { type: 'project' })
    Object.assign(target, patch)
    return { op: 'update', id: target.id, pageId: page.id, patch }
  }
  assert([...subtree].every((id) => inScope(page, id, scope)), 'Deleting this subtree would exceed the selected scope.')
  assert(!page.elements.some((el) => !subtree.has(el.id) && (el.interactions || []).some((action) => subtree.has(action.targetId))), 'Another element references this subtree; update the interaction before deletion.')
  assert(!(document.components || []).some((component) => Array.isArray(component.elementIds) && component.elementIds.some((id) => subtree.has(id))), 'A component references this subtree.')
  page.elements = page.elements.filter((el) => !subtree.has(el.id))
  return { op: 'delete', id: target.id, pageId: page.id }
}

function evaluate(document, operations, requestedScope) {
  const errors = []; const normalized = []
  let draft; let scope
  try {
    const pages = getPages(document)
    scope = normalizeScope(requestedScope, pages)
    assert(Array.isArray(operations) && operations.length <= 64, 'operations must be an array of at most 64 entries.')
    draft = structuredClone(document)
  } catch (error) { return { ok: false, operations: [], errors: [{ index: -1, message: error.message }] } }
  for (let index = 0; index < operations.length; index++) {
    try { normalized.push(applyOne(draft, operations[index], scope)) } catch (error) { errors.push({ index, message: error.message }); break }
  }
  return { ok: errors.length === 0, operations: errors.length ? [] : normalized, errors, document: errors.length ? undefined : draft }
}

export function validateOperations(document, operations, scope) {
  const { document: _draft, ...validation } = evaluate(document, operations, scope)
  return validation
}

export function applyOperations(document, operations, scope) {
  const result = evaluate(document, operations, scope)
  if (!result.ok) throw new OperationValidationError(result.errors)
  return { document: result.document, project: result.document, operations: result.operations, errors: [] }
}

export function parseOperations(value) { return Array.isArray(value) ? value : isObject(value) && Array.isArray(value.operations) ? value.operations : [] }
