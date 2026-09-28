// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Canvas, type CanvasProps } from '../src/components/Canvas'
import { Prototype } from '../src/components/Prototype'
import { createInitialProject, makeElement, type DesignElement } from '../src/lib/model'
import { SHAPE_OPTIONS, preserveSnappedAspect } from '../src/lib/shapes'
import { snapResizeRect } from '../src/lib/geometry'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function props(elements: DesignElement[]): CanvasProps {
  const project = createInitialProject()
  return { page: { ...project.pages[0], elements }, view: { ...project.view, mode: 'design', zoom: 1, panX: 0, panY: 0 }, settings: project.settings, selectedIds: elements.map((element) => element.id), activeTool: 'select', previewState: {}, selectionRect: null, onSelect: vi.fn(), onClearSelection: vi.fn(), onSelectionRect: vi.fn(), onSetSelectionRect: vi.fn(), onContextMenu: vi.fn(), onTransformStart: vi.fn(), onTransform: vi.fn(), onTransformEnd: vi.fn(), onPreviewAction: vi.fn(), onPan: vi.fn() }
}
function render(elements: DesignElement[], preview = false) {
  const settings = props(elements)
  const root = document.createElement('div')
  root.innerHTML = renderToStaticMarkup(preview ? <Prototype page={settings.page} /> : <Canvas {...settings} />)
  return root
}
const node = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-element-id="${id}"], [data-prototype-id="${id}"]`)!

describe('shape and image rendering', () => {
  for (const preview of [false, true]) {
    const mode = preview ? 'preview/export' : 'editor'
    it(`${mode}: renders every preset with editable SVG fill and true outline`, () => {
      const elements = SHAPE_OPTIONS.map(({ value }) => makeElement('rect', { id: value, shape: value, fill: '#123456', stroke: '#abcdef', strokeWidth: 4, rotation: 23, width: 180, height: 100, text: undefined }))
      const root = render(elements, preview)
      for (const element of elements) {
        const outer = node(root, element.id)
        expect(outer.style.transform).toBe('rotate(23deg)')
        expect(outer.style.clipPath).toBe('')
        const path = outer.querySelector('svg path')!
        expect(path.getAttribute('fill')).toBe('#123456')
        expect(path.getAttribute('stroke')).toBe('#abcdef')
        expect(path.getAttribute('stroke-width')).toBe('4')
        expect(path.getAttribute('d')).toContain('Z')
        expect(outer.textContent).not.toContain('RECT')
      }
    })
    it(`${mode}: clips round frame children in local coordinates`, () => {
      const frame = makeElement('frame', { id: 'frame', shape: 'round', x: 120, y: 90, width: 180, height: 180, text: undefined })
      frame.layout = { ...frame.layout!, mode: 'free', overflow: 'hidden' }
      const child = makeElement('image', { id: 'photo', parentId: frame.id, x: 8, y: 12, width: 240, height: 240, src: '/photo.png' })
      const root = render([frame, child], preview)
      const outer = node(root, frame.id)
      const content = outer.querySelector<HTMLElement>(preview ? '.prototype-content' : '.element-content')!
      expect(outer.style.overflow).toBe('visible')
      expect(content.style.overflow).toBe('hidden')
      expect(content.style.borderRadius).toBe('50%')
      expect(content.contains(node(root, child.id))).toBe(true)
      expect(node(root, child.id).style.left).toBe('8px')
      expect(node(root, child.id).style.top).toBe('12px')
      expect(outer.textContent).not.toContain('FRAME')
    })
    it(`${mode}: clips images inside selection geometry and applies opacity once`, () => {
      const image = makeElement('image', { id: 'photo', src: '/photo.png', opacity: .4, corners: { topLeft: 20, topRight: 20, bottomRight: 20, bottomLeft: 20 }, imageFit: 'contain', imagePosition: '20% 30%' })
      const root = render([image], preview)
      const outer = node(root, image.id)
      const content = outer.querySelector<HTMLElement>(preview ? '.prototype-content' : '.element-content')!
      expect(outer.style.overflow).toBe('visible')
      expect(outer.style.opacity).toBe('0.4')
      expect(content.style.opacity).toBe('')
      expect(content.style.overflow).toBe('hidden')
      expect(content.style.borderRadius).toBe('20px 20px 20px 20px')
      expect(content.querySelector('img')!.style.objectFit).toBe('contain')
      expect(content.querySelector('img')!.style.objectPosition).toBe('20% 30%')
      if (!preview) {
        expect(outer.querySelectorAll(':scope > .resize-handle')).toHaveLength(8)
        expect(outer.querySelector(':scope > .rotation-handle')).not.toBeNull()
        expect(content.querySelector('.resize-handle')).toBeNull()
      }
    })
    it(`${mode}: preserves chamfers, patterns and original stacking`, () => {
      const shape = makeElement('rect', { id: 'cut', text: 'Label', opacity: .5, cutCorners: { topLeft: 15, topRight: 8, bottomRight: 0, bottomLeft: 5 }, pattern: { enabled: true, type: 'dots', color: '#ffffff', spacing: 10, scale: 1, rotation: 0, opacity: 1 } })
      const root = render([shape, makeElement('rect', { id: 'later' })], preview)
      const outer = node(root, shape.id)
      const content = outer.querySelector<HTMLElement>(preview ? '.prototype-content' : '.element-content')!
      expect(content.style.clipPath).toContain('15px')
      expect(content.style.backgroundImage).toContain('radial-gradient')
      expect(content.textContent).toContain('Label')
      expect(content.style.opacity).toBe('')
      expect(Number(outer.style.zIndex)).toBeLessThan(Number(node(root, 'later').style.zIndex))
    })
  }

  it('keeps image ratio and opposite corner when both axes snap', () => {
    const start = { x: 100, y: 100, width: 200, height: 100 }
    const proposed = { x: 83, y: 91.5, width: 217, height: 108.5 }
    const snapped = snapResizeRect(proposed, start, 'nw', { width: 1000, height: 800, elements: [] }, { tolerance: 9, includePage: false, userGuides: [{ axis: 'x', position: 80 }, { axis: 'y', position: 90 }] })
    const result = preserveSnappedAspect(snapped, proposed, start, 'nw')
    expect(result.rect.width / result.rect.height).toBe(2)
    expect(result.rect.x + result.rect.width).toBe(300)
    expect(result.rect.y + result.rect.height).toBe(200)
    expect(result.guides.every((guide) => guide.axis === result.guides[0].axis)).toBe(true)
  })

  it.each([
    { handle: 'se', x: 337, y: 219 },
    { handle: 'e', x: 337, y: 350 },
    { handle: 's', x: 480, y: 219 },
  ])('resizes a selected uploaded image from $handle while preserving ratio', async ({ handle: handleName, x, y }) => {
    const image = makeElement('image', { id: 'photo', src: '/photo.png', x: 100, y: 100, width: 200, height: 100, aspectRatioLocked: true })
    const settings = props([image])
    settings.userGuides = [{ axis: 'x', position: 340 }, { axis: 'y', position: 218 }]
    const host = document.createElement('div')
    const root = createRoot(host)
    const pointer = (target: Element, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      target.dispatchEvent(event)
    }
    try {
      await act(async () => root.render(<Canvas {...settings} />))
      const handle = host.querySelector(`.handle-${handleName}`)!
      const viewport = host.querySelector('.canvas-viewport')!
      await act(async () => {
        pointer(handle, 'pointerdown', 300, 200)
        pointer(viewport, 'pointermove', x, y)
        pointer(viewport, 'pointerup', x, y)
      })
      expect(settings.onTransformStart).toHaveBeenCalledOnce()
      const patch = vi.mocked(settings.onTransform).mock.calls.at(-1)![1]
      expect(patch.width! / patch.height!).toBe(2)
      expect(patch.width).toBeGreaterThan(200)
      expect(settings.onTransformEnd).toHaveBeenCalledWith('Resized layer')
    } finally { await act(async () => root.unmount()) }
  })
})
