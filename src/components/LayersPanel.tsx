import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Icon, type IconName } from './Icon'
import { InlineRename } from './InlineRename'
import { filterLayerTree } from '../lib/layer-search'
import { isLockedByAncestor } from '../lib/operations'
import type { DesignElement, Page } from '../lib/model'

interface Props {
  page: Page
  selectedIds: string[]
  onSelect: (id: string, additive?: boolean, toggle?: boolean) => void
  onToggleVisible: (id: string) => void
  onToggleLocked: (id: string) => void
  onRename: (id: string, name: string) => void
  onGroup?: () => void
  onMoveLayer?: (sourceId: string, targetId: string, position: 'before' | 'after' | 'inside') => void
}

export function LayersPanel({ page, selectedIds, onSelect, onToggleVisible, onToggleLocked, onRename, onGroup, onMoveLayer }: Props) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set(page.elements.filter((element) => element.type === 'group' || element.layout?.mode !== 'free').map((element) => element.id)))
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' | 'inside' } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const nameButtons = useRef(new Map<string, HTMLButtonElement>())
  const restoreFocus = useRef<string | null>(null)
  const { needle, matches, visible } = filterLayerTree(page, query)
  const roots = page.elements.filter((element) => !element.parentId && visible.has(element.id))
  const children = (parentId: string) => page.elements.filter((element) => element.parentId === parentId && visible.has(element.id))
  const isContainer = (element: DesignElement) => Boolean(element.layout)
  const isLocked = (element: DesignElement) => element.locked || isLockedByAncestor(page, element.id)
  const iconFor = (element: DesignElement): IconName => {
    if (element.name.toLowerCase().includes('note')) return 'pin'
    if (element.type === 'text') return 'text'
    if (element.type === 'image') return 'image'
    if (element.type === 'icon') return 'icon'
    if (element.type === 'section' || element.type === 'footer') return 'section'
    if (element.type === 'group') return 'group'
    if (element.type === 'frame' || element.type === 'modal') return 'frame'
    if (element.type === 'line') return 'minus'
    if (element.type === 'button') return 'cursor'
    if (element.type === 'nav') return 'arrow-right'
    if (element.type === 'form' || element.type === 'input') return 'page'
    if (element.type === 'tabs' || element.type === 'accordion') return 'grid'
    return 'shape'
  }
  const beginRename = (element: DesignElement) => {
    if (isLocked(element)) return
    restoreFocus.current = element.id
    setEditingId(element.id)
  }
  useEffect(() => {
    if (!editingId && restoreFocus.current) {
      (nameButtons.current.get(restoreFocus.current) ?? searchRef.current)?.focus({ preventScroll: true })
      restoreFocus.current = null
    }
  }, [editingId])

  const startDrag = (event: DragEvent<HTMLDivElement>, element: DesignElement) => {
    if (!onMoveLayer || isLocked(element) || editingId) { event.preventDefault(); return }
    setDragId(element.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', element.id)
  }

  const dragOver = (event: DragEvent<HTMLDivElement>, element: DesignElement) => {
    if (!dragId || !onMoveLayer || dragId === element.id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = isContainer(element) ? 'inside' : event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
    setDropTarget({ id: element.id, position })
  }

  const finishDrag = () => { setDragId(null); setDropTarget(null) }

  const renderRow = (element: DesignElement, depth = 0) => {
    const kids = children(element.id); const isOpen = Boolean(needle) || expanded.has(element.id); const hasChildren = kids.length > 0
    return <div key={element.id}>
      <div
        className={`layer-row ${selectedIds.includes(element.id) ? 'selected' : ''} ${isLocked(element) ? 'is-locked' : ''} ${!element.visible ? 'is-hidden' : ''} ${needle && matches.has(element.id) ? 'search-match' : ''} ${dragId === element.id ? 'is-dragging' : ''} ${dropTarget?.id === element.id ? `drop-${dropTarget.position}` : ''}`}
        data-layer-id={element.id}
        style={{ paddingLeft: 8 + depth * 16 }}
        draggable={Boolean(onMoveLayer && !isLocked(element) && !editingId)}
        onDragStart={(event) => startDrag(event, element)}
        onDragOver={(event) => dragOver(event, element)}
        onDrop={(event) => { event.preventDefault(); if (dragId && dropTarget?.id === element.id) { if (dropTarget.position === 'inside') setExpanded((current) => new Set(current).add(element.id)); onMoveLayer?.(dragId, element.id, dropTarget.position) } finishDrag() }}
        onDragEnd={finishDrag}
        onClick={(event) => onSelect(element.id, event.shiftKey, event.shiftKey)}
        onDoubleClick={() => beginRename(element)}
      >
        {hasChildren ? <button className="layer-disclosure" disabled={Boolean(needle)} aria-expanded={isOpen} data-tooltip={needle ? 'Matching groups stay expanded during search' : isOpen ? 'Collapse group' : 'Expand group'} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setExpanded((current) => { const next = new Set(current); next.has(element.id) ? next.delete(element.id) : next.add(element.id); return next }) }} aria-label={isOpen ? 'Collapse group' : 'Expand group'}><Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} /></button> : <span className="layer-disclosure-spacer" />}
         <span className="layer-type"><Icon name={iconFor(element)} size={13} /></span>
        {editingId === element.id ? <InlineRename value={element.name} label="Layer name" className="layer-rename-input" onCommit={(name) => { setEditingId(null); onRename(element.id, name) }} onCancel={() => setEditingId(null)} /> :
          <button className="layer-name" ref={(node) => { if (node) nameButtons.current.set(element.id, node); else nameButtons.current.delete(element.id) }} aria-pressed={selectedIds.includes(element.id)} data-tooltip={isLocked(element) ? `${element.name} · Locked` : `${element.name} · Double-click or F2 to rename`} onKeyDown={(event) => { if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); beginRename(element) } }}>{element.name}</button>}
        {element.componentId && <span className="component-dot" data-tooltip="Component" />}
        <span className="layer-actions" onDoubleClick={(event) => event.stopPropagation()}><button className="icon-button tiny" onClick={(event) => { event.stopPropagation(); onToggleVisible(element.id) }} aria-label={element.visible ? 'Hide layer' : 'Show layer'} data-tooltip={element.visible ? 'Hide layer' : 'Show layer'}><Icon name={element.visible ? 'eye' : 'eye-off'} size={13} /></button><button className="icon-button tiny" onClick={(event) => { event.stopPropagation(); onToggleLocked(element.id) }} aria-label={element.locked ? 'Unlock layer' : 'Lock layer'} data-tooltip={element.locked ? 'Unlock layer' : 'Lock layer'}><Icon name={element.locked ? 'lock' : 'unlock'} size={13} /></button></span>
      </div>
      {isOpen && kids.map((child) => renderRow(child, depth + 1))}
    </div>
  }

  return <section className="layers-section">
    <div className="section-header"><span className="section-title"><Icon name="layers" size={14} /> Layers</span><div className="layers-heading-actions">
      <span className="section-count" aria-label={needle ? `${matches.size} matching layers` : `${page.elements.length} layers`}>{needle ? `${matches.size}/${page.elements.length}` : page.elements.length}</span>
       <button className="icon-button tiny" onClick={onGroup} disabled={!onGroup || selectedIds.length < 2} aria-label="Group layers" data-tooltip={selectedIds.length < 2 ? 'Select at least two layers to group' : 'Group selected layers'}><Icon name="group" size={13} /></button>
    </div></div>
     <div className="mini-search layer-search" role="search">
       <Icon name="search" size={13} />
       <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery('') } }} placeholder="Find layer" aria-label="Find layer" />
       <button type="button" className="layer-search-clear" aria-label="Clear layer search" data-tooltip="Clear search" data-tooltip-shortcut="Esc" disabled={!query} onClick={() => { setQuery(''); searchRef.current?.focus() }}><Icon name="close" size={12} /></button>
     </div>
    <div className="layers-help">{needle ? `${matches.size} match${matches.size === 1 ? '' : 'es'} · includes nested layers` : 'Drag to nest or reorder. Double-click a name to rename.'}</div>
    <div className="layers-list">{roots.length ? roots.map((element) => renderRow(element)) : <div className="empty-inline" role="status">{needle ? 'No matching layers. Try a name, type, or text.' : 'No layers yet. Add one from the toolbar.'}</div>}</div>
  </section>
}
