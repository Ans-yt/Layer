import { makeElement } from './model'
import type { DesignElement, Page, Project } from './model'

export type AiScope = { type: 'selection' | 'page' | 'project'; pageId?: string; ids?: string[] }
export type UpdateOperation = { op: 'update'; id: string; pageId?: string; patch: Partial<DesignElement> }
export type CreateOperation = { op: 'create'; pageId?: string; element: Partial<DesignElement> & Pick<DesignElement, 'id' | 'type'> }
export type DeleteOperation = { op: 'delete'; id: string; pageId?: string }
export type DocumentOperation = UpdateOperation | CreateOperation | DeleteOperation

export interface OperationIssue { index: number; message: string; field?: string }
export interface OperationValidation { ok: boolean; operations: DocumentOperation[]; errors: OperationIssue[] }
export interface AiResponse { text: string; operations: DocumentOperation[]; findings?: VisionFinding[]; rounds?: number; toolTrace?: unknown[] }
export interface VisionFinding { observation: string; confidence: number | null; evidence: string; objectIds: string[] }
export interface ProviderPublicRecord { id: string; name: string; kind: string; endpoint: string; model: string; credentialSet: boolean; connected: boolean; imageInput: boolean; videoInput: boolean; manualModel: boolean; advanced?: { maxTokens: number; temperature: number | null; tokenParameter: string }; [key: string]: unknown }
export interface ProjectSummary { id: string; name: string; updatedAt?: string; pageCount?: number }

const allowedPatchFields = new Set([
  'name', 'parentId', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'fill', 'stroke', 'strokeWidth', 'radius',
  'corners', 'shape', 'shadow', 'pattern', 'text', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign',
  'wrap', 'src', 'alt', 'imageFit', 'imagePosition', 'iconName', 'layout', 'notes', 'componentId', 'variant', 'interactions', 'state', 'aspectRatioLocked',
  'curve', 'cutCorners', 'overrides',
])
const operationKeys = new Set(['op', 'id', 'pageId', 'patch', 'element'])
const elementTypes = new Set(['frame', 'section', 'text', 'rect', 'circle', 'line', 'image', 'icon', 'button', 'input', 'card', 'nav', 'form', 'tabs', 'accordion', 'modal', 'footer', 'group'])
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

const issue = (index: number, message: string, field?: string): OperationIssue => ({ index, message, ...(field ? { field } : {}) })
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown, min = -Infinity, max = Infinity) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const safeColor = (value: unknown) => typeof value === 'string' && value.length <= 120 && /^(?:transparent|none|#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.,%+\s/-]+\)|[A-Za-z]{1,30})$/i.test(value)
const safeImageUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 4 * 1024 * 1024) return false
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return true
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}
const safeExternalUrl = (value: unknown) => { try { const url = new URL(String(value)); return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) && !url.username && !url.password } catch { return false } }

function scopeFor(scope: AiScope, pages: Page[]): { scope?: AiScope; errors: OperationIssue[] } {
  if (!scope || !['selection', 'page', 'project'].includes(scope.type)) return { errors: [issue(-1, 'scope.type must be selection, page, or project.', 'scope')] }
  if (scope.pageId !== undefined && (!idPattern.test(scope.pageId) || !pages.some((page) => page.id === scope.pageId))) return { errors: [issue(-1, 'scope.pageId does not identify a page.', 'scope.pageId')] }
  if (scope.ids !== undefined && (!Array.isArray(scope.ids) || scope.ids.some((id) => typeof id !== 'string' || !idPattern.test(id)))) return { errors: [issue(-1, 'scope.ids contains an invalid element ID.', 'scope.ids')] }
  if (scope.type === 'selection' && (!scope.pageId || !scope.ids)) return { errors: [issue(-1, 'selection scope requires pageId and ids.', 'scope')] }
  if (scope.type === 'page' && !scope.pageId) return { errors: [issue(-1, 'page scope requires pageId.', 'scope.pageId')] }
  return { scope: { type: scope.type, pageId: scope.pageId, ids: scope.ids ? [...new Set(scope.ids)] : undefined }, errors: [] }
}

function inScope(page: Page, id: string, scope: AiScope): boolean {
  if (scope.type === 'project') return true
  if (page.id !== scope.pageId) return false
  return scope.type === 'page' ? true : Boolean(scope.ids?.includes(id))
}

function lockedInHierarchy(page: Page, element: DesignElement): boolean {
  const byId = new Map(page.elements.map((item) => [item.id, item]))
  const visited = new Set<string>()
  let current: DesignElement | undefined = element
  while (current && !visited.has(current.id)) {
    if (current.locked || current.visible === false) return true
    visited.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return false
}

function descendants(page: Page, id: string): Set<string> {
  const result = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const element of page.elements) if (element.parentId && result.has(element.parentId) && !result.has(element.id)) { result.add(element.id); changed = true }
  }
  return result
}

function validateNested(value: unknown, field: string, index: number, depth = 0): OperationIssue | undefined {
  if (depth > 5) return issue(index, `${field} is nested too deeply.`, field)
  if (value === null || typeof value === 'boolean') return undefined
  if (typeof value === 'string') return value.length <= 10000 ? undefined : issue(index, `${field} is too long.`, field)
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : issue(index, `${field} contains a non-finite number.`, field)
  if (Array.isArray(value)) { if (value.length > 512) return issue(index, `${field} has too many entries.`, field); for (const item of value) { const found = validateNested(item, field, index, depth + 1); if (found) return found }; return undefined }
  if (!isRecord(value)) return issue(index, `${field} must be JSON data.`, field)
  for (const [key, item] of Object.entries(value)) { if (!/^[A-Za-z0-9_-]{1,80}$/.test(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') return issue(index, `${field} contains an unsafe key.`, field); const found = validateNested(item, `${field}.${key}`, index, depth + 1); if (found) return found }
  return undefined
}

function validatePatch(patch: unknown, index: number): OperationIssue[] {
  if (!isRecord(patch)) return [issue(index, 'update.patch must be an object.', 'patch')]
  const errors: OperationIssue[] = []
  for (const key of Object.keys(patch)) if (!allowedPatchFields.has(key)) errors.push(issue(index, `Field '${key}' cannot be updated by AI.`, `patch.${key}`))
  const numeric: Record<string, [number, number]> = { x: [-Infinity, Infinity], y: [-Infinity, Infinity], width: [0, Infinity], height: [0, Infinity], rotation: [-Infinity, Infinity], opacity: [0, 1], strokeWidth: [0, Infinity], radius: [0, Infinity], fontSize: [1, 1000], fontWeight: [100, 1000], lineHeight: [0, Infinity], letterSpacing: [-Infinity, Infinity] }
  for (const [field, [min, max]] of Object.entries(numeric)) if (field in patch && !finite(patch[field], min, max)) errors.push(issue(index, `${field} is invalid.`, `patch.${field}`))
  for (const field of ['name', 'fill', 'stroke', 'text', 'fontFamily', 'wrap', 'src', 'alt', 'imageFit', 'imagePosition', 'iconName', 'notes', 'componentId', 'variant', 'state', 'shape']) if (field in patch && (typeof patch[field] !== 'string' || patch[field].length > 10000)) errors.push(issue(index, `${field} must be a string.`, `patch.${field}`))
  for (const field of ['fill', 'stroke']) if (field in patch && !safeColor(patch[field])) errors.push(issue(index, `${field} is not a safe color value.`, `patch.${field}`))
  if ('shape' in patch && !['rectangle', 'round', 'triangle', 'diamond', 'hexagon', 'star', 'burst', 'pill'].includes(String(patch.shape))) errors.push(issue(index, 'shape is invalid.', 'patch.shape'))
  if ('imageFit' in patch && !['cover', 'contain', 'fill', 'none', 'scale-down'].includes(String(patch.imageFit))) errors.push(issue(index, 'imageFit is invalid.', 'patch.imageFit'))
  if ('imagePosition' in patch && !/^(?:[\d.+% -]+|(?:left|right|center|top|bottom)(?: (?:left|right|center|top|bottom))?)$/.test(String(patch.imagePosition))) errors.push(issue(index, 'imagePosition is invalid.', 'patch.imagePosition'))
  if ('src' in patch && !safeImageUrl(patch.src)) errors.push(issue(index, 'src must be an http(s) image URL or supported image data URL.', 'patch.src'))
  if ('fontFamily' in patch && (typeof patch.fontFamily !== 'string' || /[;{}<>]/.test(patch.fontFamily))) errors.push(issue(index, 'fontFamily contains unsafe CSS characters.', 'patch.fontFamily'))
  for (const field of ['visible', 'aspectRatioLocked']) if (field in patch && typeof patch[field] !== 'boolean') errors.push(issue(index, `${field} must be boolean.`, `patch.${field}`))
  if ('parentId' in patch && patch.parentId !== undefined && patch.parentId !== null && (typeof patch.parentId !== 'string' || !idPattern.test(patch.parentId))) errors.push(issue(index, 'parentId is invalid.', 'patch.parentId'))
  if ('textAlign' in patch && !['left', 'center', 'right'].includes(String(patch.textAlign))) errors.push(issue(index, 'textAlign is invalid.', 'patch.textAlign'))
  for (const field of ['corners', 'cutCorners', 'shadow', 'pattern', 'layout', 'curve', 'overrides', 'interactions']) if (field in patch) { const found = validateNested(patch[field], field, index); if (found) errors.push(found) }
  if ('interactions' in patch && Array.isArray(patch.interactions)) for (const interaction of patch.interactions) if (isRecord(interaction) && interaction.action === 'external' && !safeExternalUrl(interaction.value)) errors.push(issue(index, 'External interaction URL is unsafe.', 'patch.interactions'))
  return errors
}

function targetFor(pages: Page[], id: string, pageId: string | undefined, scope: AiScope): { page: Page; element: DesignElement } | undefined {
  const matches = pages.flatMap((page) => page.elements.filter((element) => element.id === id && (!pageId || page.id === pageId) && inScope(page, id, scope)).map((element) => ({ page, element })))
  return matches.length === 1 ? matches[0] : undefined
}

function validateCreate(element: unknown, index: number): OperationIssue[] {
  if (!isRecord(element)) return [issue(index, 'create.element must be an object.', 'element')]
  const errors: OperationIssue[] = []
  if (typeof element.id !== 'string' || !idPattern.test(element.id)) errors.push(issue(index, 'element.id is required and invalid.', 'element.id'))
  if (typeof element.type !== 'string' || !elementTypes.has(element.type)) errors.push(issue(index, 'element.type is invalid.', 'element.type'))
  if (element.locked === true) errors.push(issue(index, 'AI-created elements cannot be locked.', 'element.locked'))
  const patch = { ...element }; delete patch.id; delete patch.type; delete patch.locked
  errors.push(...validatePatch(patch, index).map((found) => ({ ...found, field: found.field?.replace(/^patch\./, 'element.') })))
  return errors
}

function materializeElement(element: Record<string, unknown>): DesignElement {
  return makeElement(element.type as DesignElement['type'], element as unknown as Partial<DesignElement>)
}

function validateAll(document: Project, operations: unknown, requestedScope: AiScope): OperationValidation {
  const pages = document.pages
  const scopeResult = scopeFor(requestedScope, pages)
  if (scopeResult.errors.length || !scopeResult.scope) return { ok: false, operations: [], errors: scopeResult.errors }
  if (!Array.isArray(operations)) return { ok: false, operations: [], errors: [issue(-1, 'operations must be an array.', 'operations')] }
  if (operations.length > 64) return { ok: false, operations: [], errors: [issue(-1, 'At most 64 operations may be applied at once.')] }
  const draft = structuredClone(document)
  const normalized: DocumentOperation[] = []
  const errors: OperationIssue[] = []
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]
    if (!isRecord(operation)) { errors.push(issue(index, 'Operation must be an object.')); continue }
    for (const key of Object.keys(operation)) if (!operationKeys.has(key)) errors.push(issue(index, `Unknown operation field '${key}'.`, key))
    if (!['update', 'create', 'delete'].includes(String(operation.op))) { errors.push(issue(index, 'op must be update, create, or delete.', 'op')); continue }
    const op = operation.op as string
    if (op === 'update' || op === 'delete') {
      if (typeof operation.id !== 'string' || !idPattern.test(operation.id)) errors.push(issue(index, `${op}.id is required and invalid.`, 'id'))
      else {
        const target = targetFor(draft.pages, operation.id, typeof operation.pageId === 'string' ? operation.pageId : undefined, scopeResult.scope)
        if (!target) errors.push(issue(index, `Element '${operation.id}' is outside the requested scope or does not exist.`, 'id'))
        else if (lockedInHierarchy(target.page, target.element)) errors.push(issue(index, `Element '${operation.id}' or an ancestor is locked.`, 'id'))
        else if (target.element.visible === false) errors.push(issue(index, `Hidden element '${operation.id}' is protected from AI edits.`, 'id'))
        else if (op === 'update') {
          errors.push(...validatePatch(operation.patch, index))
          const patch = isRecord(operation.patch) ? operation.patch : undefined
          if (patch && 'parentId' in patch && patch.parentId) {
            const parent = target.page.elements.find((item) => item.id === patch.parentId)
            if (!parent || lockedInHierarchy(target.page, parent) || parent.visible === false) errors.push(issue(index, 'patch.parentId must reference a visible, unlocked element on this page.', 'patch.parentId'))
            if (parent && scopeResult.scope.type === 'selection' && !scopeResult.scope.ids?.includes(parent.id)) errors.push(issue(index, 'patch.parentId lies outside the selected scope.', 'patch.parentId'))
            if (parent && descendants(target.page, target.element.id).has(parent.id)) errors.push(issue(index, 'patch.parentId would create a hierarchy cycle.', 'patch.parentId'))
          }
          if (!errors.some((found) => found.index === index)) Object.assign(target.element, structuredClone(patch))
        } else {
          const remove = descendants(target.page, target.element.id)
          if (target.page.elements.some((item) => remove.has(item.id) && (item.locked || item.visible === false))) errors.push(issue(index, 'Cannot delete a hierarchy containing a locked or hidden element.', 'id'))
          if (scopeResult.scope.type === 'selection' && [...remove].some((item) => !scopeResult.scope?.ids?.includes(item))) errors.push(issue(index, 'Deleting this hierarchy would exceed the selected scope.', 'id'))
          if (!errors.some((found) => found.index === index)) target.page.elements = target.page.elements.filter((item) => !remove.has(item.id))
        }
      }
    } else {
      errors.push(...validateCreate(operation.element, index))
      const pageId = typeof operation.pageId === 'string' ? operation.pageId : scopeResult.scope.pageId
      const page = draft.pages.find((candidate) => candidate.id === pageId)
      if (!page) errors.push(issue(index, 'create requires a valid pageId.', 'pageId'))
      else if (isRecord(operation.element)) {
        const element = operation.element
        const id = typeof element.id === 'string' ? element.id : ''
        if (scopeResult.scope.type !== 'project' && page.id !== scopeResult.scope.pageId) errors.push(issue(index, 'Created element is outside the requested scope.', 'pageId'))
        if (draft.pages.some((candidate) => candidate.elements.some((item) => item.id === id))) errors.push(issue(index, `Element ID '${id}' is already in use.`, 'element.id'))
        if (element.parentId) {
          const parent = page.elements.find((item) => item.id === element.parentId)
          if (!parent || !['frame', 'section', 'card', 'nav', 'form', 'tabs', 'accordion', 'modal', 'footer', 'group'].includes(parent.type) || lockedInHierarchy(page, parent) || parent.visible === false) errors.push(issue(index, 'element.parentId must reference a visible, unlocked container on the target page.', 'element.parentId'))
        }
        if (scopeResult.scope.type === 'selection' && (typeof element.parentId !== 'string' || !scopeResult.scope.ids?.includes(element.parentId))) errors.push(issue(index, 'Selection scope may create only within a selected container.', 'element.parentId'))
        if (!errors.some((found) => found.index === index)) page.elements.push(materializeElement(structuredClone(element)))
      }
    }
    if (!errors.some((found) => found.index === index)) normalized.push(structuredClone(operation) as DocumentOperation)
  }
  return { ok: errors.length === 0, operations: errors.length === 0 ? normalized : [], errors }
}

/** Validate every operation against the same project snapshot before mutation. */
export function validateOperations(project: Project, operations: unknown, scope: AiScope): OperationValidation { return validateAll(project, operations, scope) }

/** Apply a validated batch atomically. The original project is never mutated. */
export function applyOperations(project: Project, operations: unknown, scope: AiScope): Project {
  const validation = validateAll(project, operations, scope)
  if (!validation.ok) throw new Error(validation.errors.map((found) => `${found.index}: ${found.message}`).join('\n'))
  const draft = structuredClone(project)
  for (const operation of validation.operations) {
    const pages = draft.pages
    if (operation.op === 'create') {
      const page = pages.find((candidate) => candidate.id === (operation.pageId || scope.pageId))
      if (!page) throw new Error('Target page no longer exists.')
      page.elements.push(materializeElement(structuredClone(operation.element) as unknown as Record<string, unknown>))
    } else {
      const target = targetFor(pages, operation.id, operation.pageId, scope)
      if (!target) throw new Error(`Target element '${operation.id}' no longer exists.`)
      if (operation.op === 'update') Object.assign(target.element, structuredClone(operation.patch))
      else { const remove = descendants(target.page, target.element.id); target.page.elements = target.page.elements.filter((item) => !remove.has(item.id)) }
    }
  }
  return draft
}

export interface AiClientOptions { baseUrl?: string; fetchImpl?: typeof fetch; csrfToken?: string }

export interface LayerHealth {
  ok: boolean
  service?: string
  version?: string
  csrfToken?: string
  capabilities?: { ai?: { completion?: boolean; streaming?: boolean; stream?: boolean }; aiStreaming?: boolean; [key: string]: unknown }
  routes?: { ai?: string | { completion?: string; streaming?: string; stream?: string }; aiStream?: string; [key: string]: unknown }
  [key: string]: unknown
}

export class LayerApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(message: string, status: number, code = 'REQUEST_FAILED', details?: unknown) {
    super(message)
    this.name = 'LayerApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

let csrf: string | undefined
async function apiFetch(path: string, init: RequestInit = {}, options: AiClientOptions = {}): Promise<Response> {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const base = (options.baseUrl || '').replace(/\/+$/, '')
  const method = String(init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (method !== 'GET' && method !== 'HEAD') {
    if (!csrf && !options.csrfToken) {
      const health = await fetchImpl(`${base}/api/health`, { credentials: 'same-origin' })
      if (health.ok) {
        const payload = await health.json().catch(() => null) as { csrfToken?: unknown } | null
        if (typeof payload?.csrfToken === 'string') csrf = payload.csrfToken
      }
    }
    const token = options.csrfToken || csrf
    if (token) headers.set('x-layer-csrf', token)
  }
  const response = await fetchImpl(`${base}${path}`, { ...init, headers, credentials: init.credentials || 'same-origin' })
  return response
}

async function readResponsePayload(response: Response): Promise<unknown> { return response.json().catch(() => ({})) }

export async function jsonOrThrow<T>(response: Response): Promise<T> {
  const payload = await readResponsePayload(response)
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {}
    const message = typeof record.message === 'string' && record.message.length <= 2000 ? record.message : `Layer request failed (${response.status}).`
    const code = typeof record.error === 'string' && record.error.length <= 120 ? record.error : 'REQUEST_FAILED'
    throw new LayerApiError(message, response.status, code, record.details)
  }
  return payload as T
}

export function supportsAiStreaming(health: unknown): boolean | undefined {
  if (!isRecord(health)) return undefined
  const capabilities = isRecord(health.capabilities) ? health.capabilities : undefined
  const ai = capabilities && isRecord(capabilities.ai) ? capabilities.ai : undefined
  if (typeof ai?.streaming === 'boolean') return ai.streaming
  if (typeof ai?.stream === 'boolean') return ai.stream
  if (typeof capabilities?.aiStreaming === 'boolean') return capabilities.aiStreaming
  if (typeof health.aiStreaming === 'boolean') return health.aiStreaming
  const routes = isRecord(health.routes) ? health.routes : undefined
  if (typeof routes?.aiStream === 'string') return true
  const aiRoutes = routes && isRecord(routes.ai) ? routes.ai : undefined
  if (typeof aiRoutes?.streaming === 'string' || typeof aiRoutes?.stream === 'string') return true
  return undefined
}

export async function getApiHealth(options: AiClientOptions = {}): Promise<LayerHealth> {
  return jsonOrThrow<LayerHealth>(await apiFetch('/api/health', {}, options))
}

async function readApiHealth(options: AiClientOptions): Promise<LayerHealth | undefined> {
  try {
    const response = await apiFetch('/api/health', {}, options)
    if (!response.ok) return undefined
    const payload = await readResponsePayload(response)
    if (!isRecord(payload)) return undefined
    if (!options.csrfToken && typeof payload.csrfToken === 'string') csrf = payload.csrfToken
    return payload as LayerHealth
  } catch { return undefined }
}

export function expandSlashCommand(prompt: string, commands: { id: string; name: string; instructions: string; scope: 'selection' | 'page' | 'project'; enabled: boolean }[], scope: AiScope): { prompt: string; commandId?: string } {
  const match = /^\/([A-Za-z0-9][A-Za-z0-9._-]{0,80})(?:\s+([\s\S]*))?$/.exec(prompt.trim())
  if (!match) return { prompt }
  const command = commands.find((item) => item.enabled && (item.name === match[1] || item.id === match[1]))
  if (!command || !(command.scope === 'project' || command.scope === scope.type || command.scope === 'page' && scope.type === 'selection')) return { prompt }
  return { prompt: `${command.instructions}\n\nUser details: ${match[2]?.trim() || 'Apply this command to the requested scope.'}`, commandId: command.id }
}

export interface AiRequestInput { providerId: string; visionProviderId?: string; prompt: string; document: Project; scope: AiScope; systemPrompt?: string; skills?: unknown[]; commands?: unknown[]; enabledConnections?: string[]; imageRefs?: { url: string; mimeType?: string; label?: string }[]; sampledFrames?: { url: string; mimeType?: string; label?: string }[]; videoRefs?: unknown[]; visionConfig?: { enabled?: boolean; providerId?: string }; signal?: AbortSignal }

export async function requestAi(input: AiRequestInput, options: AiClientOptions = {}): Promise<AiResponse> {
  const { signal, ...payload } = input
  const response = await apiFetch('/api/ai', { method: 'POST', body: JSON.stringify(payload), signal }, options)
  return jsonOrThrow<AiResponse>(response)
}

export async function requestAiStream(input: AiRequestInput, onDelta: (text: string) => void, options: AiClientOptions = {}): Promise<AiResponse> {
  const { signal, ...payload } = input
  const health = await readApiHealth(options)
  if (supportsAiStreaming(health) === false) throw new LayerApiError('The connected Layer service does not support AI streaming. Restart the Layer service to enable /api/ai/stream.', 503, 'AI_STREAM_UNAVAILABLE')
  const response = await apiFetch('/api/ai/stream', { method: 'POST', body: JSON.stringify(payload), signal }, options)
  if (!response.ok) {
    try { return await jsonOrThrow<AiResponse>(response) } catch (error) {
      if (response.status === 404) throw new LayerApiError('The connected Layer service does not expose /api/ai/stream. Restart the Layer service to enable AI streaming.', response.status, 'AI_STREAM_UNAVAILABLE', error instanceof LayerApiError ? error.details : undefined)
      throw error
    }
  }
  if (!response.body) throw new LayerApiError('The AI stream returned no body.', response.status, 'AI_STREAM_EMPTY')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false
  const invalidStream = (message: string) => new LayerApiError(message, response.status, 'INVALID_AI_STREAM')
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() || ''
      for (const block of blocks) {
        const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() || 'message'
        const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n')
        if (!data) continue
        let parsed: unknown
        try { parsed = JSON.parse(data) } catch { throw invalidStream('The AI stream returned malformed data.') }
        if (!isRecord(parsed)) throw invalidStream('The AI stream returned an invalid event payload.')
        if (event === 'delta') {
          if (typeof parsed.text !== 'string') throw invalidStream('The AI stream returned an invalid text delta.')
          if (parsed.text) onDelta(parsed.text)
        }
        if (event === 'error') {
          const message = typeof parsed.message === 'string' && parsed.message.length <= 2000 ? parsed.message : 'AI stream failed.'
          const code = typeof parsed.code === 'string' && parsed.code.length <= 120 ? parsed.code : 'AI_STREAM_FAILED'
          throw new LayerApiError(message, response.status, code, parsed.details)
        }
        if (event === 'done') {
          if (!isRecord(parsed.response) || typeof parsed.response.text !== 'string' || !Array.isArray(parsed.response.operations)) throw invalidStream('The AI stream returned an invalid final response.')
          completed = true
          return parsed.response as unknown as AiResponse
        }
      }
      if (done) break
    }
    if (buffer.trim()) {
      const event = buffer.match(/^event:\s*(.+)$/m)?.[1]?.trim() || 'message'
      const data = buffer.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n')
      if (data) {
        let parsed: unknown
        try { parsed = JSON.parse(data) } catch { throw invalidStream('The AI stream returned malformed data.') }
        if (!isRecord(parsed)) throw invalidStream('The AI stream returned an invalid event payload.')
        if (event === 'delta') {
          if (typeof parsed.text !== 'string') throw invalidStream('The AI stream returned an invalid text delta.')
          if (parsed.text) onDelta(parsed.text)
        } else if (event === 'error') {
          const message = typeof parsed.message === 'string' && parsed.message.length <= 2000 ? parsed.message : 'AI stream failed.'
          const code = typeof parsed.code === 'string' && parsed.code.length <= 120 ? parsed.code : 'AI_STREAM_FAILED'
          throw new LayerApiError(message, response.status, code, parsed.details)
        } else if (event === 'done') {
          if (!isRecord(parsed.response) || typeof parsed.response.text !== 'string' || !Array.isArray(parsed.response.operations)) throw invalidStream('The AI stream returned an invalid final response.')
          completed = true
          return parsed.response as unknown as AiResponse
        }
      }
    }
  } finally { await reader.cancel().catch(() => {}) }
  if (!completed) throw new LayerApiError('The AI stream ended before a final response.', response.status, 'AI_STREAM_INCOMPLETE')
  throw new LayerApiError('The AI stream ended unexpectedly.', response.status, 'AI_STREAM_INCOMPLETE')
}

export async function listProviders(options: AiClientOptions = {}) { return jsonOrThrow<{ providers: ProviderPublicRecord[] }>(await apiFetch('/api/providers', {}, options)) }
export async function saveProvider(provider: Record<string, unknown>, options: AiClientOptions = {}) { return jsonOrThrow<{ provider: ProviderPublicRecord }>(await apiFetch('/api/providers', { method: 'POST', body: JSON.stringify(provider) }, options)) }
export interface ProviderTestResult { models?: { id?: string; name?: string }[]; selected?: string; modelListed?: boolean; manualFallback?: boolean; discoveryMessage?: string; connected?: boolean; testedModel?: string; testMethod?: string }
export async function testProvider(providerId: string, options: AiClientOptions = {}) { return jsonOrThrow<ProviderTestResult>(await apiFetch(`/api/providers/${encodeURIComponent(providerId)}/test`, { method: 'POST' }, options)) }
export async function discoverProviderModels(providerId: string, options: AiClientOptions = {}) { return jsonOrThrow<ProviderTestResult>(await apiFetch(`/api/providers/${encodeURIComponent(providerId)}/models`, { method: 'POST' }, options)) }
export async function listProjects(options: AiClientOptions = {}) { return jsonOrThrow<{ projects: ProjectSummary[] }>(await apiFetch('/api/projects', {}, options)) }
export async function loadProjectFromServer(id: string, options: AiClientOptions = {}) { return jsonOrThrow<{ project: Project }>(await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {}, options)) }
export async function saveProjectToServer(project: Project, options: AiClientOptions = {}) { return jsonOrThrow<{ project: Project }>(await apiFetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'PUT', body: JSON.stringify({ project }) }, options)) }
export async function createProjectOnServer(project: Project, options: AiClientOptions = {}) { return jsonOrThrow<{ project: Project }>(await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ project }) }, options)) }
export async function deleteProjectOnServer(id: string, options: AiClientOptions = {}) { return jsonOrThrow(await apiFetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }, options)) }
export async function createShare(projectOrId: Project | string, options: AiClientOptions = {}) { const body = typeof projectOrId === 'string' ? { projectId: projectOrId } : { project: projectOrId }; return jsonOrThrow<{ token: string; url: string; createdAt: string }>(await apiFetch('/api/shares', { method: 'POST', body: JSON.stringify(body) }, options)) }
