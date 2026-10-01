import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Icon, type IconName } from './components/Icon'
import { Canvas, type CanvasContextMenu, type CanvasSelectionRect } from './components/Canvas'
import { Inspector } from './components/Inspector'
import { LayersPanel } from './components/LayersPanel'
import { AssetsPanel, ConnectionsPanel, ReviewPanel } from './components/WorkspacePanels'
import { AiPanel } from './components/AiPanel'
import { TopBar } from './components/TopBar'
import { Tutorial } from './components/Tutorial'
import { CornerEditor } from './components/CornerEditor'
import { TooltipLayer } from './components/TooltipLayer'
import { ThemeChooser } from './components/ThemePicker'
import { SelectField } from './components/SelectField'
import PreviewExperience from './components/PreviewExperience'
import type { DesignElement, ElementType, Page, Project, ViewState } from './lib/model'
import { applyThemeToProject, cloneElement, createInitialProject, createPage, deepCloneProject, exportableProject, getActivePage, makeElement, resetPageBackground, setPageBackground, uid } from './lib/model'
import { applyOperations, requestAiStream, type AiScope } from './lib/ai'
import { exportProjectPackage, listSavedProjects, loadProject, loadSavedProject, projectBuilderPrompt, readFileAsDataUrl, readLayerFile, saveProject, type SavedProjectSummary } from './lib/storage'
import { artifactToDataUrl, captureCanvas } from './lib/capture'
import { groupElements, isLockedByAncestor, nestElement, reorderElements, ungroupElements } from './lib/operations'
import { getAbsoluteRect, isDescendant } from './lib/geometry'
import { computeLayout } from './lib/layout'
import { isThemeId, type ThemeId } from './lib/themes'
import { APP_ICON_URL } from './lib/brand'
import { SafeImage } from './components/SafeImage'

export type Tool = 'select' | 'hand' | 'cut' | ElementType

const defaultView: ViewState = { zoom: 0.74, panX: 100, panY: 80, viewportWidth: 1096, mode: 'design', panel: 'inspector' }
const THEME_STORAGE_KEY = 'layer.theme.v1'

const readStoredTheme = (): ThemeId => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeId(stored) ? stored : 'black'
  } catch {
    return 'black'
  }
}

const readImageDimensions = (src: string): Promise<{ width: number; height: number }> => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height })
  image.onerror = () => reject(new Error('Image dimensions unavailable'))
  image.src = src
})

export default function App() {
  const [project, setProject] = useState<Project>(() => applyThemeToProject(loadProject(), readStoredTheme()))
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [view, setView] = useState<ViewState>(defaultView)
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [history, setHistory] = useState<Project[]>([])
  const [future, setFuture] = useState<Project[]>([])
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'recovered'>('saved')
  const [lastAction, setLastAction] = useState('Ready')
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null)
  const [selectionRect, setSelectionRect] = useState<CanvasSelectionRect | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [tutorialOpen, setTutorialOpen] = useState(() => new URLSearchParams(window.location.search).get('skipTour') !== '1' && localStorage.getItem('layer.tutorial.dismissed') !== 'true')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showPageMenu, setShowPageMenu] = useState(false)
  const [aiScope, setAiScope] = useState<'selection' | 'page' | 'project'>('selection')
  const [aiMessages, setAiMessages] = useState<{ id: string; role: 'user' | 'assistant' | 'system'; text: string; status?: 'working' | 'error' }[]>([
    { id: 'welcome', role: 'assistant', text: 'Select a layer or ask about this page. I can make small, reversible edits without a provider connection.' },
  ])
  const [aiBusy, setAiBusy] = useState(false)
  const [aiProposal, setAiProposal] = useState<{ label: string; apply: () => void } | null>(null)
  const aiAbortRef = useRef<AbortController | null>(null)
  const [aiImageRefs, setAiImageRefs] = useState<{ url: string; mimeType?: string; label?: string }[]>([])
  const [savedProjects, setSavedProjects] = useState<SavedProjectSummary[]>([])
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [previewState, setPreviewState] = useState<Record<string, boolean>>({})
  const [previewOpen, setPreviewOpen] = useState(false)
  const [tutorialStep, setTutorialStep] = useState(0)
  const [sidebarSizes, setSidebarSizes] = useState({ pages: 234, inspector: 322 })
  const [sidebarOpen, setSidebarOpen] = useState(() => ({ pages: typeof window === 'undefined' || window.innerWidth > 650, inspector: typeof window === 'undefined' || window.innerWidth > 900 }))
  const [cornerEditorOpen, setCornerEditorOpen] = useState(false)
  const [cutEditorOpen, setCutEditorOpen] = useState(false)
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme)
  const [themeChooserOpen, setThemeChooserOpen] = useState(() => !new URLSearchParams(window.location.search).has('skipTour') && localStorage.getItem('layer.tutorial.dismissed') === 'true' && !localStorage.getItem(THEME_STORAGE_KEY))
  const themePendingRef = useRef(!new URLSearchParams(window.location.search).has('skipTour') && !localStorage.getItem(THEME_STORAGE_KEY))
  const beforeTransformRef = useRef<Project | null>(null)
  const sidebarResizeRef = useRef<{ target: 'pages' | 'inspector'; pointerId: number; startClientX: number; startValue: number } | null>(null)
  const sidebarSizesRef = useRef(sidebarSizes)
  const sidebarOpenRef = useRef(sidebarOpen)
  const saveTimer = useRef<number | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const layerInputRef = useRef<HTMLInputElement>(null)
  const aiReferenceInputRef = useRef<HTMLInputElement>(null)
  const appRootRef = useRef<HTMLDivElement>(null)
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const editorShellRef = useRef<HTMLDivElement>(null)

  sidebarSizesRef.current = sidebarSizes
  sidebarOpenRef.current = sidebarOpen

  const page = getActivePage(project)
  const selected = useMemo(() => page.elements.filter((element) => selectedIds.includes(element.id)), [page.elements, selectedIds])
  const activeObject = selected.length === 1 ? selected[0] : undefined

  useEffect(() => {
    window.clearTimeout(saveTimer.current)
    setSaveState('saving')
    saveTimer.current = window.setTimeout(() => {
      void saveProject(project)
      setSaveState('saved')
    }, 450)
    return () => window.clearTimeout(saveTimer.current)
  }, [project])

  useEffect(() => {
    void listSavedProjects().then(setSavedProjects).catch(() => setSavedProjects([]))
  }, [project.updatedAt])

  useEffect(() => {
    const handler = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.context-menu')) return
      setContextMenu(null)
    }
    // Capture before React/canvas handlers can stop propagation. This keeps a
    // context menu transient even when the canvas begins a new drag/selection.
    window.addEventListener('pointerdown', handler, true)
    return () => window.removeEventListener('pointerdown', handler, true)
  }, [])

  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const drag = sidebarResizeRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const shellWidth = editorShellRef.current?.clientWidth ?? window.innerWidth
      const railWidth = shellWidth <= 650 ? 42 : shellWidth <= 900 ? 44 : 48
      const minCanvas = shellWidth <= 900 ? 280 : 320
      const other = drag.target === 'pages'
        ? (sidebarOpenRef.current.inspector ? sidebarSizesRef.current.inspector : 0)
        : (sidebarOpenRef.current.pages ? sidebarSizesRef.current.pages : 0)
      const maximum = Math.max(drag.target === 'pages' ? 0 : 0, shellWidth - railWidth - other - minCanvas)
      const delta = event.clientX - drag.startClientX
      const requested = drag.startValue + (drag.target === 'pages' ? delta : -delta)
      const closeAt = drag.target === 'pages' ? 112 : 176
      if (requested <= closeAt) {
        setSidebarOpen((current) => ({ ...current, [drag.target]: false }))
        setSidebarSizes((current) => ({ ...current, [drag.target]: 0 }))
      } else {
        setSidebarOpen((current) => ({ ...current, [drag.target]: true }))
        setSidebarSizes((current) => ({ ...current, [drag.target]: Math.round(Math.min(maximum, Math.max(drag.target === 'pages' ? 170 : 240, requested))) }))
      }
    }
    const finish = (event: globalThis.PointerEvent) => { if (sidebarResizeRef.current?.pointerId === event.pointerId) sidebarResizeRef.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish) }
  }, [])

  const startSidebarResize = (target: 'pages' | 'inspector', event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    sidebarResizeRef.current = { target, pointerId: event.pointerId, startClientX: event.clientX, startValue: sidebarOpen[target] ? sidebarSizes[target] : 0 }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* pointer capture is optional */ }
  }

  const resetSidebar = (target: 'pages' | 'inspector') => {
    setSidebarOpen((current) => ({ ...current, [target]: true }))
    setSidebarSizes((current) => ({ ...current, [target]: target === 'pages' ? 234 : 322 }))
  }

  const openPanel = useCallback((panel: ViewState['panel']) => {
    setSidebarOpen((current) => ({ ...current, inspector: true }))
    setView((current) => ({ ...current, panel }))
  }, [])

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((current) => current === message ? null : current), 2600)
  }, [])

  const openPreview = useCallback(() => {
    setPreviewState({})
    setPreviewOpen(true)
  }, [])

  const closePreview = useCallback(() => setPreviewOpen(false), [])

  const closeTutorial = useCallback(() => { setTutorialOpen(false); localStorage.setItem('layer.tutorial.dismissed', 'true'); if (themePendingRef.current) setThemeChooserOpen(true) }, [])

  useEffect(() => { document.documentElement.dataset.theme = theme; return () => { delete document.documentElement.dataset.theme } }, [theme])
  useEffect(() => { window.requestAnimationFrame(() => appRootRef.current?.focus({ preventScroll: true })) }, [])

  const updateProject = useCallback((mutator: (draft: Project) => void, label = 'Updated') => {
    setProject((current) => {
      const draft = deepCloneProject(current)
      mutator(draft)
      draft.updatedAt = new Date().toISOString()
      return draft
    })
    setLastAction(label)
  }, [])

  const commit = useCallback((mutator: (draft: Project) => void, label: string, before = project) => {
    setHistory((items) => [...items, deepCloneProject(before)].slice(-80))
    setFuture([])
    setProject((current) => {
      const draft = deepCloneProject(current)
      mutator(draft)
      draft.updatedAt = new Date().toISOString()
      return draft
    })
    setLastAction(label)
  }, [project])

  const setTheme = useCallback((next: ThemeId) => {
    try { localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* local storage is optional */ }
    if (next === theme) return
    commit((draft) => { draft.pages = applyThemeToProject(draft, next).pages }, `Changed workspace theme to ${next}`)
    setThemeState(next)
  }, [commit, theme])

  const updatePageElement = useCallback((id: string, patch: Partial<DesignElement>, label = 'Updated layer') => {
    updateProject((draft) => {
      const target = draft.pages.find((candidate) => candidate.id === draft.activePageId)
      const element = target?.elements.find((candidate) => candidate.id === id)
      if (element && !element.locked) Object.assign(element, patch)
    }, label)
  }, [updateProject])

  const updatePage = useCallback((patch: Partial<Page>, label = 'Updated page') => {
    updateProject((draft) => {
      const target = draft.pages.find((candidate) => candidate.id === draft.activePageId)
      if (!target) return
      const { background, backgroundProvenance, ...pagePatch } = patch
      Object.assign(target, pagePatch)
      if (typeof background === 'string') Object.assign(target, setPageBackground(target, background))
      else if (backgroundProvenance) target.backgroundProvenance = backgroundProvenance
    }, label)
  }, [updateProject])

  const resetCanvasBackground = useCallback(() => {
    commit((draft) => {
      const target = draft.pages.find((candidate) => candidate.id === draft.activePageId)
      if (target) Object.assign(target, resetPageBackground(target, theme))
    }, 'Reset canvas background')
  }, [commit, theme])

  const commitPageElement = useCallback((id: string, patch: Partial<DesignElement>, label = 'Updated layer') => {
    commit((draft) => {
      const target = draft.pages.find((candidate) => candidate.id === draft.activePageId)
      const element = target?.elements.find((candidate) => candidate.id === id)
      if (element && !element.locked) Object.assign(element, patch)
    }, label)
  }, [commit])

  const select = useCallback((id: string, additive = false, toggle = false) => {
    setSelectedIds((current) => {
      if (!additive && !toggle) return [id]
      if (toggle || additive) return current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      return [id]
    })
    setSidebarOpen((current) => ({ ...current, inspector: true }))
    setView((current) => ({ ...current, panel: 'inspector' }))
  }, [])

  const clearSelection = useCallback(() => setSelectedIds([]), [])

  const createElement = useCallback((type: ElementType) => {
    const base = makeElement(type, { x: Math.max(40, (page.width - 220) / 2), y: Math.max(64, 120 + page.elements.length * 12) })
    if (type === 'image') base.alt = 'Describe this image'
    if (type === 'icon') base.iconName = 'material-symbols:layers-outline'
    commit((draft) => draft.pages.find((candidate) => candidate.id === draft.activePageId)?.elements.push(base), `Added ${base.name.toLowerCase()}`)
    setSelectedIds([base.id])
    setActiveTool('select')
  }, [commit, page.elements.length, page.width])

  const openCutEditor = useCallback((id?: string) => {
    const target = page.elements.find((element) => element.id === id) ?? (id ? undefined : activeObject)
    if (!target) { notify('Select a layer first, then choose Cut corners.') ; return }
    if (target.locked || isLockedByAncestor(page, target.id)) { notify('Unlock this layer before cutting its corners.'); return }
    setSelectedIds([target.id]); setActiveTool('cut'); setCornerEditorOpen(false); setCutEditorOpen(true); setContextMenu(null)
  }, [activeObject, notify, page])

  const duplicateSelected = useCallback(() => {
    if (!selected.length) return
    const copies = selected.filter((element) => !element.locked).map((element) => cloneElement(element))
    if (!copies.length) return notify('Locked layers cannot be duplicated.')
    commit((draft) => draft.pages.find((candidate) => candidate.id === draft.activePageId)?.elements.push(...copies), `Duplicated ${copies.length} layer${copies.length === 1 ? '' : 's'}`)
    setSelectedIds(copies.map((element) => element.id))
  }, [commit, notify, selected])

  const deleteSelected = useCallback(() => {
    const removable = new Set(selected.filter((element) => !element.locked).map((element) => element.id))
    if (!removable.size) return notify('Locked layers cannot be deleted.')
    commit((draft) => {
      const target = draft.pages.find((candidate) => candidate.id === draft.activePageId)
      if (target) target.elements = target.elements.filter((element) => !removable.has(element.id) && !element.parentId || !removable.has(element.id))
    }, `Deleted ${removable.size} layer${removable.size === 1 ? '' : 's'}`)
    setSelectedIds([])
  }, [commit, notify, selected])

  const groupSelected = useCallback(() => {
    if (selected.length < 2) return notify('Select two or more layers to group.')
    const groupId = uid('group')
    const grouped = groupElements(page, selectedIds, { groupId, groupName: 'Group', groupPadding: 12 })
    if (!grouped.elements.some((element) => element.id === groupId)) return notify('Locked layers cannot be grouped.')
    commit((draft) => {
      const target = draft.pages.find((candidate) => candidate.id === draft.activePageId)
      if (target) target.elements = grouped.elements
    }, `Grouped ${selected.length} layers`)
    setSelectedIds([groupId])
  }, [commit, notify, page, selected, selectedIds])

  const ungroupSelected = useCallback(() => {
    const groups = selected.filter((element) => element.type === 'group')
    if (!groups.length) return notify('Select a group to ungroup it.')
    const ungrouped = ungroupElements(page, groups.map((group) => group.id))
    commit((draft) => {
      const target = draft.pages.find((candidate) => candidate.id === draft.activePageId)
      if (target) target.elements = ungrouped.elements
    }, 'Ungrouped layers')
    setSelectedIds([])
  }, [commit, notify, page, selected])

  const toggleLocked = useCallback(() => {
    if (!selected.length) return
    commit((draft) => {
      const target = draft.pages.find((candidate) => candidate.id === draft.activePageId)
      target?.elements.forEach((item) => { if (selectedIds.includes(item.id)) item.locked = !item.locked })
    }, selected.every((item) => item.locked) ? 'Unlocked layers' : 'Locked layers')
  }, [commit, selected, selectedIds])

  const toggleVisible = useCallback(() => {
    if (!selected.length) return
    commit((draft) => {
      const target = draft.pages.find((candidate) => candidate.id === draft.activePageId)
      target?.elements.forEach((item) => { if (selectedIds.includes(item.id)) item.visible = !item.visible })
    }, 'Toggled visibility')
  }, [commit, selected, selectedIds])

  const toggleLayerFlag = useCallback((id: string, flag: 'visible' | 'locked') => {
    commit((draft) => {
      const item = draft.pages.find((candidate) => candidate.id === draft.activePageId)?.elements.find((candidate) => candidate.id === id)
      if (item) item[flag] = !item[flag]
    }, flag === 'visible' ? 'Toggled layer visibility' : 'Toggled layer lock')
  }, [commit])

  const reorder = useCallback((direction: 'up' | 'down') => {
    if (!selectedIds.length) return
    commit((draft) => {
      const target = draft.pages.find((candidate) => candidate.id === draft.activePageId)
      if (!target) return
      const selectedSet = new Set(selectedIds)
      const indexes = target.elements.map((element, index) => selectedSet.has(element.id) ? index : -1).filter((index) => index >= 0)
      if (direction === 'up') {
        for (const index of indexes) if (index < target.elements.length - 1 && !selectedSet.has(target.elements[index + 1].id)) [target.elements[index], target.elements[index + 1]] = [target.elements[index + 1], target.elements[index]]
      } else {
        for (const index of [...indexes].reverse()) if (index > 0 && !selectedSet.has(target.elements[index - 1].id)) [target.elements[index], target.elements[index - 1]] = [target.elements[index - 1], target.elements[index]]
      }
    }, direction === 'up' ? 'Brought forward' : 'Sent backward')
  }, [commit, selectedIds])

  const moveLayer = useCallback((sourceId: string, targetId: string, position: 'before' | 'after' | 'inside') => {
    if (sourceId === targetId) return
    const source = page.elements.find((element) => element.id === sourceId)
    const target = page.elements.find((element) => element.id === targetId)
    if (!source || !target || source.locked || isLockedByAncestor(page, sourceId) || (position === 'inside' && (!target.layout || target.locked))) return
    if (isDescendant(targetId, sourceId, page)) return notify('A layer cannot be moved into its own group.')

    const staged = position === 'inside' ? nestElement(page, sourceId, targetId) : nestElement(page, sourceId, target.parentId)
    let nextPage = staged
    if (position === 'inside') {
      nextPage = reorderElements(staged, [sourceId], 'front')
    } else {
      const parentId = target.parentId
      const siblings = nextPage.elements.filter((element) => element.parentId === parentId)
      const sourceIndex = siblings.findIndex((element) => element.id === sourceId)
      const targetIndex = siblings.findIndex((element) => element.id === targetId)
      if (sourceIndex < 0 || targetIndex < 0) return
      const ordered = siblings.filter((element) => element.id !== sourceId)
      const insertAt = Math.max(0, targetIndex - (sourceIndex < targetIndex ? 1 : 0) + (position === 'after' ? 1 : 0))
      ordered.splice(insertAt, 0, nextPage.elements.find((element) => element.id === sourceId)!)
      let cursor = 0
      nextPage.elements = nextPage.elements.map((element) => element.parentId === parentId ? ordered[cursor++] : element)
    }

    commit((draft) => {
      const current = draft.pages.find((candidate) => candidate.id === draft.activePageId)
      if (current) current.elements = nextPage.elements
    }, position === 'inside' ? 'Nested layer' : 'Reordered layer')
    setSelectedIds([sourceId])
  }, [commit, notify, page])

  const alignSelected = useCallback((mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute') => {
    if (selected.length < 2) return notify('Select multiple layers to align or distribute them.')
    const next = deepCloneProject(project)
    const target = next.pages.find((candidate) => candidate.id === next.activePageId)
    if (!target) return
    const objects = target.elements.filter((item) => selectedIds.includes(item.id) && !item.locked)
    if (mode === 'left') { const value = Math.min(...objects.map((item) => item.x)); objects.forEach((item) => { item.x = value }) }
    if (mode === 'right') { const value = Math.max(...objects.map((item) => item.x + item.width)); objects.forEach((item) => { item.x = value - item.width }) }
    if (mode === 'top') { const value = Math.min(...objects.map((item) => item.y)); objects.forEach((item) => { item.y = value }) }
    if (mode === 'bottom') { const value = Math.max(...objects.map((item) => item.y + item.height)); objects.forEach((item) => { item.y = value - item.height }) }
    if (mode === 'center') { const value = (Math.min(...objects.map((item) => item.x)) + Math.max(...objects.map((item) => item.x + item.width))) / 2; objects.forEach((item) => { item.x = value - item.width / 2 }) }
    if (mode === 'middle') { const value = (Math.min(...objects.map((item) => item.y)) + Math.max(...objects.map((item) => item.y + item.height))) / 2; objects.forEach((item) => { item.y = value - item.height / 2 }) }
    if (mode === 'distribute') {
      const sorted = [...objects].sort((a, b) => a.x - b.x); const start = sorted[0].x; const end = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width; const gaps = (end - start - sorted.reduce((sum, item) => sum + item.width, 0)) / Math.max(1, sorted.length - 1)
      let x = start; sorted.forEach((item) => { item.x = x; x += item.width + gaps })
    }
    setHistory((items) => [...items, deepCloneProject(project)].slice(-80)); setFuture([]); setProject(next); setLastAction(`Aligned ${objects.length} layers`)
  }, [notify, project, selected, selectedIds])

  const fitPage = useCallback(() => {
    const host = canvasHostRef.current
    if (!host) return
    const padding = 80
    const zoom = Math.min((host.clientWidth - padding) / page.width, (host.clientHeight - padding) / page.height, 1.4)
    setView((current) => ({ ...current, zoom: Math.max(0.25, zoom), panX: Math.max(20, (host.clientWidth - page.width * zoom) / 2), panY: Math.max(24, (host.clientHeight - page.height * zoom) / 2) }))
  }, [page.height, page.width])

  const actualSize = useCallback(() => setView((current) => ({ ...current, zoom: 1 })), [])

  useEffect(() => { fitPage() }, [fitPage, view.viewportWidth])

  const startTransform = useCallback(() => { beforeTransformRef.current = deepCloneProject(project) }, [project])
  const endTransform = useCallback((label = 'Moved layer') => {
    const before = beforeTransformRef.current
    beforeTransformRef.current = null
    if (before) {
      setHistory((items) => [...items, before].slice(-80))
      setFuture([])
      setLastAction(label)
    }
  }, [])

  const addPage = useCallback(() => {
    const next = createPage({ theme, name: `Page ${project.pages.length + 1}`, width: 960, height: 760 })
    commit((draft) => { draft.pages.push(next); draft.activePageId = next.id }, 'Created page')
    setSelectedIds([])
  }, [commit, project.pages.length, theme])

  const duplicatePage = useCallback(() => {
    const source = deepCloneProject(project).pages.find((candidate) => candidate.id === project.activePageId)
    if (!source) return
    const clone: Page = { ...source, id: uid('page'), name: `${source.name} copy`, elements: source.elements.map((element) => ({ ...element, id: uid('el'), interactions: element.interactions.map((interaction) => ({ ...interaction, id: uid('int') })) })) }
    commit((draft) => draft.pages.splice(draft.pages.findIndex((candidate) => candidate.id === source.id) + 1, 0, clone), 'Duplicated page')
    setProject((current) => ({ ...current, activePageId: clone.id }))
    setSelectedIds([])
  }, [commit, project])

  const renamePage = useCallback((pageId: string) => {
    const current = project.pages.find((candidate) => candidate.id === pageId)
    const name = window.prompt('Page name', current?.name ?? 'Page')?.trim()
    if (!name || name === current?.name) return
    commit((draft) => { const target = draft.pages.find((candidate) => candidate.id === pageId); if (target) target.name = name }, 'Renamed page')
  }, [commit, project.pages])

  const deletePage = useCallback((pageId: string) => {
    if (project.pages.length <= 1) return notify('A project needs at least one page.')
    const target = project.pages.find((candidate) => candidate.id === pageId)
    if (!target || !window.confirm(`Delete “${target.name}”?`)) return
    const nextId = project.pages.find((candidate) => candidate.id !== pageId)?.id ?? project.pages[0].id
    commit((draft) => { draft.pages = draft.pages.filter((candidate) => candidate.id !== pageId); draft.activePageId = draft.activePageId === pageId ? nextId : draft.activePageId }, 'Deleted page')
    setSelectedIds([])
  }, [commit, notify, project.pages])

  const setActivePage = useCallback((pageId: string) => { setProject((current) => ({ ...current, activePageId: pageId })); setSelectedIds([]); setSidebarOpen((current) => ({ ...current, inspector: true })); setView((current) => ({ ...current, panel: 'inspector' })); setShowPageMenu(false) }, [])

  const handleCanvasSelection = useCallback((rect: CanvasSelectionRect | null, additive = false) => {
    if (!rect) { setSelectionRect(null); return }
    setSelectionRect(rect)
    const minX = Math.min(rect.startX, rect.endX); const maxX = Math.max(rect.startX, rect.endX); const minY = Math.min(rect.startY, rect.endY); const maxY = Math.max(rect.startY, rect.endY)
    const selectionLayout = computeLayout(page, { width: Math.max(1, view.viewportWidth || page.width) })
    const hits = page.elements.filter((element) => {
      if (!element.visible) return false
      const bounds = selectionLayout.rects[element.id] ?? getAbsoluteRect(element, page)
      return bounds.x < maxX && bounds.x + bounds.width > minX && bounds.y < maxY && bounds.y + bounds.height > minY
    }).map((element) => element.id)
    setSelectedIds((current) => additive ? Array.from(new Set([...current, ...hits])) : hits)
  }, [page, view.viewportWidth])

  const handleContextMenu = useCallback((menu: CanvasContextMenu) => setContextMenu(menu), [])

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return
    try { const imported = applyThemeToProject(await readLayerFile(file), theme); setHistory((items) => [...items, deepCloneProject(project)].slice(-80)); setFuture([]); setProject(imported); setSelectedIds([]); setSaveState('recovered'); notify('Layer project imported.') } catch (error) { notify(error instanceof Error ? error.message : 'Could not import this project.') }
    event.target.value = ''
  }

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return
    try {
      const src = await readFileAsDataUrl(file)
      const dimensions = await readImageDimensions(src).catch(() => ({ width: 3, height: 2 }))
      const scale = Math.min(1, 360 / Math.max(1, dimensions.width), 240 / Math.max(1, dimensions.height))
      const image = makeElement('image', { name: file.name, src, alt: file.name.replace(/\.[^.]+$/, ''), width: Math.max(32, Math.round(dimensions.width * scale)), height: Math.max(32, Math.round(dimensions.height * scale)), x: 160, y: 180, fill: '#1a2029', stroke: '#556070', imageFit: 'contain', imagePosition: 'center', aspectRatioLocked: true })
      commit((draft) => { const target = draft.pages.find((candidate) => candidate.id === draft.activePageId); target?.elements.push(image); target && draft.assets.push({ id: uid('asset'), name: file.name, kind: 'image', src, source: 'Local upload', license: 'User supplied', installedAt: new Date().toISOString() }) }, 'Inserted image')
      setSelectedIds([image.id]); setActiveTool('select'); notify('Image inserted. Add alt text in the inspector.')
    } catch { notify('Could not read this image.') }
    event.target.value = ''
  }

  const undo = useCallback(() => {
    const previous = history.at(-1); if (!previous) return notify('Nothing to undo.')
    setFuture((items) => [deepCloneProject(project), ...items].slice(0, 80)); setProject(previous); setHistory((items) => items.slice(0, -1)); setLastAction('Undid last action')
  }, [history, notify, project])

  const redo = useCallback(() => {
    const next = future[0]; if (!next) return notify('Nothing to redo.')
    setHistory((items) => [...items, deepCloneProject(project)].slice(-80)); setProject(next); setFuture((items) => items.slice(1)); setLastAction('Redid action')
  }, [future, notify, project])

  const copySelected = useCallback(async () => {
    if (!selected.length) return
    const payload = JSON.stringify(selected.map((element) => exportableProject({ ...project, pages: [{ ...page, elements: [element] }] }).pages[0].elements[0]))
    try { await navigator.clipboard.writeText(payload); notify('Copied layer data to the clipboard.') } catch { notify('Clipboard access is unavailable; use Duplicate instead.') }
  }, [notify, page, project, selected])

  const paste = useCallback(async () => {
    try {
      const raw = await navigator.clipboard.readText(); const parsed = JSON.parse(raw) as DesignElement[]
      if (!Array.isArray(parsed) || !parsed[0]?.type) throw new Error('Clipboard does not contain Layer layers.')
      const pasted = parsed.map((element) => cloneElement(element, 32))
      commit((draft) => draft.pages.find((candidate) => candidate.id === draft.activePageId)?.elements.push(...pasted), 'Pasted layers'); setSelectedIds(pasted.map((element) => element.id))
    } catch { notify('Nothing usable was found in the clipboard.') }
  }, [commit, notify])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
    if (showShortcuts) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setShowShortcuts(false)
      }
      return
    }
    const target = event.target as HTMLElement
    const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
    if (isTyping) return
    const modifier = event.ctrlKey || event.metaKey
    // Keep native text copying and control navigation out of canvas shortcuts.
    if (modifier && event.key.toLowerCase() === 'c' && window.getSelection()?.toString()) return
    if (event.key.startsWith('Arrow') && target.closest('button, a, [role="button"]')) return
    if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
    if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return }
    if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); return }
    if (modifier && event.key.toLowerCase() === 'g') { event.preventDefault(); event.shiftKey ? ungroupSelected() : groupSelected(); return }
    if (modifier && event.key.toLowerCase() === 'm' && selected.length === 1) { event.preventDefault(); setCutEditorOpen(false); setCornerEditorOpen(true); setActiveTool('select'); return }
    if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); if (selected.length === 1) openCutEditor(activeObject?.id); else void copySelected(); return }
    if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); void paste(); return }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); return }
    if (event.key === 'Escape') { if (cornerEditorOpen) { setCornerEditorOpen(false); setActiveTool('select'); return } if (cutEditorOpen) { setCutEditorOpen(false); setActiveTool('select'); return } setSelectedIds([]); setContextMenu(null); setSelectionRect(null); return }
    if (event.key === 'Enter' && modifier && selected.length === 1) { openPanel('ai'); return }
    if (!modifier) {
      const shortcut = event.key.toLowerCase()
      if (shortcut === 't') { event.preventDefault(); createElement('text'); return }
      if (shortcut === 'v') { event.preventDefault(); setActiveTool('select'); return }
      if (shortcut === 'h') { event.preventDefault(); setActiveTool('hand'); return }
      if (shortcut === 'f') { event.preventDefault(); setActiveTool('frame'); createElement('frame'); return }
      if (shortcut === 'r') { event.preventDefault(); setActiveTool('rect'); createElement('rect'); return }
      if (shortcut === 'c' && selected.length === 1) { event.preventDefault(); openCutEditor(activeObject?.id); return }
    }
    const amount = event.shiftKey ? 10 : 1
    const delta = event.key === 'ArrowLeft' ? { x: -amount } : event.key === 'ArrowRight' ? { x: amount } : event.key === 'ArrowUp' ? { y: -amount } : event.key === 'ArrowDown' ? { y: amount } : null
    if (delta && selected.length) { event.preventDefault(); selected.forEach((element) => updatePageElement(element.id, { x: element.x + (delta.x ?? 0), y: element.y + (delta.y ?? 0) }, 'Nudged layer')) }
  }

  const runPreviewAction = useCallback((element: DesignElement) => {
    element.interactions.filter((interaction) => interaction.trigger === 'click').forEach((interaction) => {
      if (interaction.action === 'navigate' && interaction.pageId) setActivePage(interaction.pageId)
      if (interaction.action === 'toggle-visibility' && interaction.targetId) setPreviewState((current) => ({ ...current, [interaction.targetId as string]: !current[interaction.targetId as string] }))
      if (interaction.action === 'animate') { setPreviewState((current) => ({ ...current, [`animate:${element.id}`]: true })); window.setTimeout(() => setPreviewState((current) => ({ ...current, [`animate:${element.id}`]: false })), interaction.duration ?? 500) }
      if (interaction.action === 'submit-form') notify('Prototype form submitted. Connect a production endpoint after export.')
    })
  }, [notify, setActivePage])

  const askLayer = useCallback((ids: string[]) => { setSelectedIds(ids); setAiScope('selection'); openPanel('ai'); setContextMenu(null) }, [openPanel])

  const createComponent = useCallback(() => {
    if (!selected.length) return notify('Select a layer first.')
    const componentId = uid('component')
    commit((draft) => {
      const target = draft.pages.find((candidate) => candidate.id === draft.activePageId)
      if (!target) return
      target.elements.forEach((element) => { if (selectedIds.includes(element.id)) element.componentId = componentId })
      draft.components.push({ id: componentId, name: selected.length === 1 ? `${selected[0].name} component` : 'Section component', elementIds: [...selectedIds], sourcePageId: target.id, updatedAt: new Date().toISOString(), variants: ['Default', 'Hover'] })
    }, 'Created component')
    notify('Component created. Use Insert instance from the component menu.')
  }, [commit, notify, selected, selectedIds])

  const insertComponent = useCallback((componentId: string) => {
    const component = project.components.find((candidate) => candidate.id === componentId); if (!component) return
    const sourcePage = project.pages.find((candidate) => candidate.id === component.sourcePageId); if (!sourcePage) return
    const sources = sourcePage.elements.filter((element) => component.elementIds.includes(element.id)); const clones = sources.map((element) => ({ ...cloneElement(element, 42), componentId }))
    commit((draft) => draft.pages.find((candidate) => candidate.id === draft.activePageId)?.elements.push(...clones), `Inserted ${component.name}`); setSelectedIds(clones.map((element) => element.id))
  }, [commit, project.components, project.pages])

  const insertElements = useCallback((elements: DesignElement[]) => {
    if (!elements.length) return
    commit((draft) => draft.pages.find((candidate) => candidate.id === draft.activePageId)?.elements.push(...elements), `Inserted ${elements.length} layer${elements.length === 1 ? '' : 's'}`)
    setSelectedIds(elements.map((element) => element.id))
    setSidebarOpen((current) => ({ ...current, inspector: true }))
    setView((current) => ({ ...current, panel: 'inspector' }))
  }, [commit])

  const applyStyle = useCallback((styleId: string) => {
    const style = project.styles.find((candidate) => candidate.id === styleId)
    if (!style || !selected.length) { notify(!selected.length ? 'Select a layer before applying a token.' : 'Token not found.'); return }
    const value = style.value.trim()
    commit((draft) => draft.pages.forEach((candidate) => candidate.elements.forEach((element) => {
      if (!selectedIds.includes(element.id) || element.locked) return
      if (style.kind === 'color') element.fill = value
      if (style.kind === 'type') element.fontFamily = value
      if (style.kind === 'spacing') { const spacing = Number(value); if (Number.isFinite(spacing)) element.layout = { ...(element.layout ?? makeElement('group').layout!), gap: spacing } }
      if (style.kind === 'shadow') { try { const parsed = JSON.parse(value) as DesignElement['shadow']; if (parsed && typeof parsed === 'object') element.shadow = parsed } catch { /* keep token application safe */ } }
    })), `Applied ${style.name}`)
    notify(`${style.name} applied to ${selected.length} layer${selected.length === 1 ? '' : 's'}.`)
  }, [commit, notify, project.styles, selected, selectedIds])

  const updateComponent = useCallback(() => {
    if (!activeObject?.componentId) return notify('Select a component source or instance.')
    const componentId = activeObject.componentId; const source = page.elements.find((element) => element.componentId === componentId)
    if (!source) return
    commit((draft) => {
      draft.pages.forEach((candidate) => candidate.elements.forEach((element) => { if (element.componentId === componentId && element.id !== source.id) { element.fill = source.fill; element.stroke = source.stroke; element.fontSize = source.fontSize; element.fontWeight = source.fontWeight; element.radius = source.radius; element.text = source.text } }))
      const definition = draft.components.find((candidate) => candidate.id === componentId); if (definition) definition.updatedAt = new Date().toISOString()
    }, 'Updated component instances'); notify('Matching component instances updated.')
  }, [activeObject?.componentId, commit, notify, page.elements])

  const runLocalAi = useCallback((prompt: string) => {
    const normalized = prompt.toLowerCase()
    const focus = aiScope === 'selection' && selected.length ? selected : aiScope === 'page' ? page.elements : project.pages.flatMap((candidate) => candidate.elements)
    if (normalized.startsWith('/audit') || normalized.includes('check spacing') || normalized.includes('accessibility')) {
      const issues = page.elements.filter((element) => element.type === 'image' && !element.alt).length + page.elements.filter((element) => ['button', 'input'].includes(element.type) && (element.width < 44 || element.height < 44)).length
       return { label: 'Run review checks', apply: () => { openPanel('review'); notify(issues ? `${issues} review finding${issues === 1 ? '' : 's'} found.` : 'No obvious review findings on this page.') } }
    }
    if (normalized.includes('button')) return { label: 'Add a button', apply: () => { createElement('button'); notify('Button added to the current page.') } }
    if (normalized.includes('stack') || normalized.includes('column')) return { label: 'Make a vertical stack', apply: () => { if (!focus.length) return; commit((draft) => draft.pages.forEach((candidate) => candidate.elements.forEach((element) => { if (focus.some((item) => item.id === element.id)) element.layout = { ...(element.layout ?? makeElement('group').layout!), mode: 'column', gap: 16, padding: 24, align: 'stretch', justify: 'start', wrap: false, widthRule: 'fill', heightRule: 'fit', overflow: 'visible' } })), 'Prepared responsive stack'); notify('Responsive stack rules applied to the scoped layers.') } }
    if (normalized.includes('center') || normalized.includes('centre')) return { label: 'Center selected layers', apply: () => alignSelected('center') }
    if (normalized.includes('bigger') || normalized.includes('larger')) return { label: 'Increase selected size', apply: () => { commit((draft) => draft.pages.forEach((candidate) => candidate.elements.forEach((element) => { if (selectedIds.includes(element.id) && !element.locked) { element.width *= 1.1; element.height *= 1.1; if (element.fontSize) element.fontSize = Math.round(element.fontSize * 1.1) } })), 'Increased selected size'); notify('Selected layers increased by 10%.') } }
    if (normalized.includes('rename')) return { label: 'Name selected layers', apply: () => { commit((draft) => draft.pages.forEach((candidate) => candidate.elements.forEach((element) => { if (selectedIds.includes(element.id)) element.name = element.text?.split('\n')[0]?.slice(0, 36) || element.name })), 'Renamed selected layers'); notify('Selected layers renamed from their visible text.') } }
    return { label: 'Add a note to the scope', apply: () => { commit((draft) => { const target = draft.pages.find((candidate) => candidate.id === draft.activePageId); if (aiScope === 'page' && target) target.notes = `${target.notes ? `${target.notes}\n` : ''}Layer AI note: ${prompt}`; target?.elements.forEach((element) => { if (selectedIds.includes(element.id)) element.notes = `${element.notes ? `${element.notes}\n` : ''}Layer AI note: ${prompt}` }) }, 'Added implementation note'); notify('Note added to the scoped document.') } }
   }, [aiScope, alignSelected, commit, createElement, notify, openPanel, page.elements, project.pages, selected, selectedIds])

  const applyAiOperations = useCallback((operations: unknown[], scope: AiScope, responseText: string) => {
    const proposal = {
      label: responseText || `${operations.length} proposed document change${operations.length === 1 ? '' : 's'}`,
      apply: () => {
        try {
          setProject((current) => {
            const next = applyOperations(current, operations, scope)
            next.updatedAt = new Date().toISOString()
            setHistory((items) => [...items, deepCloneProject(current)].slice(-80))
            setFuture([])
            return next
          })
          setLastAction('Applied Layer AI edit')
        } catch (error) {
          notify(error instanceof Error ? `AI edit was rejected: ${error.message}` : 'AI edit was rejected.')
        }
      },
    }
    setAiProposal(proposal)
    if (project.settings.autoApplyAi) {
      proposal.apply()
      setAiProposal(null)
      setAiMessages((messages) => [...messages, { id: uid('msg'), role: 'system', text: 'Applied automatically as one undoable document change.' }])
    }
  }, [notify, project.settings.autoApplyAi])

  const sendAi = useCallback((prompt: string) => {
    if (!prompt.trim() || aiBusy) return
    const clean = prompt.trim()
    const scope: AiScope = aiScope === 'selection'
      ? { type: 'selection', pageId: page.id, ids: [...selectedIds] }
      : aiScope === 'page'
        ? { type: 'page', pageId: page.id }
        : { type: 'project' }
    const aiSettings = project.settings as Project['settings'] & { mainProviderId?: string; visionProviderId?: string }
    const provider = project.providers.find((candidate) => candidate.connected && candidate.id === aiSettings.mainProviderId) ?? project.providers.find((candidate) => candidate.connected)
    const visionProvider = project.providers.find((candidate) => candidate.connected && candidate.id === aiSettings.visionProviderId)
    const assistantMessageId = uid('msg')
    setAiMessages((messages) => [...messages, { id: uid('msg'), role: 'user', text: clean }, { id: assistantMessageId, role: 'assistant', text: provider ? 'Reading the current document…' : 'No connected provider. Preparing a local editor action…', status: 'working' }])
    setAiBusy(true)
    if (!provider) {
      window.setTimeout(() => {
        const local = runLocalAi(clean)
        setAiProposal(local)
        setAiMessages((messages) => messages.map((message, index) => index === messages.length - 1 ? { ...message, text: `No provider is connected, so this is a local editor command: ${local.label}. Review it before applying.`, status: undefined } : message))
        setAiBusy(false)
      }, 240)
      return
    }
    const controller = new AbortController()
    aiAbortRef.current = controller
    let streamedText = ''
    void requestAiStream({
      providerId: provider.id,
      prompt: clean,
      document: exportableProject(project),
      scope,
      systemPrompt: project.settings.mainPrompt,
      skills: project.skills.filter((skill) => skill.enabled),
      commands: project.commands.filter((command) => command.enabled),
      enabledConnections: project.connections.filter((connection) => connection.enabled && connection.status === 'connected').map((connection) => connection.id),
      imageRefs: aiImageRefs.map((reference) => ({ url: reference.url, mimeType: reference.mimeType })),
      visionProviderId: visionProvider?.id,
      visionConfig: { enabled: project.settings.visionEnabled, providerId: visionProvider?.id },
      signal: controller.signal,
    }, (delta) => {
      streamedText += delta
      setAiMessages((messages) => messages.map((message) => message.id === assistantMessageId ? { ...message, text: streamedText, status: 'working' } : message))
    }).then((response) => {
      const summary = response.text || (response.operations.length ? `I prepared ${response.operations.length} structured edit${response.operations.length === 1 ? '' : 's'}.` : 'No edit was proposed.')
      setAiMessages((messages) => messages.map((message) => message.id === assistantMessageId ? { ...message, text: summary, status: undefined } : message))
      if (response.operations.length) applyAiOperations(response.operations, scope, summary)
      else if (response.findings?.length) setAiMessages((messages) => [...messages, { id: uid('msg'), role: 'system', text: `${response.findings?.length} visual finding${response.findings?.length === 1 ? '' : 's'} returned by the vision helper.` }])
    }).catch((error: unknown) => {
      const cancelled = error instanceof DOMException && error.name === 'AbortError'
      setAiMessages((messages) => messages.map((message) => message.id === assistantMessageId ? { ...message, text: cancelled ? 'Request cancelled.' : error instanceof Error ? `Layer AI failed: ${error.message}` : 'Layer AI failed.', status: cancelled ? undefined : 'error' } : message))
    }).finally(() => { aiAbortRef.current = null; setAiBusy(false) })
  }, [aiBusy, aiImageRefs, aiScope, applyAiOperations, page.id, project, runLocalAi, selectedIds])

  const cancelAiRequest = useCallback(() => {
    aiAbortRef.current?.abort()
    setAiBusy(false)
  }, [])

  const renameProject = useCallback((name: string) => {
    const clean = name.trim().slice(0, 80)
    if (!clean || clean === project.name) return
    updateProject((draft) => { draft.name = clean }, 'Renamed project')
  }, [project.name, updateProject])

  const newProject = useCallback(() => {
    const next = createInitialProject(theme)
    next.id = uid('project')
    next.name = 'Untitled project'
    setHistory((items) => [...items, deepCloneProject(project)].slice(-80))
    setFuture([])
    setProject(next)
    setSelectedIds([])
    setView(defaultView)
    setProjectsOpen(false)
    notify('New local project created.')
  }, [notify, project, theme])

  const openSavedProject = useCallback(async (id: string) => {
    try {
      const loaded = await loadSavedProject(id)
      if (!loaded) throw new Error('Saved project could not be opened.')
      setHistory((items) => [...items, deepCloneProject(project)].slice(-80))
      setFuture([])
      setProject(applyThemeToProject(loaded, theme))
      setSelectedIds([])
      setProjectsOpen(false)
      notify(`Opened ${loaded.name}.`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not open saved project.') }
  }, [notify, project, theme])

  const exportPackage = useCallback(async () => {
    try {
      const result = await exportProjectPackage(project)
      notify(`Exported ${result.files.length} files as ${result.filename}.`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Export failed.') }
  }, [notify, project])

  const captureCanvasForAi = useCallback(async () => {
    if (!canvasHostRef.current) return notify('The canvas is not ready to capture.')
    try {
      const artifact = await captureCanvas(canvasHostRef.current, { projectId: project.id, documentVersionId: project.updatedAt, pageId: page.id, selectionIds: selectedIds, label: `${page.name} canvas capture` })
      const url = await artifactToDataUrl(artifact)
      setAiImageRefs((current) => [...current, { url, mimeType: artifact.mimeType, label: artifact.label }].slice(-4))
      setAiMessages((messages) => [...messages, { id: uid('msg'), role: 'system', text: `Captured ${artifact.label}. It is attached to the next Layer AI request with ${selectedIds.length ? `${selectedIds.length} selected object${selectedIds.length === 1 ? '' : 's'}` : 'page'} metadata.` }])
      notify('Canvas capture attached to Layer AI.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Canvas capture failed.') }
  }, [notify, page.id, page.name, project.id, project.updatedAt, selectedIds])

  const handleAiReference = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const url = await readFileAsDataUrl(file)
      setAiImageRefs((current) => [...current, { url, mimeType: file.type, label: file.name }].slice(-4))
      notify(`${file.name} attached to Layer AI.`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Reference could not be attached.') }
    event.target.value = ''
  }, [notify])

  const handlePreviewImport = (event: ChangeEvent<HTMLInputElement>) => { void handleImport(event) }

  return <div ref={appRootRef} className="layer-app" data-theme={theme} onKeyDown={onKeyDown} onPointerDownCapture={(event) => { const target = event.target as HTMLElement; if (target.closest('input,textarea,select,button,[contenteditable="true"]')) return; if (target.closest('.canvas-viewport, .canvas-zone, .left-rail, .pages-sidebar')) event.currentTarget.focus({ preventScroll: true }) }} tabIndex={0} onContextMenu={(event) => event.preventDefault()}>
      <TopBar project={project} page={page} view={view} saveState={saveState} selectedCount={selected.length} onUndo={undo} onRedo={redo} canUndo={history.length > 0} canRedo={future.length > 0} onFit={fitPage} onActualSize={actualSize} onExport={() => void exportPackage()} onImport={() => layerInputRef.current?.click()} onPreview={openPreview} onTutorial={() => { setTutorialStep(0); setTutorialOpen(true) }} onShortcuts={() => setShowShortcuts(true)} onRenameProject={renameProject} savedProjects={savedProjects} projectsOpen={projectsOpen} onToggleProjects={() => setProjectsOpen((value) => !value)} onNewProject={newProject} onOpenProject={openSavedProject} />
     <input ref={layerInputRef} className="visually-hidden" type="file" accept=".json,.layer.json,application/json" onChange={handlePreviewImport} />
     <input ref={aiReferenceInputRef} className="visually-hidden" type="file" accept="image/*,video/*" onChange={(event) => void handleAiReference(event)} />
     <div ref={editorShellRef} className="editor-shell" style={{ '--pages-width': `${sidebarOpen.pages ? sidebarSizes.pages : 0}px`, '--inspector-width': `${sidebarOpen.inspector ? sidebarSizes.inspector : 0}px` } as CSSProperties}>
       <div className="canvas-toolbar editor-canvas-toolbar" aria-label="Canvas controls">
         <div className="canvas-tool-group canvas-toolbar-left">
           <button type="button" className={`tool-chip ${view.mode === 'design' ? 'active' : ''}`} aria-pressed={view.mode === 'design'}><Icon name={view.mode === 'preview' ? 'play' : 'cursor'} size={14} /><span className="tool-chip-label">{view.mode === 'preview' ? 'Preview' : 'Design'}</span></button>
            <button type="button" className="tool-chip" onClick={() => openPanel('assets')}><Icon name="plus" size={14} /><span className="tool-chip-label">Insert</span></button>
         </div>
         <label className="viewport-picker canvas-toolbar-center"><Icon name="monitor" size={13} /><SelectField value={[1096, 768, 390, 1440].includes(view.viewportWidth) ? String(view.viewportWidth) : 'custom'} options={[['1096', 'Desktop · 1096'], ['768', 'Tablet · 768'], ['390', 'Phone · 390'], ['1440', 'Wide · 1440'], ['custom', 'Custom width…']].map(([value, label]) => ({ value, label }))} ariaLabel="Responsive preview width" onChange={(raw) => { const value = raw === 'custom' ? Number(window.prompt('Preview width in pixels', String(view.viewportWidth)) ?? view.viewportWidth) : Number(raw); if (Number.isFinite(value) && value >= 240 && value <= 4000) { setView((current) => ({ ...current, viewportWidth: Math.round(value) })); window.setTimeout(fitPage, 0) } }} /></label>
         <div className="canvas-tool-group canvas-toolbar-right">
           <button type="button" className="tool-chip" aria-label="Zoom out" data-tooltip="Zoom out" disabled={view.zoom <= 0.25} onClick={() => setView((current) => ({ ...current, zoom: Math.max(0.25, current.zoom - 0.1) }))}><Icon name="minus" size={14} /></button><span className="zoom-readout" aria-label={`Zoom ${Math.round(view.zoom * 100)} percent`}>{Math.round(view.zoom * 100)}%</span><button type="button" className="tool-chip" aria-label="Zoom in" data-tooltip="Zoom in" disabled={view.zoom >= 2.4} onClick={() => setView((current) => ({ ...current, zoom: Math.min(2.4, current.zoom + 0.1) }))}><Icon name="plus" size={14} /></button><button type="button" className="tool-chip" onClick={fitPage} data-tooltip="Fit page to canvas"><Icon name="fit" size={14} /><span className="tool-chip-label">Fit</span></button><button type="button" className="tool-chip tool-chip-actual" onClick={actualSize} data-tooltip="View at actual size"><Icon name="maximize" size={14} /><span className="tool-chip-label">100%</span></button>
         </div>
       </div>
       <aside className="left-rail" aria-label="Project navigation">
           <div className="brand-mark" aria-label="Layer"><SafeImage src={APP_ICON_URL} alt="" fallbackKind="brand" /></div>
         <div className="rail-tools">
           <ToolButton icon="layers" label={sidebarOpen.pages ? 'Hide pages and layers' : 'Show pages and layers'} active={sidebarOpen.pages} onClick={() => sidebarOpen.pages ? setSidebarOpen((current) => ({ ...current, pages: false })) : resetSidebar('pages')} />
           <ToolButton icon="sliders" label={sidebarOpen.inspector ? 'Hide inspector' : 'Show inspector'} active={sidebarOpen.inspector} onClick={() => sidebarOpen.inspector ? setSidebarOpen((current) => ({ ...current, inspector: false })) : resetSidebar('inspector')} />
         </div>
         <div className="rail-bottom">
           <ToolButton icon="spark" label="Ask Layer" active={view.panel === 'ai'} onClick={() => openPanel('ai')} />
           <ToolButton icon="plug" label="Connections" active={view.panel === 'connections'} onClick={() => openPanel('connections')} />
           <ToolButton icon="settings" label="Review & settings" active={view.panel === 'review'} onClick={() => openPanel('review')} />
        </div>
      </aside>

      <aside className={`pages-sidebar ${sidebarOpen.pages ? '' : 'is-collapsed'}`}>
        <div className="sidebar-heading"><span>Pages</span><div className="inline-actions"><button className="icon-button" onClick={addPage} aria-label="Add page"><Icon name="plus" /></button><button className="icon-button" onClick={() => setShowPageMenu((value) => !value)} aria-label="Page menu"><Icon name="more" /></button></div></div>
        {showPageMenu && <div className="page-menu popover"><button onClick={addPage}><Icon name="plus" /> New page</button><button onClick={duplicatePage}><Icon name="copy" /> Duplicate page</button><button onClick={() => renamePage(project.activePageId)}><Icon name="type" /> Rename page</button><button onClick={() => deletePage(project.activePageId)}><Icon name="trash" /> Delete page</button></div>}
         <div className="page-list">{project.pages.map((candidate, index) => <div key={candidate.id} className={`page-row ${candidate.id === project.activePageId ? 'active' : ''}`}><button className="page-button" onClick={() => setActivePage(candidate.id)}><span className="page-icon" aria-hidden="true"><Icon name="page" size={16} /></span><span className="page-name">{candidate.name}</span>{candidate.id === project.activePageId && candidate.name.toLowerCase() === 'home' && <Icon name="home" size={13} className="page-current-mark" />}</button><div className="row-actions"><button className="icon-button tiny" onClick={() => renamePage(candidate.id)} aria-label={`Rename ${candidate.name}`}><Icon name="more" size={14} /></button>{index === project.pages.length - 1 && <button className="icon-button tiny" onClick={() => deletePage(candidate.id)} aria-label={`Delete ${candidate.name}`}><Icon name="trash" size={13} /></button>}</div></div>)}</div>
        <div className="sidebar-divider" />
         <LayersPanel key={page.id} page={page} selectedIds={selectedIds} onSelect={select} onToggleVisible={(id) => toggleLayerFlag(id, 'visible')} onToggleLocked={(id) => toggleLayerFlag(id, 'locked')} onRename={(id, name) => commitPageElement(id, { name }, 'Renamed layer')} onGroup={groupSelected} onMoveLayer={moveLayer} />
         <div className="sidebar-footer"><button className="subtle-button" onClick={() => openPanel('assets')}><Icon name="layers" /> Assets & components</button><button className="subtle-button" onClick={openPreview}><Icon name="play" /> Preview site</button></div>
      </aside>

       <main className="canvas-zone" ref={canvasHostRef}>
         <div className="floating-tool-dock" aria-label="Drawing tools">
           <button type="button" className={`tool-dock-button ${activeTool === 'select' ? 'active' : ''}`} aria-label="Select (V)" aria-pressed={activeTool === 'select'} data-tooltip="Select (V)" onClick={() => setActiveTool('select')}><Icon name="cursor" size={17} /></button>
           <button type="button" className={`tool-dock-button ${activeTool === 'hand' ? 'active' : ''}`} aria-label="Pan (H)" aria-pressed={activeTool === 'hand'} data-tooltip="Pan (H)" onClick={() => setActiveTool('hand')}><Icon name="hand" size={17} /></button>
           <span className="tool-dock-divider" aria-hidden="true" />
           <button type="button" className={`tool-dock-button ${activeTool === 'frame' ? 'active' : ''}`} aria-label="Canvas (F)" aria-pressed={activeTool === 'frame'} data-tooltip="Canvas (F)" onClick={() => { setActiveTool('frame'); createElement('frame') }}><Icon name="frame" size={17} /></button>
           <button type="button" className={`tool-dock-button ${activeTool === 'text' ? 'active' : ''}`} aria-label="Text (T)" aria-pressed={activeTool === 'text'} data-tooltip="Text (T)" onClick={() => { setActiveTool('text'); createElement('text') }}><Icon name="text" size={17} /></button>
           <button type="button" className={`tool-dock-button ${activeTool === 'rect' ? 'active' : ''}`} aria-label="Shape (R)" aria-pressed={activeTool === 'rect'} data-tooltip="Shape (R)" onClick={() => { setActiveTool('rect'); createElement('rect') }}><Icon name="shape" size={17} /></button>
           <button type="button" className={`tool-dock-button ${activeTool === 'image' ? 'active' : ''}`} aria-label="Image" aria-pressed={activeTool === 'image'} data-tooltip="Image" onClick={() => { setActiveTool('image'); fileInputRef.current?.click() }}><Icon name="image" size={17} /></button>
           <details className="tool-dock-overflow">
             <summary className="tool-dock-button" aria-label="More drawing tools" data-tooltip="More drawing tools"><Icon name="more" size={17} /></summary>
             <div className="tool-dock-menu" role="menu" aria-label="More drawing tools">
               <button type="button" role="menuitem" aria-label="Cut corners (Ctrl/Cmd C)" onClick={(event) => { openCutEditor(); event.currentTarget.closest('details')?.removeAttribute('open') }}><Icon name="scissors" size={15} /><span>Cut corners</span></button>
                <button type="button" role="menuitem" aria-label="Icon" onClick={(event) => { openPanel('assets'); setActiveTool('icon'); event.currentTarget.closest('details')?.removeAttribute('open') }}><Icon name="icon" size={15} /><span>Icon</span></button>
               <button type="button" role="menuitem" aria-label="Section" onClick={(event) => { setActiveTool('section'); createElement('section'); event.currentTarget.closest('details')?.removeAttribute('open') }}><Icon name="section" size={15} /><span>Section</span></button>
             </div>
           </details>
         </div>
         <Canvas page={page} project={project} view={view} selectedIds={selectedIds} activeTool={activeTool} previewState={previewState} settings={project.settings} selectionRect={selectionRect} onSelect={select} onClearSelection={clearSelection} onSelectionRect={handleCanvasSelection} onSetSelectionRect={setSelectionRect} onContextMenu={handleContextMenu} onTransformStart={startTransform} onTransform={(id, patch) => updatePageElement(id, patch, 'Editing layer')} onTransformEnd={endTransform} onPreviewAction={runPreviewAction} onPreviewNavigate={setActivePage} onPan={(panX, panY) => setView((current) => ({ ...current, panX, panY }))} onZoom={(zoom) => setView((current) => ({ ...current, zoom }))} onCut={openCutEditor} />
         <div className="canvas-statusbar"><span>{lastAction}</span><span className="status-separator" /> <span>{page.name} · {page.width} × {page.height}</span><span className="status-separator" /><span className={saveState === 'saving' ? 'status-saving' : ''}>{saveState === 'saving' ? 'Saving…' : saveState === 'recovered' ? 'Recovered' : 'Saved locally'}</span><div className="canvas-status-actions"><button className="status-button" onClick={() => commit((draft) => draft.versions.push({ id: uid('snapshot'), name: `Snapshot ${draft.versions.length + 1}`, createdAt: new Date().toISOString(), project: exportableProject(draft) }), 'Created snapshot')}><Icon name="download-cloud" size={13} /> Snapshot</button><button className="status-button" onClick={() => openPanel('review')}><Icon name="check-circle" size={13} /> Checks</button><button className="status-button" onClick={openPreview}><Icon name="play" size={13} /> Preview</button></div></div>
      </main>

      <aside className={`right-panel panel-${view.panel} ${sidebarOpen.inspector ? '' : 'is-collapsed'}`} aria-label="Properties and assistant">
          {view.panel === 'inspector' && <Inspector page={page} selected={selected} activeObject={activeObject} project={project} onUpdate={updatePageElement} onCommit={commitPageElement} onDelete={deleteSelected} onDuplicate={duplicateSelected} onGroup={groupSelected} onUngroup={ungroupSelected} onLock={toggleLocked} onVisible={toggleVisible} onReorder={reorder} onAlign={alignSelected} onAskLayer={askLayer} onCut={openCutEditor} onCreateComponent={createComponent} onUpdateComponent={updateComponent} onSetPanel={(panel) => setView((current) => ({ ...current, panel }))} onPageUpdate={updatePage} onTransformStart={startTransform} onTransformEnd={endTransform} />}
          {view.panel === 'assets' && <AssetsPanel project={project} onUpdate={updateProject} onCommit={commit} onInsertElement={(element) => insertElements([element])} onInsertElements={insertElements} onInsertComponent={insertComponent} onApplyStyle={applyStyle} onUpload={() => fileInputRef.current?.click()} onNotify={notify} />}
           <AiPanel key={project.id} active={view.panel === 'ai'} project={project} page={page} selected={selected} scope={aiScope} messages={aiMessages} busy={aiBusy} proposal={aiProposal} attachmentCount={aiImageRefs.length} onScope={setAiScope} onSend={sendAi} onApply={() => { aiProposal?.apply(); setAiProposal(null); setAiMessages((messages) => [...messages, { id: uid('msg'), role: 'system', text: 'Applied as one undoable document change.' }]) }} onCancel={() => { setAiProposal(null); setAiMessages((messages) => [...messages, { id: uid('msg'), role: 'system', text: 'Proposal cancelled.' }]) }} onCancelRequest={cancelAiRequest} onCapture={() => void captureCanvasForAi()} onAttach={() => aiReferenceInputRef.current?.click()} onClearAttachments={() => setAiImageRefs([])} onSettings={() => openPanel('connections')} />
           {view.panel === 'connections' && <ConnectionsPanel project={project} onUpdate={updateProject} onCommit={commit} onNotify={notify} onBack={() => openPanel('ai')} theme={theme} onTheme={setTheme} />}
          {view.panel === 'review' && <ReviewPanel project={project} page={page} onUpdate={updateProject} onNotify={notify} onExport={() => void exportPackage()} onCopy={() => { void navigator.clipboard.writeText(projectBuilderPrompt(project)); notify('Builder prompt copied.') }} onPreview={openPreview} />}
      </aside>
      <div className="sidebar-resize-handle pages-resize" role="separator" aria-orientation="vertical" aria-label="Resize or close pages sidebar" data-tooltip="Drag to resize or close. Double-click to reset." data-tooltip-side="right" onPointerDown={(event) => startSidebarResize('pages', event)} onDoubleClick={() => resetSidebar('pages')} />
      <div className="sidebar-resize-handle inspector-resize" role="separator" aria-orientation="vertical" aria-label="Resize or close inspector sidebar" data-tooltip="Drag to resize or close. Double-click to reset." data-tooltip-side="left" onPointerDown={(event) => startSidebarResize('inspector', event)} onDoubleClick={() => resetSidebar('inspector')} />
    </div>

    {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} onDuplicate={duplicateSelected} onDelete={deleteSelected} onGroup={groupSelected} onUngroup={ungroupSelected} onLock={toggleLocked} onAskLayer={askLayer} onCopy={() => void copySelected()} onPaste={() => void paste()} onBring={() => reorder('up')} onSend={() => reorder('down')} onCut={() => openCutEditor(contextMenu.targetId)} />}
     {cornerEditorOpen && activeObject && <CornerEditor element={activeObject} onChange={(patch) => updatePageElement(activeObject.id, patch, 'Edited corner radius')} onStart={startTransform} onEnd={endTransform} onClose={() => { setCornerEditorOpen(false); setActiveTool('select') }} />}
     {cutEditorOpen && activeObject && <CornerEditor mode="cut" element={activeObject} onChange={(patch) => updatePageElement(activeObject.id, patch, 'Edited cut corners')} onStart={startTransform} onEnd={endTransform} onClose={() => { setCutEditorOpen(false); setActiveTool('select') }} />}
    {toast && <div className="toast" role="status"><Icon name="check-circle" size={16} /> {toast}</div>}
    {showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}
     {tutorialOpen && <Tutorial step={tutorialStep} setStep={setTutorialStep} onClose={closeTutorial} />}
      {themeChooserOpen && <ThemeChooser value={theme} onChange={setTheme} canvasBackground={page.background} canvasBackgroundProvenance={page.backgroundProvenance} onCanvasBackground={(value) => updatePage({ background: value }, 'Changed canvas background')} onResetCanvasBackground={resetCanvasBackground} onClose={() => { setThemeChooserOpen(false); themePendingRef.current = false }} />}
     <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" onChange={handleImageUpload} />
     <TooltipLayer />
     {previewOpen && <PreviewExperience project={project} page={page} viewportWidth={view.viewportWidth} previewState={previewState} reducedMotion={project.settings.reducedMotion} onExit={closePreview} onNavigate={setActivePage} />}
   </div>
}

function ToolButton({ icon, label, active, onClick }: { icon: IconName; label: string; active?: boolean; onClick: () => void }) {
  return <button className={`rail-button ${active ? 'active' : ''}`} onClick={onClick} aria-label={label} data-tooltip={label}><Icon name={icon} size={17} /></button>
}

function ContextMenu({ menu, onClose, onDuplicate, onDelete, onGroup, onUngroup, onLock, onAskLayer, onCopy, onPaste, onBring, onSend, onCut }: { menu: CanvasContextMenu; onClose: () => void; onDuplicate: () => void; onDelete: () => void; onGroup: () => void; onUngroup: () => void; onLock: () => void; onAskLayer: (ids: string[]) => void; onCopy: () => void; onPaste: () => void; onBring: () => void; onSend: () => void; onCut: () => void }) {
  const selected = menu.selectedIds
  return <div className="context-menu" style={{ left: menu.clientX, top: menu.clientY }} onPointerDown={(event) => event.stopPropagation()}><div className="context-label">{menu.targetName ? `Layer · ${menu.targetName}` : 'Canvas'}</div><button onClick={() => { onAskLayer(selected.length ? selected : menu.targetId ? [menu.targetId] : []); onClose() }}><Icon name="spark" /> Ask Layer <span className="menu-shortcut">⌘↵</span></button><div className="menu-rule" /><button onClick={() => { onCut(); onClose() }} disabled={!menu.targetId}><Icon name="scissors" /> Cut corners <span className="menu-shortcut">Ctrl/Cmd C</span></button><button onClick={() => { onDuplicate(); onClose() }} disabled={!selected.length}><Icon name="copy" /> Duplicate <span className="menu-shortcut">⌘D</span></button><button onClick={() => { onCopy(); onClose() }} disabled={!selected.length}><Icon name="copy" /> Copy</button><button onClick={() => { onPaste(); onClose() }}><Icon name="download" /> Paste</button><button onClick={() => { onGroup(); onClose() }} disabled={selected.length < 2}><Icon name="group" /> Group selection <span className="menu-shortcut">⌘G</span></button><button onClick={() => { onUngroup(); onClose() }}><Icon name="ungroup" /> Ungroup</button><div className="menu-rule" /><button onClick={() => { onBring(); onClose() }}><Icon name="arrow-up" /> Bring forward</button><button onClick={() => { onSend(); onClose() }}><Icon name="arrow-down" /> Send backward</button><button onClick={() => { onLock(); onClose() }}><Icon name="lock" /> Lock / unlock</button><button className="danger" onClick={() => { onDelete(); onClose() }} disabled={!selected.length}><Icon name="trash" /> Delete <span className="menu-shortcut">Del</span></button></div>
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  return <div className="modal-backdrop" onPointerDown={onClose}><div className="shortcuts-modal" onPointerDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="panel-kicker">SHORTCUTS</span><h2>Keep the canvas moving.</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div><div className="shortcut-grid"><Shortcut keys="V" label="Select" /><Shortcut keys="T" label="Create text" /><Shortcut keys="H" label="Pan canvas" /><Shortcut keys="⌘ C" label="Cut corners" /><Shortcut keys="⌘ M" label="Round corners" /><Shortcut keys="⌘ D" label="Duplicate" /><Shortcut keys="⌘ G" label="Group selection" /><Shortcut keys="⌘ ⇧ G" label="Ungroup" /><Shortcut keys="⌘ Z" label="Undo" /><Shortcut keys="⌘ ⇧ Z" label="Redo" /><Shortcut keys="Shift + arrows" label="Nudge 10px" /><Shortcut keys="Right drag" label="Select rectangle" /><Shortcut keys="⌘ ↵" label="Ask Layer" /></div><button className="primary-button full" onClick={onClose}>Back to canvas</button></div></div>
}

function Shortcut({ keys, label }: { keys: string; label: string }) { return <div className="shortcut-row"><span className="keycap">{keys}</span><span>{label}</span></div> }
