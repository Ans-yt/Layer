import type {
  AssetRecord,
  ComponentDefinition,
  CustomCommand,
  DesignElement,
  DesignStyle,
  Interaction,
  IntegrationRecord,
  LayoutRules,
  McpConnection,
  Page,
  Project,
  ProjectSettings,
  ProviderRecord,
  SkillRecord,
  Snapshot,
} from './model'
import { DEFAULT_MAIN_PROMPT, DEFAULT_VISION_PROMPT, createInitialProject } from './model'

/**
 * Limits are deliberately conservative.  The document is local-first, but a
 * project can still be pasted into a browser or sent to an export endpoint.
 * Keeping the limits here gives both importers and storage one source of truth.
 */
export const PROJECT_LIMITS = {
  maxImportBytes: 50 * 1024 * 1024,
  maxPages: 100,
  maxElementsPerPage: 2_000,
  maxTotalElements: 20_000,
  maxAssets: 1_000,
  maxStyles: 2_000,
  maxComponents: 500,
  maxSnapshots: 80,
  maxInteractionsPerElement: 100,
  maxStringLength: 200_000,
  maxNameLength: 512,
  maxIdLength: 128,
  maxAssetBytes: 20 * 1024 * 1024,
  maxMetadataEntries: 100,
  maxMetadataValueLength: 20_000,
} as const

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const URL_CONTROL_PATTERN = /[\u0000-\u001f\u007f\s]/
const DISALLOWED_CSS_PATTERN = /[<>;{}]|url\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:/i
const SAFE_COLOR_PATTERN = /^(?:transparent|currentColor|inherit|initial|unset|none|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.%\s,+-]+\)|[a-z][a-z0-9 -]{0,32})$/i
const SAFE_SVG_DATA_PATTERN = /^data:image\/svg\+xml(?:;[^,]*)?,/i
const SAFE_IMAGE_DATA_PATTERN = /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)(?:;[^,]*)?,/i

export interface ValidationIssue {
  path: string
  message: string
}

export interface ValidationOptions {
  /** Maximum JSON size when the input is a parsed value. */
  maxBytes?: number
  /** Set false when validating the project portion of a snapshot. */
  allowSnapshots?: boolean
}

export interface ValidationResult {
  valid: boolean
  project?: Project
  issues: ValidationIssue[]
}

export class ProjectValidationError extends Error {
  readonly issues: ValidationIssue[]

  constructor(issues: ValidationIssue[] | string) {
    const normalized = typeof issues === 'string' ? [{ path: '$', message: issues }] : issues
    super(`Layer project validation failed: ${normalized.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`)
    this.name = 'ProjectValidationError'
    this.issues = normalized
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const own = (value: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)
const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

const stringValue = (value: unknown, path: string, issues: ValidationIssue[], options: { required?: boolean; max?: number } = {}): string => {
  if (typeof value !== 'string') {
    if (options.required !== false) issues.push({ path, message: 'must be a string' })
    return ''
  }
  const max = options.max ?? PROJECT_LIMITS.maxStringLength
  if (value.length > max) issues.push({ path, message: `exceeds the ${max}-character limit` })
  if (/[\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u000b\u000c\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f]/.test(value)) issues.push({ path, message: 'contains control characters' })
  return value
}

const optionalString = (value: unknown, path: string, issues: ValidationIssue[], max: number = PROJECT_LIMITS.maxStringLength): string | undefined => {
  if (value === undefined || value === null) return undefined
  return stringValue(value, path, issues, { max })
}

const numberValue = (value: unknown, path: string, issues: ValidationIssue[], min: number, max: number, fallback = 0): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({ path, message: 'must be a finite number' })
    return fallback
  }
  if (value < min || value > max) issues.push({ path, message: `must be between ${min} and ${max}` })
  return value
}

const booleanValue = (value: unknown, path: string, issues: ValidationIssue[], fallback = false): boolean => {
  if (typeof value !== 'boolean') {
    issues.push({ path, message: 'must be a boolean' })
    return fallback
  }
  return value
}

const enumValue = <T extends string>(value: unknown, path: string, issues: ValidationIssue[], values: readonly T[], fallback: T): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    issues.push({ path, message: `must be one of ${values.join(', ')}` })
    return fallback
  }
  return value as T
}

const idValue = (value: unknown, path: string, issues: ValidationIssue[], fallback = ''): string => {
  const id = stringValue(value, path, issues, { max: PROJECT_LIMITS.maxIdLength })
  if (!ID_PATTERN.test(id)) issues.push({ path, message: 'is not a safe Layer identifier' })
  return id || fallback
}

export const isSafeId = (value: string): boolean => ID_PATTERN.test(value)

const arrayValue = <T>(value: unknown, path: string, issues: ValidationIssue[], max: number, required = false): T[] => {
  if (!Array.isArray(value)) {
    if (required) issues.push({ path, message: 'must be an array' })
    return []
  }
  if (value.length > max) issues.push({ path, message: `contains more than ${max} items` })
  return value.slice(0, max) as T[]
}

const safeCssColor = (value: unknown, path: string, issues: ValidationIssue[], fallback = 'transparent'): string => {
  const color = stringValue(value, path, issues, { max: 128 })
  if (!SAFE_COLOR_PATTERN.test(color) || DISALLOWED_CSS_PATTERN.test(color)) issues.push({ path, message: 'contains unsafe CSS' })
  return color || fallback
}

/** True for HTTP(S), safe relative paths, or image/font data URLs. */
export const isSafeUrl = (value: string, options: { allowData?: boolean; allowRelative?: boolean; allowFontData?: boolean } = {}): boolean => {
  const { allowData = true, allowRelative = true, allowFontData = true } = options
  const candidate = value.trim()
  if (!candidate || URL_CONTROL_PATTERN.test(candidate) || /[<>"'`]/.test(candidate)) return false
  if (/^(?:javascript|vbscript|file|about|chrome|blob):/i.test(candidate)) return false
  if (/^data:/i.test(candidate)) {
    if (!allowData) return false
    return SAFE_IMAGE_DATA_PATTERN.test(candidate) || (allowFontData && /^data:font\/(?:woff2?|opentype|ttf)(?:;[^,]*)?,/i.test(candidate))
  }
  if (candidate.startsWith('//')) return false
  try {
    const parsed = new URL(candidate, 'https://layer.invalid')
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (!allowRelative && parsed.origin === 'https://layer.invalid') return false
      return true
    }
  } catch {
    return false
  }
  return allowRelative && !candidate.includes(':') && !candidate.startsWith('\\')
}

export const assertSafeUrl = (value: string, path = 'url', options?: Parameters<typeof isSafeUrl>[1]): string => {
  if (!isSafeUrl(value, options)) throw new ProjectValidationError([{ path, message: 'is not a safe URL' }])
  return value
}

const sanitizeSvgWithDom = (markup: string): string | null => {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return null
  try {
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
    const root = parsed.documentElement
    if (!root || root.nodeName.toLowerCase() !== 'svg') return ''
    const blocked = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'link', 'meta', 'audio', 'video', 'canvas', 'style'])
    const elements = Array.from(root.querySelectorAll('*'))
    for (const element of elements) {
      if (blocked.has(element.tagName.toLowerCase())) {
        element.remove()
        continue
      }
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase()
        const attrValue = attribute.value.trim()
        if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || name === 'style' && DISALLOWED_CSS_PATTERN.test(attrValue)) {
          element.removeAttribute(attribute.name)
          continue
        }
        if ((name === 'href' || name === 'xlink:href' || name === 'src') && !isSafeUrl(attrValue, { allowRelative: false })) element.removeAttribute(attribute.name)
      }
    }
    for (const attribute of Array.from(root.attributes)) {
      const name = attribute.name.toLowerCase()
      const attrValue = attribute.value.trim()
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || name === 'style' && DISALLOWED_CSS_PATTERN.test(attrValue)) root.removeAttribute(attribute.name)
      else if ((name === 'href' || name === 'xlink:href' || name === 'src') && !isSafeUrl(attrValue, { allowRelative: false })) root.removeAttribute(attribute.name)
    }
    return new XMLSerializer().serializeToString(root)
  } catch {
    return ''
  }
}

/**
 * Sanitize SVG without ever executing it.  DOMPurify can be layered in by a
 * host application, but this parser/regex fallback intentionally has no
 * dependency and is safe for Iconify responses and imported data URLs.
 */
export const sanitizeSvgMarkup = (markup: string): string => {
  const value = typeof markup === 'string' ? markup : ''
  if (!value) return ''
  const parsed = sanitizeSvgWithDom(value)
  if (parsed !== null) return parsed
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<((?:script|foreignObject|iframe|object|embed|link|meta|style|audio|video|canvas))\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(?:script|foreignObject|iframe|object|embed|link|meta|style|audio|video|canvas)(?:\s[^>]*)?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:srcdoc|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (attribute, doubleQuoted, singleQuoted, unquoted) => DISALLOWED_CSS_PATTERN.test(String(doubleQuoted ?? singleQuoted ?? unquoted ?? '')) ? '' : attribute)
    .replace(/\s+(href|xlink:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (attribute, name, doubleQuoted, singleQuoted, unquoted) => {
      const target = String(doubleQuoted ?? singleQuoted ?? unquoted ?? '')
      return isSafeUrl(target, { allowData: false, allowRelative: false }) ? ` ${name}="${target.replace(/"/g, '&quot;')}"` : ''
    })
    .replace(/\b(?:javascript|vbscript)\s*:/gi, '')
}

export const sanitizeSvgDataUrl = (value: string): string => {
  if (!SAFE_SVG_DATA_PATTERN.test(value)) return value
  const comma = value.indexOf(',')
  const header = value.slice(0, comma)
  const body = value.slice(comma + 1)
  let markup = body
  try {
    markup = /;base64/i.test(header) ? new TextDecoder().decode(Uint8Array.from(atob(body), (character) => character.charCodeAt(0))) : decodeURIComponent(body)
  } catch {
    return ''
  }
  const clean = sanitizeSvgMarkup(markup)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`
}

const safeMetadata = (value: unknown, path: string, issues: ValidationIssue[]): Record<string, string> | undefined => {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) {
    issues.push({ path, message: 'must be an object' })
    return undefined
  }
  const entries = Object.entries(value).slice(0, PROJECT_LIMITS.maxMetadataEntries)
  if (Object.keys(value).length > PROJECT_LIMITS.maxMetadataEntries) issues.push({ path, message: `contains more than ${PROJECT_LIMITS.maxMetadataEntries} entries` })
  const result: Record<string, string> = {}
  for (const [key, raw] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(key)) {
      issues.push({ path: `${path}.${key}`, message: 'is not a safe metadata key' })
      continue
    }
    result[key] = stringValue(raw, `${path}.${key}`, issues, { max: PROJECT_LIMITS.maxMetadataValueLength })
  }
  return result
}

const validateLayout = (value: unknown, path: string, issues: ValidationIssue[]): LayoutRules | undefined => {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) { issues.push({ path, message: 'must be an object' }); return undefined }
  const input = asRecord(value)
  const mode = enumValue(input.mode ?? 'free', `${path}.mode`, issues, ['free', 'row', 'column', 'grid'] as const, 'free')
  return {
    ...layoutExtensions(input, path, issues),
    mode,
    gap: numberValue(input.gap ?? 0, `${path}.gap`, issues, 0, 10_000),
    padding: numberValue(input.padding ?? 0, `${path}.padding`, issues, 0, 10_000),
    align: enumValue(input.align ?? 'start', `${path}.align`, issues, ['start', 'center', 'end', 'stretch', 'space-between'] as const, 'start'),
    justify: enumValue(input.justify ?? 'start', `${path}.justify`, issues, ['start', 'center', 'end', 'space-between', 'space-around'] as const, 'start'),
    wrap: booleanValue(input.wrap ?? false, `${path}.wrap`, issues),
    widthRule: enumValue(input.widthRule ?? 'fixed', `${path}.widthRule`, issues, ['fixed', 'fill', 'fit'] as const, 'fixed'),
    heightRule: enumValue(input.heightRule ?? 'fixed', `${path}.heightRule`, issues, ['fixed', 'fill', 'fit'] as const, 'fixed'),
    minWidth: input.minWidth === undefined ? undefined : numberValue(input.minWidth, `${path}.minWidth`, issues, 0, 10_000),
    maxWidth: input.maxWidth === undefined ? undefined : numberValue(input.maxWidth, `${path}.maxWidth`, issues, 0, 10_000),
    minHeight: input.minHeight === undefined ? undefined : numberValue(input.minHeight, `${path}.minHeight`, issues, 0, 10_000),
    maxHeight: input.maxHeight === undefined ? undefined : numberValue(input.maxHeight, `${path}.maxHeight`, issues, 0, 10_000),
    overflow: enumValue(input.overflow ?? 'visible', `${path}.overflow`, issues, ['visible', 'hidden', 'scroll'] as const, 'visible'),
  }
}

// Allowlist the evolving design schema; never spread unknown input into state.
const layoutExtensions = (input: Record<string, unknown>, path: string, issues: ValidationIssue[], nested = false): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const key of ['columns', 'columnCount', 'minItemWidth']) if (input[key] !== undefined) result[key] = numberValue(input[key], `${path}.${key}`, issues, 1, key === 'minItemWidth' ? 100_000 : 100)
  if (input.position !== undefined) result.position = enumValue(input.position, `${path}.position`, issues, ['auto', 'absolute'] as const, 'auto')
  if (!nested) for (const key of ['responsive', 'breakpoints']) if (input[key] !== undefined) result[key] = responsiveRules(input[key], `${path}.${key}`, issues)
  return result
}

const responsiveRules = (value: unknown, path: string, issues: ValidationIssue[]): unknown => {
  const patch = (raw: unknown, patchPath: string): Record<string, unknown> => {
    if (!isRecord(raw)) { issues.push({ path: patchPath, message: 'must be an object' }); return {} }
    const result = layoutExtensions(raw, patchPath, issues, true)
    for (const key of ['x', 'y', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'gap', 'padding']) if (raw[key] !== undefined) result[key] = numberValue(raw[key], `${patchPath}.${key}`, issues, key === 'x' || key === 'y' ? -100_000 : 0, 100_000)
    for (const [key, allowed] of Object.entries({ mode: ['free', 'row', 'column', 'grid'], align: ['start', 'center', 'end', 'stretch', 'space-between'], justify: ['start', 'center', 'end', 'space-between', 'space-around'], widthRule: ['fixed', 'fill', 'fit'], heightRule: ['fixed', 'fill', 'fit'], overflow: ['visible', 'hidden', 'scroll'], position: ['auto', 'absolute'] })) if (raw[key] !== undefined) result[key] = enumValue(raw[key], `${patchPath}.${key}`, issues, allowed, allowed[0])
    if (raw.wrap !== undefined) result.wrap = booleanValue(raw.wrap, `${patchPath}.wrap`, issues)
    if (raw.breakpoint !== undefined) result.breakpoint = stringValue(raw.breakpoint, `${patchPath}.breakpoint`, issues, { max: PROJECT_LIMITS.maxNameLength })
    for (const key of ['rules', 'layout']) if (raw[key] !== undefined) {
      if (!isRecord(raw[key])) { issues.push({ path: `${patchPath}.${key}`, message: 'must be an object' }); continue }
      const child = asRecord(raw[key])
      if (child.rules !== undefined || child.layout !== undefined) issues.push({ path: patchPath, message: 'responsive rules cannot recursively nest' })
      result[key] = patch(Object.fromEntries(Object.entries(child).filter(([name]) => name !== 'rules' && name !== 'layout')), `${patchPath}.${key}`)
    }
    return result
  }
  if (Array.isArray(value)) return arrayValue<unknown>(value, path, issues, 100).map((entry, index) => patch(entry, `${path}[${index}]`))
  if (!isRecord(value)) { issues.push({ path, message: 'must be an array or breakpoint map' }); return [] }
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) issues.push({ path, message: 'has an unsafe breakpoint key' })
    else result[key] = patch(entry, `${path}.${key}`)
  }
  return result
}

const commentsValue = (value: unknown, path: string, issues: ValidationIssue[]) => {
  if (!Array.isArray(value)) { issues.push({ path, message: 'must be an array' }); return [] }
  return arrayValue<unknown>(value, path, issues, 500, true).map((raw, index) => {
  const item = asRecord(raw)
  return { id: idValue(item.id, `${path}[${index}].id`, issues), text: stringValue(item.text, `${path}[${index}].text`, issues), createdAt: stringValue(item.createdAt, `${path}[${index}].createdAt`, issues, { max: 128 }) }
  })
}

const elementExtensions = (input: Record<string, unknown>, path: string, issues: ValidationIssue[]): Record<string, unknown> => {
  const output: Record<string, unknown> = {}
  if (input.textColor !== undefined) output.textColor = safeCssColor(input.textColor, `${path}.textColor`, issues)
  if (input.imageFit !== undefined) output.imageFit = enumValue(input.imageFit, `${path}.imageFit`, issues, ['cover', 'contain', 'fill', 'none', 'scale-down'], 'cover')
  if (input.imagePosition !== undefined) {
    const position = stringValue(input.imagePosition, `${path}.imagePosition`, issues, { max: 128 })
    if (!/^(?:[\d.+% -]+|(?:left|right|center|top|bottom)(?: (?:left|right|center|top|bottom))?)$/.test(position)) issues.push({ path: `${path}.imagePosition`, message: 'must be a safe object position' })
    output.imagePosition = position
  }
  if (input.shape !== undefined) output.shape = enumValue(input.shape, `${path}.shape`, issues, ['rectangle', 'round', 'triangle', 'diamond', 'hexagon', 'star', 'burst', 'pill'], 'rectangle')
  if (input.required !== undefined) output.required = booleanValue(input.required, `${path}.required`, issues)
  if (input.inputType !== undefined) output.inputType = enumValue(input.inputType, `${path}.inputType`, issues, ['text', 'email', 'password', 'number', 'tel', 'url', 'search', 'date', 'time', 'checkbox', 'radio'], 'text')
  for (const key of ['content', 'placeholder', 'label']) if (input[key] !== undefined) output[key] = stringValue(input[key], `${path}.${key}`, issues)
  if (input.sourceId !== undefined) output.sourceId = idValue(input.sourceId, `${path}.sourceId`, issues)
  if (input.comments !== undefined) output.comments = commentsValue(input.comments, `${path}.comments`, issues)
  if (input.styleRefs !== undefined) {
    if (!isRecord(input.styleRefs)) { issues.push({ path: `${path}.styleRefs`, message: 'must be an object' }); return output }
    const refs: Record<string, string> = {}
    for (const [key, value] of Object.entries(asRecord(input.styleRefs))) {
      if (!['fill', 'stroke', 'textColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'gap', 'padding', 'radius', 'shadow'].includes(key)) issues.push({ path: `${path}.styleRefs.${key}`, message: 'is not a supported style property' })
      else refs[key] = idValue(value, `${path}.styleRefs.${key}`, issues)
    }
    output.styleRefs = refs
  }
  for (const key of ['responsive', 'breakpoints']) if (input[key] !== undefined) output[key] = responsiveRules(input[key], `${path}.${key}`, issues)
  return output
}

const validateInteraction = (value: unknown, path: string, issues: ValidationIssue[]): Interaction => {
  const input = asRecord(value)
  return {
    id: idValue(input.id, `${path}.id`, issues),
    trigger: enumValue(input.trigger, `${path}.trigger`, issues, ['click', 'hover', 'focus', 'page-load', 'scroll-into-view'] as const, 'click'),
    action: enumValue(input.action, `${path}.action`, issues, ['navigate', 'external', 'scroll', 'toggle-visibility', 'set-state', 'submit-form', 'animate'] as const, 'navigate'),
    targetId: optionalString(input.targetId, `${path}.targetId`, issues, PROJECT_LIMITS.maxIdLength),
    pageId: optionalString(input.pageId, `${path}.pageId`, issues, PROJECT_LIMITS.maxIdLength),
    value: optionalString(input.value, `${path}.value`, issues, PROJECT_LIMITS.maxStringLength),
    duration: input.duration === undefined ? undefined : numberValue(input.duration, `${path}.duration`, issues, 0, 60_000),
    delay: input.delay === undefined ? undefined : numberValue(input.delay, `${path}.delay`, issues, 0, 60_000),
    easing: optionalString(input.easing, `${path}.easing`, issues, 128),
    repeat: input.repeat === undefined ? undefined : Math.round(numberValue(input.repeat, `${path}.repeat`, issues, 0, 1_000)),
  }
}

const validateElement = (value: unknown, path: string, issues: ValidationIssue[]): DesignElement => {
  const input = asRecord(value)
  const type = enumValue(input.type, `${path}.type`, issues, ['frame', 'section', 'text', 'rect', 'circle', 'line', 'image', 'icon', 'button', 'input', 'card', 'nav', 'form', 'tabs', 'accordion', 'modal', 'footer', 'group'] as const, 'group')
  const interactions = arrayValue<unknown>(input.interactions, `${path}.interactions`, issues, PROJECT_LIMITS.maxInteractionsPerElement).map((item, index) => validateInteraction(item, `${path}.interactions[${index}]`, issues))
  const rawOverrides = isRecord(input.overrides) ? input.overrides : undefined
  const overrides: Record<string, string | number | boolean> | undefined = rawOverrides ? {} : undefined
  if (rawOverrides) {
    for (const [key, item] of Object.entries(rawOverrides).slice(0, 100)) {
      if (!/^[A-Za-z0-9_.-]{1,100}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof item) || typeof item === 'number' && !Number.isFinite(item)) {
        issues.push({ path: `${path}.overrides.${key}`, message: 'must be a safe primitive override' })
      } else if (typeof item === 'string') {
        overrides![key] = stringValue(item, `${path}.overrides.${key}`, issues, { max: 4_000 })
      } else overrides![key] = item as string | number | boolean
    }
  }
  const cornersInput = asRecord(input.corners)
  const cutCornersInput = input.cutCorners === undefined || input.cutCorners === null ? undefined : asRecord(input.cutCorners)
  const shadowInput = input.shadow === undefined || input.shadow === null ? undefined : asRecord(input.shadow)
  const patternInput = input.pattern === undefined || input.pattern === null ? undefined : asRecord(input.pattern)
  const curveInput = input.curve === undefined || input.curve === null ? undefined : asRecord(input.curve)
  let elementSrc = optionalString(input.src, `${path}.src`, issues, PROJECT_LIMITS.maxAssetBytes)
  if (elementSrc && !isSafeUrl(elementSrc, { allowData: true, allowRelative: true })) issues.push({ path: `${path}.src`, message: 'is not a safe element URL' })
  if (elementSrc && SAFE_SVG_DATA_PATTERN.test(elementSrc)) elementSrc = sanitizeSvgDataUrl(elementSrc)
  return {
    id: idValue(input.id, `${path}.id`, issues),
    type,
    ...elementExtensions(input, path, issues),
    name: stringValue(input.name, `${path}.name`, issues, { max: PROJECT_LIMITS.maxNameLength }),
    parentId: optionalString(input.parentId, `${path}.parentId`, issues, PROJECT_LIMITS.maxIdLength),
    x: numberValue(input.x, `${path}.x`, issues, -10_000_000, 10_000_000),
    y: numberValue(input.y, `${path}.y`, issues, -10_000_000, 10_000_000),
    width: numberValue(input.width, `${path}.width`, issues, 0, 10_000_000),
    height: numberValue(input.height, `${path}.height`, issues, 0, 10_000_000),
    rotation: numberValue(input.rotation, `${path}.rotation`, issues, -360_000, 360_000),
    opacity: numberValue(input.opacity, `${path}.opacity`, issues, 0, 1),
    visible: booleanValue(input.visible, `${path}.visible`, issues, true),
    locked: booleanValue(input.locked, `${path}.locked`, issues),
    fill: safeCssColor(input.fill, `${path}.fill` , issues),
    stroke: safeCssColor(input.stroke, `${path}.stroke`, issues),
    strokeWidth: numberValue(input.strokeWidth, `${path}.strokeWidth`, issues, 0, 10_000),
    radius: numberValue(input.radius, `${path}.radius`, issues, 0, 10_000),
    corners: {
      topLeft: numberValue(cornersInput.topLeft, `${path}.corners.topLeft`, issues, 0, 10_000),
      topRight: numberValue(cornersInput.topRight, `${path}.corners.topRight`, issues, 0, 10_000),
      bottomRight: numberValue(cornersInput.bottomRight, `${path}.corners.bottomRight`, issues, 0, 10_000),
      bottomLeft: numberValue(cornersInput.bottomLeft, `${path}.corners.bottomLeft`, issues, 0, 10_000),
    },
    cutCorners: {
      topLeft: numberValue(cutCornersInput?.topLeft ?? 0, `${path}.cutCorners.topLeft`, issues, 0, 10_000),
      topRight: numberValue(cutCornersInput?.topRight ?? 0, `${path}.cutCorners.topRight`, issues, 0, 10_000),
      bottomRight: numberValue(cutCornersInput?.bottomRight ?? 0, `${path}.cutCorners.bottomRight`, issues, 0, 10_000),
      bottomLeft: numberValue(cutCornersInput?.bottomLeft ?? 0, `${path}.cutCorners.bottomLeft`, issues, 0, 10_000),
    },
    shadow: shadowInput ? {
      x: numberValue(shadowInput.x, `${path}.shadow.x`, issues, -10_000, 10_000),
      y: numberValue(shadowInput.y, `${path}.shadow.y`, issues, -10_000, 10_000),
      blur: numberValue(shadowInput.blur, `${path}.shadow.blur`, issues, 0, 10_000),
      spread: numberValue(shadowInput.spread, `${path}.shadow.spread`, issues, -10_000, 10_000),
      color: safeCssColor(shadowInput.color, `${path}.shadow.color`, issues, '#000000'),
      opacity: numberValue(shadowInput.opacity, `${path}.shadow.opacity`, issues, 0, 1),
    } : undefined,
    pattern: patternInput ? {
      enabled: booleanValue(patternInput.enabled, `${path}.pattern.enabled`, issues),
      type: enumValue(patternInput.type, `${path}.pattern.type`, issues, ['dots', 'grid', 'stripes', 'noise'] as const, 'dots'),
      scale: numberValue(patternInput.scale, `${path}.pattern.scale`, issues, 0, 1_000),
      spacing: numberValue(patternInput.spacing, `${path}.pattern.spacing`, issues, 0, 10_000),
      rotation: numberValue(patternInput.rotation, `${path}.pattern.rotation`, issues, -360_000, 360_000),
      opacity: numberValue(patternInput.opacity, `${path}.pattern.opacity`, issues, 0, 1),
      color: safeCssColor(patternInput.color, `${path}.pattern.color`, issues, '#000000'),
    } : undefined,
    text: optionalString(input.text, `${path}.text`, issues),
    fontFamily: (() => {
      const family = optionalString(input.fontFamily, `${path}.fontFamily`, issues, 512)
      if (family && DISALLOWED_CSS_PATTERN.test(family)) issues.push({ path: `${path}.fontFamily`, message: 'contains unsafe CSS' })
      return family
    })(),
    fontSize: input.fontSize === undefined ? undefined : numberValue(input.fontSize, `${path}.fontSize`, issues, 0, 100_000),
    fontWeight: input.fontWeight === undefined ? undefined : numberValue(input.fontWeight, `${path}.fontWeight`, issues, 1, 1_000),
    lineHeight: input.lineHeight === undefined ? undefined : numberValue(input.lineHeight, `${path}.lineHeight`, issues, 0, 100),
    letterSpacing: input.letterSpacing === undefined ? undefined : numberValue(input.letterSpacing, `${path}.letterSpacing`, issues, -10_000, 10_000),
    textAlign: input.textAlign === undefined ? undefined : enumValue(input.textAlign, `${path}.textAlign`, issues, ['left', 'center', 'right'] as const, 'left'),
    wrap: input.wrap === undefined ? undefined : enumValue(input.wrap, `${path}.wrap`, issues, ['fixed', 'auto'] as const, 'fixed'),
    src: elementSrc,
    alt: optionalString(input.alt, `${path}.alt`, issues),
    iconName: optionalString(input.iconName, `${path}.iconName`, issues, 256),
    layout: validateLayout(input.layout, `${path}.layout`, issues),
    notes: optionalString(input.notes, `${path}.notes`, issues),
    componentId: optionalString(input.componentId, `${path}.componentId`, issues, PROJECT_LIMITS.maxIdLength),
    variant: optionalString(input.variant, `${path}.variant`, issues, PROJECT_LIMITS.maxNameLength),
    interactions,
    state: optionalString(input.state, `${path}.state`, issues, 512),
    aspectRatioLocked: input.aspectRatioLocked === undefined ? undefined : booleanValue(input.aspectRatioLocked, `${path}.aspectRatioLocked`, issues),
    curve: curveInput ? {
      x1: numberValue(curveInput.x1, `${path}.curve.x1`, issues, -10_000_000, 10_000_000),
      y1: numberValue(curveInput.y1, `${path}.curve.y1`, issues, -10_000_000, 10_000_000),
      x2: numberValue(curveInput.x2, `${path}.curve.x2`, issues, -10_000_000, 10_000_000),
      y2: numberValue(curveInput.y2, `${path}.curve.y2`, issues, -10_000_000, 10_000_000),
    } : undefined,
    overrides,
  }
}

const validatePage = (value: unknown, path: string, issues: ValidationIssue[]): Page => {
  const input = asRecord(value)
  const rawElements = arrayValue<unknown>(input.elements, `${path}.elements`, issues, PROJECT_LIMITS.maxElementsPerPage, true)
  const elements = rawElements.map((item, index) => validateElement(item, `${path}.elements[${index}]`, issues))
  const rawBreakpoints = arrayValue<unknown>(input.breakpoints, `${path}.breakpoints`, issues, 100)
  const breakpoints = rawBreakpoints.map((item, index) => {
    const bp = asRecord(item)
    return {
      id: idValue(bp.id, `${path}.breakpoints[${index}].id`, issues),
      name: stringValue(bp.name, `${path}.breakpoints[${index}].name`, issues, { max: PROJECT_LIMITS.maxNameLength }),
      width: numberValue(bp.width, `${path}.breakpoints[${index}].width`, issues, 1, 100_000),
    }
  })
  return {
    id: idValue(input.id, `${path}.id`, issues),
    name: stringValue(input.name, `${path}.name`, issues, { max: PROJECT_LIMITS.maxNameLength }),
    ...(input.autoHeight === undefined ? {} : { autoHeight: booleanValue(input.autoHeight, `${path}.autoHeight`, issues) }),
    ...(input.comments === undefined ? {} : { comments: commentsValue(input.comments, `${path}.comments`, issues) }),
    ...(input.userGuides === undefined ? {} : { userGuides: Array.isArray(input.userGuides) ? arrayValue<unknown>(input.userGuides, `${path}.userGuides`, issues, 500, true).map((raw, index) => typeof raw === 'number' ? numberValue(raw, `${path}.userGuides[${index}]`, issues, -100_000, 100_000) : { axis: enumValue(asRecord(raw).axis, `${path}.userGuides[${index}].axis`, issues, ['x', 'y'], 'x'), position: numberValue(asRecord(raw).position, `${path}.userGuides[${index}].position`, issues, -100_000, 100_000), label: optionalString(asRecord(raw).label, `${path}.userGuides[${index}].label`, issues, 512) }) : (issues.push({ path: `${path}.userGuides`, message: 'must be an array' }), []) }),
    width: numberValue(input.width, `${path}.width`, issues, 1, 100_000),
    height: numberValue(input.height, `${path}.height`, issues, 1, 100_000),
    background: safeCssColor(input.background, `${path}.background`, issues, '#ffffff'),
    elements,
    notes: stringValue(input.notes ?? '', `${path}.notes`, issues),
    breakpoints,
  }
}

const validateStyles = (value: unknown, issues: ValidationIssue[]): DesignStyle[] => arrayValue<unknown>(value, 'project.styles', issues, PROJECT_LIMITS.maxStyles).map((item, index) => {
  const input = asRecord(item)
  return {
    id: idValue(input.id, `project.styles[${index}].id`, issues),
    name: stringValue(input.name, `project.styles[${index}].name`, issues, { max: PROJECT_LIMITS.maxNameLength }),
    kind: enumValue(input.kind, `project.styles[${index}].kind`, issues, ['color', 'type', 'spacing', 'shadow'] as const, 'color'),
    value: stringValue(input.value, `project.styles[${index}].value`, issues, { max: 4_000 }),
  }
})

const validateComponents = (value: unknown, issues: ValidationIssue[]): ComponentDefinition[] => arrayValue<unknown>(value, 'project.components', issues, PROJECT_LIMITS.maxComponents).map((item, index) => {
  const input = asRecord(item)
  return {
    id: idValue(input.id, `project.components[${index}].id`, issues),
    name: stringValue(input.name, `project.components[${index}].name`, issues, { max: PROJECT_LIMITS.maxNameLength }),
    elementIds: arrayValue<unknown>(input.elementIds, `project.components[${index}].elementIds`, issues, PROJECT_LIMITS.maxElementsPerPage).map((id, childIndex) => idValue(id, `project.components[${index}].elementIds[${childIndex}]`, issues)),
    sourcePageId: idValue(input.sourcePageId, `project.components[${index}].sourcePageId`, issues),
    updatedAt: stringValue(input.updatedAt, `project.components[${index}].updatedAt`, issues, { max: 128 }),
    variants: arrayValue<unknown>(input.variants, `project.components[${index}].variants`, issues, 100).map((variant, childIndex) => stringValue(variant, `project.components[${index}].variants[${childIndex}]`, issues, { max: PROJECT_LIMITS.maxNameLength })),
  }
})

const validateAssets = (value: unknown, issues: ValidationIssue[]): AssetRecord[] => arrayValue<unknown>(value, 'project.assets', issues, PROJECT_LIMITS.maxAssets).map((item, index) => {
  const input = asRecord(item)
  let src = optionalString(input.src, `project.assets[${index}].src`, issues, PROJECT_LIMITS.maxAssetBytes)
  if (src && !isSafeUrl(src, { allowData: true, allowRelative: true })) issues.push({ path: `project.assets[${index}].src`, message: 'is not a safe asset URL' })
  if (src && SAFE_SVG_DATA_PATTERN.test(src)) src = sanitizeSvgDataUrl(src)
  if (src?.startsWith('data:') && src.length > PROJECT_LIMITS.maxAssetBytes * 1.37) issues.push({ path: `project.assets[${index}].src`, message: 'data URL exceeds the asset size limit' })
  return {
    id: idValue(input.id, `project.assets[${index}].id`, issues),
    name: stringValue(input.name, `project.assets[${index}].name`, issues, { max: PROJECT_LIMITS.maxNameLength }),
    kind: enumValue(input.kind, `project.assets[${index}].kind`, issues, ['image', 'icon', 'font', 'pattern'] as const, 'image'),
    src,
    iconName: optionalString(input.iconName, `project.assets[${index}].iconName`, issues, 256),
    source: stringValue(input.source, `project.assets[${index}].source`, issues, { max: 2_000 }),
    license: stringValue(input.license, `project.assets[${index}].license`, issues, { max: 4_000 }),
    installedAt: stringValue(input.installedAt, `project.assets[${index}].installedAt`, issues, { max: 128 }),
    metadata: safeMetadata(input.metadata, `project.assets[${index}].metadata`, issues),
  }
})

const validateIntegrations = (value: unknown, issues: ValidationIssue[]): IntegrationRecord[] => arrayValue<unknown>(value, 'project.integrations', issues, 100).map((item, index) => {
  const input = asRecord(item)
  const sourceUrl = stringValue(input.sourceUrl, `project.integrations[${index}].sourceUrl`, issues, { max: 4_000 })
  if (!isSafeUrl(sourceUrl, { allowData: false, allowRelative: false })) issues.push({ path: `project.integrations[${index}].sourceUrl`, message: 'is not a safe source URL' })
  return {
    id: idValue(input.id, `project.integrations[${index}].id`, issues),
    name: stringValue(input.name, `project.integrations[${index}].name`, issues, { max: PROJECT_LIMITS.maxNameLength }),
    description: stringValue(input.description, `project.integrations[${index}].description`, issues),
    kind: enumValue(input.kind, `project.integrations[${index}].kind`, issues, ['fonts', 'icons', 'assets'] as const, 'assets'),
    enabled: booleanValue(input.enabled, `project.integrations[${index}].enabled`, issues),
    installed: booleanValue(input.installed, `project.integrations[${index}].installed`, issues),
    version: stringValue(input.version, `project.integrations[${index}].version`, issues, { max: 256 }),
    sourceUrl,
    lastSynced: optionalString(input.lastSynced, `project.integrations[${index}].lastSynced`, issues, 128),
    error: optionalString(input.error, `project.integrations[${index}].error`, issues, 4_000),
  }
})

const validateProviders = (value: unknown, issues: ValidationIssue[]): ProviderRecord[] => arrayValue<unknown>(value, 'project.providers', issues, 100).map((item, index) => {
  const input = asRecord(item)
  const endpoint = stringValue(input.endpoint, `project.providers[${index}].endpoint`, issues, { max: 4_000 })
  if (!isSafeUrl(endpoint, { allowData: false, allowRelative: false })) issues.push({ path: `project.providers[${index}].endpoint`, message: 'is not a safe endpoint URL' })
  return {
    id: idValue(input.id, `project.providers[${index}].id`, issues),
    name: stringValue(input.name, `project.providers[${index}].name`, issues, { max: PROJECT_LIMITS.maxNameLength }),
    kind: enumValue(input.kind, `project.providers[${index}].kind`, issues, ['openrouter', 'nvidia', 'anthropic', 'openai', 'custom'] as const, 'custom'),
    endpoint,
    model: stringValue(input.model, `project.providers[${index}].model`, issues, { max: 512 }),
    credentialSet: booleanValue(input.credentialSet, `project.providers[${index}].credentialSet`, issues),
    connected: booleanValue(input.connected, `project.providers[${index}].connected`, issues),
    imageInput: booleanValue(input.imageInput, `project.providers[${index}].imageInput`, issues),
    videoInput: booleanValue(input.videoInput, `project.providers[${index}].videoInput`, issues),
    manualModel: booleanValue(input.manualModel, `project.providers[${index}].manualModel`, issues),
  }
})

const validateSkills = (value: unknown, issues: ValidationIssue[]): SkillRecord[] => arrayValue<unknown>(value, 'project.skills', issues, 500).map((item, index) => {
  const input = asRecord(item)
  return {
    id: idValue(input.id, `project.skills[${index}].id`, issues),
    name: stringValue(input.name, `project.skills[${index}].name`, issues, { max: PROJECT_LIMITS.maxNameLength }),
    description: stringValue(input.description, `project.skills[${index}].description`, issues),
    instructions: stringValue(input.instructions, `project.skills[${index}].instructions`, issues),
    enabled: booleanValue(input.enabled, `project.skills[${index}].enabled`, issues),
    requiredTools: arrayValue<unknown>(input.requiredTools, `project.skills[${index}].requiredTools`, issues, 100).map((tool, toolIndex) => stringValue(tool, `project.skills[${index}].requiredTools[${toolIndex}]`, issues, { max: 256 })),
  }
})

const validateCommands = (value: unknown, issues: ValidationIssue[]): CustomCommand[] => arrayValue<unknown>(value, 'project.commands', issues, 500).map((item, index) => {
  const input = asRecord(item)
  return {
    id: idValue(input.id, `project.commands[${index}].id`, issues),
    name: stringValue(input.name, `project.commands[${index}].name`, issues, { max: 128 }),
    description: stringValue(input.description, `project.commands[${index}].description`, issues),
    instructions: stringValue(input.instructions, `project.commands[${index}].instructions`, issues),
    scope: enumValue(input.scope, `project.commands[${index}].scope`, issues, ['selection', 'page', 'project'] as const, 'project'),
    enabled: booleanValue(input.enabled, `project.commands[${index}].enabled`, issues),
  }
})

const validateConnections = (value: unknown, issues: ValidationIssue[]): McpConnection[] => arrayValue<unknown>(value, 'project.connections', issues, 100).map((item, index) => {
  const input = asRecord(item)
  const url = stringValue(input.url, `project.connections[${index}].url`, issues, { max: 4_000 })
  if (!isSafeUrl(url, { allowData: false, allowRelative: false })) issues.push({ path: `project.connections[${index}].url`, message: 'is not a safe connection URL' })
  return {
    id: idValue(input.id, `project.connections[${index}].id`, issues),
    name: stringValue(input.name, `project.connections[${index}].name`, issues, { max: PROJECT_LIMITS.maxNameLength }),
    url,
    enabled: booleanValue(input.enabled, `project.connections[${index}].enabled`, issues),
    status: enumValue(input.status, `project.connections[${index}].status`, issues, ['disconnected', 'testing', 'connected', 'error'] as const, 'disconnected'),
    tools: arrayValue<unknown>(input.tools, `project.connections[${index}].tools`, issues, 500).map((tool, toolIndex) => {
      const toolInput = asRecord(tool)
      return { name: stringValue(toolInput.name, `project.connections[${index}].tools[${toolIndex}].name`, issues, { max: 512 }), description: stringValue(toolInput.description, `project.connections[${index}].tools[${toolIndex}].description`, issues, { max: 4_000 }) }
    }),
    error: optionalString(input.error, `project.connections[${index}].error`, issues, 4_000),
  }
})

const validateSettings = (value: unknown, issues: ValidationIssue[]): ProjectSettings => {
  const input = asRecord(value)
  return {
    ...(input.mainProviderId === undefined ? {} : { mainProviderId: stringValue(input.mainProviderId, 'project.settings.mainProviderId', issues, { max: 128 }) }),
    ...(input.visionProviderId === undefined ? {} : { visionProviderId: stringValue(input.visionProviderId, 'project.settings.visionProviderId', issues, { max: 128 }) }),
    ...(input.promptVersions === undefined ? {} : { promptVersions: arrayValue<unknown>(input.promptVersions, 'project.settings.promptVersions', issues, 40, true).map((value, index) => {
      const raw = asRecord(value)
      const result: Record<string, string> = {}
      for (const key of ['id', 'name', 'createdAt', 'mainPrompt', 'visionPrompt', 'kind', 'text']) if (raw[key] !== undefined) result[key] = stringValue(raw[key], `project.settings.promptVersions[${index}].${key}`, issues)
      return result
    }) }),
    autoApplyAi: booleanValue(input.autoApplyAi, 'project.settings.autoApplyAi', issues),
    snap: booleanValue(input.snap, 'project.settings.snap', issues),
    snapEdges: booleanValue(input.snapEdges, 'project.settings.snapEdges', issues),
    snapCenters: booleanValue(input.snapCenters, 'project.settings.snapCenters', issues),
    snapGaps: booleanValue(input.snapGaps, 'project.settings.snapGaps', issues),
    snapGrid: booleanValue(input.snapGrid, 'project.settings.snapGrid', issues),
    gridSize: numberValue(input.gridSize, 'project.settings.gridSize', issues, 1, 10_000),
    reducedMotion: booleanValue(input.reducedMotion, 'project.settings.reducedMotion', issues),
    visionEnabled: booleanValue(input.visionEnabled, 'project.settings.visionEnabled', issues),
    videoEnabled: booleanValue(input.videoEnabled, 'project.settings.videoEnabled', issues),
    ocrEnabled: booleanValue(input.ocrEnabled, 'project.settings.ocrEnabled', issues),
    ocrStatus: enumValue(input.ocrStatus, 'project.settings.ocrStatus', issues, ['not-installed', 'installing', 'ready', 'error'] as const, 'not-installed'),
    mainPrompt: stringValue(input.mainPrompt ?? '', 'project.settings.mainPrompt', issues),
    visionPrompt: stringValue(input.visionPrompt ?? '', 'project.settings.visionPrompt', issues),
  }
}

const detectPrototypeKeys = (value: unknown, path: string, issues: ValidationIssue[], seen: Set<unknown>, depth = 0): void => {
  if (depth > 30 || value === null || typeof value !== 'object') return
  if (seen.has(value)) {
    issues.push({ path, message: 'contains a cyclic object' })
    return
  }
  seen.add(value)
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) issues.push({ path, message: 'contains a forbidden object prototype' })
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') issues.push({ path: `${path}.${key}`, message: 'contains a forbidden object key' })
    detectPrototypeKeys(child, `${path}.${key}`, issues, seen, depth + 1)
  }
  seen.delete(value)
}

const validateProjectInternal = (value: unknown, options: ValidationOptions, issues: ValidationIssue[]): Project => {
  const input = asRecord(value)
  const rawPages = arrayValue<unknown>(input.pages, 'project.pages', issues, PROJECT_LIMITS.maxPages, true)
  const pages = rawPages.map((item, index) => validatePage(item, `project.pages[${index}]`, issues))
  const rawVersions = options.allowSnapshots === false ? [] : arrayValue<unknown>(input.versions, 'project.versions', issues, PROJECT_LIMITS.maxSnapshots)
  const versions: Snapshot[] = rawVersions.map((item, index) => {
    const snapshot = asRecord(item)
    const snapshotProject = validateProjectInternal({ ...asRecord(snapshot.project), versions: [] }, { ...options, allowSnapshots: false }, issues)
    const { versions: _ignored, ...withoutVersions } = snapshotProject
    return {
      id: idValue(snapshot.id, `project.versions[${index}].id`, issues),
      name: stringValue(snapshot.name, `project.versions[${index}].name`, issues, { max: PROJECT_LIMITS.maxNameLength }),
      createdAt: stringValue(snapshot.createdAt, `project.versions[${index}].createdAt`, issues, { max: 128 }),
      project: withoutVersions,
    }
  })
  const project: Project = {
    id: idValue(input.id, 'project.id', issues),
    name: stringValue(input.name, 'project.name', issues, { max: PROJECT_LIMITS.maxNameLength }),
    updatedAt: stringValue(input.updatedAt, 'project.updatedAt', issues, { max: 128 }),
    ...(input.comments === undefined ? {} : { comments: commentsValue(input.comments, 'project.comments', issues) }),
    pages,
    activePageId: idValue(input.activePageId, 'project.activePageId', issues),
    styles: validateStyles(input.styles, issues),
    components: validateComponents(input.components, issues),
    assets: validateAssets(input.assets, issues),
    integrations: validateIntegrations(input.integrations, issues),
    providers: validateProviders(input.providers, issues),
    skills: validateSkills(input.skills, issues),
    commands: validateCommands(input.commands, issues),
    connections: validateConnections(input.connections, issues),
    versions,
    settings: validateSettings(input.settings, issues),
  }

  const pageIds = new Set<string>()
  const elementIds = new Set<string>()
  const interactionIds = new Set<string>()
  const breakpointIds = new Set<string>()
  const elementToPage = new Map<string, Page>()
  let elementCount = 0
  for (const [pageIndex, page] of pages.entries()) {
    if (pageIds.has(page.id)) issues.push({ path: `project.pages[${pageIndex}].id`, message: 'is duplicated' })
    pageIds.add(page.id)
    for (const [breakpointIndex, breakpoint] of page.breakpoints.entries()) {
      if (breakpointIds.has(breakpoint.id)) issues.push({ path: `project.pages[${pageIndex}].breakpoints[${breakpointIndex}].id`, message: 'is duplicated' })
      breakpointIds.add(breakpoint.id)
    }
    const localIds = new Set<string>()
    for (const [elementIndex, element] of page.elements.entries()) {
      elementCount += 1
      if (localIds.has(element.id) || elementIds.has(element.id)) issues.push({ path: `project.pages[${pageIndex}].elements[${elementIndex}].id`, message: 'is duplicated' })
      localIds.add(element.id); elementIds.add(element.id); elementToPage.set(element.id, page)
      if (element.parentId && !localIds.has(element.parentId) && !page.elements.some((candidate) => candidate.id === element.parentId)) issues.push({ path: `project.pages[${pageIndex}].elements[${elementIndex}].parentId`, message: 'does not reference an element on this page' })
      for (const [interactionIndex, interaction] of element.interactions.entries()) {
        if (interactionIds.has(interaction.id)) issues.push({ path: `project.pages[${pageIndex}].elements[${elementIndex}].interactions[${interactionIndex}].id`, message: 'is duplicated' })
        interactionIds.add(interaction.id)
        if (interaction.targetId && !page.elements.some((candidate) => candidate.id === interaction.targetId)) issues.push({ path: `project.pages[${pageIndex}].elements[${elementIndex}].interactions[${interactionIndex}].targetId`, message: 'does not reference an element' })
        if (interaction.pageId && !pages.some((candidate) => candidate.id === interaction.pageId)) issues.push({ path: `project.pages[${pageIndex}].elements[${elementIndex}].interactions[${interactionIndex}].pageId`, message: 'does not reference a page' })
        if (interaction.action === 'navigate' && !interaction.pageId) issues.push({ path: `project.pages[${pageIndex}].elements[${elementIndex}].interactions[${interactionIndex}].pageId`, message: 'is required for navigate actions' })
        if (interaction.action === 'external' && interaction.value && !isSafeUrl(interaction.value, { allowData: false, allowRelative: false })) issues.push({ path: `project.pages[${pageIndex}].elements[${elementIndex}].interactions[${interactionIndex}].value`, message: 'is not a safe external URL' })
      }
    }
    const byId = new Map(page.elements.map((element) => [element.id, element]))
    for (const element of page.elements) {
      const seen = new Set<string>()
      let current = element
      while (current.parentId) {
        if (seen.has(current.id)) {
          issues.push({ path: `project.pages[${pageIndex}].elements.${element.id}.parentId`, message: 'contains a parent cycle' })
          break
        }
        seen.add(current.id)
        const parent = byId.get(current.parentId)
        if (!parent) break
        current = parent
      }
    }
  }
  if (elementCount > PROJECT_LIMITS.maxTotalElements) issues.push({ path: 'project.pages', message: `contains more than ${PROJECT_LIMITS.maxTotalElements} elements` })
  if (!pageIds.has(project.activePageId)) issues.push({ path: 'project.activePageId', message: 'does not reference a page' })
  const styleIds = new Set<string>()
  for (const style of project.styles) { if (styleIds.has(style.id)) issues.push({ path: `project.styles.${style.id}`, message: 'is duplicated' }); styleIds.add(style.id) }
  const componentIds = new Set<string>()
  for (const component of project.components) {
    if (componentIds.has(component.id)) issues.push({ path: `project.components.${component.id}`, message: 'is duplicated' }); componentIds.add(component.id)
    if (!pageIds.has(component.sourcePageId)) issues.push({ path: `project.components.${component.id}.sourcePageId`, message: 'does not reference a page' })
    const sourcePage = pages.find((page) => page.id === component.sourcePageId)
    for (const elementId of component.elementIds) if (!sourcePage?.elements.some((element) => element.id === elementId)) issues.push({ path: `project.components.${component.id}.elementIds`, message: `does not reference ${elementId} on the source page` })
  }
  for (const page of pages) {
    for (const element of page.elements) {
      if (element.componentId && !componentIds.has(element.componentId)) issues.push({ path: `project.pages.${page.id}.elements.${element.id}.componentId`, message: 'does not reference a component' })
    }
  }
  const collectionIds: Array<[string, Array<{ id: string }>]> = [
    ['assets', project.assets], ['integrations', project.integrations], ['providers', project.providers], ['skills', project.skills], ['commands', project.commands], ['connections', project.connections], ['versions', project.versions],
  ]
  for (const [collection, items] of collectionIds) {
    const ids = new Set<string>()
    for (const [index, item] of items.entries()) {
      if (ids.has(item.id)) issues.push({ path: `project.${collection}[${index}].id`, message: 'is duplicated' })
      ids.add(item.id)
    }
  }
  return project
}

const jsonByteLength = (value: unknown): number => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength } catch { return Number.POSITIVE_INFINITY }
}

/** Validate and return a clean, prototype-free project copy. */
export const validateProject = (value: unknown, options: ValidationOptions = {}): Project => {
  const issues: ValidationIssue[] = []
  detectPrototypeKeys(value, '$', issues, new Set())
  const maxBytes = options.maxBytes ?? PROJECT_LIMITS.maxImportBytes
  if (jsonByteLength(value) > maxBytes) issues.push({ path: '$', message: `exceeds the ${maxBytes}-byte project limit` })
  if (!isRecord(value)) issues.push({ path: '$', message: 'must be an object' })
  const project = validateProjectInternal(value, { allowSnapshots: options.allowSnapshots !== false }, issues)
  if (issues.length) throw new ProjectValidationError(issues)
  return project
}

export const validateProjectResult = (value: unknown, options: ValidationOptions = {}): ValidationResult => {
  try {
    return { valid: true, project: validateProject(value, options), issues: [] }
  } catch (error) {
    return { valid: false, issues: error instanceof ProjectValidationError ? error.issues : [{ path: '$', message: error instanceof Error ? error.message : 'invalid project' }] }
  }
}

export const validateLayerDocument = (value: unknown, options: ValidationOptions = {}): Project => {
  if (!isRecord(value)) throw new ProjectValidationError('document must be an object')
  if (own(value, 'format') && value.format !== 'layer') throw new ProjectValidationError('unsupported document format')
  if (own(value, 'version') && (typeof value.version !== 'number' || !Number.isFinite(value.version) || value.version < 1 || value.version > 2)) throw new ProjectValidationError('unsupported Layer document version')
  const rawProject = own(value, 'project') ? value.project : value
  return validateProject(rawProject, options)
}

export const validateImport = validateLayerDocument
export const sanitizeSvg = sanitizeSvgMarkup

/** A small helper used by storage/export to avoid exporting private project data. */
export const cloneForPersistence = (project: Project): Project => validateProject(JSON.parse(JSON.stringify(project)))

// Keep these imports used in browser builds where a legacy document omitted
// prompts/settings fields.  They are intentionally not applied silently by
// validateProject; storage performs that migration before validation.
export const legacyDefaults = { createInitialProject, DEFAULT_MAIN_PROMPT, DEFAULT_VISION_PROMPT }
