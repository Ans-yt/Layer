import { createElement } from 'react'
import type { DesignElement, ShapeVariant } from './model'
import type { Rect, SnapResult } from './geometry'

export const SHAPE_OPTIONS: Array<{ value: ShapeVariant; label: string; description: string }> = [
  { value: 'rectangle', label: 'Rectangle', description: 'A standard editable box' },
  { value: 'round', label: 'Round frame', description: 'A circular logo/photo frame' },
  { value: 'triangle', label: 'Triangle', description: 'A three-sided symbol' },
  { value: 'diamond', label: 'Diamond', description: 'A rotated square' },
  { value: 'hexagon', label: 'Hexagon', description: 'A six-sided badge' },
  { value: 'star', label: 'Star', description: 'A five-point symbol' },
  { value: 'burst', label: 'Burst', description: 'A sharp badge or sticker' },
  { value: 'pill', label: 'Pill', description: 'A capsule-shaped frame' },
]

export const shapeLabel = (shape: ShapeVariant | undefined) => SHAPE_OPTIONS.find((option) => option.value === shape)?.label ?? 'Rectangle'

/** CSS polygon syntax shared by the editor and exported preview. */
export const shapeClipPath = (shape: ShapeVariant | undefined): string | undefined => {
  switch (shape) {
    case 'triangle': return 'polygon(50% 0%, 100% 100%, 0% 100%)'
    case 'diamond': return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'
    case 'hexagon': return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)'
    case 'star': return 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 100%, 50% 73%, 21% 100%, 32% 57%, 2% 35%, 39% 35%)'
    case 'burst': return 'polygon(50% 0%, 59% 17%, 78% 8%, 79% 29%, 100% 32%, 84% 50%, 100% 68%, 79% 71%, 78% 92%, 59% 83%, 50% 100%, 41% 83%, 22% 92%, 21% 71%, 0% 68%, 16% 50%, 0% 32%, 21% 29%, 22% 8%, 41% 17%)'
    default: return undefined
  }
}

export const shapeUsesRoundCorners = (shape: ShapeVariant | undefined) => shape === 'round' || shape === 'pill'

/** Use actual geometry for the fill and outline, rather than clipping a box border. */
export function ShapeVisual({ element, width, height }: { element: DesignElement; width: number; height: number }) {
  if (!['rect', 'frame', 'circle'].includes(element.type) || element.curve) return null
  const shape = element.type === 'circle' ? 'round' : element.shape
  const strokeWidth = Math.min(Math.max(0, element.strokeWidth || 0), width, height)
  const inset = strokeWidth / 2
  const w = Math.max(0, width - strokeWidth), h = Math.max(0, height - strokeWidth)
  const polygon = shapeClipPath(shape)?.match(/[\d.]+/g)?.map(Number)
  let d: string
  if (polygon) {
    d = polygon.reduce((path, value, index) => index % 2 ? path : `${path}${index ? ' L' : 'M'} ${inset + value * w / 100} ${inset + polygon[index + 1] * h / 100}`, '') + ' Z'
  } else if (shape === 'round') {
    d = `M ${inset} ${height / 2} A ${w / 2} ${h / 2} 0 1 0 ${width - inset} ${height / 2} A ${w / 2} ${h / 2} 0 1 0 ${inset} ${height / 2} Z`
  } else {
    const cut = element.cutCorners
    const chamfered = cut && Object.values(cut).some((value) => value > 0)
    const radii = (['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const).map((key) => Math.max(0, Math.min(w / 2, h / 2, shape === 'pill' ? Math.min(w, h) / 2 : ((chamfered ? cut[key] : element.corners?.[key] ?? element.radius) || 0) - inset)))
    const [tl, tr, br, bl] = radii
    const r = width - inset, b = height - inset
    const corner = (radius: number, x: number, y: number) => chamfered || !radius ? `L ${x} ${y}` : `A ${radius} ${radius} 0 0 1 ${x} ${y}`
    d = `M ${inset + tl} ${inset} L ${r - tr} ${inset} ${corner(tr, r, inset + tr)} L ${r} ${b - br} ${corner(br, r - br, b)} L ${inset + bl} ${b} ${corner(bl, inset, b - bl)} L ${inset} ${inset + tl} ${corner(tl, inset + tl, inset)} Z`
  }
  return createElement('svg', { 'aria-hidden': true, 'data-shape-visual': shape ?? 'rectangle', viewBox: `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`, preserveAspectRatio: 'none', style: { position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' } }, createElement('path', { d, fill: element.fill, stroke: element.stroke, strokeWidth, strokeLinejoin: 'round' }))
}

/** Keep the closest snapped axis and derive the other size from the saved ratio. */
export function preserveSnappedAspect(result: SnapResult, proposed: Rect, start: Rect, handle: string): SnapResult {
  const ratio = start.width / start.height
  if (!Number.isFinite(ratio) || ratio <= 0) return result
  const xGuide = result.guides.some((guide) => guide.axis === 'x')
  const yGuide = result.guides.some((guide) => guide.axis === 'y')
  const useX = xGuide && (!yGuide || Math.abs(result.rect.width - proposed.width) <= Math.abs(result.rect.height - proposed.height) * ratio)
  if (!xGuide && !yGuide) return { ...result, rect: proposed }
  const width = Math.max(2, 2 * ratio, useX ? result.rect.width : result.rect.height * ratio)
  const height = width / ratio
  const rect = { x: handle.includes('w') ? start.x + start.width - width : proposed.x, y: handle.includes('n') ? start.y + start.height - height : proposed.y, width, height }
  const guides = result.guides.filter((guide) => guide.axis === (useX ? 'x' : 'y'))
  return { ...result, rect, guides, vertical: useX ? result.vertical : [], horizontal: useX ? [] : result.horizontal }
}
