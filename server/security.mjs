import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX_BODY_BYTES = 16 * 1024 * 1024
export const DEFAULT_DATA_DIR = path.resolve(process.env.LAYER_DATA_DIR || path.join(process.cwd(), '.layer-data'))

export class HttpError extends Error {
  constructor(status, message, code = 'BAD_REQUEST', details) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message, details) => new HttpError(400, message, 'BAD_REQUEST', details)
export const forbidden = (message = 'Request origin is not allowed.') => new HttpError(403, message, 'FORBIDDEN')
export const notFound = (message = 'Resource not found.') => new HttpError(404, message, 'NOT_FOUND')

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function assertPlainObject(value, message = 'Expected a JSON object.') {
  if (!isPlainObject(value)) throw badRequest(message)
  return value
}

export function validateId(value, field = 'id') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw badRequest(`${field} must contain only letters, numbers, '.', '_', ':', or '-'.`)
  }
  return value
}

export function parseHttpUrl(value, field = 'url', { allowLocalhost = true } = {}) {
  if (typeof value !== 'string' || value.length > 2048) throw badRequest(`${field} must be a URL.`)
  let url
  try { url = new URL(value) } catch { throw badRequest(`${field} must be a valid URL.`) }
  if (!['http:', 'https:'].includes(url.protocol)) throw badRequest(`${field} must use http or https.`)
  if (url.username || url.password) throw badRequest(`${field} must not contain credentials.`)
  if (!url.hostname) throw badRequest(`${field} must include a host.`)
  if (!allowLocalhost && isLocalhostHostname(url.hostname)) throw forbidden(`${field} cannot target localhost.`)
  url.hash = ''
  return url
}

export function isLocalhostHostname(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '::'
}

export function isTrustedOrigin(origin, { port = 8787, allowedOrigins = [] } = {}) {
  if (!origin) return true
  if (origin === 'null') return false
  let parsed
  try { parsed = new URL(origin) } catch { return false }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false
  const configured = new Set([
    ...allowedOrigins,
    ...(process.env.LAYER_ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean),
  ])
  if (configured.has(origin)) return true
  return parsed.origin === origin && parsed.protocol === 'http:' && [String(port), '5173'].includes(parsed.port || '80') && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase())
}

/**
 * Enforce browser origin and CSRF rules. Requests without an Origin/Referer
 * are treated as non-browser local clients and do not need the browser token.
 */
export function assertRequestSecurity(req, options = {}) {
  const { port = 8787, csrfToken, mutate = false, allowedOrigins = [] } = options
  const origin = req.headers.origin
  if (origin && !isTrustedOrigin(origin, { port, allowedOrigins })) throw forbidden()
  const referer = req.headers.referer || req.headers.referrer
  if (referer) {
    let refererOrigin
    try { refererOrigin = new URL(referer).origin } catch { throw forbidden() }
    if (!isTrustedOrigin(refererOrigin, { port, allowedOrigins })) throw forbidden()
  }
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase()
  if (fetchSite === 'cross-site' && !origin || origin && !isTrustedOrigin(origin, { port, allowedOrigins })) throw forbidden()
  if (!mutate) return
  if ((origin || referer || fetchSite) && csrfToken && req.headers['x-layer-csrf'] !== csrfToken) {
    throw new HttpError(403, 'Missing or invalid CSRF token.', 'CSRF_REQUIRED')
  }
}

export async function readJsonBody(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  if (Number(req.headers['content-length'] || 0) > maxBytes) throw new HttpError(413, 'Request body is too large.', 'PAYLOAD_TOO_LARGE')
  if (req.headers['content-type'] && !/^application\/json(?:;|$)/i.test(req.headers['content-type'])) throw new HttpError(415, 'Use application/json for API requests.', 'UNSUPPORTED_MEDIA')
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new HttpError(413, 'Request body is too large.', 'PAYLOAD_TOO_LARGE')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    const value = JSON.parse(text)
    if (!isPlainObject(value)) throw new Error('not object')
    return value
  } catch {
    throw badRequest('Request body must be a JSON object.')
  }
}

export function redactSecret(value) {
  if (typeof value !== 'string' || !value) return value
  return value.length <= 8 ? '[redacted]' : `${value.slice(0, 3)}…${value.slice(-2)}`
}

function keyFromEnv() {
  const raw = process.env.LAYER_SECRET_KEY
  if (!raw) return null
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex')
  try {
    const decoded = Buffer.from(raw, 'base64')
    if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/, '') === raw.replace(/=+$/, '')) return decoded
  } catch { /* derive below */ }
  return crypto.createHash('sha256').update(raw).digest()
}

export async function getEncryptionKey(dataDir = DEFAULT_DATA_DIR) {
  const fromEnv = keyFromEnv()
  if (fromEnv) return fromEnv
  await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
  const keyPath = path.join(dataDir, 'master.key')
  try {
    const key = await fsp.readFile(keyPath)
    if (key.length !== 32) throw new Error('Invalid master key length')
    return key
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    const key = crypto.randomBytes(32)
    await fsp.writeFile(keyPath, key, { mode: 0o600, flag: 'wx' }).catch(async (writeError) => {
      if (writeError?.code !== 'EEXIST') throw writeError
    })
    try { await fsp.chmod(keyPath, 0o600) } catch { /* best effort on Windows */ }
    return fsp.readFile(keyPath)
  }
}

export function encryptSecret(secret, key) {
  if (secret === undefined || secret === null || secret === '') return null
  const value = Buffer.from(String(secret), 'utf8')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`
}

export function decryptSecret(payload, key) {
  if (!payload) return undefined
  if (typeof payload !== 'string' || !payload.startsWith('v1.')) throw new Error('Unsupported encrypted secret format.')
  const [, ivText, tagText, cipherText] = payload.split('.')
  if (!ivText || !tagText || !cipherText) throw new Error('Malformed encrypted secret.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(cipherText, 'base64url')), decipher.final()]).toString('utf8')
}

export async function atomicWrite(filePath, value) {
  const directory = path.dirname(filePath)
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 })
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try { await fsp.chmod(temp, 0o600) } catch { /* best effort on Windows */ }
  await fsp.rename(temp, filePath)
}

export class SecureConfigStore {
  constructor({ dataDir = DEFAULT_DATA_DIR, fetchImpl = globalThis.fetch } = {}) {
    this.dataDir = path.resolve(dataDir)
    this.fetchImpl = fetchImpl
    this.keyPromise = null
    this.providers = null
    this.connections = null
    this.writeQueue = Promise.resolve()
  }

  async key() {
    this.keyPromise ||= getEncryptionKey(this.dataDir)
    return this.keyPromise
  }

  async read(name, fallback) {
    try {
      const text = await fsp.readFile(path.join(this.dataDir, name), 'utf8')
      const value = JSON.parse(text)
      return isPlainObject(value) ? value : fallback
    } catch (error) {
      if (error?.code === 'ENOENT') return fallback
      throw error
    }
  }

  async load() {
    this.loadPromise ||= Promise.all([this.read('providers.json', { providers: [] }), this.read('connections.json', { connections: [] })]).then(([providers, connections]) => { this.providers = providers; this.connections = connections })
    await this.loadPromise
    return this
  }

  async write(name, value) {
    const snapshot = structuredClone(value)
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => atomicWrite(path.join(this.dataDir, name), snapshot))
    await this.writeQueue
  }

  async saveProviders() { await this.write('providers.json', this.providers) }
  async saveConnections() { await this.write('connections.json', this.connections) }

  async providerRecords() {
    await this.load()
    const key = await this.key()
    return (this.providers.providers || []).map((record) => ({
      ...record,
      key: record.keyEncrypted ? decryptSecret(record.keyEncrypted, key) : undefined,
    }))
  }

  async connectionRecords() {
    await this.load()
    const key = await this.key()
    return (this.connections.connections || []).map((record) => ({
      ...record,
      authToken: record.authTokenEncrypted ? decryptSecret(record.authTokenEncrypted, key) : undefined,
    }))
  }

  async upsertProvider(input) {
    await this.load()
    const key = await this.key()
    const existing = (this.providers.providers || []).find((item) => item.id === input.id)
    const existingKey = existing?.keyEncrypted ? decryptSecret(existing.keyEncrypted, key) : undefined
    const record = { ...(existing || {}), ...input }
    const suppliedKey = Object.prototype.hasOwnProperty.call(input, 'key') && input.key !== undefined
    const endpointChanged = existing && (input.endpoint !== existing.endpoint || input.kind !== existing.kind)
    const secret = suppliedKey ? input.key : endpointChanged ? undefined : existingKey
    delete record.key
    record.keyEncrypted = encryptSecret(secret, key)
    record.credentialSet = Boolean(secret)
    const changed = !existing || endpointChanged || secret !== existingKey || input.model !== existing.model || JSON.stringify(input.advanced) !== JSON.stringify(existing.advanced) || input.imageInput !== existing.imageInput || input.videoInput !== existing.videoInput
    record.connected = changed ? false : existing.connected
    record.error = undefined
    this.providers.providers = (this.providers.providers || []).filter((item) => item.id !== input.id)
    this.providers.providers.push(record)
    await this.saveProviders()
    return { ...record, key: secret }
  }

  async removeProvider(id) {
    await this.load()
    this.providers.providers = (this.providers.providers || []).filter((item) => item.id !== id)
    await this.saveProviders()
  }

  async updateProviderState(id, patch) {
    await this.load()
    const record = (this.providers.providers || []).find((item) => item.id === id)
    if (!record) return null
    Object.assign(record, patch)
    await this.saveProviders()
    return record
  }

  async upsertConnection(input) {
    await this.load()
    const key = await this.key()
    const existing = (this.connections.connections || []).find((item) => item.id === input.id)
    const existingToken = existing?.authTokenEncrypted ? decryptSecret(existing.authTokenEncrypted, key) : undefined
    const record = { ...(existing || {}), ...input }
    const suppliedToken = Object.prototype.hasOwnProperty.call(input, 'authToken') && input.authToken !== undefined
    const endpointChanged = existing && input.url !== existing.url
    const token = suppliedToken ? input.authToken : endpointChanged ? undefined : existingToken
    delete record.authToken
    record.authTokenEncrypted = encryptSecret(token, key)
    delete record.token
    record.tools = Array.isArray(record.tools) ? record.tools : []
    if (!existing) record.status ||= 'disconnected'
    else {
      const changed = (input.url !== undefined && input.url !== existing.url)
        || (input.allowLocalhost !== undefined && input.allowLocalhost !== existing.allowLocalhost)
        || (input.transport !== undefined && input.transport !== existing.transport)
        || (suppliedToken && token !== existingToken)
      if (changed) { record.status = 'disconnected'; record.sessionId = undefined; record.tools = []; record.allowedTools = [] }
    }
    this.connections.connections = (this.connections.connections || []).filter((item) => item.id !== input.id)
    this.connections.connections.push(record)
    await this.saveConnections()
    return { ...record, authToken: token }
  }

  async removeConnection(id) {
    await this.load()
    this.connections.connections = (this.connections.connections || []).filter((item) => item.id !== id)
    await this.saveConnections()
  }

  async updateConnectionState(id, patch) {
    await this.load()
    const record = (this.connections.connections || []).find((item) => item.id === id)
    if (!record) return null
    Object.assign(record, patch)
    await this.saveConnections()
    return record
  }
}

export function publicProvider(record) {
  if (!record) return undefined
  const { key, keyEncrypted, ...safe } = record
  return { ...safe, credentialSet: Boolean(record.credentialSet || key) }
}

export function publicConnection(record) {
  if (!record) return undefined
  const { authToken, authTokenEncrypted, token, sessionId, ...safe } = record
  return { ...safe, authTokenSet: Boolean(record.authTokenSet || authToken) }
}

export function responseJson(res, status, payload, headers = {}) {
  if (res.headersSent) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  })
  res.end(body)
}

export function errorPayload(error) {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }
  }
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'The server could not complete the request.' } }
}

export function isMainModule(metaUrl) {
  try { return fs.realpathSync(fileURLToPath(metaUrl)) === fs.realpathSync(process.argv[1]) } catch { return false }
}
