import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from './Icon'
import { InlineRename } from './InlineRename'
import type { Page, Project, ViewState } from '../lib/model'
import type { SavedProjectSummary } from '../lib/storage'
import { APP_ICON_URL } from '../lib/brand'

interface Props {
  project: Project; page: Page; view: ViewState; saveState: 'saved' | 'saving' | 'recovered'
  selectedCount: number
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean
  onFit: () => void; onActualSize: () => void; onExport: () => void; onImport: () => void
  onPreview: () => void; onTutorial: () => void; onShortcuts: () => void
  onRenameProject: (name: string) => void; savedProjects: SavedProjectSummary[]
  projectsOpen: boolean; onToggleProjects: () => void; onNewProject: () => void; onOpenProject: (id: string) => void
}

export function TopBar({ project, page, view, saveState, selectedCount, onUndo, onRedo, canUndo, canRedo, onExport, onImport, onPreview, onTutorial, onShortcuts, onRenameProject, savedProjects, projectsOpen, onToggleProjects, onNewProject, onOpenProject }: Props) {
  const [nameEditing, setNameEditing] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const projectArea = useRef<HTMLDivElement>(null)
  const exportArea = useRef<HTMLDivElement>(null)
  const projectTrigger = useRef<HTMLButtonElement>(null)
  const exportTrigger = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  const projectsId = useId()
  const exportsId = useId()
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

  useEffect(() => {
    if (!nameEditing && wasEditing.current) projectTrigger.current?.focus({ preventScroll: true })
    wasEditing.current = nameEditing
  }, [nameEditing])

  useEffect(() => {
    if (!projectsOpen && !moreOpen) return
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (projectsOpen && !projectArea.current?.contains(event.target)) onToggleProjects()
      if (moreOpen && !exportArea.current?.contains(event.target)) setMoreOpen(false)
    }
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || nameEditing) return
      event.preventDefault()
      event.stopPropagation()
      if (projectsOpen) { onToggleProjects(); projectTrigger.current?.focus() }
      if (moreOpen) { setMoreOpen(false); exportTrigger.current?.focus() }
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissEscape, true)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissEscape, true)
    }
  }, [projectsOpen, moreOpen, nameEditing, onToggleProjects])

  const beginRename = () => {
    if (projectsOpen) onToggleProjects()
    setMoreOpen(false)
    setNameEditing(true)
  }
  const fileAction = (action: () => void) => { setMoreOpen(false); exportTrigger.current?.focus(); action() }

  return <header className="topbar">
    <div className="topbar-left">
      <div className="project-name-wrap" ref={projectArea}>
        {nameEditing ? <InlineRename value={project.name} label="Project name" onCommit={(name) => { setNameEditing(false); onRenameProject(name) }} onCancel={() => setNameEditing(false)} /> :
          <button ref={projectTrigger} className="project-name" aria-expanded={projectsOpen} aria-controls={projectsId} data-tooltip="Switch or rename project" data-tooltip-side="bottom"
            onClick={() => { setMoreOpen(false); onToggleProjects() }} onDoubleClick={beginRename}>
            <img className="topbar-brand-icon" src={APP_ICON_URL} alt="" /><span>{project.name}</span><Icon name="chevron-down" size={12} />
          </button>}
        {projectsOpen && <div className="popover projects-menu" id={projectsId} role="region" aria-label="Projects">
          <div className="projects-menu-heading"><span>Projects</span><button className="mini-link" onClick={onNewProject}><Icon name="plus" size={13} /> New</button></div>
          <button className="project-rename-action" onClick={beginRename}><Icon name="type" size={14} /> Rename current project</button>
          <div className="saved-project-list">{savedProjects.length ? savedProjects.map((saved) =>
            <button key={saved.id} className={saved.id === project.id ? 'current' : ''} aria-current={saved.id === project.id ? 'true' : undefined} onClick={() => { if (saved.id === project.id) onToggleProjects(); else onOpenProject(saved.id) }}>
              <span>{saved.id === project.id ? project.name : saved.name}</span><small>{new Date(saved.updatedAt).toLocaleDateString()}</small>
            </button>) : <div className="projects-empty">Saved projects appear here after the first edit.</div>}</div>
        </div>}
        <span className="save-status" role="status" aria-live="polite"><span className={`save-dot ${saveState}`} />{saveState === 'saving' ? 'Saving' : saveState === 'recovered' ? 'Recovered' : 'Saved'}</span>
      </div>
      <div className="topbar-divider" />
      <div className="history-controls">
        <button className="icon-button" onClick={onUndo} disabled={!canUndo} aria-label="Undo" data-tooltip={canUndo ? 'Undo' : 'Nothing to undo'} data-tooltip-shortcut={`${modifier} Z`} data-tooltip-side="bottom"><Icon name="undo" size={16} /></button>
        <button className="icon-button" onClick={onRedo} disabled={!canRedo} aria-label="Redo" data-tooltip={canRedo ? 'Redo' : 'Nothing to redo'} data-tooltip-shortcut={`${modifier} Shift Z`} data-tooltip-side="bottom"><Icon name="redo" size={16} /></button>
      </div>
    </div>
    <div className="topbar-center"><span className="breadcrumb">{page.name}</span><span className="slash">/</span><span className="selection-count">{selectedCount ? `${selectedCount} selected` : 'Canvas'}</span></div>
    <div className="topbar-right">
      <button className={`mode-button ${view.mode === 'preview' ? 'active' : ''}`} onClick={onPreview} aria-pressed={view.mode === 'preview'}><Icon name={view.mode === 'preview' ? 'pause' : 'play'} size={14} /> {view.mode === 'preview' ? 'Exit preview' : 'Preview'}</button>
      <button className="topbar-button" onClick={onTutorial}><Icon name="book" size={14} /> Quick tour</button>
      <button className="topbar-button" onClick={onShortcuts}><Icon name="keyboard" size={14} /> Shortcuts</button>
      <div className="export-wrap" ref={exportArea}>
        <button className="export-button" onClick={onExport}><Icon name="download" size={14} /> Export</button>
        <button ref={exportTrigger} className="export-more" onClick={() => { if (projectsOpen) onToggleProjects(); setMoreOpen((value) => !value) }} aria-label="More export options" aria-expanded={moreOpen} aria-controls={exportsId} data-tooltip="Import and export options" data-tooltip-side="bottom"><Icon name="chevron-down" size={12} /></button>
        {moreOpen && <div className="popover export-menu" id={exportsId} role="region" aria-label="File actions">
          <button onClick={() => fileAction(onImport)}><Icon name="upload" /> Import Layer file</button>
          <button onClick={() => fileAction(onExport)}><Icon name="download" /> Export package</button>
          <a href="/" target="_blank" rel="noopener noreferrer" onClick={() => fileAction(() => {})}><Icon name="external" /> Open editor in new tab</a>
        </div>}
      </div>
      <div className="avatar" aria-hidden="true">L</div>
    </div>
  </header>
}
