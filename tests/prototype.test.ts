import { describe, expect, it } from 'vitest'
import { buildPrototypeHtml } from '../src/lib/prototypeExport'
import { createInitialProject, makeElement } from '../src/lib/model'
import { sanitizePrototypeUrl } from '../src/components/Prototype'

describe('shared prototype renderer contracts', () => {
  it('sanitizes image and external URLs including encoded SVG data', () => {
    expect(sanitizePrototypeUrl('javascript:alert(1)', 'external')).toBeUndefined()
    expect(sanitizePrototypeUrl('data:image/svg+xml,%3Csvg%3E%3Cscript%3Ebad%3C%2Fscript%3E%3C%2Fsvg%3E', 'image')).toBeUndefined()
    expect(sanitizePrototypeUrl('data:image/svg+xml,%3Csvg%3E%3Ccircle%20r%3D%225%22%2F%3E%3C%2Fsvg%3E', 'image')).toContain('data:image/svg+xml')
    expect(sanitizePrototypeUrl('../assets/hero.webp', 'image')).toBe('../assets/hero.webp')
  })

  it('embeds escaped project data and references the bundled runtime', () => {
    const project = structuredClone(createInitialProject())
    project.name = '</title><script>alert("xss")</script>'
    project.providers[0].model = 'private-model'
    project.pages[0].elements.push(makeElement('line', { id: 'curve', curve: { x1: 20, y1: 4, x2: 60, y2: 40 }, src: 'javascript:bad' }))
    const html = buildPrototypeHtml(project)
    expect(html).toContain('preview-runtime.js')
    expect(html).toContain('layer-project')
    expect(html).not.toContain('<script>alert("xss")</script>')
    expect(html).not.toContain('private-model')
    expect(html).toContain('curve')
  })

  it('supports an inline runtime for a single file:// handoff', () => {
    const html = buildPrototypeHtml(createInitialProject(), { runtimeCode: 'window.LayerPreviewRuntime={mount:function(){}}' })
    expect(html).toContain('window.LayerPreviewRuntime={mount:function(){}}')
    expect(html).not.toContain('<script src="preview-runtime.js"')
  })
})
