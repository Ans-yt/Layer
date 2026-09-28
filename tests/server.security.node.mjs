import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createServer } from '../server/index.mjs'
import { runAi } from '../server/ai.mjs'
import { applyOperations, validateOperations } from '../server/operations.mjs'
import { safeFetch, validateNetworkUrl } from '../server/network.mjs'
import { decryptSecret, encryptSecret } from '../server/security.mjs'
import { AnthropicAdapter, discoverModels, testProvider } from '../server/providers.mjs'
import { ProjectStore } from '../server/projects.mjs'

function fixtureProject() {
  return {
    id: 'project', name: 'Fixture', updatedAt: new Date().toISOString(), activePageId: 'page-a', pages: [{ id: 'page-a', name: 'Home', width: 800, height: 600, background: '#fff', notes: '', breakpoints: [], elements: [
      { id: 'hero', type: 'frame', name: 'Hero', x: 0, y: 0, width: 300, height: 200, rotation: 0, opacity: 1, visible: true, locked: false, fill: '#111', stroke: 'none', strokeWidth: 0, radius: 0, corners: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }, interactions: [] },
      { id: 'title', type: 'text', name: 'Title', parentId: 'hero', x: 10, y: 10, width: 100, height: 30, rotation: 0, opacity: 1, visible: true, locked: false, fill: 'transparent', stroke: 'none', strokeWidth: 0, radius: 0, corners: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }, interactions: [], text: 'Hello' },
    ] }], styles: [], components: [], assets: [], integrations: [], providers: [], skills: [], commands: [], connections: [], versions: [], settings: {},
  }
}

function jsonResponse(value, status = 200, headers = {}) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } }) }

test('operation validation is scoped, lock-aware, field-limited, and atomic', () => {
  const project = fixtureProject()
  const rejected = validateOperations(project, [{ op: 'update', id: 'title', pageId: 'page-a', patch: { text: 'Changed', disallowed: true } }], { type: 'selection', pageId: 'page-a', ids: ['title'] })
  assert.equal(rejected.ok, false)
  assert.equal(project.pages[0].elements[1].text, 'Hello')

  project.pages[0].elements[0].locked = true
  assert.equal(validateOperations(project, [{ op: 'update', id: 'title', patch: { text: 'Nope' } }], { type: 'page', pageId: 'page-a' }).ok, false)
  project.pages[0].elements[0].locked = false
  assert.throws(() => applyOperations(project, [{ op: 'update', id: 'title', pageId: 'page-a', patch: { text: 'Changed' } }, { op: 'delete', id: 'does-not-exist', pageId: 'page-a' }], { type: 'page', pageId: 'page-a' }))
})

test('operation application leaves the input project untouched and applies valid batches', () => {
  const project = fixtureProject()
  const result = applyOperations(project, [{ op: 'update', id: 'title', pageId: 'page-a', patch: { text: 'Changed', fontSize: 24 } }, { op: 'create', pageId: 'page-a', element: { id: 'cta', type: 'button', name: 'CTA', x: 20, y: 60, width: 100, height: 40 } }], { type: 'page', pageId: 'page-a' })
  assert.equal(project.pages[0].elements.length, 2)
  assert.equal(result.document.pages[0].elements.length, 3)
  assert.equal(result.document.pages[0].elements.find((item) => item.id === 'title').text, 'Changed')
})

test('AES-GCM encrypts and decrypts secrets', () => {
  const key = Buffer.alloc(32, 7)
  const encrypted = encryptSecret('super-secret', key)
  assert.ok(encrypted.startsWith('v1.'))
  assert.notEqual(encrypted, 'super-secret')
  assert.equal(decryptSecret(encrypted, key), 'super-secret')
  assert.throws(() => decryptSecret(encrypted, Buffer.alloc(32, 8)))
})

test('upstream networking refuses localhost/private targets unless explicitly enabled', async () => {
  assert.throws(() => validateNetworkUrl('http://127.0.0.1:8787'))
  await assert.rejects(safeFetch('http://127.0.0.1:8787', {}, { fetchImpl: async () => jsonResponse({ ok: true }) }))
  assert.equal(validateNetworkUrl('http://127.0.0.1:8787', { allowLocalhost: true }).hostname, '127.0.0.1')
})

test('HTTP service protects origins, stores encrypted credentials, and exposes model fallback', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'layer-server-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const providerCalls = []
  const mcpCalls = []
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url)
    providerCalls.push({ url: parsed.toString(), init })
    if (parsed.pathname.endsWith('/models')) return jsonResponse({ data: [{ id: 'fixture-model' }] })
    if (parsed.pathname.endsWith('/chat/completions')) return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'fixture response' }, finish_reason: 'stop' }] })
    if (parsed.pathname === '/mcp') {
      mcpCalls.push({ url: parsed.toString(), init })
      const message = JSON.parse(init.body)
      if (message.method === 'initialize') return jsonResponse({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-03-26', capabilities: {} } }, 200, { 'mcp-session-id': 'fixture-session' })
      if (message.method === 'notifications/initialized') return new Response('', { status: 202 })
      if (message.method === 'tools/list') {
        const payload = { jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'echo', description: 'Echo fixture', inputSchema: { type: 'object' } }] } }
        return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'fixture-session' } })
      }
      if (message.method === 'tools/call') return jsonResponse({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'echoed' }] } }, 200, { 'mcp-session-id': 'fixture-session' })
    }
    return jsonResponse({ error: { message: 'fixture route not found' } }, 404)
  }
  const server = createServer({ port: 0, host: '127.0.0.1', dataDir, allowLocalhostMcp: true, fetchImpl })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`
  const get = (route, init) => fetch(`${base}${route}`, init)
  const postJson = (route, body, init = {}) => get(route, { ...init, method: 'POST', headers: { 'content-type': 'application/json', ...(init.headers || {}) }, body: JSON.stringify(body) })

  const health = await (await get('/api/health')).json()
  assert.equal(health.ok, true)
  assert.equal(health.dataDir, undefined)
  assert.equal((await get('/api/providers', { headers: { origin: 'https://evil.example' } })).status, 403)
  assert.equal((await postJson('/api/providers', { id: 'x', kind: 'openai', endpoint: 'https://provider.example/v1', model: 'fixture', key: 'super-secret' }, { headers: { origin: 'http://localhost:5173' } })).status, 403)
  const created = await postJson('/api/providers', { id: 'x', kind: 'openai', endpoint: 'https://provider.example/v1', model: 'fixture', key: 'super-secret' })
  assert.equal(created.status, 200)
  const publicProviders = await (await get('/api/providers')).json()
  assert.equal(publicProviders.providers[0].key, undefined)
  assert.equal(publicProviders.providers[0].credentialSet, true)
  const stored = await readFile(path.join(dataDir, 'providers.json'), 'utf8')
  assert.equal(stored.includes('super-secret'), false)
  assert.equal(stored.includes('keyEncrypted'), true)
  const discovered = await postJson('/api/providers/x/models', {})
  assert.equal(discovered.status, 200)
  assert.equal((await discovered.json()).models[0].id, 'fixture-model')

  const connection = await postJson('/api/connections', { id: 'mcp-fixture', name: 'Fixture', url: 'http://localhost/mcp', enabled: true, authToken: 'mcp-secret' })
  assert.equal(connection.status, 200)
  const tested = await postJson('/api/connections/mcp-fixture/test', {})
  assert.equal(tested.status, 200)
  assert.equal((await tested.json()).tools[0].name, 'echo')
  const publicConnections = await (await get('/api/connections')).json()
  assert.equal(publicConnections.connections[0].authToken, undefined)
  const storedConnections = await readFile(path.join(dataDir, 'connections.json'), 'utf8')
  assert.equal(storedConnections.includes('mcp-secret'), false)
  const called = await postJson('/api/connections/mcp-fixture/call', { name: 'echo', arguments: { value: 'ok' } })
  assert.equal(called.status, 200)
  const callRequest = mcpCalls.find(({ init }) => JSON.parse(init.body).method === 'tools/call')
  assert.equal(Boolean(callRequest), true)
  assert.equal(callRequest.init.headers.authorization, 'Bearer mcp-secret')
  assert.equal(callRequest.init.headers['mcp-session-id'], 'fixture-session')
  assert.equal((await postJson('/api/connections/mcp-fixture/call', { name: 'not-allowed', arguments: {} })).status, 403)
  assert.ok(providerCalls.length > 0)

  const persisted = await postJson('/api/projects', { project: fixtureProject() })
  assert.equal(persisted.status, 200)
  const snapshot = await postJson('/api/projects/project/snapshots', { name: 'Fixture snapshot' })
  assert.equal(snapshot.status, 200)
  const projectRead = await get('/api/projects/project')
  assert.equal(projectRead.status, 200)
  const share = await postJson('/api/shares', { projectId: 'project' })
  assert.equal(share.status, 200)
  const sharePayload = await share.json()
  const shared = await get(`/api/shares/${sharePayload.token}`)
  assert.equal(shared.status, 200)
  assert.deepEqual((await shared.json()).project.providers, [])
})

test('AI runner uses provider tool calls and returns only validated operations', async () => {
  let turn = 0
  const provider = {
    kind: 'openai',
    async complete() {
      turn += 1
      if (turn === 1) return { text: '', toolCalls: [{ id: 'call-1', name: 'layer_apply_operations', arguments: { operations: [{ op: 'update', id: 'title', pageId: 'page-a', patch: { text: 'Model edit' } }] } }], assistantMessage: { role: 'assistant', content: '', tool_calls: [] } }
      return { text: 'Edit prepared for review.', toolCalls: [], assistantMessage: { role: 'assistant', content: 'Edit prepared for review.' } }
    },
  }
  const result = await runAi({ provider, prompt: 'Change the title', document: fixtureProject(), scope: { type: 'page', pageId: 'page-a' } })
  assert.equal(result.operations.length, 1)
  assert.equal(result.operations[0].patch.text, 'Model edit')
  assert.equal(result.rounds, 2)
})

test('Anthropic adapter sends native tools and vision content', async () => {
  const requests = []
  const adapter = new AnthropicAdapter({ kind: 'anthropic', endpoint: 'https://api.anthropic.example/v1', model: 'claude-test', key: 'anthropic-secret', advanced: { maxTokens: 400, temperature: 0, tokenParameter: 'max_tokens' } }, async (url, init) => {
    requests.push({ url, init })
    return jsonResponse({ content: [{ type: 'tool_use', id: 'tool-1', name: 'layer_apply_operations', input: { operations: [] } }], stop_reason: 'tool_use' })
  })
  const result = await adapter.complete({ system: 'system', messages: [{ role: 'user', content: [{ type: 'text', text: 'Inspect' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }], tools: [{ name: 'layer_apply_operations', description: 'edit', inputSchema: { type: 'object' } }] })
  const body = JSON.parse(requests[0].init.body)
  assert.equal(requests[0].url, 'https://api.anthropic.example/v1/messages')
  assert.equal(body.system, 'system')
  assert.equal(body.tools[0].name, 'layer_apply_operations')
  assert.equal(body.messages[0].content[1].source.type, 'base64')
  assert.equal(result.toolCalls[0].name, 'layer_apply_operations')
  assert.equal(requests[0].init.headers['x-api-key'], 'anthropic-secret')
})

test('provider discovery falls back on 404 but testProvider performs real completion', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (String(url).endsWith('/models')) return jsonResponse({ error: { message: 'not implemented' } }, 404)
    return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] })
  }
  const record = { id: 'fallback', kind: 'openai', endpoint: 'https://provider.example/v1', model: 'manual-model', key: 'provider-secret', advanced: { maxTokens: 128, temperature: 0, tokenParameter: 'max_tokens' } }
  const result = await testProvider(record, { fetchImpl })
  assert.equal(result.manualFallback, true)
  assert.equal(result.testMethod, 'completion')
  assert.equal(calls.some((call) => String(call.url).endsWith('/chat/completions')), true)
  assert.equal(JSON.parse(calls.at(-1).init.body).messages[0].content, 'Reply with OK.')
})

test('provider failures stay explicit without echoing upstream bodies', async () => {
  await assert.rejects(testProvider({ id: 'broken', kind: 'openai', endpoint: 'https://provider.example/v1', model: 'broken', key: 'secret-key' }, { fetchImpl: async () => jsonResponse({ error: { message: 'secret-key leaked body' } }, 500) }), (error) => {
    assert.equal(error.code, 'UPSTREAM_ERROR')
    assert.equal(error.message.includes('secret-key'), false)
    return true
  })
})

test('durable projects and shares exclude credentials and are immutable snapshots', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'layer-projects-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const store = new ProjectStore({ dataDir })
  const project = fixtureProject()
  project.providers = [{ id: 'p', endpoint: 'https://provider.example', key: 'secret', name: 'Provider' }]
  project.connections = [{ id: 'c', url: 'https://mcp.example', authToken: 'token', name: 'MCP', enabled: true, status: 'connected', tools: [] }]
  const saved = await store.put(project)
  assert.equal(JSON.stringify(saved).includes('secret'), false)
  assert.equal(JSON.stringify(saved).includes('token'), false)
  const share = await store.createShare(saved)
  const snapshot = await store.getShare(share.token)
  assert.deepEqual(snapshot.project.pages, saved.pages)
  assert.deepEqual(snapshot.project.providers, [])
  assert.deepEqual(snapshot.project.connections, [])
  saved.pages[0].elements[0].name = 'changed after share'
  const storedShare = await store.getShare(share.token)
  assert.equal(storedShare.project.pages[0].elements[0].name, 'Hero')
})
