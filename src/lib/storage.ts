import { unzipSync, zipSync } from 'fflate'
import type { AssetRecord, Page, Project, Snapshot } from './model'
import { createInitialProject, deepCloneProject, uid } from './model'
import { PROJECT_LIMITS, ProjectValidationError, isSafeId, isSafeUrl, sanitizeSvgDataUrl, validateLayerDocument, validateProject } from './validation'
import { loadFontFiles } from './catalog'
import { buildPrototypeHtml } from './prototypeExport'

const PROJECT_KEY = 'layer.project.v1'
const PROJECT_INDEX_KEY = 'layer.projects.index.v1'
const FALLBACK_PROJECT_PREFIX = 'layer.project.saved.v1.'
const RECOVERY_POINTER_KEY = 'layer.project.recovery.pointer.v1'
const DB_NAME = 'layer.projects'
const DB_VERSION = 1
const PROJECT_STORE = 'projects'
const MAX_SAVED_PROJECTS = 200
export const MAX_PROJECT_VERSIONS: number = PROJECT_LIMITS.maxSnapshots

export interface SavedProjectSummary {
  id: string
  name: string
  updatedAt: string
  createdAt: string
  size: number
}

export interface SaveProjectOptions {
  /** Keep a named snapshot before replacing the saved project. */
  snapshotName?: string
  /** Skip writing the synchronous recovery copy. Useful for explicit tests. */
  skipRecoveryCopy?: boolean
}

export interface RecoveryPointer {
  projectId: string
  updatedAt: string
  reason: 'local-storage-quota' | 'local-storage-unavailable'
}

export class ProjectStorageError extends Error {
  readonly code: 'quota' | 'unavailable' | 'failed'
  constructor(message: string, code: ProjectStorageError['code']) { super(message); this.name = 'ProjectStorageError'; this.code = code }
}

export interface SnapshotOptions {
  name?: string
  maxVersions?: number
}

interface StoredProjectRecord {
  id: string
  project: Project
  createdAt: string
  updatedAt: string
  size: number
}

export interface ExportScreenshot {
  id?: string
  blob?: Blob
  dataUrl?: string
  fileName?: string
  label?: string
  pageId?: string
  documentVersionId?: string
  selectionIds?: string[]
  capturedAt?: string
  mimeType?: string
}

export interface ExportProjectOptions {
  /** Download the generated archive when running in a browser. Defaults true. */
  download?: boolean
  filename?: string
  screenshots?: ExportScreenshot[]
  /** Optional fetch implementation for tests or an authenticated asset proxy. */
  fetchAsset?: (url: string) => Promise<Response>
}

export interface ExportAssetManifestEntry {
  id: string
  name: string
  kind: AssetRecord['kind']
  source: string
  license: string
  metadata?: Record<string, string>
  path?: string
  embedded: boolean
  error?: string
}

export interface ExportPackageBlob extends Blob {
  /** Alias for callers that prefer an object-like result. Points to itself. */
  blob: Blob
  filename: string
  files: string[]
  manifest: ExportAssetManifestEntry[]
}

const canUseStorage = () => typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined'
const getStorage = (): Storage | null => {
  if (!canUseStorage()) return null
  try { return globalThis.localStorage } catch { return null }
}

const now = () => new Date().toISOString()
const clone = <T>(value: T): T => structuredClone(value)

const storageGet = (key: string): string | null => {
  try { return getStorage()?.getItem(key) ?? null } catch { return null }
}
const storageSet = (key: string, value: string): boolean => {
  try {
    const storage = getStorage()
    if (!storage) return false
    storage.setItem(key, value)
    return true
  } catch { return false }
}
const storageRemove = (key: string) => { try { getStorage()?.removeItem(key) } catch { /* private mode/quota */ } }
const writeRecoveryPointer = (pointer: RecoveryPointer) => storageSet(RECOVERY_POINTER_KEY, JSON.stringify(pointer))
export const getRecoveryPointer = (): RecoveryPointer | null => {
  const raw = storageGet(RECOVERY_POINTER_KEY)
  if (!raw) return null
  try {
    const pointer = JSON.parse(raw) as RecoveryPointer
    return isSafeId(pointer.projectId) && typeof pointer.updatedAt === 'string' && (pointer.reason === 'local-storage-quota' || pointer.reason === 'local-storage-unavailable') ? pointer : null
  } catch { return null }
}
const clearRecoveryPointer = () => storageRemove(RECOVERY_POINTER_KEY)

const isQuotaError = (error: unknown) => {
  const candidate = error as { name?: string; message?: string } | null
  return candidate?.name === 'QuotaExceededError' || /quota|storage.?full|not.?enough.?space/i.test(candidate?.message ?? '')
}
const isStorageUnavailableError = (error: unknown) => /indexeddb is unavailable|indexeddb.*blocked|security.?error|not.?allowed/i.test(error instanceof Error ? error.message : String(error))

const migrateProject = (value: unknown): Project | null => {
  if (!value || typeof value !== 'object') return null
  try {
    const baseline = createInitialProject()
    const input = value as Partial<Project>
    // Early Layer documents did not always contain newly-added arrays/settings.
    // Fill only known model fields before strict validation; unknown fields are
    // removed by validateProject, preventing prototype pollution on recovery.
    const merged = {
      ...baseline,
      ...input,
      pages: Array.isArray(input.pages) ? input.pages : baseline.pages,
      styles: Array.isArray(input.styles) ? input.styles : [],
      components: Array.isArray(input.components) ? input.components : [],
      assets: Array.isArray(input.assets) ? input.assets : [],
      integrations: Array.isArray(input.integrations) ? input.integrations : baseline.integrations,
      providers: Array.isArray(input.providers) ? input.providers : baseline.providers,
      skills: Array.isArray(input.skills) ? input.skills : [],
      commands: Array.isArray(input.commands) ? input.commands : [],
      connections: Array.isArray(input.connections) ? input.connections : [],
      versions: Array.isArray(input.versions) ? input.versions : [],
      settings: { ...baseline.settings, ...(input.settings ?? {}) },
    }
    return validateProject(merged)
  } catch { return null }
}

const readLegacyProject = (): Project | null => {
  const raw = storageGet(PROJECT_KEY)
  if (!raw) return null
  try { return migrateProject(JSON.parse(raw)) } catch { return null }
}

/**
 * Synchronous startup path retained for the existing editor.  IndexedDB is
 * asynchronous, so it is used by loadSavedProject/listSavedProjects while the
 * legacy recovery copy makes a refresh immediately usable.
 */
export const loadProject = (): Project => readLegacyProject() ?? createInitialProject()

/** Async startup hydration for a project whose synchronous recovery copy was too large. */
export const hydrateRecoveryProject = async (fallback: Project = loadProject()): Promise<Project> => {
  const pointer = getRecoveryPointer()
  if (!pointer) return fallback
  return (await loadSavedProject(pointer.projectId)) ?? fallback
}

const projectSize = (project: Project): number => {
  try { return new TextEncoder().encode(JSON.stringify(project)).byteLength } catch { return Number.POSITIVE_INFINITY }
}

const localSummaryIndex = (): SavedProjectSummary[] => {
  const raw = storageGet(PROJECT_INDEX_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is SavedProjectSummary => Boolean(item && typeof item.id === 'string' && isSafeId(item.id) && typeof item.name === 'string' && typeof item.updatedAt === 'string' && typeof item.createdAt === 'string' && typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0)).slice(0, MAX_SAVED_PROJECTS)
  } catch { return [] }
}

const writeLocalSummaryIndex = (items: SavedProjectSummary[]) => storageSet(PROJECT_INDEX_KEY, JSON.stringify(items.slice(0, MAX_SAVED_PROJECTS)))

const writeLocalProject = (project: Project, createdAt = now()): { summary: SavedProjectSummary; projectWritten: boolean; indexWritten: boolean } => {
  const copy = clone(project)
  const summary: SavedProjectSummary = { id: copy.id, name: copy.name, updatedAt: copy.updatedAt, createdAt, size: projectSize(copy) }
  const projectWritten = storageSet(`${FALLBACK_PROJECT_PREFIX}${copy.id}`, JSON.stringify(copy))
  const existing = localSummaryIndex().filter((item) => item.id !== copy.id)
  const indexWritten = writeLocalSummaryIndex([summary, ...existing].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  return { summary, projectWritten, indexWritten }
}

const readLocalProject = (id: string): { project: Project; summary: SavedProjectSummary } | null => {
  const raw = storageGet(`${FALLBACK_PROJECT_PREFIX}${id}`)
  if (!raw) return null
  try {
    const project = migrateProject(JSON.parse(raw))
    if (!project) return null
    const summary = localSummaryIndex().find((item) => item.id === id) ?? { id, name: project.name, updatedAt: project.updatedAt, createdAt: project.updatedAt, size: projectSize(project) }
    return { project, summary }
  } catch { return null }
}

const hasIndexedDb = () => typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined'

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (!hasIndexedDb()) { reject(new Error('IndexedDB is unavailable.')); return }
  const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(PROJECT_STORE)) {
      const store = database.createObjectStore(PROJECT_STORE, { keyPath: 'id' })
      store.createIndex('updatedAt', 'updatedAt', { unique: false })
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('Could not open project storage.'))
})

const idbRequest = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
})

const idbPutProject = async (project: Project, createdAt?: string): Promise<SavedProjectSummary> => {
  const existing = await idbGetProject(project.id)
  const database = await openDatabase()
  try {
    const transaction = database.transaction(PROJECT_STORE, 'readwrite')
    const record: StoredProjectRecord = { id: project.id, project: clone(project), createdAt: existing?.createdAt ?? createdAt ?? now(), updatedAt: project.updatedAt, size: projectSize(project) }
    transaction.objectStore(PROJECT_STORE).put(record)
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error ?? new Error('Could not save project.')); transaction.onabort = () => reject(transaction.error ?? new Error('Project save was aborted.')) })
    return { id: record.id, name: project.name, updatedAt: record.updatedAt, createdAt: record.createdAt, size: record.size }
  } finally { database.close() }
}

const idbGetProject = async (id: string): Promise<StoredProjectRecord | null> => {
  const database = await openDatabase()
  try { return (await idbRequest<StoredProjectRecord | undefined>(database.transaction(PROJECT_STORE, 'readonly').objectStore(PROJECT_STORE).get(id))) ?? null } finally { database.close() }
}

const idbListProjects = async (): Promise<StoredProjectRecord[]> => {
  const database = await openDatabase()
  try { return await idbRequest<StoredProjectRecord[]>(database.transaction(PROJECT_STORE, 'readonly').objectStore(PROJECT_STORE).getAll()) } finally { database.close() }
}

const idbDeleteProject = async (id: string): Promise<void> => {
  const database = await openDatabase()
  try { await idbRequest(database.transaction(PROJECT_STORE, 'readwrite').objectStore(PROJECT_STORE).delete(id)) } finally { database.close() }
}

let legacyMigration: Promise<void> | null = null
const migrateLegacyToIndexedDb = async (): Promise<void> => {
  if (!hasIndexedDb()) return
  if (!legacyMigration) legacyMigration = (async () => {
    try {
      const existing = await idbListProjects()
      const legacy = readLegacyProject()
      if (legacy && !existing.some((record) => record.id === legacy.id)) await idbPutProject(legacy, legacy.updatedAt)
    } catch { /* fallback storage remains authoritative when IDB is blocked */ }
  })()
  await legacyMigration
}

/** Save to IndexedDB and always keep a synchronous local recovery copy. */
export const saveProject = async (project: Project, options: SaveProjectOptions = {}): Promise<Project> => {
  const candidate = clone(project)
  candidate.updatedAt = now()
  let copy = validateProject(candidate)
  if (options.snapshotName) copy = addSnapshot(copy, options.snapshotName).project
  const existingLocal = localSummaryIndex().find((item) => item.id === copy.id)
  let recoveryComplete = false
  if (!options.skipRecoveryCopy) {
    const raw = JSON.stringify(copy)
    const primaryRecoveryWritten = storageSet(PROJECT_KEY, raw)
    const fallback = writeLocalProject(copy, existingLocal?.createdAt ?? copy.updatedAt)
    recoveryComplete = primaryRecoveryWritten && fallback.projectWritten && fallback.indexWritten && storageGet(PROJECT_KEY) === raw && storageGet(`${FALLBACK_PROJECT_PREFIX}${copy.id}`) !== null
    if (!recoveryComplete) writeRecoveryPointer({ projectId: copy.id, updatedAt: copy.updatedAt, reason: getStorage() ? 'local-storage-quota' : 'local-storage-unavailable' })
    else clearRecoveryPointer()
  }
  try {
    await idbPutProject(copy, existingLocal?.createdAt ?? copy.updatedAt)
  } catch (error) {
    // Local-only/private browsers remain supported. Quota failures are
    // surfaced so the UI cannot claim a save that did not persist.
    if (isQuotaError(error)) throw new ProjectStorageError('Project storage quota was exceeded. Remove large assets or export a package before saving again.', 'quota')
    if (!hasIndexedDb() || isStorageUnavailableError(error)) {
      if (recoveryComplete) return clone(copy)
      throw new ProjectStorageError(getStorage() ? 'Project could not be saved because browser recovery storage is full.' : 'Project could not be saved because browser storage is unavailable.', getStorage() ? 'quota' : 'unavailable')
    }
    throw new ProjectStorageError(error instanceof Error ? error.message : 'Project could not be saved.', 'failed')
  }
  return clone(copy)
}

export const clearStoredProject = () => {
  storageRemove(PROJECT_KEY)
}

export const listSavedProjects = async (): Promise<SavedProjectSummary[]> => {
  try {
    await migrateLegacyToIndexedDb()
    const records = await idbListProjects()
    const validRecords = records.filter((record) => { try { record.project = validateProject(record.project); return true } catch { return false } })
    const summaries = validRecords.map((record) => ({ id: record.id, name: record.project.name, updatedAt: record.updatedAt, createdAt: record.createdAt, size: record.size })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    // Keep an index for browsers that later lose IndexedDB access.
    writeLocalSummaryIndex(summaries)
    for (const record of validRecords) storageSet(`${FALLBACK_PROJECT_PREFIX}${record.id}`, JSON.stringify(record.project))
    return summaries.slice(0, MAX_SAVED_PROJECTS)
  } catch {
    const legacy = readLegacyProject()
    if (legacy && !localSummaryIndex().some((item) => item.id === legacy.id)) writeLocalProject(legacy, legacy.updatedAt)
    return localSummaryIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_SAVED_PROJECTS)
  }
}

export const loadSavedProject = async (id: string): Promise<Project | null> => {
  if (!isSafeId(id)) return null
  try {
    await migrateLegacyToIndexedDb()
    const record = await idbGetProject(id)
    if (record?.project) return validateProject(record.project)
  } catch { /* use recovery fallback */ }
  return readLocalProject(id)?.project ?? null
}

export const deleteSavedProject = async (id: string): Promise<void> => {
  if (!isSafeId(id)) return
  storageRemove(`${FALLBACK_PROJECT_PREFIX}${id}`)
  writeLocalSummaryIndex(localSummaryIndex().filter((item) => item.id !== id))
  if (readLegacyProject()?.id === id) storageRemove(PROJECT_KEY)
  try { await idbDeleteProject(id) } catch { /* already removed from fallback */ }
}

const snapshotProject = (project: Project): Omit<Project, 'versions'> => {
  const copy = clone(project)
  copy.versions = []
  const { versions: _versions, ...withoutVersions } = copy
  return withoutVersions
}

export const createSnapshot = (project: Project, name = `Snapshot ${new Date().toLocaleString()}`): Snapshot => ({ id: uid('snapshot'), name: name.slice(0, PROJECT_LIMITS.maxNameLength), createdAt: now(), project: snapshotProject(validateProject(project)) })

export const withSnapshot = (project: Project, snapshot: Snapshot, maxVersions = MAX_PROJECT_VERSIONS): Project => {
  const copy = validateProject(project)
  const bounded = Number.isFinite(maxVersions) ? Math.max(1, Math.min(Math.floor(maxVersions), MAX_PROJECT_VERSIONS)) : MAX_PROJECT_VERSIONS
  const versions = [...copy.versions.filter((item) => item.id !== snapshot.id), clone(snapshot)].slice(-bounded)
  return { ...copy, versions }
}

export const addSnapshot = (project: Project, name?: string, maxVersions = MAX_PROJECT_VERSIONS): { project: Project; snapshot: Snapshot } => {
  const snapshot = createSnapshot(project, name)
  return { snapshot, project: withSnapshot(project, snapshot, maxVersions) }
}

export const saveSnapshot = async (project: Project, name?: string, options: { maxVersions?: number; skipProjectSave?: boolean } = {}): Promise<Snapshot> => {
  const result = addSnapshot(project, name, options.maxVersions ?? MAX_PROJECT_VERSIONS)
  if (!options.skipProjectSave) await saveProject(result.project)
  return result.snapshot
}

export const listProjectSnapshots = async (projectId: string): Promise<Snapshot[]> => (await loadSavedProject(projectId))?.versions ?? []
export const listSnapshots = listProjectSnapshots

export const restoreSnapshot = (project: Project, snapshotId: string): Project => {
  const snapshot = validateProject(project).versions.find((item) => item.id === snapshotId)
  if (!snapshot) throw new Error(`Snapshot ${snapshotId} was not found.`)
  return validateProject({ ...snapshot.project, id: project.id, name: project.name, updatedAt: now(), versions: project.versions })
}

export const deleteSnapshot = async (project: Project, snapshotId: string): Promise<Project> => {
  const next = validateProject({ ...project, versions: project.versions.filter((snapshot) => snapshot.id !== snapshotId), updatedAt: now() })
  await saveProject(next)
  return next
}

const slug = (value: string, fallback = 'layer-project') => {
  const normalized = value.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return normalized.slice(0, 96) || fallback
}

const markdownText = (value: string) => value.replace(/[`*_#[\]<>]/g, (character) => `\\${character}`).replace(/\r?\n/g, '\n')

const exportSafeProject = (project: Project): Project => {
  const safe = validateProject(project)
  const copy = deepCloneProject(safe)
  // Provider records, MCP connections, skills/commands, chat history and
  // editable prompts are local/private configuration, never handoff data.
  copy.providers = []
  copy.connections = []
  copy.skills = []
  copy.commands = []
  copy.versions = []
  const privateSettings = copy.settings as Project['settings'] & { mainProviderId?: string; visionProviderId?: string; promptVersions?: unknown }
  privateSettings.mainPrompt = ''
  privateSettings.visionPrompt = ''
  delete privateSettings.mainProviderId
  delete privateSettings.visionProviderId
  delete privateSettings.promptVersions
  return copy
}

const briefFor = (project: Project) => {
  const pageLines = project.pages.map((page) => {
    const elements = page.elements.filter((element) => element.visible).map((element) => `  - ${markdownText(element.name)} (${element.type}) · ${element.width}×${element.height} at ${element.x},${element.y}${element.text ? ` — ${markdownText(element.text)}` : ''}`).join('\n')
    return `### ${markdownText(page.name)} · ${page.width}×${page.height}\n\n${markdownText(page.notes || 'No page notes.')}\n\n${elements || '  - No visible elements.'}`
  }).join('\n\n')
  const interactions = project.pages.flatMap((page) => page.elements.flatMap((element) => element.interactions.map((interaction) => `- ${markdownText(page.name)} / ${markdownText(element.name)} — ${interaction.trigger} → ${interaction.action}${interaction.pageId ? ` → ${markdownText(interaction.pageId)}` : ''}${interaction.value ? ` (${markdownText(interaction.value)})` : ''}`))).join('\n') || '- None defined.'
  const notes = project.pages.flatMap((page) => page.elements.filter((element) => element.notes).map((element) => `- ${markdownText(page.name)} / ${markdownText(element.name)}: ${markdownText(element.notes ?? '')}`)).join('\n') || '- None recorded.'
  const assets = project.assets.map((asset) => `- ${markdownText(asset.name)} (${asset.kind}) · ${markdownText(asset.license)} · ${markdownText(asset.source)}`).join('\n') || '- None installed.'
  return `# ${markdownText(project.name)} — implementation brief\n\nThis brief describes the exported Layer prototype. Prototype actions are client-side simulations; production data, authentication, and form backends remain outside this package.\n\n## Pages\n\n${pageLines}\n\n## Design tokens\n\n${project.styles.map((style) => `- ${markdownText(style.name)}: ${markdownText(style.value)}`).join('\n') || '- None defined.'}\n\n## Components\n\n${project.components.map((component) => `- ${markdownText(component.name)} (${component.elementIds.length} source objects)`).join('\n') || '- None defined.'}\n\n## Interactions\n\n${interactions}\n\n## Assets and licenses\n\n${assets}\n\n## Implementation notes\n\n${notes}\n\n## Responsive behavior\n\nEach page scales to the available viewport while preserving its design coordinate system. Exported navigation, scroll, visibility, state, form simulation, and external-link interactions are wired in the standalone preview.\n\nGenerated at ${now()}. Private provider records, MCP connections, chat history, skills, commands, and editable prompts are excluded.\n`
}

const schemaDocumentation = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Layer project package',
  type: 'object',
  required: ['format', 'version', 'project'],
  properties: {
    format: { const: 'layer' }, version: { type: 'integer', minimum: 1, maximum: 2 }, exportedAt: { type: 'string', format: 'date-time' },
    project: { type: 'object', required: ['id', 'name', 'pages', 'activePageId', 'styles', 'components', 'assets', 'integrations', 'providers', 'skills', 'commands', 'connections', 'versions', 'settings'], description: 'Validated Layer Project. Exported private arrays are intentionally empty.' },
  },
  interactionActions: ['navigate', 'external', 'scroll', 'toggle-visibility', 'set-state', 'submit-form', 'animate'],
  privateFieldsExcluded: ['providers', 'connections', 'skills', 'commands', 'settings.mainPrompt', 'settings.visionPrompt', 'settings.mainProviderId', 'settings.visionProviderId', 'settings.promptVersions', 'versions', 'chat', 'chatHistory', 'messages'],
}

const bytesFromBase64 = (value: string): Uint8Array => {
  const normalized = value.replace(/\s/g, '')
  if (typeof atob === 'function') return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0))
  // Node's global Buffer is intentionally reached without a compile-time
  // dependency so this module remains browser-compatible.
  const maybeBuffer = (globalThis as unknown as { Buffer?: { from(value: string, encoding: string): Uint8Array } }).Buffer
  if (maybeBuffer) return new Uint8Array(maybeBuffer.from(normalized, 'base64'))
  throw new Error('Base64 decoding is unavailable in this environment.')
}

const dataUrlBytes = (value: string): { bytes: Uint8Array; mime: string } | null => {
  const match = value.match(/^data:([^;,]+)(?:;[^,]*)?,([\s\S]*)$/i)
  if (!match) return null
  const [, mime, payload] = match
  try {
    const header = value.slice(0, value.indexOf(','))
    return { mime, bytes: /;base64/i.test(header) ? bytesFromBase64(payload) : new TextEncoder().encode(decodeURIComponent(payload)) }
  } catch { return null }
}

const extensionFor = (asset: AssetRecord, mime = '') => {
  if (asset.kind === 'font') return mime.includes('woff2') ? 'woff2' : mime.includes('woff') ? 'woff' : mime.includes('opentype') ? 'otf' : 'ttf'
  if (mime.includes('svg')) return 'svg'
  if (mime.includes('png')) return 'png'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('jpeg')) return 'jpg'
  return asset.kind === 'icon' ? 'svg' : 'bin'
}

const assetPath = (asset: AssetRecord, mime = '') => {
  const safeId = asset.id.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 120) || 'asset'
  return `assets/${safeId}.${extensionFor(asset, mime)}`
}

const exportAssets = (project: Project): AssetRecord[] => {
  const result = [...project.assets]
  const registered = new Set(result.map((asset) => asset.src).filter((src): src is string => Boolean(src)))
  for (const page of project.pages) for (const element of page.elements) {
    if (!element.src || registered.has(element.src)) continue
    registered.add(element.src)
    result.push({ id: `element-${element.id}`, name: `${element.name} source`, kind: element.type === 'icon' ? 'icon' : 'image', src: element.src, source: 'Element source', license: 'User/project supplied', installedAt: now(), metadata: { elementId: element.id, pageId: page.id } })
  }
  return result
}

const toUint8 = async (value: Blob | Uint8Array | ArrayBuffer): Promise<Uint8Array> => value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(await value.arrayBuffer())

const fetchAssetBytes = async (asset: AssetRecord, fetchAsset?: (url: string) => Promise<Response>): Promise<{ bytes: Uint8Array; mime: string } | null> => {
  if (!asset.src) return null
  const data = dataUrlBytes(asset.src)
  if (data) {
    if (data.bytes.byteLength > PROJECT_LIMITS.maxAssetBytes) throw new Error('asset exceeds the package size limit')
    return { bytes: data.bytes, mime: data.mime }
  }
  if (!isSafeUrl(asset.src, { allowData: false, allowRelative: false })) return null
  const fetcher = fetchAsset ?? globalThis.fetch?.bind(globalThis)
  if (!fetcher) return null
  const response = await fetcher(asset.src)
  if (!response.ok) throw new Error(`asset request returned ${response.status}`)
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > PROJECT_LIMITS.maxAssetBytes) throw new Error('asset exceeds the package size limit')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > PROJECT_LIMITS.maxAssetBytes) throw new Error('asset exceeds the package size limit')
  const mime = response.headers.get('content-type')?.split(';')[0] ?? ''
  if (mime === 'image/svg+xml' || asset.kind === 'icon' && /\.svg(?:$|[?#])/i.test(asset.src)) {
    const sanitized = sanitizeSvgDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new TextDecoder().decode(bytes))}`)
    const hydrated = dataUrlBytes(sanitized)
    if (!hydrated) throw new Error('SVG asset could not be sanitized')
    return { bytes: hydrated.bytes, mime: 'image/svg+xml' }
  }
  return { bytes, mime }
}

const replaceAssetReferences = (project: Project, paths: Map<string, string>): Project => {
  const copy = deepCloneProject(project)
  copy.assets = copy.assets.map((asset) => ({ ...asset, src: asset.src && paths.get(asset.src) ? paths.get(asset.src) : asset.src }))
  copy.pages = copy.pages.map((page) => ({ ...page, elements: page.elements.map((element) => ({ ...element, src: element.src && paths.get(element.src) ? paths.get(element.src) : element.src })) }))
  return copy
}

const previewProject = (project: Project): Project => {
  const copy = deepCloneProject(project)
  const relative = (src: string | undefined) => src?.startsWith('assets/') ? `../${src}` : src
  copy.assets = copy.assets.map((asset) => ({ ...asset, src: relative(asset.src) }))
  copy.pages = copy.pages.map((page) => ({ ...page, elements: page.elements.map((element) => ({ ...element, src: relative(element.src) })) }))
  return copy
}

const escapeJsonForHtml = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const previewFor = (project: Project): string => {
  const pageData = project.pages.map((page) => ({ id: page.id, name: page.name, width: page.width, height: page.height, background: page.background, breakpoints: page.breakpoints, elements: page.elements.map((element) => ({ ...element, text: element.text ?? '', src: element.src?.startsWith('assets/') ? `../${element.src}` : element.src })) }))
  const safeTitle = escapeHtml(project.name)
  const json = escapeJsonForHtml({ project: { id: project.id, name: project.name, activePageId: project.activePageId, pages: pageData } })
  const fonts = project.assets.filter((asset) => asset.kind === 'font' && asset.src).map((asset) => ({ family: asset.metadata?.family ?? asset.name, src: asset.src?.startsWith('assets/') ? `../${asset.src}` : asset.src }))
  const fontJson = escapeJsonForHtml(fonts)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} preview</title><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#0b0c0e;color:#f4f1e8;font-family:Segoe UI,Arial,sans-serif}body{padding:20px}.layer-nav{display:flex;gap:8px;flex-wrap:wrap;max-width:1200px;margin:0 auto 18px}.layer-nav button{border:1px solid #394250;background:#151a22;color:#f4f1e8;border-radius:7px;padding:8px 12px;cursor:pointer}.layer-nav button[aria-current=true]{background:#f5b847;color:#090b0c;border-color:#f5b847}.layer-status{max-width:1200px;margin:0 auto 12px;min-height:1.2em;color:#b9c2d0}.page-shell{position:relative;width:min(100%,var(--design-width));margin:0 auto;overflow:hidden;border:1px solid #303844}.page-canvas{position:absolute;left:0;top:0;transform-origin:top left;overflow:hidden}.layer-node{position:absolute;white-space:pre-wrap;overflow:hidden;transform-origin:center;transition:opacity .18s,transform .18s}.layer-node.is-hidden{display:none!important}.layer-node.is-animated{animation:layer-pulse .5s ease}.layer-node img{display:block;width:100%;height:100%;object-fit:cover}.layer-node.button,.layer-node.input,.layer-node.nav{cursor:pointer}.layer-node.button{display:grid;place-items:center}.layer-node.input{outline:1px solid #6c7584}.layer-node.state-active{outline:2px solid #f5b847}@keyframes layer-pulse{50%{transform:scale(1.04)}}@media(max-width:600px){body{padding:10px}.layer-nav{margin-bottom:10px}.layer-nav button{padding:7px 9px}}
</style></head><body><nav class="layer-nav" aria-label="Pages"></nav><div class="layer-status" role="status" aria-live="polite"></div><main id="layer-root"></main><script id="layer-data" type="application/json">${json}</script><script>
(function(){'use strict';
const data=JSON.parse(document.getElementById('layer-data').textContent||'{}'), pages=data.project.pages||[], root=document.getElementById('layer-root'), nav=document.querySelector('.layer-nav'), status=document.querySelector('.layer-status'); let active=null; const initialPages=new Set(); let observer=null;
const fonts=${fontJson};if('FontFace' in window){fonts.forEach((font)=>{if(font.src){const face=new FontFace(font.family,'url("'+font.src.replace(/"/g,'%22')+'")');face.load().then((loaded)=>document.fonts.add(loaded)).catch(()=>{});}});}
const number=(v,f)=>Number.isFinite(Number(v))?Number(v):f;
const setStyle=(node,e)=>{node.style.left=number(e.x,0)+'px';node.style.top=number(e.y,0)+'px';node.style.width=Math.max(0,number(e.width,0))+'px';node.style.height=Math.max(0,number(e.height,0))+'px';node.style.opacity=String(Math.max(0,Math.min(1,number(e.opacity,1))));node.style.transform='rotate('+number(e.rotation,0)+'deg)';node.style.background=e.fill||'transparent';node.style.border=(number(e.strokeWidth,0))+'px solid '+(e.stroke||'transparent');node.style.borderRadius=number(e.radius,0)+'px';node.style.color='#f4f1e8';node.style.fontFamily=e.fontFamily||'Segoe UI, Arial, sans-serif';node.style.fontSize=number(e.fontSize,16)+'px';node.style.fontWeight=String(number(e.fontWeight,500));node.style.lineHeight=String(number(e.lineHeight,1.35));node.style.letterSpacing=number(e.letterSpacing,0)+'px';node.style.textAlign=e.textAlign||'left';node.style.padding=e.type==='line'?'0':'16px';node.style.whiteSpace='pre-wrap';};
const findNode=(id)=>Array.from(root.querySelectorAll('[data-layer-id]')).find((node)=>node.dataset.layerId===id);
function applyAction(action){if(!action)return; if(action.action==='navigate'&&action.pageId)showPage(action.pageId); else if(action.action==='external'&&action.value&&/^https?:\\/\\//i.test(action.value))window.open(action.value,'_blank','noopener,noreferrer'); else if(action.action==='scroll'&&action.targetId){const target=findNode(action.targetId);target&&target.scrollIntoView({behavior:'smooth',block:'center'});} else if(action.action==='toggle-visibility'&&action.targetId){const target=findNode(action.targetId);target&&target.classList.toggle('is-hidden');} else if(action.action==='set-state'&&action.targetId){const target=findNode(action.targetId);if(target){target.dataset.state=action.value||'active';target.classList.toggle('state-active',target.dataset.state==='active');}} else if(action.action==='submit-form'){status.textContent='Prototype form submitted locally; connect a production handler during implementation.';} else if(action.action==='animate'&&action.targetId){const target=findNode(action.targetId);if(target){target.classList.remove('is-animated');void target.offsetWidth;target.classList.add('is-animated');}}}
function makeElement(e){const node=document.createElement(e.type==='button'?'button':'div');node.className='layer-node '+e.type+(e.visible===false?' is-hidden':'');node.dataset.layerId=e.id;setStyle(node,e);if(e.type==='image'&&e.src){const img=document.createElement('img');img.src=e.src;img.alt=e.alt||'';node.replaceChildren(img);}else if(e.type==='icon'&&e.src){const img=document.createElement('img');img.src=e.src;img.alt=e.alt||e.name||'';node.replaceChildren(img);}else if(e.type==='input'){const input=document.createElement('input');input.type='text';input.placeholder=e.text||'';input.style.cssText='width:100%;height:100%;background:transparent;border:0;color:inherit;font:inherit;outline:0';node.replaceChildren(input);}else node.textContent=e.text||e.name||e.type.toUpperCase();(e.interactions||[]).forEach((action)=>{if(action.trigger==='click')node.addEventListener('click',()=>applyAction(action));if(action.trigger==='hover')node.addEventListener('mouseenter',()=>applyAction(action));if(action.trigger==='focus'){node.tabIndex=0;node.addEventListener('focus',()=>applyAction(action));}});return node;}
function resize(){const shell=root.querySelector('.page-shell'),canvas=root.querySelector('.page-canvas');if(!shell||!canvas||!active)return;const scale=Math.min(1,Math.max(.05,shell.clientWidth/active.width));canvas.style.transform='scale('+scale+')';shell.style.height=(active.height*scale)+'px';}
function showPage(id){active=pages.find((page)=>page.id===id)||pages[0];if(!active)return;observer&&observer.disconnect();root.replaceChildren();const shell=document.createElement('section');shell.className='page-shell';shell.style.setProperty('--design-width',active.width+'px');const canvas=document.createElement('div');canvas.className='page-canvas';canvas.style.width=active.width+'px';canvas.style.height=active.height+'px';canvas.style.background=active.background||'#fff';canvas.setAttribute('data-page-id',active.id);(active.elements||[]).forEach((e)=>canvas.appendChild(makeElement(e)));shell.appendChild(canvas);root.appendChild(shell);nav.querySelectorAll('button').forEach((button)=>button.setAttribute('aria-current',button.dataset.pageId===active.id?'true':'false'));resize();window.scrollTo({top:0,behavior:'smooth'});const mountedPage=active;if(!initialPages.has(mountedPage.id)){initialPages.add(mountedPage.id);mountedPage.elements.forEach((e)=>(e.interactions||[]).filter((a)=>a.trigger==='page-load').forEach((a)=>setTimeout(()=>{if(active.id===mountedPage.id)applyAction(a);},number(a.delay,0))));}if('IntersectionObserver' in window){observer=new IntersectionObserver((entries)=>entries.forEach((entry)=>{if(entry.isIntersecting){const e=mountedPage.elements.find((item)=>item.id===entry.target.dataset.layerId);(e&&e.interactions||[]).filter((a)=>a.trigger==='scroll-into-view').forEach(applyAction);observer&&observer.unobserve(entry.target);}}));canvas.querySelectorAll('[data-layer-id]').forEach((node)=>observer.observe(node));}}
pages.forEach((page)=>{const button=document.createElement('button');button.type='button';button.dataset.pageId=page.id;button.textContent=page.name;button.addEventListener('click',()=>showPage(page.id));nav.appendChild(button);});window.addEventListener('resize',resize);showPage(data.project.activePageId||pages[0]&&pages[0].id);
}());
</script></body></html>`
}

const screenshotBytes = async (screenshot: ExportScreenshot): Promise<{ bytes: Uint8Array; mime: string } | null> => {
  if (screenshot.dataUrl) return dataUrlBytes(screenshot.dataUrl)
  if (screenshot.blob) return { bytes: await toUint8(screenshot.blob), mime: screenshot.mimeType ?? screenshot.blob.type ?? 'image/png' }
  return null
}

const loadPreviewRuntime = async (): Promise<string | null> => {
  try {
    if (typeof globalThis.fetch !== 'function') return null
    const response = await globalThis.fetch('/preview-runtime.js', { cache: 'no-store' })
    if (!response.ok) return null
    const text = await response.text()
    return text.length > 1000 ? text : null
  } catch { return null }
}

const downloadBlob = (filename: string, blob: Blob) => {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.rel = 'noopener'; link.style.display = 'none'
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Download a text file without leaking object URLs or interpreting markup. */
export const downloadText = (filename: string, text: string, type = 'text/plain;charset=utf-8') => downloadBlob(filename, new Blob([text], { type }))

/** Build a self-contained ZIP package. The returned Blob also exposes metadata. */
export const exportProjectPackage = async (project: Project, options: ExportProjectOptions = {}): Promise<ExportPackageBlob> => {
  const safe = exportSafeProject(project)
  const files: Record<string, Uint8Array> = {}
  const manifest: ExportAssetManifestEntry[] = []
  const paths = new Map<string, string>()
  const sourceAssets = exportAssets(safe)
  for (const asset of sourceAssets) {
    const entry: ExportAssetManifestEntry = { id: asset.id, name: asset.name, kind: asset.kind, source: asset.source, license: asset.license, metadata: asset.metadata, embedded: false }
    if (asset.src) {
      try {
        const fetched = await fetchAssetBytes(asset, options.fetchAsset)
        if (fetched) { const path = assetPath(asset, fetched.mime); files[path] = fetched.bytes; entry.path = path; entry.embedded = true; paths.set(asset.src, path) }
      } catch (error) { entry.error = error instanceof Error ? error.message : 'asset could not be embedded' }
    } else if (asset.kind === 'font' && asset.metadata?.family) {
      try {
        const fontFiles = await loadFontFiles({ id: asset.id, family: asset.metadata.family, license: asset.license, cssUrl: asset.metadata.cssUrl }, { fetcher: options.fetchAsset ? ((input: RequestInfo | URL) => options.fetchAsset!(String(input))) as typeof fetch : undefined })
        const fontFile = fontFiles[0]
        const fetched = dataUrlBytes(fontFile.dataUrl)
        if (fetched) { const path = assetPath(asset, fetched.mime); files[path] = fetched.bytes; entry.path = path; entry.embedded = true; asset.src = path }
      } catch (error) { entry.error = error instanceof Error ? error.message : 'font could not be embedded' }
    }
    manifest.push(entry)
  }
  const packagedProject = replaceAssetReferences({ ...safe, assets: sourceAssets }, paths)
  const exportedDocument = { format: 'layer', version: 2, exportedAt: now(), project: packagedProject }
  files['design.layer.json'] = new TextEncoder().encode(JSON.stringify(exportedDocument, null, 2))
  files['brief.md'] = new TextEncoder().encode(briefFor(packagedProject))
  files['schema.json'] = new TextEncoder().encode(JSON.stringify(schemaDocumentation, null, 2))
  files['assets/manifest.json'] = new TextEncoder().encode(JSON.stringify({ generatedAt: now(), assets: manifest }, null, 2))
  files['LICENSES.md'] = new TextEncoder().encode(`# Asset licenses\n\n${manifest.map((entry) => `## ${markdownText(entry.name)}\n\n- Source: ${markdownText(entry.source)}\n- License: ${markdownText(entry.license)}\n- Embedded file: ${entry.path ? `\`${entry.path}\`` : 'No (source URL retained)'}${entry.error ? `\n- Embedding note: ${markdownText(entry.error)}` : ''}`).join('\n\n') || 'No project assets.'}\n`)
  if (options.screenshots?.length) {
    const screenshots = [] as Array<Record<string, unknown>>
    for (const [index, screenshot] of options.screenshots.entries()) {
      const captured = await screenshotBytes(screenshot)
      const safeName = slug(screenshot.fileName ?? screenshot.label ?? `screenshot-${index + 1}`, `screenshot-${index + 1}`).replace(/\.[a-z0-9]+$/i, '')
      const path = `screenshots/${safeName}.${(captured?.mime.split('/')[1] ?? 'png').replace(/[^a-z0-9]/gi, '') || 'png'}`
      if (captured) files[path] = captured.bytes
      screenshots.push({ id: screenshot.id ?? `screenshot-${index + 1}`, label: screenshot.label ?? `Screenshot ${index + 1}`, pageId: screenshot.pageId, documentVersionId: screenshot.documentVersionId, selectionIds: screenshot.selectionIds ?? [], capturedAt: screenshot.capturedAt ?? now(), path: captured ? path : undefined })
    }
    files['screenshots/manifest.json'] = new TextEncoder().encode(JSON.stringify({ screenshots }, null, 2))
  }
  const previewRuntime = await loadPreviewRuntime()
  if (previewRuntime) files['preview/preview-runtime.js'] = new TextEncoder().encode(previewRuntime)
  files['preview/index.html'] = new TextEncoder().encode(previewRuntime ? buildPrototypeHtml(previewProject(exportSafeProject(packagedProject)), { runtimeSrc: 'preview-runtime.js' }) : await buildStandalonePreview(packagedProject))
  const archive = zipSync(files, { level: 6 })
  const requestedFilename = options.filename?.trim()
  const filename = requestedFilename ? (requestedFilename.toLowerCase().endsWith('.layer.zip') ? requestedFilename.replace(/[\\/]+/g, '-') : `${slug(requestedFilename)}.layer.zip`) : `${slug(safe.name)}.layer.zip`
  const result = new Blob([archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer], { type: 'application/zip' }) as ExportPackageBlob
  result.blob = result; result.filename = filename; result.files = Object.keys(files); result.manifest = manifest
  if (options.download !== false) downloadBlob(filename, result)
  return result
}

export const projectBuilderPrompt = (project: Project) => `${briefFor(exportSafeProject(project))}\n\nImplement this design faithfully. Ask only about unresolved decisions; use the exported IDs and notes as the source of truth.`
export const buildProjectBrief = (project: Project) => briefFor(exportSafeProject(project))
export const buildStandalonePreview = async (project: Project): Promise<string> => {
  const runtime = await loadPreviewRuntime()
  return buildPrototypeHtml(previewProject(exportSafeProject(project)), runtime ? { runtimeCode: runtime } : { runtimeSrc: 'preview-runtime.js' })
}
export const sanitizeProjectForExport = exportSafeProject

export const readFileAsDataUrl = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  if (file.size > PROJECT_LIMITS.maxAssetBytes) { reject(new Error('The selected file exceeds the 20 MB asset limit.')); return }
  if (typeof FileReader === 'undefined') {
    void file.arrayBuffer().then((buffer) => { const bytes = new Uint8Array(buffer); let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte) }); resolve(`data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`) }).catch(reject)
    return
  }
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error ?? new Error('Could not read file.')); reader.readAsDataURL(file)
})

const readBlobText = (file: Blob): Promise<string> => {
  if (file.size > PROJECT_LIMITS.maxImportBytes) return Promise.reject(new Error('The Layer file exceeds the 50 MB import limit.'))
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error ?? new Error('Could not read Layer file.')); reader.readAsText(file) })
}

const readBlobBytes = (file: Blob): Promise<Uint8Array> => {
  if (file.size > PROJECT_LIMITS.maxImportBytes) return Promise.reject(new Error('The Layer file exceeds the 50 MB import limit.'))
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.onerror = () => reject(reader.error ?? new Error('Could not read Layer file.')); reader.readAsArrayBuffer(file) })
}

const isZipBytes = (bytes: Uint8Array) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04

const base64FromBytes = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  if (typeof btoa === 'function') return btoa(binary)
  const maybeBuffer = (globalThis as unknown as { Buffer?: { from(value: Uint8Array): { toString(encoding: string): string } } }).Buffer
  if (maybeBuffer) return maybeBuffer.from(bytes).toString('base64')
  throw new Error('Base64 encoding is unavailable in this environment.')
}

const mimeForPath = (path: string): string => {
  const extension = path.split('.').pop()?.toLowerCase()
  return extension === 'svg' ? 'image/svg+xml' : extension === 'png' ? 'image/png' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'gif' ? 'image/gif' : extension === 'webp' ? 'image/webp' : extension === 'woff2' ? 'font/woff2' : extension === 'woff' ? 'font/woff' : extension === 'otf' ? 'font/otf' : extension === 'ttf' ? 'font/ttf' : 'application/octet-stream'
}

const hydrateArchiveAssets = (parsed: unknown, archive: Record<string, Uint8Array>): unknown => {
  if (!parsed || typeof parsed !== 'object') return parsed
  const document = parsed as Record<string, unknown>
  const project = (document.project && typeof document.project === 'object' ? document.project : document) as Record<string, unknown>
  const rawManifest = archive['assets/manifest.json']
  const manifestEntries: Array<{ path?: unknown }> = []
  if (rawManifest) {
    try {
      const manifest = JSON.parse(new TextDecoder().decode(rawManifest)) as { assets?: unknown }
      if (Array.isArray(manifest.assets)) for (const entry of manifest.assets) if (entry && typeof entry === 'object') manifestEntries.push(entry as { path?: unknown })
    } catch { /* the validator below still handles the document */ }
  }
  const paths = new Set<string>()
  for (const entry of manifestEntries) if (typeof entry.path === 'string' && entry.path.startsWith('assets/') && !entry.path.includes('..')) paths.add(entry.path)
  const rawAssets = Array.isArray(project.assets) ? project.assets : []
  for (const asset of rawAssets) {
    if (!asset || typeof asset !== 'object') continue
    const record = asset as Record<string, unknown>
    if (typeof record.src === 'string' && paths.has(record.src) && archive[record.src]) {
      const mime = mimeForPath(record.src)
      const dataUrl = `data:${mime};base64,${base64FromBytes(archive[record.src])}`
      record.src = mime === 'image/svg+xml' ? sanitizeSvgDataUrl(dataUrl) : dataUrl
    }
  }
  const pages = Array.isArray(project.pages) ? project.pages : []
  for (const page of pages) {
    if (!page || typeof page !== 'object') continue
    const elements = Array.isArray((page as Record<string, unknown>).elements) ? (page as Record<string, unknown>).elements as unknown[] : []
    for (const element of elements) {
      if (!element || typeof element !== 'object') continue
      const record = element as Record<string, unknown>
      if (typeof record.src === 'string' && paths.has(record.src) && archive[record.src]) {
        const mime = mimeForPath(record.src)
        const dataUrl = `data:${mime};base64,${base64FromBytes(archive[record.src])}`
        record.src = mime === 'image/svg+xml' ? sanitizeSvgDataUrl(dataUrl) : dataUrl
      }
    }
  }
  return parsed
}

/** Read raw JSON or an exported .layer.zip and validate before returning it. */
export const readLayerFile = async (file: Blob): Promise<Project> => {
  if (file.size > PROJECT_LIMITS.maxImportBytes) throw new Error('The Layer file exceeds the 50 MB import limit.')
  const buffer = await readBlobBytes(file)
  let text: string
  if (isZipBytes(buffer)) {
    let archive: Record<string, Uint8Array>
    let extractedBudget = 0
    try {
      archive = unzipSync(buffer, { filter: (file) => {
        if (!/^[A-Za-z0-9_.\-/]+$/.test(file.name) || file.name.includes('..') || file.name.startsWith('/')) throw new Error('The Layer archive contains an unsafe path.')
        if (file.originalSize > PROJECT_LIMITS.maxImportBytes || extractedBudget + file.originalSize > PROJECT_LIMITS.maxImportBytes) throw new Error('The Layer archive expands beyond the 50 MB import limit.')
        extractedBudget += file.originalSize
        return true
      } })
    } catch (error) { throw new Error(error instanceof Error ? error.message : 'The Layer archive is corrupt or unsupported.') }
    const extractedBytes = Object.values(archive).reduce((total, bytes) => total + bytes.byteLength, 0)
    if (extractedBytes > PROJECT_LIMITS.maxImportBytes) throw new Error('The Layer archive expands beyond the 50 MB import limit.')
    const document = archive['design.layer.json']
    if (!document) throw new Error('The Layer archive is missing design.layer.json.')
    try {
      const parsedDocument = JSON.parse(new TextDecoder().decode(document)) as unknown
      text = JSON.stringify(hydrateArchiveAssets(parsedDocument, archive))
    } catch { throw new Error('The Layer archive contains invalid design.layer.json.') }
  } else text = await readBlobText(file)
  if (new TextEncoder().encode(text).byteLength > PROJECT_LIMITS.maxImportBytes) throw new Error('The Layer document exceeds the 50 MB import limit.')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('The Layer file is not valid JSON.') }
  try { return validateLayerDocument(parsed) } catch (error) {
    if (error instanceof ProjectValidationError) throw error
    throw new Error(error instanceof Error ? error.message : 'The Layer project is invalid.')
  }
}

/** Raw pasted/imported JSON follows exactly the same validator as file import. */
export const parseLayerDocument = (text: string): Project => {
  if (new TextEncoder().encode(text).byteLength > PROJECT_LIMITS.maxImportBytes) throw new Error('The Layer document exceeds the 50 MB import limit.')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('The Layer document is not valid JSON.') }
  return validateLayerDocument(parsed)
}

export const readLayerJson = parseLayerDocument
