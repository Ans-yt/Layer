// @vitest-environment jsdom
import { act } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetsPanel } from '../src/components/AssetsPanel'
import { SafeImage } from '../src/components/SafeImage'
import { TopBar } from '../src/components/TopBar'
import { APP_ICON_URL, LAYER_LOGO_URL } from '../src/lib/brand'
import { createInitialProject } from '../src/lib/model'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

function render(node: ReactNode) {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root!.render(node))
}

function topBar() {
  const project = createInitialProject()
  const props: ComponentProps<typeof TopBar> = {
    project,
    page: project.pages[0],
    view: { zoom: 1, panX: 0, panY: 0, viewportWidth: 1096, mode: 'design', panel: 'inspector' },
    saveState: 'saved', selectedCount: 0,
    onUndo: vi.fn(), onRedo: vi.fn(), canUndo: false, canRedo: false, onFit: vi.fn(), onActualSize: vi.fn(),
    onExport: vi.fn(), onImport: vi.fn(), onPreview: vi.fn(), onTutorial: vi.fn(), onShortcuts: vi.fn(),
    onRenameProject: vi.fn(), savedProjects: [], projectsOpen: false, onToggleProjects: vi.fn(), onNewProject: vi.fn(), onOpenProject: vi.fn(),
  }
  return props
}

describe('Vite-managed branding', () => {
  it('exposes all built-in branding files as non-empty Vite asset URLs', () => {
    expect(APP_ICON_URL).toEqual(expect.any(String))
    expect(APP_ICON_URL.length).toBeGreaterThan(0)
    expect(LAYER_LOGO_URL).toEqual(expect.any(String))
    expect(LAYER_LOGO_URL.length).toBeGreaterThan(0)
  })

  it('uses the bundled app icon in the header', () => {
    render(<TopBar {...topBar()} />)
    expect(host!.querySelector<HTMLImageElement>('.topbar-brand-icon')?.getAttribute('src')).toBe(APP_ICON_URL)
  })
})

describe('safe asset states', () => {
  it('renders a neutral, labelled placeholder for an invalid source', () => {
    render(<SafeImage src="hehe" alt="Reference photo" />)
    expect(host!.querySelector('img')).toBeNull()
    expect(host!.querySelector('[data-asset-fallback]')?.getAttribute('aria-label')).toBe('Reference photo')
  })

  it('replaces a remote image after an error without dropping its alt text', () => {
    render(<SafeImage src="https://assets.invalid/missing.png" alt="Reference photo" />)
    const image = host!.querySelector<HTMLImageElement>('img')!
    act(() => image.dispatchEvent(new Event('error')))
    expect(host!.querySelector('img')).toBeNull()
    expect(host!.querySelector('[data-asset-fallback]')?.getAttribute('aria-label')).toBe('Reference photo')
  })

  it('keeps the built-in logo source and insertion payload aligned', async () => {
    const project = createInitialProject()
    const onInsertElement = vi.fn()
    render(<AssetsPanel project={project} onUpdate={vi.fn()} onCommit={vi.fn()} onInsertElement={onInsertElement} onUpload={vi.fn()} onNotify={vi.fn()} />)
    await act(async () => { await Promise.resolve() })
    expect(host!.querySelector<HTMLImageElement>('.logo-preview img')?.getAttribute('src')).toBe(LAYER_LOGO_URL)
    const logoButton = [...host!.querySelectorAll('button')].find((button) => button.textContent?.includes('Layer logo'))
    expect(logoButton).toBeTruthy()
    act(() => (logoButton as HTMLButtonElement).click())
    expect(onInsertElement).toHaveBeenCalledWith(expect.objectContaining({ name: 'Layer logo', src: LAYER_LOGO_URL, alt: 'Layer logo' }))
  })
})
