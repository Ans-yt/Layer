export type Hsva = { h: number; s: number; v: number; a: number }
export type ColorFormat = 'hex' | 'hsl' | 'rgb'
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const hue = (value: number) => ((value % 360) + 360) % 360

export function rgbaToHsva(r: number, g: number, b: number, a = 1): Hsva {
  const [red, green, blue] = [r, g, b].map((part) => part / 255)
  const max = Math.max(red, green, blue); const min = Math.min(red, green, blue); const delta = max - min
  const h = !delta ? 0 : max === red ? 60 * ((green - blue) / delta) : max === green ? 60 * ((blue - red) / delta + 2) : 60 * ((red - green) / delta + 4)
  return { h: hue(h), s: max ? delta / max * 100 : 0, v: max * 100, a }
}

export function hsvaToRgba({ h, s, v, a }: Hsva) {
  h = hue(h)
  const c = v / 100 * s / 100; const x = c * (1 - Math.abs(h / 60 % 2 - 1)); const m = v / 100 - c
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const [r, g, b] = rgb.map((part) => Math.round((part + m) * 255))
  return { r, g, b, a }
}

export function hsvaToHex(color: Hsva) {
  const { r, g, b, a } = hsvaToRgba(color)
  return '#' + [r, g, b, ...(a < 1 ? [Math.round(a * 255)] : [])].map((part) => part.toString(16).padStart(2, '0')).join('')
}

export function hsvaToHsla({ h, s, v, a }: Hsva) {
  const l = v / 100 * (1 - s / 200)
  return { h, s: l === 0 || l === 1 ? 0 : (v / 100 - l) / Math.min(l, 1 - l) * 100, l: l * 100, a }
}

function hslaToHsva(h: number, s: number, l: number, a: number): Hsva {
  const lightness = l / 100; const v = lightness + s / 100 * Math.min(lightness, 1 - lightness)
  return { h: hue(h), s: v ? 2 * (1 - lightness / v) * 100 : 0, v: v * 100, a }
}

const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)$/
function channel(text: string, max: number, percent = false) {
  const isPercent = text.endsWith('%'); const raw = isPercent ? text.slice(0, -1) : text
  if (!numberPattern.test(raw)) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > (isPercent ? 100 : max) || (percent && !isPercent)) return null
  return isPercent ? value / 100 * max : value
}

/** Strict CSS hex, rgb(a), hsl(a), transparent, or format-specific comma tuples.
 * Omitted alpha in an edited tuple/hex preserves the caller's alpha; props default to opaque.
 */
export function parseColor(text: string, format?: ColorFormat, alpha = 1): Hsva | null {
  text = text.trim().toLowerCase()
  if (text === 'transparent') return { h: 0, s: 0, v: 0, a: 0 }
  const hex = /^#?([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(text)
  if (hex && (!format || format === 'hex')) {
    const expanded = hex[1].length < 5 ? [...hex[1]].map((part) => part + part).join('') : hex[1]
    return rgbaToHsva(parseInt(expanded.slice(0, 2), 16), parseInt(expanded.slice(2, 4), 16), parseInt(expanded.slice(4, 6), 16), expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : alpha)
  }
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(text)
  const kind = fn ? fn[1].startsWith('rgb') ? 'rgb' : 'hsl' : format
  if (!kind || kind === 'hex' || (fn && format && kind !== format)) return null
  const body = fn ? fn[2].trim() : text
  let parts: string[]
  if (body.includes(',')) {
    if (body.includes('/')) return null
    parts = body.split(',').map((part) => part.trim())
  } else {
    const sections = body.split('/')
    if (sections.length > 2) return null
    parts = sections[0].trim().split(/\s+/)
    if (parts.length !== 3) return null
    if (sections.length === 2) parts.push(sections[1].trim())
  }
  if (parts.length !== 3 && parts.length !== 4) return null
  const a = parts.length === 4 ? channel(parts[3], 1) : alpha
  if (a === null) return null
  if (kind === 'rgb') {
    const channels = parts.slice(0, 3).map((part) => channel(part, 255))
    if (channels.some((part) => part === null)) return null
    return rgbaToHsva(channels[0]!, channels[1]!, channels[2]!, a)
  }
  const rawHue = parts[0].replace(/(?:deg|°)$/, '')
  if (!numberPattern.test(rawHue) || !Number.isFinite(Number(rawHue))) return null
  const s = channel(parts[1], 100, !!fn); const l = channel(parts[2], 100, !!fn)
  return s === null || l === null ? null : hslaToHsva(Number(rawHue), s, l, a)
}

export function formatColor(color: Hsva, format: ColorFormat) {
  const round = (value: number) => Number(value.toFixed(2))
  if (format === 'hex') return hsvaToHex(color)
  const alpha = color.a < 1 ? ` / ${round(color.a * 100)}%` : ''
  if (format === 'rgb') {
    const { r, g, b } = hsvaToRgba(color)
    return `rgb(${r} ${g} ${b}${alpha})`
  }
  const { h, s, l } = hsvaToHsla(color)
  return `hsl(${round(h)} ${round(s)}% ${round(l)}%${alpha})`
}

/** Contrast of the actual translucent foreground composited over the given opaque background. */
export function colorContrast(color: Hsva, background: string) {
  const fg = hsvaToRgba(color); const bg = hsvaToRgba(parseColor(background)!)
  const luminance = (rgb: number[]) => rgb.map((part) => part / 255).map((part) => part <= .04045 ? part / 12.92 : ((part + .055) / 1.055) ** 2.4).reduce((sum, part, index) => sum + part * [.2126, .7152, .0722][index], 0)
  const a = luminance([fg.r * fg.a + bg.r * (1 - fg.a), fg.g * fg.a + bg.g * (1 - fg.a), fg.b * fg.a + bg.b * (1 - fg.a)])
  const b = luminance([bg.r, bg.g, bg.b])
  return ((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2)
}
