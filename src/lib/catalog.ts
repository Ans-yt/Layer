import type { AssetRecord } from './model'
import { uid } from './model'
import { PROJECT_LIMITS, isSafeUrl, sanitizeSvgMarkup } from './validation'

export type CatalogSource = 'proxy' | 'google-fonts' | 'fontsource' | 'iconify' | 'cache'

export interface IconSearchResult {
  name: string
  prefix: string
  icon: string
  title?: string
  source?: CatalogSource
}

export interface IconLicense {
  prefix: string
  title?: string
  spdx?: string
  url?: string
  source: CatalogSource
}

export interface FontResult {
  id: string
  family: string
  category?: string
  subsets?: string[]
  license?: string
  licenseUrl?: string
  source?: CatalogSource
  version?: string
  cssUrl?: string
  weights?: number[]
  styles?: string[]
}

export interface FontFile {
  family: string
  weight?: number
  style?: string
  format?: string
  sourceUrl: string
  dataUrl: string
}

export type CatalogItemKind = 'font' | 'icon' | 'template' | 'pattern'
export interface CatalogItem {
  id: string
  title: string
  kind: CatalogItemKind
  description: string
  source: CatalogSource | 'local'
  license: string
  licenseUrl?: string
  version?: string
  updatedAt?: string
  font?: FontResult
  icon?: IconSearchResult
}
export interface CatalogPage {
  items: CatalogItem[]
  page: number
  pageSize: number
  total: number
  hasNext: boolean
  cached: boolean
  source: CatalogSource | 'local'
}

export interface CatalogRequestOptions {
  fetcher?: typeof fetch
  /** Let the caller enforce its project integration installed/enabled state. */
  enabled?: boolean
  cacheTtlMs?: number
}

export class CatalogUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'CatalogUnavailableError' }
}

const CACHE_DB = 'layer.catalog.cache'
const CACHE_VERSION = 1
const CACHE_STORE = 'entries'
const CACHE_PREFIX = 'layer.catalog.cache.v1.'
const CACHE_TTL = 24 * 60 * 60 * 1_000
const MAX_CACHE_BYTES = 8 * 1024 * 1024
const FONT_PROXY = '/api/catalog/fonts'
const GOOGLE_METADATA_URL = 'https://fonts.google.com/metadata/fonts'
const FONTSOURCE_METADATA_URL = 'https://api.fontsource.org/v1/fonts'
const ICONIFY_API = 'https://api.iconify.design'

interface CacheEntry { key: string; value: unknown; savedAt: number }

const cacheKey = (kind: string, query: string) => `${kind}:${query.trim().toLowerCase()}`
const localKey = (key: string) => `${CACHE_PREFIX}${key}`

const getLocalStorage = (): Storage | null => {
  try { return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage } catch { return null }
}

const readLocalCache = (key: string, ttl: number): unknown | undefined => {
  try {
    const raw = getLocalStorage()?.getItem(localKey(key))
    if (!raw) return undefined
    const entry = JSON.parse(raw) as CacheEntry
    return Date.now() - entry.savedAt <= ttl ? entry.value : undefined
  } catch { return undefined }
}

const writeLocalCache = (key: string, value: unknown): void => {
  try {
    const raw = JSON.stringify({ key, value, savedAt: Date.now() } satisfies CacheEntry)
    if (raw.length <= MAX_CACHE_BYTES) getLocalStorage()?.setItem(localKey(key), raw)
  } catch { /* storage quota/security is optional */ }
}

const openCacheDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof globalThis.indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return }
  const request = globalThis.indexedDB.open(CACHE_DB, CACHE_VERSION)
  request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(CACHE_STORE)) request.result.createObjectStore(CACHE_STORE, { keyPath: 'key' }) }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('Could not open catalog cache.'))
})

const readIndexedCache = async (key: string, ttl: number): Promise<unknown | undefined> => {
  try {
    const database = await openCacheDb()
    const entry = await new Promise<CacheEntry | undefined>((resolve, reject) => { const request = database.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(key); request.onsuccess = () => resolve(request.result as CacheEntry | undefined); request.onerror = () => reject(request.error) })
    database.close()
    return entry && Date.now() - entry.savedAt <= ttl ? entry.value : undefined
  } catch { return undefined }
}

const writeIndexedCache = async (key: string, value: unknown): Promise<void> => {
  try {
    const database = await openCacheDb()
    await new Promise<void>((resolve, reject) => { const request = database.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE).put({ key, value, savedAt: Date.now() } satisfies CacheEntry); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) })
    database.close()
  } catch { /* cache must never make a real request fail */ }
}

const readCache = async (key: string, ttl = CACHE_TTL): Promise<{ value: unknown; source: 'cache' } | undefined> => {
  const local = readLocalCache(key, ttl)
  if (local !== undefined) return { value: local, source: 'cache' }
  const indexed = await readIndexedCache(key, ttl)
  return indexed === undefined ? undefined : { value: indexed, source: 'cache' }
}

const writeCache = async (key: string, value: unknown): Promise<void> => {
  writeLocalCache(key, value)
  await writeIndexedCache(key, value)
}

const requestJson = async <T>(url: string, fetcher: typeof fetch): Promise<{ data: T; source: CatalogSource }> => {
  const response = await fetcher(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new CatalogUnavailableError(`Catalog request returned ${response.status}.`)
  try { return { data: await response.json() as T, source: url.startsWith(FONT_PROXY) ? 'proxy' : url.includes('fontsource') ? 'fontsource' : url.includes('iconify') ? 'iconify' : 'google-fonts' } } catch { throw new CatalogUnavailableError('Catalog returned invalid JSON.') }
}

const requestText = async (url: string, fetcher: typeof fetch): Promise<{ text: string; response: Response }> => {
  const response = await fetcher(url, { headers: { Accept: 'text/css,image/svg+xml,text/plain' } })
  if (!response.ok) throw new CatalogUnavailableError(`Catalog request returned ${response.status}.`)
  const text = await response.text()
  if (text.length > MAX_CACHE_BYTES) throw new CatalogUnavailableError('Catalog response exceeds the cache limit.')
  return { text, response }
}

const resultId = (family: string) => family.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const parseGoogleFonts = (raw: unknown): FontResult[] => {
  const data = raw as { familyMetadataList?: Array<Record<string, unknown>> }
  const list = Array.isArray(data?.familyMetadataList) ? data.familyMetadataList : Array.isArray(raw) ? raw as Array<Record<string, unknown>> : []
  return list.flatMap((font) => {
    const family = typeof font.family === 'string' ? font.family : typeof font.name === 'string' ? font.name : ''
    if (!family) return []
    const subsets = Array.isArray(font.subsets) ? font.subsets.filter((item): item is string => typeof item === 'string') : undefined
    const category = typeof font.category === 'string' ? font.category : undefined
    const license = typeof font.license === 'string' ? font.license : typeof (font.license as Record<string, unknown> | undefined)?.type === 'string' ? String((font.license as Record<string, unknown>).type) : undefined
    return [{ id: resultId(family), family, category, subsets, license, licenseUrl: typeof font.licenseUrl === 'string' ? font.licenseUrl : undefined, version: typeof font.version === 'string' ? font.version : undefined }]
  })
}

const parseFontsource = (raw: unknown): FontResult[] => {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((font) => {
    const item = font as Record<string, unknown>
    const family = typeof item.family === 'string' ? item.family : typeof item.name === 'string' ? item.name : ''
    if (!family) return []
    const subsets = Array.isArray(item.subsets) ? item.subsets.filter((subset): subset is string => typeof subset === 'string') : undefined
    const weights = Array.isArray(item.weights) ? item.weights.filter((weight): weight is number => typeof weight === 'number' && Number.isFinite(weight)) : undefined
    const styles = Array.isArray(item.styles) ? item.styles.filter((style): style is string => typeof style === 'string') : undefined
    const licenseObject = item.license && typeof item.license === 'object' ? item.license as Record<string, unknown> : undefined
    return [{ id: resultId(family), family, category: typeof item.category === 'string' ? item.category : undefined, subsets, license: typeof item.license === 'string' ? item.license : typeof licenseObject?.name === 'string' ? licenseObject.name : typeof licenseObject?.id === 'string' ? licenseObject.id : undefined, licenseUrl: typeof item.license_url === 'string' ? item.license_url : typeof licenseObject?.url === 'string' ? licenseObject.url : undefined, version: typeof item.version === 'string' ? item.version : undefined, weights, styles }]
  })
}

const normalizeQuery = (query: string) => query.trim().slice(0, 200)

const LOCAL_MARKETPLACE: CatalogItem[] = [
  { id: 'starter-landing', title: 'Landing page', kind: 'template', description: 'A real hero, proof rail, call to action, and footer structure.', source: 'local', license: 'Layer starter content', version: '1.0.0' },
  { id: 'starter-dashboard', title: 'Dashboard shell', kind: 'template', description: 'Navigation, metric cards, activity list, and responsive content regions.', source: 'local', license: 'Layer starter content', version: '1.0.0' },
  { id: 'starter-contact', title: 'Contact flow', kind: 'template', description: 'Contact heading, supporting copy, form fields, and submit state.', source: 'local', license: 'Layer starter content', version: '1.0.0' },
  { id: 'pattern-signal-grid', title: 'Signal grid', kind: 'pattern', description: 'Editable grid fill with an amber signal accent.', source: 'local', license: 'Layer starter content', version: '1.0.0' },
  { id: 'pattern-soft-dots', title: 'Soft dots', kind: 'pattern', description: 'A low-contrast dotted backdrop for cards and hero regions.', source: 'local', license: 'Layer starter content', version: '1.0.0' },
]

export const getCatalogCategories = async (): Promise<Array<{ id: string; label: string; kind?: CatalogItemKind }>> => [
  { id: 'all', label: 'All' }, { id: 'template', label: 'Starters', kind: 'template' }, { id: 'pattern', label: 'Patterns', kind: 'pattern' }, { id: 'font', label: 'Fonts', kind: 'font' }, { id: 'icon', label: 'Icons', kind: 'icon' },
]

export const marketplaceCategories = getCatalogCategories

const paginate = (items: CatalogItem[], page: number, pageSize: number, cached: boolean, source: CatalogPage['source']): CatalogPage => {
  const safePage = Math.max(1, Math.floor(page))
  const safeSize = Math.max(1, Math.min(48, Math.floor(pageSize)))
  return { items: items.slice((safePage - 1) * safeSize, safePage * safeSize), page: safePage, pageSize: safeSize, total: items.length, hasNext: safePage * safeSize < items.length, cached, source }
}

export interface CatalogSearchOptions extends CatalogRequestOptions {
  query?: string
  category?: string
  page?: number
  pageSize?: number
}

/** A real catalog page composed from the official feeds and local starter content. */
export const searchCatalog = async (options: CatalogSearchOptions = {}): Promise<CatalogPage> => {
  ensureEnabled(options)
  const category = options.category ?? 'all'
  const query = normalizeQuery(options.query ?? '')
  const local = LOCAL_MARKETPLACE.filter((item) => (category === 'all' || item.kind === category) && (!query || `${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase())))
  if (category === 'template' || category === 'pattern') return paginate(local, options.page ?? 1, options.pageSize ?? 12, false, 'local')
  const items: CatalogItem[] = [...local]
  let cached = false
  let source: CatalogPage['source'] = 'local'
  if (category === 'all' || category === 'font') {
    const fonts = await searchFonts(query, options)
    cached ||= fonts.some((font) => font.source === 'cache')
    source = fonts[0]?.source ?? source
    items.push(...fonts.map((font) => ({ id: `font:${font.id}`, title: font.family, kind: 'font' as const, description: `${font.category ?? 'type'} family${font.weights?.length ? ` · ${font.weights.length} weights` : ''}`, source: font.source ?? 'google-fonts', license: font.license ?? 'Catalog metadata', licenseUrl: font.licenseUrl, version: font.version, font })))
  }
  if (category === 'all' || category === 'icon') {
    const icons = await searchIcons(query || 'arrow', options)
    cached ||= icons.some((icon) => icon.source === 'cache')
    source = icons[0]?.source ?? source
    items.push(...icons.map((icon) => ({ id: `icon:${icon.icon}`, title: icon.title ?? icon.name, kind: 'icon' as const, description: `${icon.prefix} collection`, source: icon.source ?? 'iconify', license: 'Collection license fetched on install', icon })))
  }
  return paginate(items.filter((item) => category === 'all' || item.kind === category), options.page ?? 1, options.pageSize ?? 12, cached, source)
}

export const searchMarketplace = searchCatalog

const ensureEnabled = (options?: CatalogRequestOptions) => { if (options?.enabled === false) throw new CatalogUnavailableError('This catalog integration is disabled.') }

/** Search the Iconify service; cached results are labelled and never invented. */
export const searchIcons = async (query: string, options: CatalogRequestOptions = {}): Promise<IconSearchResult[]> => {
  ensureEnabled(options)
  const normalized = normalizeQuery(query || 'arrow')
  const key = cacheKey('icons', normalized)
  const cached = await readCache(key, options.cacheTtlMs)
  if (cached) return (cached.value as IconSearchResult[]).filter((result) => typeof result?.icon === 'string' && /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(result.icon)).map((result) => ({ ...result, source: 'cache' }))
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis)
  if (!fetcher) throw new CatalogUnavailableError('Fetch is unavailable; install or enable the Iconify integration.')
  try {
    const { data } = await requestJson<{ icons?: unknown }>(`${ICONIFY_API}/search?query=${encodeURIComponent(normalized)}&limit=24`, fetcher)
    const icons = Array.isArray(data.icons) ? data.icons.filter((item): item is string => typeof item === 'string' && /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(item)) : []
    const results = icons.map((full) => { const [prefix, name] = full.split(':'); return { name, prefix, icon: full, title: name.replace(/[-_]/g, ' '), source: 'iconify' as const } })
    await writeCache(key, results)
    return results
  } catch (error) {
    if (error instanceof CatalogUnavailableError) throw error
    throw new CatalogUnavailableError(error instanceof Error ? error.message : 'Icon catalog is unavailable.')
  }
}

const safeIconName = (icon: string) => {
  if (!/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(icon)) throw new CatalogUnavailableError('Invalid Iconify icon name.')
  return icon
}

/** Load and sanitize an SVG from Iconify before it reaches the DOM. */
export const loadIconSvg = async (icon: string, options: CatalogRequestOptions = {}): Promise<string> => {
  ensureEnabled(options)
  const safe = safeIconName(icon)
  const key = cacheKey('svg', safe)
  const cached = await readCache(key, options.cacheTtlMs)
  if (cached && typeof cached.value === 'string') {
    const sanitized = sanitizeSvgMarkup(cached.value)
    if (/^\s*<svg(?:\s|>)/i.test(sanitized) && !/<script\b|\son[a-z]+=|javascript\s*:/i.test(sanitized)) return sanitized
  }
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis)
  if (!fetcher) throw new CatalogUnavailableError('Fetch is unavailable; install or enable the Iconify integration.')
  const { text } = await requestText(`${ICONIFY_API}/${safe.replace(':', '/')}.svg?height=96`, fetcher)
  const svg = sanitizeSvgMarkup(text)
  if (!/^\s*<svg(?:\s|>)/i.test(svg) || /<script\b|\son[a-z]+=|javascript\s*:/i.test(svg)) throw new CatalogUnavailableError('Iconify returned unsafe SVG.')
  await writeCache(key, svg)
  return svg
}

export const loadIconSvgDataUrl = async (icon: string, options: CatalogRequestOptions = {}) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await loadIconSvg(icon, options))}`

export const createIconAsset = async (result: IconSearchResult, options: CatalogRequestOptions = {}): Promise<AssetRecord> => {
  const source = result.source === 'cache' ? 'Iconify (cached)' : 'Iconify'
  const license = await getIconCollectionLicense(result.prefix, options)
  const src = await loadIconSvgDataUrl(result.icon, options)
  return { id: uid('asset'), name: result.title ?? result.name, kind: 'icon', iconName: result.icon, src, source, license: license.spdx ?? license.title ?? 'Collection metadata', installedAt: new Date().toISOString(), metadata: { collection: result.prefix, licenseUrl: license.url ?? '', licenseSpdx: license.spdx ?? '' } }
}

/** Resolve the actual Iconify collection license instead of attaching a vague placeholder. */
export const getIconCollectionLicense = async (prefix: string, options: CatalogRequestOptions = {}): Promise<IconLicense> => {
  ensureEnabled(options)
  if (!/^[A-Za-z0-9-]{1,64}$/.test(prefix)) throw new CatalogUnavailableError('Invalid Iconify collection prefix.')
  const key = cacheKey('license', prefix)
  const cached = await readCache(key, options.cacheTtlMs)
  if (cached) return { ...(cached.value as IconLicense), source: 'cache' }
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis)
  if (!fetcher) throw new CatalogUnavailableError('Fetch is unavailable; install or enable the Iconify integration.')
  const { data } = await requestJson<Record<string, unknown>>(`${ICONIFY_API}/collection?prefix=${encodeURIComponent(prefix)}`, fetcher)
  const licenseObject = data.license as Record<string, unknown> | undefined
  const license: IconLicense = { prefix, title: typeof licenseObject?.title === 'string' ? licenseObject.title : typeof data.license === 'string' ? data.license : undefined, spdx: typeof licenseObject?.spdx === 'string' ? licenseObject.spdx : undefined, url: typeof licenseObject?.url === 'string' ? licenseObject.url : undefined, source: 'iconify' }
  if (!license.title && !license.spdx && !license.url) throw new CatalogUnavailableError('Iconify did not provide license metadata for this collection.')
  await writeCache(key, license)
  return license
}

export const loadIconCollectionLicense = getIconCollectionLicense
export const getIconLicense = getIconCollectionLicense
export const searchIconify = searchIcons

const findCachedFonts = async (query: string, options: CatalogRequestOptions): Promise<FontResult[] | undefined> => {
  const exact = await readCache(cacheKey('fonts', query), options.cacheTtlMs)
  if (exact && Array.isArray(exact.value)) return (exact.value as FontResult[]).map((font) => ({ ...font, source: 'cache' }))
  const all = await readCache(cacheKey('fonts', ''), options.cacheTtlMs)
  if (all && Array.isArray(all.value)) return (all.value as FontResult[]).filter((font) => !query || font.family.toLowerCase().includes(query.toLowerCase())).slice(0, 32).map((font) => ({ ...font, source: 'cache' }))
  return undefined
}

/** Search Google Fonts metadata through a same-origin proxy first, then the official feeds. */
export const searchFonts = async (query: string, options: CatalogRequestOptions = {}): Promise<FontResult[]> => {
  ensureEnabled(options)
  const normalized = normalizeQuery(query)
  const cached = await findCachedFonts(normalized, options)
  if (cached) return cached
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis)
  if (!fetcher) throw new CatalogUnavailableError('Fetch is unavailable; install or enable the font catalog.')
  const sources = [
    `${FONT_PROXY}?query=${encodeURIComponent(normalized)}`,
    GOOGLE_METADATA_URL,
    FONTSOURCE_METADATA_URL,
  ]
  let lastError: unknown
  for (const source of sources) {
    try {
      const { data, source: sourceLabel } = await requestJson<unknown>(source, fetcher)
      const parsed = source === FONTSOURCE_METADATA_URL ? parseFontsource(data) : parseGoogleFonts(data)
      if (!parsed.length) throw new CatalogUnavailableError('Font catalog returned no usable metadata.')
      const results = parsed.filter((font) => !normalized || font.family.toLowerCase().includes(normalized.toLowerCase())).slice(0, 32).map((font) => ({ ...font, source: sourceLabel }))
      await writeCache(cacheKey('fonts', normalized), results)
      if (!normalized) await writeCache(cacheKey('fonts', ''), parsed)
      return results
    } catch (error) { lastError = error }
  }
  throw new CatalogUnavailableError(lastError instanceof Error ? lastError.message : 'The font catalog could not be reached.')
}

export const fontImportUrl = (family: string) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`

const parseCssFontSources = (css: string): Array<{ weight?: number; style?: string; url: string; format?: string }> => {
  const results: Array<{ weight?: number; style?: string; url: string; format?: string }> = []
  const blocks = css.match(/@font-face\s*\{[\s\S]*?\}/gi) ?? []
  for (const block of blocks) {
    const weightMatch = block.match(/font-weight\s*:\s*([0-9]+)/i)
    const styleMatch = block.match(/font-style\s*:\s*([a-z-]+)/i)
    const sourceMatch = block.match(/src\s*:[\s\S]*?url\((['"]?)(https?:[^)'"\s]+)\1\)\s*format\((['"]?)([^)'"\s]+)\3\)/i) ?? block.match(/src\s*:[\s\S]*?url\((['"]?)(https?:[^)'"\s]+)\1\)/i)
    if (sourceMatch) results.push({ weight: weightMatch ? Number(weightMatch[1]) : undefined, style: styleMatch?.[1], url: sourceMatch[2], format: sourceMatch[4] })
  }
  return results
}

const bytesToDataUrl = (bytes: Uint8Array, mime: string): string => {
  let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return `data:${mime || 'application/octet-stream'};base64,${btoa(binary)}`
}

/** Fetch selected font files and return self-contained data URLs for export. */
export const loadFontFiles = async (font: FontResult, options: CatalogRequestOptions = {}): Promise<FontFile[]> => {
  ensureEnabled(options)
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis)
  if (!fetcher) throw new CatalogUnavailableError('Fetch is unavailable; install or enable the font catalog.')
  const cssUrl = font.cssUrl ?? fontImportUrl(font.family)
  const css = await requestText(cssUrl, fetcher)
  const sources = parseCssFontSources(css.text)
  if (!sources.length) throw new CatalogUnavailableError(`No downloadable font files were advertised for ${font.family}.`)
  const files: FontFile[] = []
  for (const source of sources) {
    if (!isSafeUrl(source.url, { allowData: false, allowRelative: false })) continue
    const key = cacheKey('font-file', source.url)
    const cached = await readCache(key, options.cacheTtlMs)
    if (cached && typeof cached.value === 'string' && /^data:font\/(?:woff2?|opentype|ttf)(?:;[^,]*)?,/i.test(cached.value)) files.push({ family: font.family, weight: source.weight, style: source.style, format: source.format, sourceUrl: source.url, dataUrl: cached.value });
    else {
      const response = await fetcher(source.url)
      if (!response.ok) throw new CatalogUnavailableError(`Font file request returned ${response.status}.`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > PROJECT_LIMITS.maxAssetBytes) throw new CatalogUnavailableError('Font file exceeds the asset size limit.')
      const dataUrl = bytesToDataUrl(bytes, response.headers.get('content-type') ?? `font/${source.format ?? 'woff2'}`)
      await writeCache(key, dataUrl)
      files.push({ family: font.family, weight: source.weight, style: source.style, format: source.format, sourceUrl: source.url, dataUrl })
    }
  }
  if (!files.length) throw new CatalogUnavailableError(`No safe font files were available for ${font.family}.`)
  return files
}

/** Convert a catalog result into a project asset with embedded font files. */
export const createFontAsset = async (font: FontResult, options: CatalogRequestOptions = {}): Promise<AssetRecord> => {
  const files = await loadFontFiles(font, options)
  const first = files[0]
  return { id: uid('asset'), name: font.family, kind: 'font', src: first.dataUrl, source: font.source === 'fontsource' ? 'Fontsource' : 'Google Fonts', license: font.license ?? 'See catalog metadata', installedAt: new Date().toISOString(), metadata: { family: font.family, category: font.category ?? '', cssUrl: font.cssUrl ?? fontImportUrl(font.family), files: JSON.stringify(files.map(({ dataUrl: _dataUrl, ...descriptor }) => descriptor)), licenseUrl: font.licenseUrl ?? '' } }
}

export const downloadFontFiles = loadFontFiles

/** Create one self-contained project asset per downloaded weight/style. */
export const createFontAssets = async (font: FontResult, options: CatalogRequestOptions = {}): Promise<AssetRecord[]> => {
  const files = await loadFontFiles(font, options)
  return files.map((file) => ({ id: uid('asset'), name: `${font.family}${file.weight ? ` ${file.weight}` : ''}${file.style ? ` ${file.style}` : ''}`, kind: 'font', src: file.dataUrl, source: font.source === 'fontsource' ? 'Fontsource' : 'Google Fonts', license: font.license ?? 'See catalog metadata', installedAt: new Date().toISOString(), metadata: { family: font.family, weight: String(file.weight ?? ''), style: file.style ?? '', format: file.format ?? '', sourceUrl: file.sourceUrl, licenseUrl: font.licenseUrl ?? '' } }))
}

/** Hydrate all locally embedded font assets after refresh; no network is needed. */
export const hydrateInstalledFonts = (assets: AssetRecord[]): FontFace[] => {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return []
  const loaded: FontFace[] = []
  for (const asset of assets) {
    if (asset.kind !== 'font' || !asset.src || !/^data:font\//i.test(asset.src)) continue
    const family = asset.metadata?.family ?? asset.name
    const weight = asset.metadata?.weight ?? '400'
    const style = asset.metadata?.style ?? 'normal'
    try {
      const face = new FontFace(family, `url(${asset.src})`, { weight, style })
      void face.load().then((ready) => { document.fonts.add(ready) }).catch(() => undefined)
      loaded.push(face)
    } catch { /* malformed optional font assets remain visible as metadata */ }
  }
  return loaded
}

export const isCatalogIntegrationEnabled = (integration: { installed?: boolean; enabled?: boolean } | null | undefined) => Boolean(integration?.installed && integration.enabled)

export const clearCatalogCache = async (kind?: string): Promise<void> => {
  const storage = getLocalStorage()
  if (storage) {
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) { const key = storage.key(index); if (key?.startsWith(CACHE_PREFIX) && (!kind || key.includes(`.${kind}:`))) keys.push(key) }
    keys.forEach((key) => { try { storage.removeItem(key) } catch { /* ignore */ } })
  }
  try {
    const database = await openCacheDb()
    if (!kind) await new Promise<void>((resolve, reject) => { const request = database.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE).clear(); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) })
    else {
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => { const request = database.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).getAllKeys(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      await new Promise<void>((resolve, reject) => { const transaction = database.transaction(CACHE_STORE, 'readwrite'); const store = transaction.objectStore(CACHE_STORE); keys.filter((key) => String(key).startsWith(`${kind}:`)).forEach((key) => store.delete(key)); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) })
    }
    database.close()
  } catch { /* cache is optional */ }
}
