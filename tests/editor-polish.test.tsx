// @vitest-environment jsdom
import { act, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TopBar } from '../src/components/TopBar'
import { InlineRename } from '../src/components/InlineRename'
import { createInitialProject, makeElement } from '../src/lib/model'
import { LayersPanel } from '../src/components/LayersPanel'
import { filterLayerTree } from '../src/lib/layer-search'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
afterEach(() => { act(() => root?.unmount()); host?.remove() })
function render(node: ReactNode) {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root.render(node))
}
function click(button: Element) { act(() => (button as HTMLElement).click()) }
function key(target: Element, value: string) { act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))) }
function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const button = (label: string) => [...host.querySelectorAll('button')].find((el) => (el.getAttribute('aria-label') ?? el.textContent?.trim()) === label)!

function toolbar() {
  const project = createInitialProject()
  const props: ComponentProps<typeof TopBar> = {
    project, page: project.pages[0], view: { zoom: 1, panX: 0, panY: 0, viewportWidth: 1096, mode: 'design', panel: 'inspector' },
    saveState: 'saved', selectedCount: 1,
    onUndo: vi.fn(), onRedo: vi.fn(), canUndo: true, canRedo: false, onFit: vi.fn(), onActualSize: vi.fn(),
    onExport: vi.fn(), onImport: vi.fn(), onPreview: vi.fn(), onTutorial: vi.fn(), onShortcuts: vi.fn(),
    onRenameProject: vi.fn(), savedProjects: [{ id: project.id, name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt, size: 0 }], projectsOpen: false, onToggleProjects: vi.fn(), onNewProject: vi.fn(), onOpenProject: vi.fn(),
  }
  const bubbled = vi.fn()
  function Harness() {
    const [open, setOpen] = useState(false)
    return <div onKeyDown={bubbled}><TopBar {...props} projectsOpen={open} onToggleProjects={() => setOpen((value) => !value)} /></div>
  }
  render(<Harness />)
  return { props, bubbled }
}

describe('toolbar refinements', () => {
  it('closes file options after an action and after outside clicks', () => {
    const { props } = toolbar()
    click(button('More export options'))
    click(button('Import Layer file'))
    expect(props.onImport).toHaveBeenCalledOnce()
    expect(host.querySelector('.export-menu')).toBeNull()
    click(button('More export options'))
    act(() => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(host.querySelector('.export-menu')).toBeNull()
  })
  it('Escape restores trigger focus without reaching canvas shortcuts', () => {
    const { bubbled } = toolbar()
    click(button('More export options'))
    key(button('Import Layer file'), 'Escape')
    expect(bubbled).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(button('More export options'))
    expect(button('More export options').getAttribute('aria-expanded')).toBe('false')
  })
  it('offers project rename, trims the name, and commits only once', () => {
    const { props } = toolbar()
    click(host.querySelector('.project-name')!)
    click(button('Rename current project'))
    expect(host.querySelector('.projects-menu')).toBeNull()
    const input = host.querySelector<HTMLInputElement>('[aria-label="Project name"]')!
    type(input, '  My revised project  ')
    key(input, 'Enter')
    expect(props.onRenameProject).toHaveBeenCalledExactlyOnceWith('My revised project')
    expect(document.activeElement).toBe(host.querySelector('.project-name'))
  })
  it('does not reload a stale saved copy when the current project is clicked', () => {
    const { props } = toolbar()
    click(host.querySelector('.project-name')!)
    click(host.querySelector('.saved-project-list button.current')!)
    expect(props.onOpenProject).not.toHaveBeenCalled()
    expect(host.querySelector('.projects-menu')).toBeNull()
  })
})

describe('inline rename safety', () => {
  it.each(['', '   ', 'Original'])('does not commit empty or unchanged names: %j', (value) => {
    const onCommit = vi.fn(), onCancel = vi.fn()
    render(<InlineRename value="Original" label="Name" onCommit={onCommit} onCancel={onCancel} />)
    const input = host.querySelector('input')!
    type(input, value)
    key(input, 'Enter')
    act(() => input.blur())
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })
  it('Escape cancels without committing on subsequent blur', () => {
    const onCommit = vi.fn(), onCancel = vi.fn()
    render(<InlineRename value="Original" label="Name" onCommit={onCommit} onCancel={onCancel} />)
    const input = host.querySelector('input')!
    type(input, 'Discard me')
    key(input, 'Escape')
    act(() => input.blur())
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

function layerList(locked = false) {
  const page = createInitialProject().pages[0]
  page.elements = [
    makeElement('frame', { id: 'shell', name: 'Shell', locked }),
    makeElement('group', { id: 'inner', name: 'Inner group', parentId: 'shell' }),
    makeElement('text', { id: 'needle', name: 'Needle title', parentId: 'inner', text: 'Nested message' }),
    makeElement('rect', { id: 'sibling', name: 'Unrelated shape', parentId: 'shell' }),
  ]
  const callbacks = { onSelect: vi.fn(), onToggleVisible: vi.fn(), onToggleLocked: vi.fn(), onRename: vi.fn() }
  render(<LayersPanel page={page} selectedIds={['shell']} {...callbacks} />)
  return { page, callbacks, search: host.querySelector<HTMLInputElement>('[aria-label="Find layer"]')! }
}

describe('layer list refinements', () => {
  it('finds nested matches with ancestor context and restores collapsed state after clearing', () => {
    const { search } = layerList()
    const initialRows = host.querySelectorAll('.layer-row').length
    type(search, '   NEEDLE   ')
    expect([...host.querySelectorAll('.layer-name')].map((el) => el.textContent)).toEqual(['Shell', 'Inner group', 'Needle title'])
    expect(host.querySelector('.layers-help')?.textContent).toContain('1 match')
    click(button('Clear layer search'))
    expect(host.querySelectorAll('.layer-row')).toHaveLength(initialRows)
    expect(document.activeElement).toBe(search)
  })
  it('Escape clears only the filter', () => {
    const { search, callbacks } = layerList()
    type(search, 'not found')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('No matching layers')
    key(search, 'Escape')
    expect(search.value).toBe('')
    expect(callbacks.onSelect).not.toHaveBeenCalled()
  })
  it('renames with F2 and restores keyboard focus', () => {
    const { callbacks } = layerList()
    key(button('Shell'), 'F2')
    const input = host.querySelector<HTMLInputElement>('[aria-label="Layer name"]')!
    type(input, '  New shell  ')
    key(input, 'Enter')
    expect(callbacks.onRename).toHaveBeenCalledExactlyOnceWith('shell', 'New shell')
    expect(document.activeElement).toBe(button('Shell'))
  })
  it('respects locked ancestors when renaming a filtered child', () => {
    const { search, callbacks } = layerList(true)
    type(search, 'Needle')
    key(button('Needle title'), 'F2')
    expect(host.querySelector('[aria-label="Layer name"]')).toBeNull()
    expect(callbacks.onRename).not.toHaveBeenCalled()
  })
  it('eye and lock actions identify their own row without selecting it', () => {
    const { search, callbacks } = layerList()
    type(search, 'Needle')
    const row = host.querySelector('[data-layer-id="needle"]')!
    click(row.querySelector('[aria-label="Hide layer"]')!)
    click(row.querySelector('[aria-label="Lock layer"]')!)
    expect(callbacks.onToggleVisible).toHaveBeenCalledExactlyOnceWith('needle')
    expect(callbacks.onToggleLocked).toHaveBeenCalledExactlyOnceWith('needle')
    expect(callbacks.onSelect).not.toHaveBeenCalled()
  })
  it('search includes text and terminates on invalid cyclic input', () => {
    const { page } = layerList()
    page.elements[0].parentId = 'inner'
    const result = filterLayerTree(page, 'nested message')
    expect([...result.matches]).toEqual(['needle'])
    expect([...result.visible]).toEqual(['needle', 'inner', 'shell'])
  })
})
