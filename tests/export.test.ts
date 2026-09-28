import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { createInitialProject } from '../src/lib/model'
import { exportProjectPackage, readLayerFile } from '../src/lib/storage'

describe('Layer export/import package', () => {
  it('round-trips assets and produces a runnable multi-page package without private data', async () => {
    const project = structuredClone(createInitialProject())
    project.name = '</title><script>alert("xss")</script>'
    project.providers[0].model = 'private-provider-secret'
    project.settings.mainPrompt = 'private custom prompt should not ship'
    ;(project.settings as typeof project.settings & { promptVersions?: Array<{ mainPrompt: string }> }).promptVersions = [{ mainPrompt: 'private prompt version secret' }]
    project.connections = [{ id: 'mcp_export', name: 'private', url: 'https://private.invalid/mcp', enabled: true, status: 'connected', tools: [{ name: 'secret', description: 'secret' }] }]
    project.assets.push({ id: 'asset_svg_export', name: 'Safe icon', kind: 'icon', src: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E%3Ccircle%20cx%3D%225%22%20cy%3D%225%22%20r%3D%225%22%2F%3E%3C%2Fsvg%3E', source: 'test', license: 'MIT', installedAt: new Date().toISOString() })
    const archive = await exportProjectPackage(project, { download: false, screenshots: [{ dataUrl: 'data:image/png;base64,aGVsbG8=', label: 'hero', pageId: project.pages[0].id, documentVersionId: 'v1' }] })
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()))
    const names = Object.keys(files)
    expect(names).toEqual(expect.arrayContaining(['design.layer.json', 'brief.md', 'schema.json', 'LICENSES.md', 'assets/manifest.json', 'preview/index.html', 'screenshots/manifest.json']))
    const designText = new TextDecoder().decode(files['design.layer.json'])
    const design = JSON.parse(designText) as { project: typeof project }
    expect(design.project.providers).toEqual([])
    expect(design.project.connections).toEqual([])
    expect(design.project.settings.mainPrompt).toBe('')
    expect(designText).not.toContain('private-provider-secret')
    expect(designText).not.toContain('private prompt version secret')
    expect(new TextDecoder().decode(files['preview/index.html'])).not.toContain('<script>alert("xss")</script>')
    expect(names.some((name) => name.startsWith('assets/asset_svg_export.'))).toBe(true)
    expect(names.some((name) => name.startsWith('screenshots/hero.'))).toBe(true)

    const imported = await readLayerFile(archive)
    const importedAsset = imported.assets.find((asset) => asset.id === 'asset_svg_export')
    expect(importedAsset?.src).toMatch(/^data:image\/svg\+xml/)
    expect(importedAsset?.src).not.toMatch(/script|javascript/i)
    expect(imported.pages).toHaveLength(project.pages.length)
  })

  it('rejects raw imports with oversized or malformed structure', async () => {
    const tooLarge = new Blob([JSON.stringify({ project: { pages: [{ elements: [], width: 1, height: 1, id: 'p', name: 'p', background: '#fff', notes: '', breakpoints: [] }], settings: {} } })])
    await expect(readLayerFile(tooLarge)).rejects.toThrow()
  })
})
