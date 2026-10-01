// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewExperience, resolvePreviewPreset } from '../src/components/PreviewExperience'
import { createInitialProject } from '../src/lib/model'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined })

const renderPreview = async (props: Partial<React.ComponentProps<typeof PreviewExperience>> = {}) => {
  const project = createInitialProject()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => { root?.render(<PreviewExperience project={project} onExit={vi.fn()} {...props} />) })
  return { project, host }
}

describe('PreviewExperience', () => {
  it('maps Layer responsive widths to the expected frame treatments', () => {
    expect(resolvePreviewPreset(1096)).toBe('desktop')
    expect(resolvePreviewPreset(1440)).toBe('desktop')
    expect(resolvePreviewPreset(768)).toBe('tablet')
    expect(resolvePreviewPreset(390)).toBe('phone')
  })

  it('keeps editor chrome out of the presentation and renders device frames', async () => {
    const desktop = await renderPreview({ viewportWidth: 1096 })
    expect(desktop.host.querySelector('.preview-experience')?.getAttribute('data-preview-frame')).toBe('monitor')
    expect(desktop.host.querySelector('.preview-device--monitor')).toBeTruthy()
    act(() => root?.unmount())

    const tablet = await renderPreview({ viewportWidth: 768 })
    expect(tablet.host.querySelector('.preview-device--tablet')).toBeTruthy()
    expect(tablet.host.querySelector('.left-rail, .pages-sidebar, .right-panel, .editor-canvas-toolbar')).toBeNull()
    act(() => root?.unmount())

    const phone = await renderPreview({ viewportWidth: 390 })
    expect(phone.host.querySelector('.preview-device--phone')).toBeTruthy()
  })

  it('exits through the labelled affordance and Escape without changing the project', async () => {
    const onExit = vi.fn()
    const { project, host: previewHost } = await renderPreview({ onExit, viewportWidth: 390 })
    const before = JSON.stringify(project)
    const shell = previewHost.querySelector('.preview-experience') as HTMLElement
    await act(async () => { shell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(onExit).toHaveBeenCalledTimes(1)
    await act(async () => { (previewHost.querySelector('button[aria-label="Exit preview"]') as HTMLButtonElement).click() })
    expect(onExit).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(project)).toBe(before)
  })

  it('forwards Prototype navigation actions while preserving reduced motion', async () => {
    const project = createInitialProject()
    const onPreviewNavigate = vi.fn()
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    await act(async () => { root?.render(<PreviewExperience project={project} viewportWidth={1096} reducedMotion onPreviewNavigate={onPreviewNavigate} onExit={vi.fn()} />) })
    const button = host.querySelector('[data-prototype-id="hero-cta"] button') as HTMLButtonElement
    await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onPreviewNavigate).toHaveBeenCalledWith('page-library', expect.anything())
    expect(host.querySelector('.preview-experience')?.getAttribute('data-reduced-motion')).toBe('true')
    expect(host.querySelector('[aria-label="Library webpage preview"]')).toBeTruthy()
  })

  it('uses real device viewport ratios instead of the document height', async () => {
    const desktop = await renderPreview({ viewportWidth: 1096 })
    const monitor = desktop.host.querySelector('.preview-experience')
    expect(monitor?.getAttribute('data-preview-viewport')).toBe('1096')
    expect(desktop.host.querySelector('.preview-device__screen')).toBeTruthy()
    expect(desktop.host.querySelector('.preview-device__stand')).toBeTruthy()
    act(() => root?.unmount())

    const phone = await renderPreview({ viewportWidth: 390 })
    expect(phone.host.querySelector('.preview-device__screen')?.className).toContain('preview-device__screen')
    expect(phone.host.querySelector('.preview-device--phone')).toBeTruthy()
  })
})
