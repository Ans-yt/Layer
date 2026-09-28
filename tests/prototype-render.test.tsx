// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Prototype } from '../src/components/Prototype'
import { makeElement } from '../src/lib/model'
import type { Page } from '../src/lib/model'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const makePage = (elements: ReturnType<typeof makeElement>[]): Page => ({ id: 'p', name: 'Prototype', width: 500, height: 300, background: '#fff', elements, notes: '', breakpoints: [] })

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined })

describe('Prototype interactions', () => {
  it('hides descendants with a hidden parent and can reveal that parent', async () => {
    const parent = makeElement('frame', { id: 'parent', x: 10, y: 10, width: 240, height: 180, visible: false })
    const child = makeElement('text', { id: 'child', parentId: 'parent', text: 'Hidden child', x: 10, y: 10 })
    const reveal = makeElement('button', { id: 'reveal', x: 10, y: 220, text: 'Reveal', interactions: [{ id: 'show', trigger: 'click', action: 'toggle-visibility', targetId: 'parent' }] })
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    await act(async () => { root?.render(<Prototype page={makePage([parent, child, reveal])} width={500} />) })
    expect(host.querySelector('[data-prototype-id="child"]')).toBeNull()
    await act(async () => { host?.querySelector('[data-prototype-id="reveal"] button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(host.querySelector('[data-prototype-id="child"]')?.textContent).toContain('Hidden child')
  })

  it('renders multiple tabs, accordion body text, modal close, and flat form associations', async () => {
    const tabs = makeElement('tabs', { id: 'tabs', x: 10, y: 10, width: 240, height: 80, text: 'One     Two', options: [{ id: 'one', label: 'One', content: 'First panel' }, { id: 'two', label: 'Two', content: 'Second panel' }] } as never)
    const accordion = makeElement('accordion', { id: 'accordion', x: 10, y: 100, width: 240, height: 80, text: 'Details', body: 'Accordion body' } as never)
    const modal = makeElement('modal', { id: 'modal', x: 270, y: 10, width: 180, height: 120, text: 'Dialog' } as never)
    const form = makeElement('form', { id: 'form', x: 270, y: 150, width: 180, height: 120, interactions: [{ id: 'submit', trigger: 'click', action: 'submit-form' }] })
    const input = makeElement('input', { id: 'email', x: 280, y: 165, width: 150, height: 40, required: true, inputType: 'email' } as never)
    host = document.body.appendChild(document.createElement('div')); root = createRoot(host)
    await act(async () => { root?.render(<Prototype page={makePage([tabs, accordion, modal, form, input])} width={500} />) })
    expect(host.querySelectorAll('[role="tab"]').length).toBe(2)
    expect(host.textContent).toContain('Accordion body')
    expect(host.querySelector('[role="dialog"]')).toBeTruthy()
    expect(host.querySelector('#prototype-input-email')?.getAttribute('form')).toBe('prototype-form-form')
    expect(host.querySelector('#prototype-input-email')?.hasAttribute('required')).toBe(true)
  })

  it('runs every matching action and forwards navigation once', async () => {
    const onNavigate = vi.fn()
    const onStateChange = vi.fn()
    const button = makeElement('button', { id: 'button', text: 'Go', interactions: [{ id: 'navigate', trigger: 'click', action: 'navigate', pageId: 'next' }, { id: 'state', trigger: 'click', action: 'set-state', targetId: 'button', value: 'active' }] })
    const next: Page = { ...makePage([]), id: 'next', name: 'Next' }
    const project = { id: 'project', name: 'Project', updatedAt: '', pages: [makePage([button]), next], activePageId: 'p', styles: [], components: [], assets: [], integrations: [], providers: [], skills: [], commands: [], connections: [], versions: [], settings: { autoApplyAi: false, snap: true, snapEdges: true, snapCenters: true, snapGaps: true, snapGrid: false, gridSize: 8, reducedMotion: true, visionEnabled: false, videoEnabled: false, ocrEnabled: false, ocrStatus: 'not-installed' as const, mainPrompt: '', visionPrompt: '' } }
    host = document.body.appendChild(document.createElement('div')); root = createRoot(host)
    await act(async () => { root?.render(<Prototype document={project} page={project.pages[0]} onNavigate={onNavigate} onStateChange={onStateChange} width={500} />) })
    await act(async () => { host?.querySelector('[data-prototype-id="button"] button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onStateChange).toHaveBeenCalledWith('button', 'active')
  })
})
