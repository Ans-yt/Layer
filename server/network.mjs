import http from 'node:http'
import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { HttpError, isLocalhostHostname, parseHttpUrl } from './security.mjs'

export const MAX_UPSTREAM_BYTES = 8 * 1024 * 1024

export function isPublicAddress(address) {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 0 || b === 168) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0)
  }
  if (isIP(value) === 6) {
    // Only globally routable unicast IPv6. This excludes loopback, mapped
    // IPv4, private, link-local, multicast and transition-address bypasses.
    return /^[23][0-9a-f]{3}:/.test(value) && !value.startsWith('2002:') && !value.startsWith('2001:0:') && !value.startsWith('2001:db8:')
  }
  return false
}

function loopbackAddress(value) { return value === '::1' || /^127\./.test(value) }

export function validateNetworkUrl(value, { allowLocalhost = false } = {}) {
  const url = parseHttpUrl(String(value), 'endpoint', { allowLocalhost })
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const local = isLocalhostHostname(hostname) || (isIP(hostname) === 4 && /^127\./.test(hostname))
  if (local && !allowLocalhost) throw new HttpError(403, 'Localhost access must be explicitly enabled.', 'LOCALHOST_NOT_ALLOWED')
  if (url.protocol !== 'https:' && !(local && allowLocalhost)) throw new HttpError(400, 'Remote endpoints must use HTTPS.', 'INSECURE_ENDPOINT')
  if (isIP(hostname) && !isPublicAddress(hostname) && !(allowLocalhost && loopbackAddress(hostname))) throw new HttpError(403, 'Private and reserved network addresses are not allowed.', 'PRIVATE_ENDPOINT')
  if (url.hash) throw new HttpError(400, 'Endpoint fragments are not supported.', 'BAD_ENDPOINT')
  return url
}

/** Resolve and pin an address for each request; redirects are never followed. */
export async function safeFetch(value, init = {}, { allowLocalhost = false, fetchImpl = globalThis.fetch } = {}) {
  const url = validateNetworkUrl(value, { allowLocalhost })
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000)
  signal.throwIfAborted()
  if (fetchImpl !== globalThis.fetch) return fetchImpl(url.toString(), { ...init, signal, redirect: 'error' })
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  let addresses
  try { addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true }) } catch {
    throw new HttpError(502, 'Endpoint DNS resolution failed.', 'UPSTREAM_UNAVAILABLE')
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address) && !(allowLocalhost && isLocalhostHostname(hostname) && loopbackAddress(address)))) {
    throw new HttpError(403, 'Endpoint resolves to a private or reserved network address.', 'PRIVATE_ENDPOINT')
  }
  const pinned = addresses[0]
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http
    const request = transport.request(url, {
      method: init.method || 'GET', headers: init.headers, signal,
      // Keep original hostname for Host/SNI/TLS while pinning the verified IP.
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
    }, (response) => {
      const status = response.statusCode || 502
      if (status >= 300 && status < 400) { response.destroy(); reject(new HttpError(502, 'Endpoint redirects are refused. Configure the final URL.', 'UPSTREAM_REDIRECT')); return }
      const headers = new Headers()
      for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      if ([204, 205, 304].includes(status)) { response.resume(); resolve(new Response(null, { status, headers })); return }
      resolve(new Response(Readable.toWeb(response), { status, headers }))
    })
    request.once('error', (error) => reject(signal.aborted ? signal.reason : new HttpError(502, 'Unable to reach the configured endpoint.', 'UPSTREAM_UNAVAILABLE')))
    if (init.body) request.write(init.body)
    request.end()
  })
}

export async function boundedText(response, maxBytes = MAX_UPSTREAM_BYTES) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''; let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      bytes += value.byteLength
      if (bytes > maxBytes) throw new HttpError(502, 'Endpoint response exceeds the size limit.', 'UPSTREAM_TOO_LARGE')
      text += decoder.decode(value, { stream: true })
    }
  } finally { await reader.cancel().catch(() => {}) }
}
