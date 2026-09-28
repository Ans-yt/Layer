import { describe, expect, it } from 'vitest'
import { requestAiStream, type AiRequestInput, LayerApiError } from '../src/lib/ai'

const input = { providerId: 'fixture', prompt: 'Say hello', document: { pages: [] }, scope: { type: 'project' } } as AiRequestInput

function sse(body: string, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}

function health(capabilities: unknown = { ai: { completion: true, streaming: true } }) {
  return new Response(JSON.stringify({ ok: true, csrfToken: 'fixture-csrf', capabilities }), { headers: { 'content-type': 'application/json' } })
}

describe('AI stream client contract', () => {
  it('checks the advertised capability, sends CSRF, and returns the final response', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const deltas: string[] = []
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/api/health')) return health()
      expect(init?.headers).toBeInstanceOf(Headers)
      expect((init?.headers as Headers).get('x-layer-csrf')).toBe('fixture-csrf')
      return sse([
        'event: delta\ndata: {"text":"Hel"}\n\n',
        'event: delta\ndata: {"text":"lo"}\n\n',
        'event: done\ndata: {"response":{"text":"Hello","operations":[]}}\n\n',
      ].join(''))
    }
    const result = await requestAiStream(input, (text) => deltas.push(text), { baseUrl: 'https://example.invalid/', fetchImpl })
    expect(deltas).toEqual(['Hel', 'lo'])
    expect(result).toMatchObject({ text: 'Hello', operations: [] })
    expect(calls.map((call) => call.url)).toEqual(['https://example.invalid/api/health', 'https://example.invalid/api/ai/stream'])
  })

  it('preserves structured mid-stream errors without flattening their code', async () => {
    const fetchImpl: typeof fetch = async (url) => String(url).endsWith('/api/health')
      ? health()
      : sse('event: error\ndata: {"error":"UPSTREAM_STREAM_ERROR","code":"UPSTREAM_STREAM_ERROR","message":"Provider stream failed.","details":{"upstreamCode":"provider_failure"}}\n\n')
    await expect(requestAiStream(input, () => {}, { baseUrl: 'https://example.invalid', fetchImpl })).rejects.toMatchObject({
      name: 'LayerApiError', code: 'UPSTREAM_STREAM_ERROR', status: 200,
    })
  })

  it('rejects a truncated or malformed client stream', async () => {
    const truncatedFetch: typeof fetch = async (url) => String(url).endsWith('/api/health')
      ? health()
      : sse('event: delta\ndata: {"text":"partial"}\n\n')
    await expect(requestAiStream(input, () => {}, { baseUrl: 'https://example.invalid', fetchImpl: truncatedFetch })).rejects.toMatchObject({ code: 'AI_STREAM_INCOMPLETE' })

    const invalidFetch: typeof fetch = async (url) => String(url).endsWith('/api/health')
      ? health()
      : sse('event: delta\ndata: {"text":42}\n\n')
    await expect(requestAiStream(input, () => {}, { baseUrl: 'https://example.invalid', fetchImpl: invalidFetch })).rejects.toMatchObject({ code: 'INVALID_AI_STREAM' })
  })

  it('avoids a paid request when health explicitly says streaming is unavailable', async () => {
    const urls: string[] = []
    const fetchImpl: typeof fetch = async (url) => {
      urls.push(String(url))
      return health({ ai: { completion: true, streaming: false } })
    }
    const promise = requestAiStream(input, () => {}, { baseUrl: 'https://example.invalid', fetchImpl })
    await expect(promise).rejects.toEqual(expect.objectContaining<Partial<LayerApiError>>({ code: 'AI_STREAM_UNAVAILABLE', status: 503 }))
    expect(urls).toEqual(['https://example.invalid/api/health'])
  })

  it('diagnoses a stale backend route when old health metadata is missing', async () => {
    const urls: string[] = []
    const fetchImpl: typeof fetch = async (url) => {
      urls.push(String(url))
      if (String(url).endsWith('/api/health')) return new Response(JSON.stringify({ ok: true, version: '1' }), { headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ error: 'NOT_FOUND', message: 'Resource not found.' }), { status: 404, headers: { 'content-type': 'application/json' } })
    }
    await expect(requestAiStream(input, () => {}, { baseUrl: 'https://example.invalid', fetchImpl })).rejects.toMatchObject({ code: 'AI_STREAM_UNAVAILABLE', status: 404 })
    expect(urls).toEqual(['https://example.invalid/api/health', 'https://example.invalid/api/ai/stream'])
  })
})
