/** DOM capture helpers used by canvas/vision/export integrations. */

type HtmlToImageModule = { toBlob?: (node: HTMLElement, options?: Record<string, unknown>) => Promise<Blob | null>; toPng?: (node: HTMLElement, options?: Record<string, unknown>) => Promise<string>; toCanvas?: (node: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement> }

export interface CaptureCrop { x: number; y: number; width: number; height: number }

export interface CaptureOptions {
  projectId: string
  documentVersionId: string
  pageId: string
  selectionIds?: string[]
  label?: string
  pixelRatio?: number
  backgroundColor?: string
  /** Useful for tests and hosts that provide a controlled renderer. */
  renderer?: (element: HTMLElement, options?: Record<string, unknown>) => Promise<Blob | string | null>
  crop?: CaptureCrop
  abortSignal?: AbortSignal
}

export interface CaptureArtifact {
  id: string
  kind: 'screenshot' | 'sampled-frame'
  label: string
  blob: Blob
  mimeType: string
  projectId: string
  documentVersionId: string
  pageId: string
  selectionIds: string[]
  capturedAt: string
  frameIndex?: number
  frameTimeMs?: number
}

export interface SampledFrameOptions extends CaptureOptions {
  /** Explicit sample times are labels/metadata; this API does not claim native video. */
  timesMs?: number[]
  frameCount?: number
  onFrame?: (frame: CaptureArtifact) => void | Promise<void>
}

const dynamicHtmlToImage = async (): Promise<HtmlToImageModule> => {
  try { return await import('html-to-image') as unknown as HtmlToImageModule } catch (error) { throw new Error(`DOM capture requires html-to-image. Add html-to-image to the app dependencies (${error instanceof Error ? error.message : 'module not found'}).`) }
}

const blobFromDataUrl = (dataUrl: string): Blob => {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/i)
  if (!match) throw new Error('Capture renderer returned an invalid data URL.')
  const mime = match[1] || 'image/png'
  const payload = match[2]
  if (/;base64/i.test(dataUrl.slice(0, dataUrl.indexOf(',')))) {
    const binary = atob(payload)
    return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: mime })
  }
  return new Blob([decodeURIComponent(payload)], { type: mime })
}

const blobFromRenderer = async (result: Blob | string): Promise<Blob> => result instanceof Blob ? result : blobFromDataUrl(result)

const abortIfNeeded = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Capture aborted.', 'AbortError') }

const cropCanvas = async (canvas: HTMLCanvasElement, crop: CaptureCrop): Promise<Blob> => {
  const x = Math.min(Math.max(0, Math.floor(crop.x)), Math.max(0, canvas.width - 1)); const y = Math.min(Math.max(0, Math.floor(crop.y)), Math.max(0, canvas.height - 1)); const width = Math.max(1, Math.min(canvas.width - x, Math.floor(crop.width))); const height = Math.max(1, Math.min(canvas.height - y, Math.floor(crop.height)))
  const output = document.createElement('canvas'); output.width = width; output.height = height
  const context = output.getContext('2d'); if (!context) throw new Error('The browser could not create a crop canvas.')
  context.drawImage(canvas, x, y, width, height, 0, 0, width, height)
  return new Promise((resolve, reject) => { output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode the cropped capture.')), 'image/png') })
}

const capture = async (element: HTMLElement, options: CaptureOptions, kind: CaptureArtifact['kind'], frameIndex?: number, frameTimeMs?: number): Promise<CaptureArtifact> => {
  if (!element || typeof element !== 'object') throw new Error('A DOM element is required for capture.')
  if (!options.projectId || !options.documentVersionId || !options.pageId) throw new Error('Capture metadata requires projectId, documentVersionId, and pageId.')
  abortIfNeeded(options.abortSignal)
  const ratio = Math.max(0.25, Math.min(4, options.pixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)))
  const renderOptions = { pixelRatio: ratio, cacheBust: true, backgroundColor: options.backgroundColor, skipFonts: false, crop: options.crop }
  let rendered: Blob | string | null
  if (options.renderer) rendered = await options.renderer(element, renderOptions)
  else {
    const module = await dynamicHtmlToImage()
    if (options.crop && module.toCanvas) rendered = await cropCanvas(await module.toCanvas(element, renderOptions), { x: options.crop.x * ratio, y: options.crop.y * ratio, width: options.crop.width * ratio, height: options.crop.height * ratio })
    else if (module.toBlob) rendered = await module.toBlob(element, renderOptions)
    else if (module.toPng) rendered = await module.toPng(element, renderOptions)
    else throw new Error('html-to-image does not expose toBlob or toPng.')
  }
  abortIfNeeded(options.abortSignal)
  if (!rendered) throw new Error('The DOM capture renderer returned no image.')
  const blob = await blobFromRenderer(rendered)
  if (!blob.size) throw new Error('The DOM capture renderer returned an empty image.')
  const label = options.label ?? (kind === 'sampled-frame' ? `Sampled frame ${Number(frameIndex ?? 0) + 1}` : 'Canvas screenshot')
  return { id: `capture_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, kind, label, blob, mimeType: blob.type || 'image/png', projectId: options.projectId, documentVersionId: options.documentVersionId, pageId: options.pageId, selectionIds: [...(options.selectionIds ?? [])], capturedAt: new Date().toISOString(), frameIndex, frameTimeMs }
}

export const captureElement = (element: HTMLElement, options: CaptureOptions) => capture(element, options, 'screenshot')
export const captureScreenshot = captureElement
export const capturePage = captureElement
export const captureCanvas = captureElement
export const captureFrame = captureElement
export const captureDomScreenshot = captureElement

/** Capture the canvas DOM while retaining the current object selection metadata. */
export const captureSelection = (element: HTMLElement, options: CaptureOptions & { selectionIds: string[] }) => capture(element, options, 'screenshot')

/**
 * Capture labeled stills from a live DOM. Frames are independent PNG/JPEG
 * artifacts with timestamps; they intentionally do not masquerade as video.
 */
export const captureSampledFrames = async (element: HTMLElement, options: SampledFrameOptions): Promise<CaptureArtifact[]> => {
  const times = options.timesMs?.length ? options.timesMs : Array.from({ length: Math.max(1, Math.min(120, options.frameCount ?? 3)) }, (_, index) => index * 250)
  const frames: CaptureArtifact[] = []
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  for (const [index, timeMs] of times.entries()) {
    abortIfNeeded(options.abortSignal)
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
    const waitMs = Math.max(0, Math.round(timeMs) - elapsed)
    if (waitMs > 0) await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, waitMs); options.abortSignal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Capture aborted.', 'AbortError')) }, { once: true }) })
    const frame = await capture(element, { ...options, label: options.label ? `${options.label} · frame ${index + 1}` : `Sampled frame ${index + 1}` }, 'sampled-frame', index, Math.max(0, Math.round(timeMs)))
    frames.push(frame)
    await options.onFrame?.(frame)
  }
  return frames
}

export const captureFrames = captureSampledFrames
export const captureMotionFrames = captureSampledFrames

export const artifactToDataUrl = (artifact: CaptureArtifact): Promise<string> => {
  if (typeof FileReader === 'undefined') return artifact.blob.arrayBuffer().then((buffer) => {
    let binary = ''; new Uint8Array(buffer).forEach((byte) => { binary += String.fromCharCode(byte) })
    return `data:${artifact.mimeType || artifact.blob.type || 'image/png'};base64,${btoa(binary)}`
  })
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error ?? new Error('Could not read capture artifact.')); reader.readAsDataURL(artifact.blob) })
}
