import { useEffect, useState } from 'react'
import type { ImgHTMLAttributes } from 'react'
import { Icon } from './Icon'
import './safe-image.css'

export type SafeImageFallback = 'image' | 'icon' | 'brand'

export interface SafeImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  src?: string | null
  alt?: string
  fallbackKind?: SafeImageFallback
  fallbackLabel?: string
}

/**
 * An image that never leaves a broken-image glyph behind when a document
 * contains a stale, missing, or unreachable source URL.
 */
export function SafeImage({ src, alt = '', fallbackKind = 'image', fallbackLabel, className, style, title, ...imageProps }: SafeImageProps) {
  const candidate = typeof src === 'string' ? src.trim() : ''
  const sourceIsSafe = isSafeImageSource(candidate)
  const [failed, setFailed] = useState(() => !sourceIsSafe)

  useEffect(() => {
    setFailed(!sourceIsSafe)
  }, [candidate, sourceIsSafe])

  if (!sourceIsSafe || failed) {
    const label = fallbackLabel ?? alt
    return <span
      className={['asset-image-fallback', `asset-image-fallback-${fallbackKind}`, className].filter(Boolean).join(' ')}
      style={style}
      title={title}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-asset-fallback="true"
    >
      {fallbackKind === 'brand' ? <span className="asset-image-brand-glyph" aria-hidden="true">L</span> : <Icon name={fallbackKind === 'icon' ? 'icon' : 'image'} size={16} />}
    </span>
  }

  return <img
    {...imageProps}
    className={className}
    style={style}
    src={candidate}
    alt={alt}
    title={title}
    onError={() => setFailed(true)}
  />
}

/**
 * Keep obvious bad values out of the DOM. Remote and local sources are still
 * allowed to fail later, at which point SafeImage swaps in the same fallback.
 */
export const isSafeImageSource = (value: string): boolean => {
  if (!value || /[\s<>"'`]/.test(value)) return false
  if (/^(?:javascript|vbscript|file|about|chrome|data:text\/html):/i.test(value)) return false
  if (/^data:image\//i.test(value) || /^(?:https?:|blob:)/i.test(value)) return true
  if (value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return false
  return value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('assets/') || /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(value)
}
