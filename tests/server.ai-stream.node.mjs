import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createServer } from '../server/index.mjs'
import { OpenAICompatibleAdapter, joinEndpoint, normalizeProviderEndpoint, testProvider } from '../server/providers.mjs'

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function streamResponse(chunks, status = 200) {
  const encoder = new TextEncoder()
  let index = 0
  const body = new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) { controller.close(); return }
      controller.enqueue(encoder.encode(chunks[index]))
      index += 1
    },
  })
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}

function record(overrides = {}) {
  return {
    id: 'fixture', kind: 'openai', endpoint: 'https://provider.example/v1', model: 'manual-model', key: 'fixture-secret',
    advanced: { maxTokens: 128, temperature: 0, tokenParameter: 'max_tokens' }, ...overrides,
  }
}

test('provider endpoint normalization avoids duplicated action paths', () => {
  assert.equal(normalizeProviderEndpoint('https://openrouter.ai/api/v1/').toString(), 'https://openrouter.ai/api/v1')
  assert.equal(normalizeProviderEndpoint('https://openrouter.ai/api/v1/chat/completions/').toString(), 'https://openrouter.ai/api/v1')
  assert.equal(joinEndpoint('https://openrouter.ai/api/v1/models', 'models'), 'https://openrouter.ai/api/v1/models')
  assert.equal(joinEndpoint('https://openrouter.ai/api/v1/messages/', 'chat/completions'), 'https://openrouter.ai/api/v1/chat/completions')
})

test('a public model list is advisory and does not reject a manually entered model ID', async () => {
  const calls = []
  const result = await testProvider(record(), {
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/models')) return jsonResponse({ data: [{ id: 'catalog-only-model' }] })
      return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] })
    },
  })
  assert.equal(result.connected, true)
  assert.equal(result.modelListed, false)
  assert.match(result.discoveryMessage, /advisory/i)
  assert.equal(calls.some((call) => call.url.endsWith('/chat/completions')), true)
})

test('OpenAI-compatible streaming assembles split SSE frames and requires completion', async () => {
  const deltas = []
  const adapter = new OpenAICompatibleAdapter(record(), async (url) => {
    assert.equal(String(url), 'https://provider.example/v1/chat/completions')
    return streamResponse([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n',
      '\ndata: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ])
  })
  const result = await adapter.completeStream({ messages: [{ role: 'user', content: 'hello' }], onText: async (text) => deltas.push(text) })
  assert.equal(result.text, 'Hello')
  assert.deepEqual(deltas, ['Hel', 'lo'])
})

test('streaming reports upstream errors and invalid deltas without echoing provider text', async () => {
  const errorAdapter = new OpenAICompatibleAdapter(record(), async () => streamResponse([
    'data: {"error":{"code":"provider_failure","message":"fixture-secret should not escape"},"choices":[{"delta":{},"finish_reason":"error"}]}\n\n',
  ]))
  await assert.rejects(errorAdapter.completeStream({ messages: [{ role: 'user', content: 'hello' }] }), (error) => {
    assert.equal(error.code, 'UPSTREAM_STREAM_ERROR')
    assert.equal(error.message.includes('fixture-secret'), false)
    return true
  })

  const invalidAdapter = new OpenAICompatibleAdapter(record(), async () => streamResponse([
    'data: {"choices":[{"delta":{"content":42}}]}\n\n',
    'data: [DONE]\n\n',
  ]))
  await assert.rejects(invalidAdapter.completeStream({ messages: [{ role: 'user', content: 'hello' }] }), (error) => {
    assert.equal(error.code, 'INVALID_UPSTREAM_RESPONSE')
    return true
  })
})

test('streaming treats EOF without the provider completion marker as truncation', async () => {
  const adapter = new OpenAICompatibleAdapter(record(), async () => streamResponse([
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
  ]))
  await assert.rejects(adapter.completeStream({ messages: [{ role: 'user', content: 'hello' }] }), (error) => {
    assert.equal(error.code, 'UPSTREAM_STREAM_TRUNCATED')
    return true
  })
})

test('health advertises streaming and pre-header stream failures stay structured JSON', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'layer-stream-health-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const server = createServer({ port: 0, host: '127.0.0.1', dataDir })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  const health = await (await fetch(`${base}/api/health`)).json()
  assert.equal(health.capabilities.ai.streaming, true)
  assert.equal(health.routes.aiStream, 'POST /api/ai/stream')

  const response = await fetch(`${base}/api/ai/stream`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'missing-provider' }),
  })
  assert.equal(response.status, 404)
  assert.equal(response.headers.get('content-type').includes('application/json'), true)
  assert.deepEqual(await response.json(), { error: 'NOT_FOUND', message: "Provider 'missing-provider' was not found." })
})
