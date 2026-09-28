import { describe, expect, it } from 'vitest'
import { createInitialProject } from '../src/lib/model'
import { ProjectValidationError, sanitizeSvgMarkup, validateProject } from '../src/lib/validation'

const validProject = () => structuredClone(createInitialProject())

describe('Layer project validation', () => {
  it('accepts the model fixture and returns a clean clone', () => {
    const project = validProject()
    const validated = validateProject(project)
    expect(validated).not.toBe(project)
    expect(validated.pages).toHaveLength(project.pages.length)
  })

  it('rejects non-finite dimensions and invalid references', () => {
    const project = validProject()
    project.pages[0].width = Number.POSITIVE_INFINITY
    project.pages[0].elements[0].interactions = [{ id: 'int_safe', trigger: 'click', action: 'navigate', pageId: 'missing-page' }]
    expect(() => validateProject(project)).toThrow(ProjectValidationError)
    try { validateProject(project) } catch (error) {
      expect(error).toBeInstanceOf(ProjectValidationError)
      expect((error as ProjectValidationError).issues.some((issue) => issue.path.includes('width'))).toBe(true)
      expect((error as ProjectValidationError).issues.some((issue) => issue.path.includes('pageId'))).toBe(true)
    }
  })

  it('rejects parent cycles and unsafe executable URLs', () => {
    const project = validProject()
    const page = project.pages[0]
    page.elements[0].parentId = page.elements[1].id
    page.elements[1].parentId = page.elements[0].id
    page.elements[2].src = 'javascript:alert(1)'
    expect(() => validateProject(project)).toThrow(/unsafe|cycle|URL/i)
  })

  it('sanitizes SVG event handlers and scripts', () => {
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><path d="M0 0"/></a></svg>'
    const clean = sanitizeSvgMarkup(dirty)
    expect(clean).not.toMatch(/script|onload|javascript:/i)
    expect(clean).toMatch(/<svg/i)
  })

  it('rejects prototype-pollution keys', () => {
    const project = validProject() as unknown as Record<string, unknown>
    project.__proto__ = { polluted: true }
    expect(() => validateProject(project)).toThrow(/forbidden|validation/i)
  })
})
