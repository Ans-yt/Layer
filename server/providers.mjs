import { badRequest, HttpError, isPlainObject, parseHttpUrl } from './security.mjs'
import { boundedText, MAX_UPSTREAM_BYTES, safeFetch } from './network.mjs'

export const PROVIDER_KINDS = new Set(['openrouter', 'nvidia', 'anthropic', 'openai', 'custom'])
export const DEFAULT_PROVIDER_ENDPOINTS = Object.freeze({
  openrouter: 'https://openrouter.ai/api/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  custom: 'http://localhost:8787/v1',
})

const DEFAULT_MODELS = Object.freeze({
  openrouter: 'openai/gpt-4o-mini',
  nvidia: 'meta/llama-3.1-8b-instruct',
  anthropic: 'claude-3-5-sonnet-latest',
  openai: 'gpt-4o-mini',
  custom: 'manual-model-id',
})

export function normalizeProviderInput(input, { requireKey = false } = {}) {
  if (!input || typeof input !== 'object') throw badRequest('Provider configuration must be an object.')
  const id = String(input.id || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw badRequest('Provider id is invalid.')
  const kind = String(input.kind || '').toLowerCase()
  if (!PROVIDER_KINDS.has(kind)) throw badRequest(`Unsupported provider kind '${kind}'.`)
  const endpointValue = input.endpoint || DEFAULT_PROVIDER_ENDPOINTS[kind]
  const endpoint = normalizeProviderEndpoint(endpointValue)
  if (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(endpoint.hostname.toLowerCase())) {
    throw badRequest('Provider endpoint must use HTTPS unless it targets localhost.')
  }
  const model = String(input.model || DEFAULT_MODELS[kind]).trim()
  if (!model || model.length > 256 || /\s/.test(model)) throw badRequest('model must be a non-empty model identifier.')
  const keyProvided = Object.prototype.hasOwnProperty.call(input, 'key')
  if (requireKey && !keyProvided && !input.credentialSet) throw badRequest('An API key is required for this provider.')
  if (keyProvided && input.key !== undefined && input.key !== null && (typeof input.key !== 'string' || input.key.length > 8192 || /[\r\n]/.test(input.key))) throw badRequest('key must be a string of at most 8192 characters without newlines.')
  return { id, name: String(input.name || id).slice(0, 160), kind, endpoint: endpoint.toString().replace(/\/$/, ''), model, ...(keyProvided ? { key: input.key } : {}), imageInput: Boolean(input.imageInput), videoInput: Boolean(input.videoInput), manualModel: input.manualModel !== false, advanced: normalizeAdvanced(input.advanced) }
}

export function normalizeAdvanced(value = {}) {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !['maxTokens', 'temperature', 'tokenParameter'].includes(key))) throw badRequest('Advanced overrides support maxTokens, temperature and tokenParameter only.')
  const maxTokens = value.maxTokens ?? 3000
  const temperature = value.temperature === undefined ? 0.2 : value.temperature
  const tokenParameter = value.tokenParameter || 'max_tokens'
  if (!Number.isInteger(maxTokens) || maxTokens < 64 || maxTokens > 16000) throw badRequest('maxTokens must be between 64 and 16000.')
  if (temperature !== null && (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2)) throw badRequest('temperature must be between 0 and 2, or null to omit it.')
  if (!['max_tokens', 'max_completion_tokens'].includes(tokenParameter)) throw badRequest('Invalid tokenParameter override.')
  return { maxTokens, temperature, tokenParameter }
}

const ACTION_SUFFIXES = Object.freeze(['/chat/completions', '/messages', '/models'])

/**
 * Provider settings sometimes contain a full API action URL copied from docs.
 * Normalize those URLs back to an API root before appending an action. This
 * also keeps `/v1/` and `/v1` equivalent without changing the provider path.
 */
export function normalizeProviderEndpoint(value) {
  const endpoint = parseHttpUrl(value, 'endpoint')
  if (endpoint.search) throw badRequest('Provider endpoints cannot contain query parameters. Use the API key field for authentication.')
  let pathname = endpoint.pathname.replace(/\/+$/, '')
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of ACTION_SUFFIXES) {
      if (pathname.toLowerCase().endsWith(suffix)) {
        pathname = pathname.slice(0, -suffix.length).replace(/\/+$/, '')
        changed = true
        break
      }
    }
  }
  endpoint.pathname = pathname || '/'
  return endpoint
}

export function joinEndpoint(endpoint, suffix) {
  const base = normalizeProviderEndpoint(endpoint).toString().replace(/\/$/, '')
  return `${base}/${String(suffix).replace(/^\/+/, '')}`
}

function modelRecord(item) {
  if (typeof item === 'string') return { id: item, name: item }
  const id = item?.id
  return typeof id === 'string' && id ? { id, name: typeof item.name === 'string' ? item.name : id } : null
}

async function readResponse(response) {
  const text = await boundedText(response)
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = null }
  return { text, json }
}

function providerError(response, payload, action, secret, details = {}) {
  // Upstream error bodies may echo Authorization. Report status without
  // copying untrusted provider text into logs or public configuration.
  if (response.status === 404 && action === 'Model request' && details.model) return new HttpError(502, `${details.kind === 'openrouter' ? 'OpenRouter' : 'The provider'} model request was not found (HTTP 404). Check the endpoint and model ID.`, 'UPSTREAM_NOT_FOUND', { status: response.status, model: details.model })
  return new HttpError(502, `${action} failed (HTTP ${response.status}). Check the endpoint, key and model ID.`, 'UPSTREAM_ERROR', { status: response.status })
}

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
}

async function request(fetchImpl, url, options, signal) {
  checkAbort(signal)
  let response
  let allowLocalhost = false
  try { allowLocalhost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname.toLowerCase()) } catch { /* URL validation below reports it */ }
  try { response = await safeFetch(url, { ...options, signal }, { fetchImpl, allowLocalhost }) } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) throw error
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'Unable to reach the provider endpoint.', 'UPSTREAM_UNAVAILABLE')
  }
  const payload = await readResponse(response)
  return { response, payload }
}

async function streamRequest(fetchImpl, url, options, signal) {
  checkAbort(signal)
  let allowLocalhost = false
  try { allowLocalhost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname.toLowerCase()) } catch { /* URL validation below reports it */ }
  let response
  const { secret: _secret, providerModel, providerKind, ...requestOptions } = options
  try { response = await safeFetch(url, { ...requestOptions, signal }, { fetchImpl, allowLocalhost }) } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) throw error
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'Unable to reach the provider endpoint.', 'UPSTREAM_UNAVAILABLE')
  }
  if (!response.ok) {
    const payload = await readResponse(response)
    throw providerError(response, payload, 'Model request', options.secret, { model: providerModel, kind: providerKind })
  }
  return response
}

const streamError = (message, code = 'INVALID_UPSTREAM_RESPONSE', details) => new HttpError(502, message, code, details)

function parseSseBlock(block) {
  let event = 'message'
  const dataLines = []
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  const data = dataLines.join('\n')
  if (!data) return null
  if (data.trim() === '[DONE]') return { event, done: true }
  try { return { event, done: false, data: JSON.parse(data) } } catch { throw streamError('Provider returned malformed streaming data.') }
}

/** Parse an SSE response while distinguishing a clean marker from EOF. */
export async function* sseJson(response, signal, { requireDoneMarker = true, maxBytes = MAX_UPSTREAM_BYTES } = {}) {
  if (!response.body) {
    if (requireDoneMarker) throw streamError('Provider stream returned no body.', 'UPSTREAM_STREAM_TRUNCATED')
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let bytes = 0
  let completed = false
  const consume = function* (block) {
    const parsed = parseSseBlock(block)
    if (!parsed) return
    if (parsed.done) completed = true
    yield parsed
  }
  try {
    while (true) {
      checkAbort(signal)
      let result
      try { result = await reader.read() } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error
        throw streamError('Provider stream was interrupted before completion.', 'UPSTREAM_STREAM_TRUNCATED')
      }
      const { done, value } = result
      if (value) {
        bytes += value.byteLength
        if (bytes > maxBytes) throw streamError('Provider stream exceeds the size limit.', 'UPSTREAM_TOO_LARGE')
      }
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() || ''
      for (const block of blocks) {
        for (const parsed of consume(block)) {
          yield parsed
          if (parsed.done) return
        }
      }
      if (done) break
    }
    if (buffer.trim()) {
      for (const parsed of consume(buffer)) yield parsed
    }
    if (requireDoneMarker && !completed) throw streamError('Provider stream ended before completion.', 'UPSTREAM_STREAM_TRUNCATED')
  } finally { await reader.cancel().catch(() => {}) }
}

function openAiHeaders(key, extra = {}) {
  return { accept: 'application/json', 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}), ...extra }
}

function parseOpenAiCompletion(payload) {
  if (!Array.isArray(payload?.json?.choices)) throw new HttpError(502, 'Provider returned no completion choices.', 'INVALID_UPSTREAM_RESPONSE')
  const choice = payload.json.choices[0]
  if (!choice || typeof choice !== 'object') throw new HttpError(502, 'Provider returned no completion choice.', 'INVALID_UPSTREAM_RESPONSE')
  if (choice.message?.tool_calls && !Array.isArray(choice.message.tool_calls)) throw new HttpError(502, 'Provider returned malformed tool calls.', 'INVALID_UPSTREAM_RESPONSE')
  const toolCalls = (choice.message?.tool_calls || []).map((call) => {
    let argumentsValue = {}
    try { argumentsValue = call.function?.arguments ? JSON.parse(call.function.arguments) : {} } catch { argumentsValue = { __invalid_json: call.function?.arguments } }
    return { id: call.id || `tool_${Date.now()}`, name: call.function?.name, arguments: argumentsValue }
  }).filter((call) => typeof call.name === 'string')
  const text = typeof choice.message?.content === 'string' ? choice.message.content : Array.isArray(choice.message?.content) ? choice.message.content.map((item) => item?.text || '').join('') : ''
  return { text, toolCalls, finishReason: choice.finish_reason, assistantMessage: choice.message, raw: payload.json }
}

function providerStreamError(record, upstreamError) {
  const details = {}
  const upstreamCode = upstreamError && typeof upstreamError === 'object' ? upstreamError.code : undefined
  if ((typeof upstreamCode === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(upstreamCode)) || Number.isInteger(upstreamCode)) details.upstreamCode = upstreamCode
  return streamError(`${record.kind === 'openrouter' ? 'OpenRouter' : 'The provider'} returned an error during streaming. Check the endpoint and model ID.`, 'UPSTREAM_STREAM_ERROR', Object.keys(details).length ? details : undefined)
}

function requireStreamObject(value, message = 'Provider returned malformed streaming data.') {
  if (!isPlainObject(value)) throw streamError(message)
  return value
}

function requireStreamIndex(value, fallback = 0) {
  const index = value === undefined ? fallback : value
  if (!Number.isInteger(index) || index < 0) throw streamError('Provider returned an invalid streaming delta index.')
  return index
}

function parseAnthropicCompletion(payload) {
  if (!Array.isArray(payload?.json?.content)) throw new HttpError(502, 'Anthropic returned no message content.', 'INVALID_UPSTREAM_RESPONSE')
  const content = payload.json.content
  const toolCalls = content.filter((item) => item?.type === 'tool_use' && typeof item.name === 'string').map((item) => ({ id: item.id || `tool_${Date.now()}`, name: item.name, arguments: item.input && typeof item.input === 'object' ? item.input : {} }))
  const text = content.filter((item) => item?.type === 'text').map((item) => item.text || '').join('')
  return { text, toolCalls, finishReason: payload.json?.stop_reason, assistantMessage: { role: 'assistant', content }, raw: payload.json }
}

export class OpenAICompatibleAdapter {
  constructor(record, fetchImpl = globalThis.fetch) {
    this.record = record
    this.kind = record.kind
    this.fetch = fetchImpl
    this.headers = openAiHeaders(record.key, record.kind === 'openrouter' ? { 'http-referer': 'http://localhost:8787', 'x-title': 'Layer' } : {})
  }

  async listModels({ signal } = {}) {
    const { response, payload } = await request(this.fetch, joinEndpoint(this.record.endpoint, 'models'), { method: 'GET', headers: this.headers }, signal)
    if (!response.ok) throw providerError(response, payload, 'Model discovery', this.record.key)
    const list = Array.isArray(payload.json?.data) ? payload.json.data : Array.isArray(payload.json?.models) ? payload.json.models : null
    if (!list) throw new HttpError(502, 'Model discovery returned an invalid model list.', 'INVALID_UPSTREAM_RESPONSE')
    return list.slice(0, 2000).map(modelRecord).filter(Boolean)
  }

  async complete({ messages, tools = [], signal, maxTokens, temperature, responseFormat, system } = {}) {
    const advanced = normalizeAdvanced(this.record.advanced)
    const body = { model: this.record.model, messages: system ? [{ role: 'system', content: system }, ...messages] : messages, [advanced.tokenParameter]: maxTokens ?? advanced.maxTokens }
    const selectedTemperature = temperature === undefined ? advanced.temperature : temperature
    if (selectedTemperature !== null) body.temperature = selectedTemperature
    if (tools.length) body.tools = tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema || { type: 'object', additionalProperties: true } } }))
    if (responseFormat) body.response_format = responseFormat
    const { response, payload } = await request(this.fetch, joinEndpoint(this.record.endpoint, 'chat/completions'), { method: 'POST', headers: this.headers, body: JSON.stringify(body) }, signal)
    if (!response.ok) throw providerError(response, payload, 'Model request', this.record.key, this.record)
    return parseOpenAiCompletion(payload)
  }

  async completeStream({ messages, tools = [], signal, maxTokens, temperature, responseFormat, system, onText } = {}) {
    const advanced = normalizeAdvanced(this.record.advanced)
    const body = { model: this.record.model, messages: system ? [{ role: 'system', content: system }, ...messages] : messages, [advanced.tokenParameter]: maxTokens ?? advanced.maxTokens, stream: true }
    const selectedTemperature = temperature === undefined ? advanced.temperature : temperature
    if (selectedTemperature !== null) body.temperature = selectedTemperature
    if (tools.length) body.tools = tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema || { type: 'object', additionalProperties: true } } }))
    if (responseFormat) body.response_format = responseFormat
    const response = await streamRequest(this.fetch, joinEndpoint(this.record.endpoint, 'chat/completions'), { method: 'POST', headers: this.headers, body: JSON.stringify(body), secret: this.record.key, providerModel: this.record.model, providerKind: this.record.kind }, signal)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/event-stream')) {
      const text = await boundedText(response)
      let json = {}
      try { json = text ? JSON.parse(text) : {} } catch { /* provider returned non-JSON */ }
      if (json.error !== undefined) throw providerStreamError(this.record, json.error)
      const completion = parseOpenAiCompletion({ json })
      if (completion.text) await onText?.(completion.text)
      return completion
    }
    let text = ''
    let finishReason
    const calls = new Map()
    let sawChoice = false
    for await (const frame of sseJson(response, signal)) {
      if (frame.done) continue
      const chunk = requireStreamObject(frame.data)
      if (chunk.error !== undefined) throw providerStreamError(this.record, chunk.error)
      if (!Array.isArray(chunk.choices)) throw streamError('Provider returned an invalid streaming choices field.')
      // Some OpenAI-compatible providers send an empty usage-only chunk.
      if (!chunk.choices.length) continue
      const choice = requireStreamObject(chunk.choices[0], 'Provider returned an invalid streaming choice.')
      sawChoice = true
      if (choice.delta !== undefined && !isPlainObject(choice.delta)) throw streamError('Provider returned an invalid streaming delta.')
      const delta = choice.delta || {}
      if (delta.content !== undefined && typeof delta.content !== 'string') throw streamError('Provider returned a non-text streaming delta.')
      if (typeof delta.content === 'string' && delta.content) { text += delta.content; await onText?.(delta.content) }
      if (choice.finish_reason !== undefined && choice.finish_reason !== null && typeof choice.finish_reason !== 'string') throw streamError('Provider returned an invalid stream finish reason.')
      if (choice.finish_reason) {
        finishReason = choice.finish_reason
        if (choice.finish_reason === 'error') throw providerStreamError(this.record, chunk.error || { code: 'finish_error' })
      }
      if (delta.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) throw streamError('Provider returned an invalid streaming tool call list.')
      for (const call of delta.tool_calls || []) {
        requireStreamObject(call, 'Provider returned an invalid streaming tool call.')
        const index = requireStreamIndex(call.index, calls.size)
        if (call.id !== undefined && typeof call.id !== 'string') throw streamError('Provider returned an invalid streaming tool call ID.')
        if (call.function !== undefined && !isPlainObject(call.function)) throw streamError('Provider returned an invalid streaming tool function.')
        if (call.function?.name !== undefined && typeof call.function.name !== 'string') throw streamError('Provider returned an invalid streaming tool name.')
        if (call.function?.arguments !== undefined && typeof call.function.arguments !== 'string') throw streamError('Provider returned invalid streaming tool arguments.')
        const current = calls.get(index) || { id: call.id || `tool_${Date.now()}_${index}`, name: '', arguments: '' }
        if (call.id) current.id = call.id
        if (call.function?.name) current.name += call.function.name
        if (call.function?.arguments) current.arguments += call.function.arguments
        calls.set(index, current)
      }
    }
    if (!sawChoice) throw streamError('Provider returned no completion choices.')
    const toolCalls = [...calls.values()].map((call) => { let argumentsValue = {}; try { argumentsValue = call.arguments ? JSON.parse(call.arguments) : {} } catch { argumentsValue = { __invalid_json: call.arguments } }; return { id: call.id, name: call.name, arguments: argumentsValue } }).filter((call) => call.name)
    const assistantToolCalls = [...calls.values()].map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments || '{}' } }))
    return { text, toolCalls, finishReason, assistantMessage: { role: 'assistant', content: text || null, ...(assistantToolCalls.length ? { tool_calls: assistantToolCalls } : {}) }, raw: undefined }
  }
}

export class OpenAIAdapter extends OpenAICompatibleAdapter {}
export class OpenRouterAdapter extends OpenAICompatibleAdapter {}
export class NvidiaAdapter extends OpenAICompatibleAdapter {}
export class CustomOpenAIAdapter extends OpenAICompatibleAdapter {}

export class AnthropicAdapter {
  constructor(record, fetchImpl = globalThis.fetch) {
    this.record = record
    this.kind = record.kind
    this.fetch = fetchImpl
    this.headers = { accept: 'application/json', 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...(record.key ? { 'x-api-key': record.key } : {}) }
  }

  async listModels({ signal } = {}) {
    const { response, payload } = await request(this.fetch, joinEndpoint(this.record.endpoint, 'models'), { method: 'GET', headers: this.headers }, signal)
    if (!response.ok) throw providerError(response, payload, 'Model discovery', this.record.key)
    if (!Array.isArray(payload.json?.data)) throw new HttpError(502, 'Anthropic returned an invalid model list.', 'INVALID_UPSTREAM_RESPONSE')
    return payload.json.data.slice(0, 2000).map(modelRecord).filter(Boolean)
  }

  async complete({ messages, tools = [], signal, maxTokens, temperature, system } = {}) {
    const advanced = normalizeAdvanced(this.record.advanced)
    const body = { model: this.record.model, max_tokens: maxTokens ?? advanced.maxTokens, messages: messages.filter((message) => message.role !== 'system').map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: normalizeAnthropicContent(message.content) })) }
    const selectedTemperature = temperature === undefined ? advanced.temperature : temperature
    if (selectedTemperature !== null) body.temperature = Math.min(1, selectedTemperature)
    if (system) body.system = system
    if (tools.length) body.tools = tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema || { type: 'object', additionalProperties: true } }))
    const { response, payload } = await request(this.fetch, joinEndpoint(this.record.endpoint, 'messages'), { method: 'POST', headers: this.headers, body: JSON.stringify(body) }, signal)
    if (!response.ok) throw providerError(response, payload, 'Model request', this.record.key, this.record)
    return parseAnthropicCompletion(payload)
  }

  async completeStream({ messages, tools = [], signal, maxTokens, temperature, system, onText } = {}) {
    const advanced = normalizeAdvanced(this.record.advanced)
    const body = { model: this.record.model, max_tokens: maxTokens ?? advanced.maxTokens, messages: messages.filter((message) => message.role !== 'system').map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: normalizeAnthropicContent(message.content) })), stream: true }
    const selectedTemperature = temperature === undefined ? advanced.temperature : temperature
    if (selectedTemperature !== null) body.temperature = Math.min(1, selectedTemperature)
    if (system) body.system = system
    if (tools.length) body.tools = tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema || { type: 'object', additionalProperties: true } }))
    const response = await streamRequest(this.fetch, joinEndpoint(this.record.endpoint, 'messages'), { method: 'POST', headers: this.headers, body: JSON.stringify(body), secret: this.record.key }, signal)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/event-stream')) {
      const text = await boundedText(response)
      let json = {}
      try { json = text ? JSON.parse(text) : {} } catch { /* provider returned non-JSON */ }
      if (json.error !== undefined) throw providerStreamError(this.record, json.error)
      const completion = parseAnthropicCompletion({ json })
      if (completion.text) await onText?.(completion.text)
      return completion
    }
    const content = []
    let stopReason
    let sawMessageStop = false
    for await (const frame of sseJson(response, signal, { requireDoneMarker: false })) {
      if (frame.done) { sawMessageStop = true; continue }
      const event = requireStreamObject(frame.data)
      if (event.error !== undefined) throw providerStreamError(this.record, event.error)
      if (typeof event.type !== 'string') throw streamError('Anthropic returned a streaming event without a type.')
      if (event.type === 'content_block_start') {
        const index = requireStreamIndex(event.index, content.length)
        const block = requireStreamObject(event.content_block, 'Anthropic returned an invalid content block.')
        if (typeof block.type !== 'string') throw streamError('Anthropic returned a content block without a type.')
        if (block.text !== undefined && typeof block.text !== 'string') throw streamError('Anthropic returned an invalid text content block.')
        content[index] = { ...block, ...(block.type === 'text' ? { text: block.text || '' } : {}) }
      }
      if (event.type === 'content_block_delta') {
        const index = requireStreamIndex(event.index)
        const delta = requireStreamObject(event.delta, 'Anthropic returned an invalid content delta.')
        if (typeof delta.type !== 'string') throw streamError('Anthropic returned a content delta without a type.')
        const block = content[index] || { type: delta.type === 'input_json_delta' ? 'tool_use' : 'text', text: '' }
        if (delta.type === 'text_delta') {
          if (typeof delta.text !== 'string') throw streamError('Anthropic returned an invalid text delta.')
          block.text = `${block.text || ''}${delta.text}`
          await onText?.(delta.text)
        }
        if (delta.type === 'input_json_delta') {
          if (typeof delta.partial_json !== 'string') throw streamError('Anthropic returned invalid tool input JSON.')
          block._partialJson = `${block._partialJson || ''}${delta.partial_json}`
        }
        content[index] = block
      }
      if (event.type === 'message_delta') {
        if (event.delta !== undefined && !isPlainObject(event.delta)) throw streamError('Anthropic returned an invalid message delta.')
        if (event.delta?.stop_reason !== undefined && event.delta.stop_reason !== null && typeof event.delta.stop_reason !== 'string') throw streamError('Anthropic returned an invalid stop reason.')
        stopReason = event.delta?.stop_reason
      }
      if (event.type === 'message_stop') sawMessageStop = true
    }
    if (!sawMessageStop) throw streamError('Anthropic stream ended before completion.', 'UPSTREAM_STREAM_TRUNCATED')
    if (!content.length) throw streamError('Anthropic returned no message content.')
    const normalized = content.filter(Boolean).map((block) => {
      if (block.type !== 'tool_use') return { type: 'text', text: block.text || '' }
      let input = {}
      try { input = block._partialJson ? JSON.parse(block._partialJson) : block.input || {} } catch { input = {} }
      return { type: 'tool_use', id: block.id || `tool_${Date.now()}`, name: block.name, input }
    })
    const toolCalls = normalized.filter((item) => item.type === 'tool_use' && typeof item.name === 'string').map((item) => ({ id: item.id, name: item.name, arguments: item.input }))
    const text = normalized.filter((item) => item.type === 'text').map((item) => item.text || '').join('')
    return { text, toolCalls, finishReason: stopReason, assistantMessage: { role: 'assistant', content: normalized }, raw: undefined }
  }
}

function normalizeAnthropicContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')
  return content.map((item) => {
    if (item?.type === 'text') return { type: 'text', text: String(item.text || '') }
    if (item?.type === 'image_url') return { type: 'image', source: imageSource(item.image_url?.url) }
    return item
  })
}

function imageSource(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Anthropic image inputs require a data URL or HTTPS URL.', 'UNSUPPORTED_MEDIA')
  if (value.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(value)
    if (!match) throw new HttpError(400, 'Invalid image data URL.', 'UNSUPPORTED_MEDIA')
    return { type: 'base64', media_type: match[1], data: match[2] }
  }
  if (/^https:\/\//i.test(value)) return { type: 'url', url: value }
  throw new HttpError(400, 'Anthropic image inputs require a data URL or HTTPS URL.', 'UNSUPPORTED_MEDIA')
}

export function createProviderAdapter(record, fetchImpl = globalThis.fetch) {
  if (!record || !PROVIDER_KINDS.has(record.kind)) throw badRequest('Unsupported provider configuration.')
  if (record.kind === 'anthropic') return new AnthropicAdapter(record, fetchImpl)
  // These providers share the wire protocol but remain distinct adapters so
  // provider-specific headers and policy can evolve without guessing from an
  // endpoint string.
  if (record.kind === 'openrouter') return new OpenRouterAdapter(record, fetchImpl)
  if (record.kind === 'nvidia') return new NvidiaAdapter(record, fetchImpl)
  if (record.kind === 'openai') return new OpenAIAdapter(record, fetchImpl)
  return new CustomOpenAIAdapter(record, fetchImpl)
}

export async function discoverModels(record, options = {}) {
  const adapter = createProviderAdapter(record, options.fetchImpl)
  try {
    const models = await adapter.listModels({ signal: options.signal })
    const modelListed = models.some((model) => model.id === record.model)
    return {
      models,
      manualFallback: models.length === 0,
      selected: record.model,
      modelListed,
      ...(models.length ? {} : { discoveryMessage: 'No models were listed. Enter a manual model ID and test it.' }),
      ...(models.length && !modelListed ? { discoveryMessage: 'The selected model was not in the public list. Listings are advisory; test the manual model ID directly.' } : {}),
    }
  } catch (error) {
    if (![404, 405, 501].includes(error.details?.status)) throw error
    return { models: [], manualFallback: true, selected: record.model, discoveryMessage: `Model listing is unsupported (HTTP ${error.details.status}). Enter a model ID and test it.` }
  }
}

export async function testProvider(record, options = {}) {
  const result = await discoverModels(record, options)
  const adapter = createProviderAdapter(record, options.fetchImpl)
  const completion = await adapter.complete({ messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: 128, signal: options.signal })
  if (!completion.text.trim()) throw new HttpError(502, 'The selected model returned no text to the test request.', 'INVALID_UPSTREAM_RESPONSE')
  return { ...result, connected: true, testedModel: record.model, testMethod: 'completion' }
}
