import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Project } from './lib/model'
import { Prototype } from './components/Prototype'

declare global {
  interface Window {
    __LAYER_PROJECT__?: Project
    __LAYER_PREVIEW_WIDTH__?: number
    LayerPreviewRuntime?: { mount: (root?: HTMLElement) => void }
  }
}

const globalStyle = `*{box-sizing:border-box}html,body,#layer-preview{margin:0;min-width:0;min-height:100%;width:100%;background:#0b0c0e}button,input,select,textarea{font:inherit}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:2px solid #f5b847;outline-offset:2px}.layer-preview-shell{width:100%;min-height:100vh;overflow:auto}.layer-preview-stage{min-height:100vh;display:flex;justify-content:center;align-items:flex-start}`

function RuntimeMount({ project, host }: { project: Project; host: HTMLElement }) {
  const [width, setWidth] = useState(() => window.__LAYER_PREVIEW_WIDTH__ || host.clientWidth || project.pages[0]?.width || 960)
  useEffect(() => {
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver((entries) => {
      const next = Math.max(1, Math.floor(entries[0]?.contentRect.width || host.clientWidth || width))
      setWidth(next)
    })
    observer?.observe(host)
    const onResize = () => setWidth(Math.max(1, Math.floor(host.clientWidth || window.innerWidth || width)))
    window.addEventListener('resize', onResize)
    return () => { observer?.disconnect(); window.removeEventListener('resize', onResize) }
  }, [host])
  const fonts = project.assets.filter((asset) => asset.kind === 'font' && asset.src).map((asset) => ({ family: asset.metadata?.family ?? asset.name, src: asset.src })).filter((font) => /^(?:https?:\/\/|data:font\/|blob:|(?:\.\.?\/|\/)[^\s]+$)/i.test(String(font.src)) && !/^(?:javascript|vbscript|file):/i.test(String(font.src)))
  return <>
    <style>{globalStyle}{fonts.map((font) => `@font-face{font-family:"${String(font.family).replace(/["'<>;]/g, '')}";src:url("${String(font.src).replace(/["'<>;]/g, '')}")}`).join('')}</style>
    <div className="layer-preview-shell"><div className="layer-preview-stage"><Prototype document={project} width={width} reducedMotion={project.settings.reducedMotion} onExternal={(url) => { window.open(url, '_blank', 'noopener,noreferrer') }} /></div></div>
  </>
}

export function mountPreview(root: HTMLElement = document.getElementById('layer-preview') as HTMLElement): void {
  const project = window.__LAYER_PROJECT__
  if (!root || !project) return
  createRoot(root).render(<StrictMode><RuntimeMount project={project} host={root} /></StrictMode>)
}

if (typeof window !== 'undefined') {
  window.LayerPreviewRuntime = { mount: mountPreview }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountPreview(), { once: true })
  else mountPreview()
}
