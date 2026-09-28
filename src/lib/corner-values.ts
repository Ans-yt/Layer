export type CornerValues = { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }

export const CORNER_NAMES = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const
export type CornerName = typeof CORNER_NAMES[number]

export const zeroCorners = (): CornerValues => ({ topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 })

export const clampCutValue = (value: number, width: number, height: number) => Math.max(0, Math.min(Math.min(width, height) / 2, Math.round(Number.isFinite(value) ? value : 0)))

export const snapCutValue = (value: number, step = 4) => Math.max(0, Math.round(value / Math.max(1, step)) * Math.max(1, step))

export const mirrorCorners = (values: CornerValues, corner: CornerName, value: number, mirrorX: boolean, mirrorY: boolean): CornerValues => {
  const next = { ...values, [corner]: value }
  if (mirrorX) {
    if (corner === 'topLeft') next.topRight = value
    if (corner === 'topRight') next.topLeft = value
    if (corner === 'bottomLeft') next.bottomRight = value
    if (corner === 'bottomRight') next.bottomLeft = value
  }
  if (mirrorY) {
    if (corner === 'topLeft') next.bottomLeft = value
    if (corner === 'bottomLeft') next.topLeft = value
    if (corner === 'topRight') next.bottomRight = value
    if (corner === 'bottomRight') next.topRight = value
  }
  if (mirrorX && mirrorY) CORNER_NAMES.forEach((name) => { next[name] = value })
  return next
}

/** CSS polygon points for literal chamfered corners, in clockwise order. */
export const cutClipPath = (values: CornerValues) => {
  const fromRight = (value: number) => value > 0 ? `calc(100% - ${value}px)` : '100%'
  const fromBottom = (value: number) => value > 0 ? `calc(100% - ${value}px)` : '100%'
  return `polygon(${values.topLeft}px 0, ${fromRight(values.topRight)} 0, 100% ${values.topRight}px, 100% ${fromBottom(values.bottomRight)}, ${fromRight(values.bottomRight)} 100%, ${values.bottomLeft}px 100%, 0 ${fromBottom(values.bottomLeft)}, 0 ${values.topLeft}px)`
}
