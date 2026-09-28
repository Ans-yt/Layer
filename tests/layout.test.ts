import { describe, expect, it } from 'vitest'
import { computeLayout, resolveResponsiveRules } from '../src/lib/layout'
import { makeElement } from '../src/lib/model'
import type { Page } from '../src/lib/model'

const makePage = (elements: ReturnType<typeof makeElement>[]): Page => ({ id: 'p', name: 'Page', width: 600, height: 200, background: '#fff', elements, notes: '', breakpoints: [] })

describe('responsive layout', () => {
  it('lays out a row with padding, gap, fill, and page growth', () => {
    const container = makeElement('frame', { id: 'container', x: 20, y: 10, width: 240, height: 40, layout: { ...makeElement('frame').layout!, mode: 'row', padding: 10, gap: 10 } })
    const first = makeElement('rect', { id: 'first', parentId: 'container', x: 0, y: 0, width: 40, height: 20 })
    const second = makeElement('rect', { id: 'second', parentId: 'container', x: 0, y: 0, width: 40, height: 20, layout: { ...makeElement('rect').layout, mode: 'free', widthRule: 'fill' } })
    const result = computeLayout(makePage([container, first, second]), 600)
    expect(result.rects.first).toMatchObject({ x: 30, y: 20, width: 40, height: 20 })
    expect(result.rects.second?.x).toBe(80)
    expect(result.rects.second?.width).toBe(170)
    expect(result.height).toBeGreaterThanOrEqual(200)
  })

  it('supports column wrapping and grid columns', () => {
    const row = makeElement('frame', { id: 'row', x: 0, y: 0, width: 100, height: 20, layout: { ...makeElement('frame').layout!, mode: 'row', padding: 0, gap: 4, wrap: true } })
    const children = [0, 1, 2].map((index) => makeElement('rect', { id: `r${index}`, parentId: 'row', width: 60, height: 10 }))
    const grid = makeElement('frame', { id: 'grid', x: 0, y: 50, width: 200, height: 20, layout: { ...makeElement('frame').layout!, mode: 'grid', padding: 0, gap: 10, columns: 2 } as never })
    const gridChildren = [0, 1, 2].map((index) => makeElement('rect', { id: `g${index}`, parentId: 'grid', width: 50, height: 20 }))
    const result = computeLayout(makePage([row, ...children, grid, ...gridChildren]), 600)
    expect(result.rects.r1?.y).toBeGreaterThan(result.rects.r0?.y ?? 0)
    expect(result.rects.g1?.x).toBeGreaterThan(result.rects.g0?.x ?? 0)
    expect(result.rects.g2?.y).toBeGreaterThan(result.rects.g0?.y ?? 0)
  })

  it('chooses width-specific responsive overrides', () => {
    const element = makeElement('frame', { layout: { ...makeElement('frame').layout!, mode: 'row', responsive: [{ minWidth: 0, maxWidth: 500, mode: 'column' }, { minWidth: 501, mode: 'row', gap: 32 }] } as never })
    expect(resolveResponsiveRules(element, 390).mode).toBe('column')
    expect(resolveResponsiveRules(element, 900)).toMatchObject({ mode: 'row', gap: 32 })
  })

  it('uses the supplied viewport width as layout space instead of scaling coordinates', () => {
    const page = makePage([makeElement('frame', { id: 'full', x: 0, y: 0, width: 600, height: 40, layout: { ...makeElement('frame').layout!, mode: 'free', widthRule: 'fill' } })])
    const result = computeLayout(page, { width: 320 })
    expect(result.width).toBe(320)
    expect(result.rects.full).toMatchObject({ x: 0, width: 320 })
  })

  it('resolves named page breakpoints in structural overrides', () => {
    const element = makeElement('frame', { layout: { ...makeElement('frame').layout!, mode: 'row' }, responsive: [{ breakpoint: 'Phone', rules: { mode: 'column' } }] } as never)
    const page = { ...makePage([element]), breakpoints: [{ id: 'desktop', name: 'Desktop', width: 900 }, { id: 'phone', name: 'Phone', width: 390 }] }
    expect(resolveResponsiveRules(element, 390, page).mode).toBe('column')
  })
})
