import { describe, expect, it } from 'vitest'
import {
  applyThemeToProject,
  createInitialProject,
  createPage,
  resetPageBackground,
  setPageBackground,
  updateProjectPageBackground,
} from '../src/lib/model'
import { getTheme, getThemeDefaultBackground } from '../src/lib/themes'
import { validateProject } from '../src/lib/validation'

describe('theme palettes and page background provenance', () => {
  it('keeps the pinned Black and Sand palettes exact', () => {
    expect(getTheme('black').palette).toEqual({
      editor: '#101113', panels: '#191A1D', controls: '#222327', hover: '#2C2D32', workspace: '#101113',
      artboard: '#191B20', cards: '#24262D', borders: '#36383E', text: '#F2F1ED', secondary: '#ACAEB7',
      primary: '#F2BB54', onPrimary: '#231907', active: '#3B3222', selection: '#89B9EF',
    })
    expect(getTheme('white').palette).toEqual({
      editor: '#E8E2D7', panels: '#F8F4EB', controls: '#EEE8DC', hover: '#E5DDCF', workspace: '#E6DFD2',
      artboard: '#FFFAF0', cards: '#F1E9DC', borders: '#D4C9B7', text: '#393329', secondary: '#716658',
      primary: '#99492F', onPrimary: '#FFF8F0', active: '#EEDED2', selection: '#AA6848',
    })
  })

  it('creates theme-following pages and moves only those pages on a theme switch', () => {
    const project = createInitialProject()
    expect(project.pages.every((page) => page.background === '#191B20' && page.backgroundProvenance === 'theme')).toBe(true)
    expect(createPage({ theme: 'white' }).background).toBe('#FFFAF0')
    const beforeFill = project.pages[0].elements[0].fill
    const custom = updateProjectPageBackground(project, project.pages[0].id, '#123456')
    const switched = applyThemeToProject(custom, 'white')
    expect(switched.pages[0]).toMatchObject({ background: '#123456', backgroundProvenance: 'custom' })
    expect(switched.pages[1]).toMatchObject({ background: '#FFFAF0', backgroundProvenance: 'theme' })
    expect(switched.pages[0].elements[0].fill).toBe(beforeFill)
  })

  it('supports explicit custom and follow-theme reset actions', () => {
    const project = createInitialProject()
    const customPage = setPageBackground(project.pages[0], '#abcdef')
    expect(customPage.backgroundProvenance).toBe('custom')
    const reset = resetPageBackground(customPage, 'white')
    expect(reset).toMatchObject({ background: getThemeDefaultBackground('white'), backgroundProvenance: 'theme' })
  })

  it('persists provenance and preserves legacy nondefault imported colors', () => {
    const project = createInitialProject()
    const imported = structuredClone(project)
    imported.pages[0].background = '#123456'
    delete imported.pages[0].backgroundProvenance
    const validated = validateProject(imported)
    expect(validated.pages[0]).toMatchObject({ background: '#123456', backgroundProvenance: 'custom' })

    const legacy = structuredClone(project)
    legacy.pages[0].background = '#0b0c0e'
    delete legacy.pages[0].backgroundProvenance
    expect(validateProject(legacy).pages[0].backgroundProvenance).toBe('theme')
  })
})
