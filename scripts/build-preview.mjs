import { build } from 'vite'
import { resolve } from 'node:path'

// Build the same React Prototype/layout renderer used by the editor into a
// single IIFE. The output has no network imports, so exported preview/index.html
// can run from file:// when preview-runtime.js is placed beside it.
await build({
  configFile: false,
  root: process.cwd(),
  publicDir: false,
  build: {
    outDir: resolve(process.cwd(), 'public'),
    emptyOutDir: false,
    lib: {
      entry: resolve(process.cwd(), 'src/preview-entry.tsx'),
      name: 'LayerPreviewRuntime',
      formats: ['iife'],
      fileName: () => 'preview-runtime.js',
    },
  },
})
