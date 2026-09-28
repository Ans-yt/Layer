import type { McpConnection } from './model'

export interface McpTool { name: string; description: string; inputSchema?: Record<string, unknown> }
export interface McpClientOptions { baseUrl?: string; fetchImpl?: typeof fetch; csrfToken?: string }
export interface McpConnectionResult { tools: McpTool[]; allowedTools?: string[]; sessionId?: string; protocolVersion?: string }
export type McpConnectionConfig = McpConnection & { authToken?: string; authTokenSet?: boolean; allowedTools?: string[]; transport?: 'streamable-http'; allowLocalhost?: boolean; sessionId?: string; protocolVersion?: string }

let csrf: string | undefined

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const toolPattern = /^[A-Za-z0-9_.:-]{1,160}$/

function validConnection(connection: McpConnectionConfig): Record<string, unknown> {
  if (!connection || !idPattern.test(connection.id)) throw new Error('MCP connection id is invalid.')
  if (!connection.url || !/^https?:\/\//i.test(connection.url)) throw new Error('MCP endpoint must be an HTTP(S) URL.')
  const url = new URL(connection.url)
  if (url.username || url.password) throw new Error('MCP endpoint must not contain credentials.')
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase())) throw new Error('MCP HTTP endpoints must use HTTPS unless localhost is allowed by the server.')
  const allowedTools = connection.allowedTools || connection.tools.map((tool) => tool.name).filter((name) => toolPattern.test(name))
  if (!Array.isArray(allowedTools) || allowedTools.length > 512 || allowedTools.some((name) => !toolPattern.test(name))) throw new Error('MCP allowedTools contains an invalid tool name.')
  if (connection.authToken !== undefined && (typeof connection.authToken !== 'string' || connection.authToken.length > 4096)) throw new Error('MCP authToken is invalid.')
  return { id: connection.id, name: connection.name, url: url.toString().replace(/\/$/, ''), enabled: connection.enabled, transport: 'streamable-http', tools: connection.tools, allowedTools, ...(connection.authToken ? { authToken: connection.authToken } : {}) }
}

async function apiFetch(path: string, init: RequestInit = {}, options: McpClientOptions = {}): Promise<Response> {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const base = options.baseUrl || ''
  const method = String(init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (method !== 'GET' && method !== 'HEAD') {
    if (!csrf && !options.csrfToken) { const health = await fetchImpl(`${base}/api/health`, { credentials: 'same-origin' }); if (health.ok) csrf = (await health.json() as { csrfToken?: string }).csrfToken }
    const token = options.csrfToken || csrf
    if (token) headers.set('x-layer-csrf', token)
  }
  return fetchImpl(`${base}${path}`, { ...init, headers, credentials: init.credentials || 'same-origin' })
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { message?: string }
  if (!response.ok) throw new Error(payload.message || `Layer MCP request failed (${response.status}).`)
  return payload as T
}

/** Persist a connection server-side, discover tools using streamable HTTP, and return the safe public record. */
export async function testMcpConnection(connection: McpConnectionConfig, options: McpClientOptions = {}): Promise<McpConnectionResult> {
  const input = validConnection(connection)
  const saved = await jsonOrThrow<{ connection: { id: string } }>(await apiFetch('/api/connections', { method: 'POST', body: JSON.stringify(input) }, options))
  return jsonOrThrow<McpConnectionResult>(await apiFetch(`/api/connections/${encodeURIComponent(saved.connection.id)}/test`, { method: 'POST' }, options))
}

/** Call only a tool present in the server-side discovered/allowed list. */
export async function callMcpTool(connection: McpConnectionConfig, name: string, args: Record<string, unknown> = {}, options: McpClientOptions = {}) {
  if (!toolPattern.test(name)) throw new Error('MCP tool name is invalid.')
  if (!connection.tools.some((tool) => tool.name === name)) throw new Error(`MCP tool '${name}' is not in the permitted tool list.`)
  const payload = validConnection(connection)
  // The UI may call a connection that was restored from local project state.
  // Upsert is idempotent. Restored public project state has no token, so the
  // normal call path never re-sends credentials; an explicitly supplied token
  // is accepted only for the initial server-side save.
  await jsonOrThrow(await apiFetch('/api/connections', { method: 'POST', body: JSON.stringify(payload) }, options))
  return jsonOrThrow<{ result: unknown }>(await apiFetch(`/api/connections/${encodeURIComponent(connection.id)}/call`, { method: 'POST', body: JSON.stringify({ name, arguments: args }) }, options)).then((response) => response.result)
}

export async function listMcpConnections(options: McpClientOptions = {}) { return jsonOrThrow<{ connections: McpConnectionConfig[] }>(await apiFetch('/api/connections', {}, options)) }
export async function saveMcpConnection(connection: McpConnectionConfig, options: McpClientOptions = {}) { return jsonOrThrow<{ connection: McpConnectionConfig }>(await apiFetch('/api/connections', { method: 'POST', body: JSON.stringify(validConnection(connection)) }, options)) }
export async function removeMcpConnection(id: string, options: McpClientOptions = {}) { if (!idPattern.test(id)) throw new Error('MCP connection id is invalid.'); return jsonOrThrow(await apiFetch(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }, options)) }
