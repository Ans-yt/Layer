import { badRequest, forbidden, HttpError, isLocalhostHostname, parseHttpUrl } from './security.mjs'
import { boundedText, safeFetch } from './network.mjs'

export const MCP_PROTOCOL_VERSION = '2025-03-26'

export class McpClientError extends HttpError {
  constructor(status, message, code = 'MCP_ERROR', details) { super(status, message, code, details); this.name = 'McpClientError' }
}

export function validateMcpConnectionInput(input, { allowLocalhost = false } = {}) {
  if (!input || typeof input !== 'object') throw badRequest('MCP connection must be an object.')
  const id = String(input.id || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw badRequest('MCP connection id is invalid.')
  if (String(input.transport || 'streamable-http').toLowerCase() !== 'streamable-http') throw new HttpError(400, 'Only MCP streamable HTTP transport is supported.', 'UNSUPPORTED_TRANSPORT')
  const url = parseHttpUrl(input.url, 'url', { allowLocalhost })
  if (url.protocol === 'http:' && !isLocalhostHostname(url.hostname)) throw badRequest('MCP endpoints must use HTTPS unless they target localhost.')
  const authToken = input.authToken
  if (authToken !== undefined && authToken !== null && typeof authToken !== 'string') throw badRequest('authToken must be a string.')
  const allowedTools = input.allowedTools === undefined ? undefined : normalizeToolNames(input.allowedTools)
  return {
    id,
    name: String(input.name || id).slice(0, 160),
    url: url.toString().replace(/\/$/, ''),
    enabled: input.enabled !== false,
    transport: 'streamable-http',
    allowLocalhost: Boolean(input.allowLocalhost ?? allowLocalhost),
    ...(authToken !== undefined ? { authToken } : {}),
    ...(Array.isArray(input.tools) ? { tools: normalizeTools(input.tools) } : {}),
    ...(allowedTools !== undefined ? { allowedTools } : {}),
  }
}

export function normalizeToolNames(value) {
  if (!Array.isArray(value) || value.length > 512 || value.some((item) => typeof item !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(item))) throw badRequest('allowedTools must be an array of tool names.')
  return [...new Set(value)]
}

export function normalizeTools(value) {
  if (!Array.isArray(value) || value.length > 512) throw badRequest('tools must be an array.')
  return value.map((tool) => {
    if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(tool.name)) throw badRequest('MCP tools must have safe names.')
    let inputSchema
    if (tool.inputSchema && typeof tool.inputSchema === 'object') {
      try { if (JSON.stringify(tool.inputSchema).length > 64 * 1024) throw new Error('too large'); inputSchema = tool.inputSchema } catch { throw new McpClientError(502, `MCP tool '${tool.name}' has an oversized input schema.`, 'MCP_INVALID_RESPONSE') }
    }
    return { name: tool.name, description: typeof tool.description === 'string' ? tool.description.slice(0, 1000) : 'No description supplied.', inputSchema }
  })
}

async function parseMcpResponse(response, requestId) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('text/event-stream')) {
    if (!response.body) return null
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''; let bytes = 0; let last = null
    const consume = (block) => {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!data) return null
      try { return JSON.parse(data) } catch { return null }
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 4 * 1024 * 1024) throw new McpClientError(502, 'MCP SSE response exceeds the size limit.', 'MCP_UPSTREAM_TOO_LARGE')
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() || ''
        for (const block of blocks) { const message = consume(block); if (!message) continue; last = message; if (requestId === undefined || message.id === requestId) return message }
      }
      buffer += decoder.decode()
      const message = consume(buffer)
      if (message) last = message
      return last
    } finally { await reader.cancel().catch(() => {}) }
  }
  const text = await boundedText(response, 4 * 1024 * 1024)
  if (!text) return null
  try { return JSON.parse(text) } catch { throw new McpClientError(502, 'MCP returned an invalid JSON response.', 'MCP_INVALID_RESPONSE') }
}

function rpcError(value, action) {
  if (!value?.error) return
  const message = typeof value.error.message === 'string' ? value.error.message : 'Unknown JSON-RPC error.'
  throw new McpClientError(502, `${action} failed: ${message}`.slice(0, 1200), 'MCP_REMOTE_ERROR', { code: value.error.code })
}

export class StreamableHttpMcpClient {
  constructor(connection, { fetchImpl = globalThis.fetch, allowLocalhost = false, signal } = {}) {
    if (connection?.transport && connection.transport !== 'streamable-http') throw new McpClientError(400, 'Only MCP streamable HTTP transport is supported.', 'UNSUPPORTED_TRANSPORT')
    this.connection = connection
    this.fetch = fetchImpl
    this.allowLocalhost = Boolean(connection?.allowLocalhost ?? allowLocalhost)
    this.signal = signal
    this.sessionId = connection?.sessionId
    // A persisted MCP session has already completed initialization. Reusing
    // it avoids sending initialize again on every tool call.
    this.initialized = Boolean(this.sessionId)
    this.protocolVersion = connection?.protocolVersion || MCP_PROTOCOL_VERSION
    this.negotiated = Boolean(this.sessionId)
    this.requestId = 0
  }

  endpoint() {
    const url = parseHttpUrl(this.connection?.url, 'url', { allowLocalhost: this.allowLocalhost })
    if (url.protocol === 'http:' && !isLocalhostHostname(url.hostname)) throw forbidden('MCP HTTP endpoints must use HTTPS unless localhost is explicitly allowed.')
    return url.toString().replace(/\/$/, '')
  }

  headers(extra = {}) {
    return {
      accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      ...(this.connection?.authToken ? { authorization: `Bearer ${this.connection.authToken}` } : {}),
      ...(this.negotiated ? { 'mcp-protocol-version': this.protocolVersion } : {}),
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}), ...extra,
    }
  }

  async post(message, { notification = false } = {}) {
    if (this.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    let response
    try { response = await safeFetch(this.endpoint(), { method: 'POST', headers: this.headers(), body: JSON.stringify(message), signal: this.signal }, { fetchImpl: this.fetch, allowLocalhost: this.allowLocalhost }) } catch (error) {
      if (error?.name === 'AbortError') throw error
      throw new McpClientError(502, `Unable to reach MCP server: ${error instanceof Error ? error.message : 'network failure'}`, 'MCP_UNAVAILABLE')
    }
    const returnedSession = response.headers.get('mcp-session-id')
    if (returnedSession) this.sessionId = returnedSession
    if (!response.ok) {
      await boundedText(response, 128 * 1024).catch(() => {})
      throw new McpClientError(502, `MCP ${message.method} returned HTTP ${response.status}.`, 'MCP_HTTP_ERROR', { status: response.status })
    }
    if (notification || response.status === 202) return null
    const result = await parseMcpResponse(response, message.id)
    rpcError(result, message.method)
    return result
  }

  async initialize() {
    if (this.initialized) return { sessionId: this.sessionId }
    const result = await this.post({ jsonrpc: '2.0', id: ++this.requestId, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Layer', version: '0.1.0' } } })
    const serverVersion = result?.result?.protocolVersion
    if (serverVersion && typeof serverVersion !== 'string') throw new McpClientError(502, 'MCP server returned an invalid protocol version.', 'MCP_INVALID_RESPONSE')
    if (serverVersion) this.protocolVersion = serverVersion
    this.negotiated = true
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, { notification: true })
    this.initialized = true
    return { sessionId: this.sessionId, result }
  }

  async listTools() {
    await this.initialize()
    const tools = []
    let cursor
    const seen = new Set()
    for (let page = 0; page < 32; page += 1) {
      const result = await this.post({ jsonrpc: '2.0', id: ++this.requestId, method: 'tools/list', params: cursor ? { cursor } : {} })
      tools.push(...normalizeTools(result?.result?.tools || []))
      const nextCursor = result?.result?.nextCursor
      if (!nextCursor) break
      if (typeof nextCursor !== 'string' || seen.has(nextCursor)) throw new McpClientError(502, 'MCP tools/list returned an invalid cursor.', 'MCP_INVALID_RESPONSE')
      seen.add(nextCursor); cursor = nextCursor
    }
    return normalizeTools(tools)
  }

  async callTool(name, args = {}) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(name)) throw badRequest('MCP tool name is invalid.')
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw badRequest('MCP tool arguments must be an object.')
    try { if (JSON.stringify(args).length > 256 * 1024) throw new Error('too large') } catch { throw badRequest('MCP tool arguments are too large.') }
    const available = normalizeTools(this.connection?.tools || [])
    const allowed = this.connection?.allowedTools === undefined ? new Set(available.map((tool) => tool.name)) : new Set(normalizeToolNames(this.connection.allowedTools))
    if (!allowed.has(name) || (available.length && !available.some((tool) => tool.name === name))) throw forbidden(`MCP tool '${name}' is not permitted.`)
    await this.initialize()
    const result = await this.post({ jsonrpc: '2.0', id: ++this.requestId, method: 'tools/call', params: { name, arguments: args } })
    return result?.result
  }
}

export async function discoverMcpTools(connection, options = {}) {
  const client = new StreamableHttpMcpClient(connection, options)
  const initialized = await client.initialize()
  const tools = await client.listTools()
  const allowedTools = connection.allowedTools === undefined ? tools.map((tool) => tool.name) : normalizeToolNames(connection.allowedTools).filter((name) => tools.some((tool) => tool.name === name))
  return { tools, allowedTools, sessionId: client.sessionId, protocolVersion: initialized.result?.result?.protocolVersion || MCP_PROTOCOL_VERSION }
}

export async function callMcpTool(connection, name, args, options = {}) {
  return new StreamableHttpMcpClient(connection, options).callTool(name, args)
}
