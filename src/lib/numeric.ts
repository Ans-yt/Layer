export function finiteNumber(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

export function clampNumber(value: number, min?: number, max?: number) {
  const lower = Number.isFinite(min) ? min! : undefined
  const upper = Number.isFinite(max) ? max! : undefined
  if (lower !== undefined && upper !== undefined && lower > upper) return lower
  return Math.min(upper ?? Number.POSITIVE_INFINITY, Math.max(lower ?? Number.NEGATIVE_INFINITY, value))
}

export function roundNumber(value: number, decimals?: number) {
  if (decimals === undefined || !Number.isFinite(decimals)) return value
  const precision = Math.max(0, Math.min(8, Math.trunc(decimals)))
  return Number(value.toFixed(precision))
}

export function normalizeNumber(value: number, fallback = 0, min?: number, max?: number, decimals?: number) {
  const finite = finiteNumber(value, fallback)
  return roundNumber(clampNumber(finite, min, max), decimals)
}

export function parseNumericInput(raw: string, fallback = 0, min?: number, max?: number, decimals?: number) {
  if (!raw.trim()) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? normalizeNumber(parsed, fallback, min, max, decimals) : null
}

export function formatNumber(value: number, decimals?: number) {
  const finite = finiteNumber(value)
  return decimals === undefined ? String(finite) : finite.toFixed(Math.max(0, Math.min(8, Math.trunc(decimals))))
}
