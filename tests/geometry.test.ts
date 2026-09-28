import { describe, expect, it } from 'vitest'
import { cornerRadiusFromPoint, getAbsoluteRect, getSelectionBounds, resizeRect, resizeRotatedRect, snapMove, snapResizeRect } from '../src/lib/geometry'
import type { Page } from '../src/lib/model'

const element = (id: string, x: number, y: number, width: number, height: number, parentId?: string) => ({
  id, type: 'rect' as const, name: id, parentId, x, y, width, height, rotation: 0, opacity: 1, visible: true, locked: false,
  fill: '#000', stroke: 'transparent', strokeWidth: 0, radius: 0, corners: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }, interactions: [],
})

const page = (elements: ReturnType<typeof element>[]): Page => ({ id: 'p', name: 'Page', width: 800, height: 600, background: '#fff', elements, notes: '', breakpoints: [] })

describe('geometry', () => {
  it('resolves nested local coordinates and selection bounds', () => {
    const parent = element('parent', 100, 80, 300, 200)
    const child = element('child', 20, 30, 40, 50, 'parent')
    const document = page([parent, child])
    expect(getAbsoluteRect(child, document)).toEqual({ x: 120, y: 110, width: 40, height: 50 })
    expect(getSelectionBounds([child], document)).toEqual({ x: 120, y: 110, width: 40, height: 50 })
  })

  it('snaps deterministically to another edge without snapping to a moving subtree', () => {
    const moving = element('moving', 100, 100, 50, 50)
    const stationary = element('stationary', 158, 300, 60, 40)
    const document = page([moving, stationary])
    const result = snapMove({ x: 103, y: 100, width: 50, height: 50 }, document, { movingIds: ['moving'], tolerance: 5 })
    expect(result.rect.x).toBe(108)
    expect(result.guides.some((guide) => guide.sourceId === 'moving')).toBe(false)
    expect(result.guides[0]?.position).toBe(158)
  })

  it('matches a stationary size while resizing and keeps the opposite edge fixed', () => {
    const moving = element('moving', 100, 100, 80, 40)
    const stationary = element('stationary', 300, 100, 100, 30)
    const document = page([moving, stationary])
    const result = snapResizeRect({ x: 100, y: 100, width: 97, height: 40 }, { x: 100, y: 100, width: 80, height: 40 }, 'e', document, { movingIds: ['moving'], tolerance: 5 })
    expect(result.rect.width).toBe(100)
    expect(result.rect.x).toBe(100)
    expect(result.guides.some((guide) => guide.kind === 'size' && guide.sourceId === 'stationary')).toBe(true)
  })

  it('resizes from a corner with aspect locking', () => {
    expect(resizeRect({ x: 10, y: 20, width: 100, height: 50 }, 'se', 50, 5, { preserveAspect: true })).toEqual({ x: 10, y: 20, width: 150, height: 75 })
  })

  it('uses local axes for rotated resize and radial distance for every corner', () => {
    const resized = resizeRotatedRect({ x: 100, y: 100, width: 100, height: 50 }, 90, 'e', 0, 20)
    expect(resized.width).toBeCloseTo(120)
    expect(resized.height).toBe(50)
    expect(cornerRadiusFromPoint({ x: 10, y: 20, width: 100, height: 60 }, 'topLeft', { x: 30, y: 40 })).toBeCloseTo(Math.sqrt(800))
    expect(cornerRadiusFromPoint({ x: 10, y: 20, width: 100, height: 60 }, 'topRight', { x: 90, y: 40 })).toBeCloseTo(Math.sqrt(800))
    expect(cornerRadiusFromPoint({ x: 10, y: 20, width: 100, height: 60 }, 'bottomRight', { x: 90, y: 60 })).toBeCloseTo(Math.sqrt(800))
    expect(cornerRadiusFromPoint({ x: 10, y: 20, width: 100, height: 60 }, 'bottomLeft', { x: 30, y: 60 })).toBeCloseTo(Math.sqrt(800))
  })
})
