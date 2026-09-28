import { describe, expect, it } from 'vitest'
import { cloneSubtrees, deleteElements, groupElements, nestElement, reorderElements, ungroupElements } from '../src/lib/operations'
import { makeElement } from '../src/lib/model'
import type { Page } from '../src/lib/model'
import { getAbsoluteRect } from '../src/lib/geometry'

const makePage = (elements: ReturnType<typeof makeElement>[]): Page => ({ id: 'p', name: 'Page', width: 600, height: 400, background: '#fff', elements, notes: '', breakpoints: [] })

describe('document operations', () => {
  it('groups and ungroups without changing page-global positions', () => {
    const a = makeElement('rect', { id: 'a', x: 40, y: 50, width: 20, height: 20 })
    const b = makeElement('rect', { id: 'b', x: 80, y: 50, width: 20, height: 20 })
    const grouped = groupElements(makePage([a, b]), ['a', 'b'], { groupId: 'g', groupPadding: 4 })
    expect(grouped.elements.find((element) => element.id === 'g')?.type).toBe('group')
    expect(getAbsoluteRect(grouped.elements.find((element) => element.id === 'a')!, grouped)).toMatchObject({ x: 40, y: 50 })
    const ungrouped = ungroupElements(grouped, ['g'])
    expect(ungrouped.elements.find((element) => element.id === 'a')).toMatchObject({ parentId: undefined, x: 40, y: 50 })
  })

  it('clones a subtree and remaps child parents and interaction IDs', () => {
    const parent = makeElement('group', { id: 'parent', x: 10, y: 10 })
    const child = makeElement('button', { id: 'child', parentId: 'parent', interactions: [{ id: 'int', trigger: 'click', action: 'set-state', targetId: 'child', value: 'on' }] })
    const result = cloneSubtrees(makePage([parent, child]), ['parent'], { idFactory: (id) => `${id}-clone` })
    expect(result.selectedIds).toEqual(['parent-clone'])
    expect(result.idMap).toEqual({ parent: 'parent-clone', child: 'child-clone' })
    const clone = result.page.elements.find((element) => element.id === 'child-clone')
    expect(clone?.parentId).toBe('parent-clone')
    expect(clone?.interactions[0].id).not.toBe('int')
    expect(clone?.interactions[0].targetId).toBe('child-clone')
  })

  it('respects locked ancestors and preserves selection order when moving layers', () => {
    const locked = makeElement('group', { id: 'locked', locked: true })
    const child = makeElement('rect', { id: 'child', parentId: 'locked' })
    const unchanged = deleteElements(makePage([locked, child]), ['child'])
    expect(unchanged.elements).toHaveLength(2)
    const reordered = reorderElements(makePage([makeElement('rect', { id: 'a' }), makeElement('rect', { id: 'b' }), makeElement('rect', { id: 'c' })]), ['a', 'b'], 'front')
    expect(reordered.elements.map((element) => element.id)).toEqual(['c', 'a', 'b'])
  })

  it('nests an element without moving its page-global location', () => {
    const parent = makeElement('group', { id: 'parent', x: 100, y: 100 })
    const child = makeElement('rect', { id: 'child', x: 20, y: 30 })
    const nested = nestElement(makePage([parent, child]), 'child', 'parent')
    expect(getAbsoluteRect(nested.elements.find((element) => element.id === 'child')!, nested)).toMatchObject({ x: 20, y: 30 })
  })
})
