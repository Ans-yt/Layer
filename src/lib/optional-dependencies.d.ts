/** Minimal declarations keep the editor type-checkable before the host adds
 * the optional packages. Installed package declarations take precedence for
 * their own APIs at runtime. */
declare module 'fflate' {
  export interface UnzipFileInfo { name: string; size: number; originalSize: number; compression: number }
  export function zipSync(files: Record<string, Uint8Array>, options?: { level?: number }): Uint8Array
  export function unzipSync(data: Uint8Array, options?: { filter?: (file: UnzipFileInfo) => boolean }): Record<string, Uint8Array>
}

declare module 'html-to-image' {
  export function toBlob(node: HTMLElement, options?: Record<string, unknown>): Promise<Blob | null>
  export function toPng(node: HTMLElement, options?: Record<string, unknown>): Promise<string>
  export function toCanvas(node: HTMLElement, options?: Record<string, unknown>): Promise<HTMLCanvasElement>
}

declare module 'tesseract.js' {
  export function createWorker(languages?: string, oem?: unknown, options?: Record<string, unknown>): Promise<unknown>
  export function recognize(image: unknown, language: string, options?: Record<string, unknown>): Promise<unknown>
}
