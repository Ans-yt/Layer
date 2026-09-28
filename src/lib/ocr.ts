/** Optional OCR integration. Tesseract is loaded only when the user installs OCR. */

type LoggerMessage = { status?: string; progress?: number }
type OcrWorker = {
  recognize: (image: string | Blob | ImageData, options?: Record<string, unknown>) => Promise<{ data: { text?: string } }>
  terminate: () => Promise<void> | void
}
type TesseractModule = {
  createWorker?: (languages?: string, oem?: unknown, options?: Record<string, unknown>) => Promise<OcrWorker>
  recognize?: (image: string | Blob | ImageData, language: string, options?: { logger?: (message: LoggerMessage) => void }) => Promise<{ data: { text?: string } }>
}

export interface OcrInstallOptions {
  language?: string | string[]
  onProgress?: (progress: number, status?: string) => void
  /** Override Tesseract's worker asset path when an app hosts it locally. */
  workerPath?: string
  /** Override language asset path when an app hosts traineddata locally. */
  langPath?: string
}

export interface OcrStatus {
  enabled: boolean
  installed: boolean
  ready: boolean
  language: string
  error?: string
}

const SUPPORTED_LANGUAGES = new Set(['eng', 'fra', 'deu', 'spa', 'ita', 'por', 'nld'])
const OCR_CACHE_NAME = 'layer-ocr-cache-v1'
const OCR_DB_NAMES = ['tesseract.js', 'layer-ocr-cache']

let worker: OcrWorker | null = null
let workerLanguage = 'eng'
let enabled = true
let installPromise: Promise<OcrWorker> | null = null
let lastError: string | undefined
let lifecycleGeneration = 0

const normalizeLanguage = (language: string | string[] = 'eng'): string => {
  const values = (Array.isArray(language) ? language : language.split(/[+,\s]+/)).map((item) => item.trim().toLowerCase()).filter(Boolean)
  const unique = [...new Set(values)]
  if (!unique.length || unique.some((item) => !SUPPORTED_LANGUAGES.has(item))) throw new Error(`Unsupported OCR language. Choose English, French, German, Spanish, Italian, Portuguese, or Dutch.`)
  return unique.join('+')
}

const progressFromLogger = (message: LoggerMessage, onProgress?: OcrInstallOptions['onProgress'], base = 0, span = 100) => {
  const value = Math.max(0, Math.min(1, Number(message.progress ?? 0)))
  onProgress?.(Math.round(base + value * span), message.status)
}

const dynamicTesseract = async (): Promise<TesseractModule> => {
  try {
    // Keep OCR out of the initial chunk; Vite resolves this optional module
    // into a lazy chunk when the host installs the documented dependency.
    return await import('tesseract.js') as unknown as TesseractModule
  } catch (error) {
    const globalRuntime = (globalThis as unknown as { Tesseract?: TesseractModule }).Tesseract
    if (globalRuntime) return globalRuntime
    throw new Error(`OCR is optional and is not installed. Add tesseract.js to enable it (${error instanceof Error ? error.message : 'module not found'}).`)
  }
}

const terminateWorker = async () => {
  const current = worker
  worker = null
  if (!current) return
  try { await current.terminate() } catch (error) { lastError = error instanceof Error ? error.message : 'OCR worker could not be stopped.' }
}

/** Install/load a worker and its language data, with progress suitable for a UI. */
export const installOcr = async (options: OcrInstallOptions = {}): Promise<{ recognize: OcrWorker['recognize']; terminate: () => Promise<void>; language: string }> => {
  if (!enabled) throw new Error('OCR is disabled. Enable it before installing the worker.')
  const language = normalizeLanguage(options.language ?? workerLanguage)
  if (worker && workerLanguage === language) return { recognize: worker.recognize.bind(worker), terminate: async () => { await terminateWorker() }, language }
  if (installPromise && workerLanguage === language) {
    const generation = lifecycleGeneration
    const pending = await installPromise
    if (!enabled || generation !== lifecycleGeneration) throw new Error('OCR was disabled while the worker was installing.')
    return { recognize: pending.recognize.bind(pending), terminate: async () => { await terminateWorker() }, language }
  }
  await terminateWorker()
  workerLanguage = language
  lastError = undefined
  const generation = lifecycleGeneration
  options.onProgress?.(0, 'loading OCR runtime')
  installPromise = (async () => {
    const module = await dynamicTesseract()
    if (!module.createWorker) {
      if (module.recognize) {
        // Older CDN builds expose recognize directly. Wrap it in the same
        // lifecycle shape, while still keeping the dependency optional.
        const compatibilityWorker: OcrWorker = { recognize: (image, recognizeOptions) => module.recognize!(image, language, { logger: recognizeOptions?.logger as ((message: LoggerMessage) => void) | undefined }), terminate: () => undefined }
        options.onProgress?.(100, 'ready')
        return compatibilityWorker
      }
      throw new Error('The loaded OCR module does not expose createWorker.')
    }
    const createOptions: Record<string, unknown> = {
      cachePath: OCR_CACHE_NAME,
      cacheMethod: 'write',
      workerPath: options.workerPath,
      langPath: options.langPath,
      logger: (message: LoggerMessage) => progressFromLogger(message, options.onProgress, 25, 70),
    }
    const current = await module.createWorker(language, undefined, createOptions)
    options.onProgress?.(100, 'ready')
    return current
  })()
  try {
    const installed = await installPromise
    if (!enabled || generation !== lifecycleGeneration) {
      try { await installed.terminate() } catch { /* the disable path owns reporting */ }
      throw new Error('OCR was disabled while the worker was installing.')
    }
    worker = installed
    return { recognize: worker.recognize.bind(worker), terminate: async () => { await terminateWorker() }, language }
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'OCR installation failed.'
    throw error
  } finally { installPromise = null }
}

export const recognizeImage = async (image: string | Blob | ImageData, language = workerLanguage, onProgress?: (progress: number) => void): Promise<string> => {
  if (!enabled) throw new Error('OCR is disabled.')
  const normalized = normalizeLanguage(language)
  const runtime = await installOcr({ language: normalized, onProgress: (progress) => onProgress?.(progress) })
  try {
    const result = await runtime.recognize(image, { logger: (message: LoggerMessage) => onProgress?.(Math.round((message.progress ?? 0) * 100)) })
    return result.data.text ?? ''
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'OCR recognition failed.'
    throw new Error(`OCR recognition failed: ${lastError}`)
  }
}

export const disableOcr = async (): Promise<void> => {
  enabled = false
  lifecycleGeneration += 1
  const pending = installPromise
  if (pending) { try { await pending } catch { /* installOcr reports the original error */ } }
  await terminateWorker()
}
export const enableOcr = () => { lifecycleGeneration += 1; enabled = true; lastError = undefined }

/** Remove worker/language assets from Cache Storage where the browser allows it. */
export const clearOcrCache = async (): Promise<void> => {
  if (typeof caches !== 'undefined') {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name === OCR_CACHE_NAME || name.toLowerCase().includes('tesseract')).map((name) => caches.delete(name)))
  }
  if (typeof indexedDB !== 'undefined') {
    await Promise.all(OCR_DB_NAMES.map((name) => new Promise<void>((resolve) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve() })))
  }
}

/** Disable the feature and remove its cached worker/language assets. */
export const removeOcr = async (): Promise<void> => { await disableOcr(); await clearOcrCache() }

export const getOcrStatus = (): OcrStatus => ({ enabled, installed: Boolean(worker) || Boolean(installPromise), ready: Boolean(worker), language: workerLanguage, error: lastError })
export const supportedOcrLanguages = [...SUPPORTED_LANGUAGES]
