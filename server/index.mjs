import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runAi } from './ai.mjs'
import { callMcpTool, discoverMcpTools, validateMcpConnectionInput } from './mcp-client.mjs'
import { discoverModels, normalizeProviderInput, testProvider, createProviderAdapter } from './providers.mjs'
import { assertRequestSecurity, badRequest, DEFAULT_DATA_DIR, errorPayload, forbidden, HttpError, isMainModule, notFound, publicConnection, publicProvider, readJsonBody, responseJson, SecureConfigStore, validateId } from './security.mjs'
import { ProjectStore } from './projects.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const defaultDist = path.join(projectRoot, 'dist')
const csrfToken = crypto.randomBytes(32).toString('base64url')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
}

function envBoolean(name, fallback = false) {
  const value = process.env[name]
  return value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function serverOptions(options = {}) {
  const port = Number(options.port ?? process.env.LAYER_PORT ?? process.env.PORT ?? 8787)
  const host = options.host ?? process.env.LAYER_HOST ?? '127.0.0.1'
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid server port.')
  return {
    port, host, dataDir: options.dataDir || DEFAULT_DATA_DIR, distDir: options.distDir || defaultDist,
    allowLocalhostMcp: options.allowLocalhostMcp ?? envBoolean('LAYER_ALLOW_LOCALHOST_MCP', false),
    allowedOrigins: options.allowedOrigins || [], fetchImpl: options.fetchImpl || globalThis.fetch,
    store: options.store || new SecureConfigStore({ dataDir: options.dataDir || DEFAULT_DATA_DIR, fetchImpl: options.fetchImpl || globalThis.fetch }),
    projectStore: options.projectStore || new ProjectStore({ dataDir: options.dataDir || DEFAULT_DATA_DIR }),
    limiter: options.limiter || new RequestLimiter(),
  }
}

class RequestLimiter {
  constructor() { this.buckets = new Map() }
  check(key, limit, windowMs = 60_000) {
    const now = Date.now(); const current = this.buckets.get(key)
    if (!current || current.reset <= now) { this.buckets.set(key, { count: 1, reset: now + windowMs }); return }
    current.count += 1
    if (current.count > limit) throw new HttpError(429, 'Too many requests. Try again shortly.', 'RATE_LIMITED', { retryAfter: Math.ceil((current.reset - now) / 1000) })
  }
  prune() { const now = Date.now(); for (const [key, bucket] of this.buckets) if (bucket.reset <= now) this.buckets.delete(key) }
}

function setCors(res, req, options) {
  const origin = req.headers.origin
  if (!origin) return
  if (!options.isTrustedOrigin(origin)) throw forbidden()
  res.setHeader('access-control-allow-origin', origin)
  res.setHeader('vary', 'Origin')
  res.setHeader('access-control-allow-credentials', 'true')
}

function routePath(req) {
  let url
  try { url = new URL(req.url || '/', 'http://layer.local') } catch { throw badRequest('Invalid request URL.') }
  try { return { pathname: decodeURIComponent(url.pathname), searchParams: url.searchParams } } catch { throw badRequest('Invalid request path encoding.') }
}

async function sendStatic(res, pathname, options, method = 'GET') {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const candidate = path.resolve(options.distDir, relative)
  const root = path.resolve(options.distDir)
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw forbidden('Invalid static path.')
  try {
    const stat = await fs.stat(candidate)
    if (!stat.isFile()) throw new Error('not file')
    const content = await fs.readFile(candidate)
    const ext = path.extname(candidate).toLowerCase()
    res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' })
    res.end(method === 'HEAD' ? undefined : content)
    return true
  } catch (error) {
    if (error?.code !== 'ENOENT') return false
    if (pathname !== '/' && path.extname(pathname)) return false
    const fallback = path.join(root, 'index.html')
    try { const content = await fs.readFile(fallback); res.writeHead(200, { 'content-type': MIME_TYPES['.html'], 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' }); res.end(method === 'HEAD' ? undefined : content); return true } catch { return false }
  }
}

function publicConnectionWithStatus(connection) {
  const safe = publicConnection(connection)
  if (!safe) return safe
  return { ...safe, authTokenSet: Boolean(connection.authToken || connection.authTokenEncrypted) }
}

const STREAM_HEADERS = Object.freeze({
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
  'x-content-type-options': 'nosniff',
})

function writeSse(res, event, payload) {
  if (res.writableEnded || res.destroyed) return
  if (!res.headersSent) res.writeHead(200, STREAM_HEADERS)
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}

async function resolveProvider(store, id) {
  validateId(id, 'provider id')
  const provider = (await store.providerRecords()).find((item) => item.id === id)
  if (!provider) throw notFound(`Provider '${id}' was not found.`)
  return provider
}

async function resolveConnections(store, enabledConnections) {
  const records = await store.connectionRecords()
  if (enabledConnections === undefined) return records.filter((connection) => connection.enabled && connection.status === 'connected')
  if (!Array.isArray(enabledConnections) || enabledConnections.length > 32) throw badRequest('enabledConnections must be an array of connection IDs.')
  const ids = enabledConnections.map((item) => typeof item === 'string' ? item : item?.id).filter((item) => typeof item === 'string')
  if (ids.length !== enabledConnections.length) throw badRequest('enabledConnections must contain connection IDs.')
  return ids.map((id) => records.find((record) => record.id === id)).map((record, index) => {
    if (!record) throw notFound(`MCP connection '${ids[index]}' was not found.`)
    if (!record.enabled || record.status !== 'connected') throw new HttpError(409, `MCP connection '${record.id}' is not connected/enabled.`, 'CONNECTION_NOT_READY')
    return record
  })
}

function safeProviderInput(body, existing) {
  const input = existing ? {
    id: existing.id, name: existing.name, kind: existing.kind, endpoint: existing.endpoint, model: existing.model,
    imageInput: existing.imageInput, videoInput: existing.videoInput, manualModel: existing.manualModel,
    ...body,
  } : { ...body }
  if (!Object.prototype.hasOwnProperty.call(body, 'key') && existing) input.credentialSet = existing.credentialSet
  return normalizeProviderInput(input)
}

async function apiRequest(req, res, pathName, options, signal) {
  const method = req.method || 'GET'
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  const ip = String(req.socket.remoteAddress || 'local').replace(/[^A-Za-z0-9:.]/g, '_')
  const isAiPath = pathName === '/api/ai' || pathName === '/api/ai/stream'
  options.limiter.check(`${ip}:${isAiPath ? 'ai' : 'api'}`, isAiPath ? 20 : 120)
  assertRequestSecurity(req, { port: options.port, csrfToken, mutate: isMutation, allowedOrigins: options.allowedOrigins })
  setCors(res, req, { isTrustedOrigin: (origin) => options.isTrustedOrigin(origin) })

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type, x-layer-csrf', 'access-control-max-age': '600' }); res.end(); return true
  }

  const body = method === 'POST' || method === 'PUT' || method === 'PATCH' ? await readJsonBody(req) : {}
  if (pathName === '/api/health' && method === 'GET') {
    responseJson(res, 200, {
      ok: true,
      service: 'layer-server',
      version: '2',
      csrfToken,
      capabilities: { ai: { completion: true, streaming: true } },
      routes: { health: 'GET /api/health', ai: 'POST /api/ai', aiStream: 'POST /api/ai/stream' },
    }); return true
  }

  if (pathName === '/api/projects' && method === 'GET') { responseJson(res, 200, { projects: await options.projectStore.list() }); return true }
  if (pathName === '/api/projects' && method === 'POST') { const project = await options.projectStore.put(body.project || body); responseJson(res, 200, { project }); return true }
  if (pathName === '/api/shares' && method === 'POST') { const project = body.project || await options.projectStore.get(body.projectId); responseJson(res, 200, await options.projectStore.createShare(project)); return true }
  const shareMatch = /^\/api\/shares\/([^/]+)$/.exec(pathName)
  if (shareMatch && method === 'GET') { responseJson(res, 200, await options.projectStore.getShare(decodeURIComponent(shareMatch[1]))); return true }
  const projectMatch = /^\/api\/projects\/([^/]+)(\/snapshots)?$/.exec(pathName)
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1])
    if (projectMatch[2] && method === 'POST') { responseJson(res, 200, { snapshot: await options.projectStore.addSnapshot(projectId, body.name) }); return true }
    if (projectMatch[2]) throw notFound()
    if (method === 'GET') { responseJson(res, 200, { project: await options.projectStore.get(projectId) }); return true }
    if (method === 'PUT') { const project = await options.projectStore.put({ ...(body.project || body), id: projectId }); responseJson(res, 200, { project }); return true }
    if (method === 'DELETE') { await options.projectStore.remove(projectId); responseJson(res, 200, { ok: true }); return true }
  }

  if (pathName === '/api/providers' && method === 'GET') {
    responseJson(res, 200, { providers: (await options.store.providerRecords()).map(publicProvider) }); return true
  }
  if (pathName === '/api/providers' && method === 'POST') {
    const existing = body.id ? (await options.store.providerRecords()).find((item) => item.id === body.id) : undefined
    const input = safeProviderInput(body, existing)
    const record = await options.store.upsertProvider(input)
    responseJson(res, 200, { provider: publicProvider(record) }); return true
  }
  const providerMatch = /^\/api\/providers\/([^/]+)(?:\/(test|models))?$/.exec(pathName)
  if (providerMatch) {
    const providerId = decodeURIComponent(providerMatch[1]); const action = providerMatch[2]
    if (!action && method === 'DELETE') { await options.store.removeProvider(providerId); responseJson(res, 200, { ok: true }); return true }
    const record = await resolveProvider(options.store, providerId)
    if (action === 'models' && (method === 'POST' || method === 'GET')) {
      try {
        const result = await discoverModels(record, { fetchImpl: options.fetchImpl, signal })
        await options.store.updateProviderState(record.id, { manualModel: result.manualFallback, model: result.selected, lastModelDiscoveryAt: new Date().toISOString(), error: undefined })
        responseJson(res, 200, { ...result, provider: publicProvider({ ...record, manualModel: result.manualFallback, model: result.selected }) }); return true
      } catch (error) {
        await options.store.updateProviderState(record.id, { error: error instanceof Error ? error.message.slice(0, 1000) : 'Model discovery failed.' })
        throw error
      }
    }
    if (action === 'test' && method === 'POST') {
      try {
        const result = await testProvider(record, { fetchImpl: options.fetchImpl, signal })
        await options.store.updateProviderState(record.id, { connected: true, manualModel: result.manualFallback, model: result.selected, lastTestedAt: new Date().toISOString(), error: undefined })
        responseJson(res, 200, { ...result, provider: publicProvider({ ...record, connected: true, manualModel: result.manualFallback, model: result.selected }) }); return true
      } catch (error) {
        await options.store.updateProviderState(record.id, { connected: false, error: error instanceof Error ? error.message.slice(0, 1000) : 'Provider test failed.' })
        throw error
      }
    }
  }

  if (pathName === '/api/connections' && method === 'GET') {
    responseJson(res, 200, { connections: (await options.store.connectionRecords()).map(publicConnectionWithStatus) }); return true
  }
  if (pathName === '/api/connections' && method === 'POST') {
    const normalized = validateMcpConnectionInput(body, { allowLocalhost: options.allowLocalhostMcp })
    const record = await options.store.upsertConnection(normalized)
    responseJson(res, 200, { connection: publicConnectionWithStatus(record) }); return true
  }
  const connectionMatch = /^\/api\/connections\/([^/]+)(?:\/(test|call))?$/.exec(pathName)
  if (connectionMatch) {
    const connectionId = decodeURIComponent(connectionMatch[1]); const action = connectionMatch[2]
    if (!action && method === 'DELETE') { await options.store.removeConnection(connectionId); responseJson(res, 200, { ok: true }); return true }
    validateId(connectionId, 'connection id')
    const record = (await options.store.connectionRecords()).find((item) => item.id === connectionId)
    if (!record) throw notFound(`MCP connection '${connectionId}' was not found.`)
    if (action === 'test' && method === 'POST') {
      try {
        const result = await discoverMcpTools(record, { fetchImpl: options.fetchImpl, allowLocalhost: options.allowLocalhostMcp, signal })
        const updated = await options.store.updateConnectionState(record.id, { status: 'connected', tools: result.tools, allowedTools: result.allowedTools, sessionId: result.sessionId, protocolVersion: result.protocolVersion, error: undefined, lastTestedAt: new Date().toISOString() })
        responseJson(res, 200, { ...result, connection: publicConnectionWithStatus({ ...record, ...updated }) }); return true
      } catch (error) {
        await options.store.updateConnectionState(record.id, { status: 'error', error: error instanceof Error ? error.message.slice(0, 1000) : 'MCP test failed.' })
        throw error
      }
    }
    if (action === 'call' && method === 'POST') {
      if (!record.enabled || record.status !== 'connected') throw new HttpError(409, 'MCP connection is not connected/enabled.', 'CONNECTION_NOT_READY')
      if (typeof body.name !== 'string') throw badRequest('MCP call requires a tool name.')
      const value = await callMcpTool(record, body.name, body.arguments || {}, { fetchImpl: options.fetchImpl, allowLocalhost: options.allowLocalhostMcp, signal })
      responseJson(res, 200, { result: value }); return true
    }
  }

  if (isAiPath && method === 'POST') {
    const streaming = pathName === '/api/ai/stream'
    try {
      const providerId = body.providerId
      if (typeof providerId !== 'string') throw badRequest('providerId is required.')
      const providerRecord = await resolveProvider(options.store, providerId)
      if (body.videoRefs !== undefined) throw new HttpError(415, 'Video input is not supported by the Layer service.', 'UNSUPPORTED_MEDIA')
      const provider = createProviderAdapter(providerRecord, options.fetchImpl)
      provider.kind = providerRecord.kind
      const visionConfig = body.visionConfig && typeof body.visionConfig === 'object' ? { ...body.visionConfig } : {}
      const visionProviderId = body.visionProviderId || visionConfig.providerId
      let visionProvider
      if (visionProviderId) {
        const visionRecord = await resolveProvider(options.store, visionProviderId)
        visionProvider = createProviderAdapter(visionRecord, options.fetchImpl)
        visionProvider.kind = visionRecord.kind
        visionConfig.enabled = visionConfig.enabled !== false
      }
      const connections = await resolveConnections(options.store, body.enabledConnections ?? body.connectionIds)
      const result = await runAi({ provider, visionProvider, prompt: body.prompt, document: body.document, scope: body.scope, systemPrompt: body.systemPrompt, skills: body.skills, commands: body.commands, connections, imageRefs: body.imageRefs || body.sampledFrames, videoRefs: body.videoRefs, visionConfig, fetchImpl: options.fetchImpl, signal, onText: streaming ? async (text) => writeSse(res, 'delta', { text }) : undefined })
      if (streaming) { writeSse(res, 'done', { response: result }); res.end() } else responseJson(res, 200, result)
    } catch (error) {
      if (!streaming) throw error
      const payload = errorPayload(error)
      if (!res.headersSent) responseJson(res, payload.status, payload.body)
      else {
        writeSse(res, 'error', { error: payload.body?.error, message: payload.body?.message || 'AI stream failed.', code: payload.body?.code, ...(payload.body?.details ? { details: payload.body.details } : {}) })
        if (!res.writableEnded && !res.destroyed) res.end()
      }
    }
    return true
  }
  throw notFound()
}

export function createServer(optionsInput = {}) {
  const options = serverOptions(optionsInput)
  options.isTrustedOrigin = (origin) => {
    try {
      const request = { headers: { origin } }
      assertRequestSecurity(request, { port: options.port, allowedOrigins: options.allowedOrigins, mutate: false })
      return true
    } catch { return false }
  }
  const server = http.createServer(async (req, res) => {
    const abort = new AbortController()
    const onClose = () => { if (!res.writableEnded) abort.abort() }
    req.on('aborted', onClose); res.on('close', onClose)
    try {
      const { pathname } = routePath(req)
      if (pathname.startsWith('/api/')) {
        await apiRequest(req, res, pathname, options, abort.signal)
      } else {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED')
        const served = await sendStatic(res, pathname, options, req.method)
        if (!served) throw notFound()
      }
    } catch (error) {
      if (error?.name === 'AbortError' && res.writableEnded) return
      const payload = errorPayload(error)
      if (!res.headersSent) {
        try { setCors(res, req, { isTrustedOrigin: (origin) => options.isTrustedOrigin(origin) }) } catch { /* leave CORS absent */ }
        responseJson(res, payload.status, payload.body)
      } else res.destroy()
    } finally {
      req.off('aborted', onClose); res.off('close', onClose)
    }
  })
  const pruneTimer = setInterval(() => options.limiter.prune(), 60_000)
  pruneTimer.unref?.()
  server.on('close', () => clearInterval(pruneTimer))
  server.layerOptions = options
  return server
}

export async function startServer(optionsInput = {}) {
  const server = createServer(optionsInput)
  const options = server.layerOptions
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error) }
    const onListening = () => { server.off('error', onError); resolve() }
    server.once('error', onError); server.once('listening', onListening); server.listen(options.port, options.host)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port
  console.log(`Layer server listening at http://${options.host}:${port}`)
  return server
}

if (isMainModule(import.meta.url)) {
  startServer().catch((error) => { console.error(error); process.exitCode = 1 })
}
