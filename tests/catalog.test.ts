import { describe, expect, it } from 'vitest'
import { getIconCollectionLicense, loadIconSvg, searchFonts, searchIcons } from '../src/lib/catalog'

const response = (body: unknown, status = 200, headers: Record<string, string> = { 'content-type': 'application/json' }) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })

describe('real catalog adapters', () => {
  it('normalizes Iconify search results and sanitizes loaded SVG', async () => {
    const calls: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const url = String(input); calls.push(url)
      if (url.includes('/search?')) return response({ icons: ['mdi:arrow-right', 'bad icon', 'lucide:check'] })
      return response('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><path d="M0 0"/></svg>', 200, { 'content-type': 'image/svg+xml' })
    }
    const results = await searchIcons(`unique-icon-${Date.now()}`, { fetcher })
    expect(results.map((item) => item.icon)).toEqual(['mdi:arrow-right', 'lucide:check'])
    const svg = await loadIconSvg('mdi:arrow-right', { fetcher })
    expect(svg).not.toMatch(/script|onload/i)
    expect(calls.length).toBe(2)
  })

  it('resolves collection license metadata and labels real font source', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('/collection?')) return response({ license: { title: 'Apache 2.0', spdx: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' } })
      if (url.startsWith('/api/catalog/fonts')) return response('', 503)
      return response({ familyMetadataList: [{ family: 'Inter', category: 'sans-serif', subsets: ['latin'], license: 'OFL-1.1' }] })
    }
    const license = await getIconCollectionLicense(`unique-license-${Date.now()}`, { fetcher })
    expect(license.spdx).toBe('Apache-2.0')
    const fonts = await searchFonts(`Inter-${Date.now()}`, { fetcher })
    // Query intentionally misses the fixture; an empty result is truthful and
    // proves this adapter does not invent a matching font.
    expect(fonts).toEqual([])
    const exact = await searchFonts('Inter', { fetcher })
    expect(exact[0]).toMatchObject({ family: 'Inter', source: 'google-fonts' })
  })

  it('surfaces catalog failures instead of returning fake-live content', async () => {
    const fetcher: typeof fetch = async () => response('', 503)
    await expect(searchFonts('anything', { fetcher, cacheTtlMs: 0 })).rejects.toThrow(/catalog|503/i)
  })
})
