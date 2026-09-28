import { useState } from 'react'
import { Icon } from './Icon'
import { NumberField } from './NumberField'
import { ColorPicker } from './ColorPicker'
import { SelectField } from './SelectField'
import type { ActionType, DesignElement, LayoutMode, Page, Project, ShapeVariant, Trigger } from '../lib/model'
import { zeroCorners } from '../lib/corner-values'
import { SHAPE_OPTIONS } from '../lib/shapes'
import { parseColor } from '../lib/color'

interface Props {
  page: Page
  selected: DesignElement[]
  activeObject?: DesignElement
  project: Project
  onUpdate: (id: string, patch: Partial<DesignElement>, label?: string) => void
  onCommit: (id: string, patch: Partial<DesignElement>, label?: string) => void
  onDelete: () => void
  onDuplicate: () => void
  onGroup: () => void
  onUngroup: () => void
  onLock: () => void
  onVisible: () => void
  onReorder: (direction: 'up' | 'down') => void
  onAlign: (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute') => void
  onAskLayer: (ids: string[]) => void
  onCut: (id: string) => void
  onCreateComponent: () => void
  onUpdateComponent: () => void
  onSetPanel: (panel: 'inspector' | 'assets' | 'ai' | 'connections' | 'review') => void
  onPageUpdate: (patch: Partial<Page>, label?: string) => void
  onTransformStart?: () => void
  onTransformEnd?: (label?: string) => void
}

const typeLabel: Record<string, string> = {
  text: 'Text',
  rect: 'Rectangle',
  circle: 'Circle',
  line: 'Line',
  image: 'Image',
  icon: 'Icon',
  button: 'Button',
  input: 'Input',
  card: 'Card',
  nav: 'Navigation',
  form: 'Form',
  section: 'Section',
  frame: 'Canvas',
  tabs: 'Tabs',
  accordion: 'Accordion',
  modal: 'Modal',
  footer: 'Footer',
  group: 'Group',
}

export function Inspector({
  page,
  selected,
  activeObject,
  project,
  onUpdate,
  onCommit,
  onDelete,
  onDuplicate,
  onGroup,
  onUngroup,
  onLock,
  onVisible,
  onReorder,
  onAlign,
  onAskLayer,
  onCut,
  onCreateComponent,
  onUpdateComponent,
  onSetPanel,
  onPageUpdate,
  onTransformStart,
  onTransformEnd,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [interactionOpen, setInteractionOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [newTrigger, setNewTrigger] = useState<Trigger>('click')
  const [newAction, setNewAction] = useState<ActionType>('navigate')
  const [newTarget, setNewTarget] = useState(page.id)
  const [newDuration, setNewDuration] = useState(400)

  const transformProps = { onTransformStart, onTransformEnd }
  const update = (patch: Partial<DesignElement>, label = 'Updated property') => {
    if (activeObject) onUpdate(activeObject.id, patch, label)
  }
  const commit = (patch: Partial<DesignElement>, label = 'Updated property') => {
    if (activeObject) onCommit(activeObject.id, patch, label)
  }
  const number = (key: keyof DesignElement, value: number, label: string) => {
    update({ [key]: value } as Partial<DesignElement>, label)
  }
  const discreteNumber = (patch: Partial<DesignElement>, label: string) => {
    onTransformStart?.()
    update(patch, label)
    onTransformEnd?.(label)
  }
  const pageNumber = (patch: Partial<Page>, label: string) => {
    onTransformStart?.()
    onPageUpdate(patch, label)
    onTransformEnd?.(label)
  }
  const common = selected.length > 0
  const textLike = Boolean(activeObject && ['text', 'button', 'input', 'nav', 'footer', 'card'].includes(activeObject.type))
  const installedFonts = project.assets.filter((asset) => asset.kind === 'font').map((asset) => asset.metadata?.family ?? asset.name).filter(Boolean)
  const fontOptions = Array.from(new Set(['Segoe UI', 'Aptos', 'Inter', 'Manrope', 'DM Sans', 'Space Grotesk', 'Plus Jakarta Sans', 'IBM Plex Sans', 'IBM Plex Mono', 'Roboto', 'Montserrat', 'Poppins', 'Nunito Sans', 'Work Sans', 'Playfair Display', 'DM Serif Display', 'Source Code Pro', 'Arial Narrow', 'Georgia', 'Courier New', 'System UI', ...installedFonts])).map((family) => ({ value: family, label: family, description: installedFonts.includes(family) ? 'Installed in this project' : 'System or catalog family' }))
  const shapeOptions = SHAPE_OPTIONS.map((option) => ({ value: option.value, label: option.label, description: option.description }))

  const addInteraction = () => {
    if (!activeObject) return
    const next = [
      ...activeObject.interactions,
      {
        id: `int_${Date.now()}`,
        trigger: newTrigger,
        action: newAction,
        pageId: newAction === 'navigate' ? newTarget : undefined,
        targetId: newAction === 'toggle-visibility' ? page.elements.find((element) => element.id !== activeObject.id)?.id : undefined,
        duration: newDuration,
        easing: 'ease-out',
        repeat: 1,
      },
    ]
    commit({ interactions: next }, 'Added interaction')
  }

  return <div className="inspector-content">
    <div className="panel-heading">
      <div><span className="panel-kicker">INSPECTOR</span><h2>{activeObject ? activeObject.name : selected.length ? `${selected.length} layers` : page.name}</h2></div>
      <button className="icon-button" onClick={() => onSetPanel('ai')} aria-label="Ask Layer"><Icon name="spark" /></button>
    </div>

    {!common && <EmptyInspector page={page} onSetPanel={onSetPanel} onPageUpdate={onPageUpdate} {...transformProps} />}

    {common && <>
       <div className="inspector-actions">
         <button className="action-button" onClick={onDuplicate}><Icon name="copy" /> Duplicate</button>
         <button className="action-button" onClick={onDelete}><Icon name="trash" /> Delete</button>
         <button className="action-button" onClick={() => onAskLayer(selected.map((item) => item.id))}><Icon name="spark" /> Ask Layer</button>
       </div>

       <div className="scrub-help" role="note"><Icon name="move" size={12} /><span>Drag a field label to scrub · Shift coarse · Alt fine</span></div>

       {textLike && <InspectorSection title="Text & typography" icon="type">
         <label className="full-field text-content-editor"><span>Visible text</span><textarea value={activeObject?.text ?? ''} onChange={(event) => update({ text: event.target.value }, 'Edited text')} rows={3} /></label>
         <div className="field-grid two">
           <Field label="Font"><SelectField value={activeObject?.fontFamily ?? 'Segoe UI'} options={fontOptions} className="select-field-font" ariaLabel="Font family" onChange={(value) => update({ fontFamily: value }, 'Changed font')} /></Field>
           <NumberField {...transformProps} label="Size" value={activeObject?.fontSize ?? 16} min={8} decimals={0} changeLabel="Changed type size" onValueChange={(value) => number('fontSize', value, 'Changed type size')} />
           <Field label="Weight"><SelectField value={String(activeObject?.fontWeight ?? 500)} options={[['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold']].map(([value, label]) => ({ value, label }))} ariaLabel="Font weight" onChange={(value) => discreteNumber({ fontWeight: Number(value) }, 'Changed font weight')} /></Field>
           <NumberField {...transformProps} label="Line height" value={activeObject?.lineHeight ?? 1.35} min={0.8} max={3} step={0.05} decimals={2} changeLabel="Changed line height" onValueChange={(value) => number('lineHeight', value, 'Changed line height')} />
           <NumberField {...transformProps} label="Tracking" value={activeObject?.letterSpacing ?? 0} step={0.1} decimals={2} changeLabel="Changed tracking" onValueChange={(value) => number('letterSpacing', value, 'Changed tracking')} />
           <Field label="Align"><SelectField value={activeObject?.textAlign ?? 'left'} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']].map(([value, label]) => ({ value, label }))} ariaLabel="Text alignment" onChange={(value) => update({ textAlign: value as DesignElement['textAlign'] }, 'Changed alignment')} /></Field>
         </div>
       </InspectorSection>}

       <InspectorSection title="Layout" icon="move">
        <div className="field-grid two">
          <NumberField {...transformProps} label="X" ariaLabel="X position" value={activeObject?.x ?? 0} changeLabel="Changed X" onValueChange={(value) => number('x', value, 'Changed X')} />
          <NumberField {...transformProps} label="Y" ariaLabel="Y position" value={activeObject?.y ?? 0} changeLabel="Changed Y" onValueChange={(value) => number('y', value, 'Changed Y')} />
          <NumberField {...transformProps} label="W" ariaLabel="Width" value={activeObject?.width ?? 0} min={0} changeLabel="Changed width" onValueChange={(value) => number('width', value, 'Changed width')} />
          <NumberField {...transformProps} label="H" ariaLabel="Height" value={activeObject?.height ?? 0} min={0} changeLabel="Changed height" onValueChange={(value) => number('height', value, 'Changed height')} />
        </div>
        <div className="field-grid three">
          <NumberField {...transformProps} label="Rotation" value={activeObject?.rotation ?? 0} changeLabel="Changed rotation" onValueChange={(value) => number('rotation', value, 'Changed rotation')} />
          <NumberField {...transformProps} label="Opacity" value={activeObject?.opacity ?? 1} min={0} max={1} step={0.05} decimals={2} changeLabel="Changed opacity" onValueChange={(value) => number('opacity', value, 'Changed opacity')} />
          <label className="checkbox-field"><input type="checkbox" checked={activeObject?.aspectRatioLocked ?? false} onChange={(event) => update({ aspectRatioLocked: event.target.checked }, 'Toggled aspect ratio')} /><span>Lock ratio</span></label>
        </div>
        <div className="alignment-row">
          <button className="icon-button" onClick={() => onAlign('left')} aria-label="Align left"><Icon name="align-left" /></button>
          <button className="icon-button" onClick={() => onAlign('center')} aria-label="Align center"><Icon name="align-center" /></button>
          <button className="icon-button" onClick={() => onAlign('right')} aria-label="Align right"><Icon name="align-right" /></button>
          <button className="icon-button" onClick={() => onAlign('top')} aria-label="Align top"><Icon name="arrow-up" /></button>
          <button className="icon-button" onClick={() => onAlign('middle')} aria-label="Align middle"><Icon name="distribute" /></button>
          <button className="icon-button" onClick={() => onAlign('bottom')} aria-label="Align bottom"><Icon name="arrow-down" /></button>
          <button className="icon-button" onClick={() => onAlign('distribute')} aria-label="Distribute horizontally"><Icon name="distribute" style={{ transform: 'rotate(90deg)' }} /></button>
        </div>
      </InspectorSection>

      {activeObject && <InspectorSection title="Fill & stroke" icon="palette">
        <div className="color-row">
           <label>Fill<ColorPicker label="Fill" value={isColor(activeObject.fill) ? activeObject.fill : '#15181e'} onChange={(value) => update({ fill: value }, 'Changed fill')} onStart={onTransformStart} onEnd={onTransformEnd} /></label>
        </div>
         <div className="color-row">
           <label>Stroke<ColorPicker label="Stroke" value={isColor(activeObject.stroke) ? activeObject.stroke : '#343b49'} onChange={(value) => update({ stroke: value }, 'Changed stroke')} onStart={onTransformStart} onEnd={onTransformEnd} /></label>
         </div>
         <div className="field-grid three">
           {['rect', 'frame'].includes(activeObject.type) && <Field label="Shape"><SelectField value={activeObject.shape ?? 'rectangle'} options={shapeOptions} ariaLabel="Shape preset" onChange={(value) => { const shape = value as ShapeVariant; update({ shape, radius: shape === 'round' || shape === 'pill' ? 999 : activeObject.radius }, 'Changed shape preset') }} /></Field>}
           <NumberField {...transformProps} label="Width" ariaLabel="Stroke width" value={activeObject.strokeWidth} min={0} changeLabel="Changed stroke width" onValueChange={(value) => number('strokeWidth', value, 'Changed stroke width')} />
           <NumberField {...transformProps} label="Radius" value={activeObject.radius} min={0} changeLabel="Changed radius" onValueChange={(radius) => update({ radius, corners: { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius } }, 'Changed radius')} />
           <Field label="Blend"><SelectField value={activeObject.opacity === 1 ? 'normal' : 'soft'} options={[['normal', 'Normal'], ['soft', 'Soft']].map(([value, label]) => ({ value, label }))} ariaLabel="Blend mode" onChange={(value) => discreteNumber({ opacity: value === 'normal' ? 1 : 0.78 }, 'Changed blend')} /></Field>
         </div>
        <div className="corner-fields">
          <span className="field-caption">Individual corners</span>
          <div className="corner-grid">
            <NumberField {...transformProps} label="TL" ariaLabel="Top left corner radius" value={activeObject.corners.topLeft} min={0} changeLabel="Changed corner radius" onValueChange={(value) => update({ corners: { ...activeObject.corners, topLeft: value } }, 'Changed corner radius')} />
            <NumberField {...transformProps} label="TR" ariaLabel="Top right corner radius" value={activeObject.corners.topRight} min={0} changeLabel="Changed corner radius" onValueChange={(value) => update({ corners: { ...activeObject.corners, topRight: value } }, 'Changed corner radius')} />
            <NumberField {...transformProps} label="BR" ariaLabel="Bottom right corner radius" value={activeObject.corners.bottomRight} min={0} changeLabel="Changed corner radius" onValueChange={(value) => update({ corners: { ...activeObject.corners, bottomRight: value } }, 'Changed corner radius')} />
            <NumberField {...transformProps} label="BL" ariaLabel="Bottom left corner radius" value={activeObject.corners.bottomLeft} min={0} changeLabel="Changed corner radius" onValueChange={(value) => update({ corners: { ...activeObject.corners, bottomLeft: value } }, 'Changed corner radius')} />
          </div>
        </div>
        <div className="cut-corner-card"><div className="shadow-title"><span><Icon name="scissors" size={13} /> Cut corners</span><button type="button" className="mini-link" onClick={() => activeObject && onCut(activeObject.id)}>Open tool</button></div><p>Literal diagonal cuts with snapping and mirrored sides.</p><div className="corner-grid">{(['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const).map((corner) => <NumberField key={corner} {...transformProps} label={corner === 'topLeft' ? 'TL' : corner === 'topRight' ? 'TR' : corner === 'bottomRight' ? 'BR' : 'BL'} ariaLabel={`${corner} cut`} value={activeObject?.cutCorners?.[corner] ?? zeroCorners()[corner]} min={0} max={Math.floor(Math.min(activeObject?.width ?? 0, activeObject?.height ?? 0) / 2)} changeLabel="Changed cut corner" onValueChange={(value) => activeObject && update({ cutCorners: { ...(activeObject.cutCorners ?? zeroCorners()), [corner]: value } }, 'Changed cut corner')} />)}</div></div>
       </InspectorSection>}

       {activeObject?.type === 'image' && <InspectorSection title="Image treatment" icon="palette">
         <div className="field-grid two">
           <Field label="Fit"><SelectField value={activeObject.imageFit ?? 'contain'} options={[['contain', 'Contain'], ['cover', 'Cover'], ['fill', 'Stretch'], ['scale-down', 'Scale down'], ['none', 'Original size']].map(([value, label]) => ({ value, label }))} ariaLabel="Image fit" onChange={(value) => update({ imageFit: value as DesignElement['imageFit'] }, 'Changed image fit')} /></Field>
           <Field label="Position"><input value={activeObject.imagePosition ?? 'center'} onChange={(event) => update({ imagePosition: event.target.value }, 'Changed image position')} placeholder="center" /></Field>
         </div>
         <div className="image-edit-note"><Icon name="move" size={12} /><span>Drag the blue handles on the canvas to resize. Shift or Lock ratio keeps the image proportional.</span></div>
         <button type="button" className="secondary-button full" onClick={() => update({ imageFit: 'contain', imagePosition: 'center' }, 'Reset image treatment')}><Icon name="refresh" size={13} /> Reset image treatment</button>
       </InspectorSection>}

        <InspectorSection title="Responsive layout" icon="grid">
        <div className="field-grid two">
           <Field label="Mode"><SelectField value={activeObject?.layout?.mode ?? 'free'} options={[['free', 'Free placement'], ['row', 'Row'], ['column', 'Column / stack'], ['grid', 'Grid']].map(([value, label]) => ({ value, label }))} ariaLabel="Layout mode" onChange={(value) => update({ layout: { ...(activeObject?.layout ?? emptyLayout()), mode: value as LayoutMode } }, 'Changed layout mode')} /></Field>
          <NumberField {...transformProps} label="Gap" value={activeObject?.layout?.gap ?? 16} min={0} changeLabel="Changed layout gap" onValueChange={(value) => update({ layout: { ...(activeObject?.layout ?? emptyLayout()), gap: value } }, 'Changed layout gap')} />
          <NumberField {...transformProps} label="Padding" value={activeObject?.layout?.padding ?? 24} min={0} changeLabel="Changed layout padding" onValueChange={(value) => update({ layout: { ...(activeObject?.layout ?? emptyLayout()), padding: value } }, 'Changed layout padding')} />
           <Field label="Width rule"><SelectField value={activeObject?.layout?.widthRule ?? 'fixed'} options={[['fixed', 'Fixed'], ['fill', 'Fill available'], ['fit', 'Fit content']].map(([value, label]) => ({ value, label }))} ariaLabel="Width rule" onChange={(value) => update({ layout: { ...(activeObject?.layout ?? emptyLayout()), widthRule: value as 'fixed' | 'fill' | 'fit' } }, 'Changed width rule')} /></Field>
           <Field label="Height rule"><SelectField value={activeObject?.layout?.heightRule ?? 'fixed'} options={[['fixed', 'Fixed'], ['fill', 'Fill available'], ['fit', 'Fit content']].map(([value, label]) => ({ value, label }))} ariaLabel="Height rule" onChange={(value) => update({ layout: { ...(activeObject?.layout ?? emptyLayout()), heightRule: value as 'fixed' | 'fill' | 'fit' } }, 'Changed height rule')} /></Field>
           <Field label="Overflow"><SelectField value={activeObject?.layout?.overflow ?? 'visible'} options={[['visible', 'Visible'], ['hidden', 'Clip'], ['scroll', 'Scroll']].map(([value, label]) => ({ value, label }))} ariaLabel="Overflow" onChange={(value) => update({ layout: { ...(activeObject?.layout ?? emptyLayout()), overflow: value as 'visible' | 'hidden' | 'scroll' } }, 'Changed overflow')} /></Field>
        </div>
        <div className="breakpoint-row"><span className="field-caption">Preview width</span><div className="breakpoint-chips">{page.breakpoints.map((breakpoint) => <span key={breakpoint.id} className="breakpoint-chip">{breakpoint.name} · {breakpoint.width}</span>)}</div></div>
      </InspectorSection>

      <Collapsible title="Interactions" icon="bolt" open={interactionOpen} onToggle={() => setInteractionOpen((current) => !current)}>
        <div className="interaction-list">
          {(activeObject?.interactions ?? []).map((interaction) => <div className="interaction-row" key={interaction.id}><span className="interaction-trigger">{interaction.trigger}</span><span>→</span><span>{interaction.action}{interaction.pageId ? ` · ${project.pages.find((candidate) => candidate.id === interaction.pageId)?.name ?? 'page'}` : ''}</span><button className="icon-button tiny" onClick={() => activeObject && commit({ interactions: activeObject.interactions.filter((item) => item.id !== interaction.id) }, 'Removed interaction')} aria-label="Remove interaction"><Icon name="trash" size={12} /></button></div>)}
          {!activeObject?.interactions.length && <div className="empty-inline">No prototype actions yet.</div>}
          <div className="field-grid two">
             <Field label="When"><SelectField value={newTrigger} options={[['click', 'Click'], ['hover', 'Hover'], ['focus', 'Focus'], ['page-load', 'Page load'], ['scroll-into-view', 'Scroll into view']].map(([value, label]) => ({ value, label }))} ariaLabel="Interaction trigger" onChange={(value) => setNewTrigger(value as Trigger)} /></Field>
             <Field label="Do"><SelectField value={newAction} options={[['navigate', 'Navigate'], ['external', 'Open URL'], ['scroll', 'Scroll to section'], ['toggle-visibility', 'Show / hide'], ['set-state', 'Change state'], ['submit-form', 'Submit form'], ['animate', 'Start animation']].map(([value, label]) => ({ value, label }))} ariaLabel="Interaction action" onChange={(value) => setNewAction(value as ActionType)} /></Field>
             {newAction === 'navigate' && <Field label="Page"><SelectField value={newTarget} options={project.pages.map((candidate) => ({ value: candidate.id, label: candidate.name }))} ariaLabel="Interaction page" onChange={setNewTarget} /></Field>}
            {newAction === 'animate' && <NumberField label="Duration" value={newDuration} min={0} step={50} decimals={0} changeLabel="Changed animation duration" onValueChange={setNewDuration} />}
          </div>
          <button className="secondary-button full" onClick={addInteraction}><Icon name="plus" /> Add action</button>
        </div>
      </Collapsible>

      <Collapsible title="Advanced" icon="sliders" open={advancedOpen} onToggle={() => setAdvancedOpen((current) => !current)}>
        <div className="field-grid two">
          <Field label="State"><input value={activeObject?.state ?? 'default'} onChange={(event) => update({ state: event.target.value }, 'Changed state')} /></Field>
          <Field label="Variant"><input value={activeObject?.variant ?? 'Default'} onChange={(event) => update({ variant: event.target.value }, 'Changed variant')} /></Field>
        </div>
        <div className="shadow-card">
          <div className="shadow-title"><span>Shadow</span><label className="switch"><input type="checkbox" checked={Boolean(activeObject?.shadow)} onChange={(event) => update({ shadow: event.target.checked ? { x: 0, y: 10, blur: 24, spread: 0, color: '#000000', opacity: 0.18 } : undefined }, 'Toggled shadow')} /><span /></label></div>
          {activeObject?.shadow && <div className="field-grid two">
            <NumberField {...transformProps} label="X" value={activeObject.shadow.x} changeLabel="Changed shadow" onValueChange={(value) => update({ shadow: { ...activeObject.shadow!, x: value } }, 'Changed shadow')} />
            <NumberField {...transformProps} label="Y" value={activeObject.shadow.y} changeLabel="Changed shadow" onValueChange={(value) => update({ shadow: { ...activeObject.shadow!, y: value } }, 'Changed shadow')} />
            <NumberField {...transformProps} label="Blur" value={activeObject.shadow.blur} min={0} changeLabel="Changed shadow" onValueChange={(value) => update({ shadow: { ...activeObject.shadow!, blur: value } }, 'Changed shadow')} />
            <NumberField {...transformProps} label="Opacity" value={activeObject.shadow.opacity} min={0} max={1} step={0.05} decimals={2} changeLabel="Changed shadow" onValueChange={(value) => update({ shadow: { ...activeObject.shadow!, opacity: value } }, 'Changed shadow')} />
          </div>}
        </div>
        <div className="pattern-card">
          <div className="shadow-title"><span>Pattern fill</span><label className="switch"><input type="checkbox" checked={activeObject?.pattern?.enabled ?? false} onChange={(event) => update({ pattern: { ...(activeObject?.pattern ?? emptyPattern()), enabled: event.target.checked } }, 'Toggled pattern')} /><span /></label></div>
          {activeObject?.pattern?.enabled && <div className="field-grid two">
             <Field label="Pattern"><SelectField value={activeObject.pattern.type} options={[['dots', 'Dots'], ['grid', 'Grid'], ['stripes', 'Stripes'], ['noise', 'Noise']].map(([value, label]) => ({ value, label }))} ariaLabel="Pattern type" onChange={(value) => update({ pattern: { ...activeObject.pattern!, type: value as 'dots' | 'grid' | 'stripes' | 'noise' } }, 'Changed pattern')} /></Field>
            <NumberField {...transformProps} label="Spacing" value={activeObject.pattern.spacing} min={0} changeLabel="Changed pattern spacing" onValueChange={(value) => update({ pattern: { ...activeObject.pattern!, spacing: value } }, 'Changed pattern spacing')} />
            <NumberField {...transformProps} label="Rotation" value={activeObject.pattern.rotation} changeLabel="Changed pattern rotation" onValueChange={(value) => update({ pattern: { ...activeObject.pattern!, rotation: value } }, 'Changed pattern rotation')} />
            <NumberField {...transformProps} label="Opacity" value={activeObject.pattern.opacity} min={0} max={1} step={0.05} decimals={2} changeLabel="Changed pattern opacity" onValueChange={(value) => update({ pattern: { ...activeObject.pattern!, opacity: value } }, 'Changed pattern opacity')} />
          </div>}
        </div>
      </Collapsible>

      <Collapsible title="Notes & intent" icon="comment" open={notesOpen} onToggle={() => setNotesOpen((current) => !current)}>
        <label className="full-field"><span>Implementation note</span><textarea value={activeObject?.notes ?? ''} onChange={(event) => update({ notes: event.target.value }, 'Edited implementation note')} placeholder="What should a builder preserve?" rows={4} /></label>
        <div className="note-hint">Notes travel with the selected object in the handoff package.</div>
      </Collapsible>

      <div className="inspector-footer-actions">
        <button className="secondary-button" onClick={activeObject?.componentId ? onUpdateComponent : onCreateComponent}><Icon name="link" /> {activeObject?.componentId ? 'Update instances' : 'Create component'}</button>
        {activeObject?.componentId && <span className="component-status">Component instance</span>}
        <div className="layer-footer-buttons"><button className="icon-button" onClick={onVisible} aria-label="Toggle visibility"><Icon name={activeObject?.visible ? 'eye' : 'eye-off'} /></button><button className="icon-button" onClick={onLock} aria-label="Lock layer"><Icon name={activeObject?.locked ? 'lock' : 'unlock'} /></button><button className="icon-button" onClick={onUngroup} aria-label="Ungroup"><Icon name="ungroup" /></button><button className="icon-button" onClick={onGroup} aria-label="Group"><Icon name="group" /></button></div>
      </div>
    </>}
  </div>
}

function EmptyInspector({
  page,
  onSetPanel,
  onPageUpdate,
  onTransformStart,
  onTransformEnd,
}: {
  page: Page
  onSetPanel: (panel: 'inspector' | 'assets' | 'ai' | 'connections' | 'review') => void
  onPageUpdate: (patch: Partial<Page>, label?: string) => void
  onTransformStart?: () => void
  onTransformEnd?: (label?: string) => void
}) {
  const pageTransformProps = { onTransformStart, onTransformEnd }
  const updatePageNumber = (patch: Partial<Page>, label: string) => {
    onTransformStart?.()
    onPageUpdate(patch, label)
    onTransformEnd?.(label)
  }

  return <div className="empty-inspector">
    <div className="empty-orbit"><Icon name="cursor" size={22} /></div>
    <h3>Select a layer</h3>
    <p>Click an object on the canvas or choose it from Layers. Right-click any object to attach it to Ask Layer.</p>
    <div className="empty-shortcuts"><div><Icon name="mouse" /> Click to select</div><div><Icon name="keyboard" /> Arrows nudge</div><div><Icon name="spark" /> Ask Layer</div></div>
    <section className="page-settings">
      <div className="page-settings-heading"><span><Icon name="frame" size={13} /> Page setup</span><small>Current page</small></div>
      <div className="field-grid two">
        <NumberField {...pageTransformProps} label="Width" ariaLabel="Page width" value={page.width} min={320} max={10000} decimals={0} changeLabel="Changed page width" onValueChange={(value) => onPageUpdate({ width: value }, 'Changed page width')} />
        <NumberField {...pageTransformProps} label="Height" ariaLabel="Page height" value={page.height} min={240} max={20000} decimals={0} changeLabel="Changed page height" onValueChange={(value) => onPageUpdate({ height: value }, 'Changed page height')} />
      </div>
      <div className="page-preset-row"><button className="breakpoint-chip" onClick={() => updatePageNumber({ width: 1440 }, 'Set desktop page width')}>Desktop</button><button className="breakpoint-chip" onClick={() => updatePageNumber({ width: 768 }, 'Set tablet page width')}>Tablet</button><button className="breakpoint-chip" onClick={() => updatePageNumber({ width: 390 }, 'Set phone page width')}>Phone</button></div>
       <div className="color-row page-background"><label>Background<ColorPicker label="Page background" value={isColor(page.background) ? page.background : '#0b0c0e'} onChange={(value) => onPageUpdate({ background: value }, 'Changed page background')} onStart={onTransformStart} onEnd={onTransformEnd} /></label></div>
      <label className="full-field"><span>Page note</span><textarea value={page.notes} onChange={(event) => onPageUpdate({ notes: event.target.value }, 'Edited page note')} placeholder="What should a builder preserve?" rows={3} /></label>
      <div className="breakpoint-row"><span className="field-caption">Breakpoints</span><div className="breakpoint-chips">{page.breakpoints.map((breakpoint) => <span className="breakpoint-chip" key={breakpoint.id}>{breakpoint.name} · {breakpoint.width}</span>)}</div></div>
    </section>
       <div className="scrub-help page-scrub-help" role="note"><Icon name="move" size={12} /><span>Drag a field label to scrub · Shift coarse · Alt fine</span></div>
       <div className="empty-actions"><button className="secondary-button" onClick={() => onSetPanel('assets')}><Icon name="plus" /> Insert section</button><button className="secondary-button" onClick={() => onSetPanel('ai')}><Icon name="spark" /> Ask about {page.name}</button></div>
  </div>
}

function InspectorSection({ title, icon, children }: { title: string; icon: 'move' | 'palette' | 'type' | 'grid'; children: React.ReactNode }) {
  return <section className="inspector-section"><div className="inspector-section-title"><span><Icon name={icon} size={14} /> {title}</span></div>{children}</section>
}

function Collapsible({ title, icon, open, onToggle, children }: { title: string; icon: 'bolt' | 'sliders' | 'comment'; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <section className={`inspector-section collapsible ${open ? 'open' : ''}`}><button className="collapsible-title" onClick={onToggle}><span><Icon name={icon} size={14} /> {title}</span><Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} /></button>{open && children}</section>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

function isColor(value: string) { return Boolean(parseColor(value)) }

function emptyLayout() {
  return { mode: 'free' as LayoutMode, gap: 16, padding: 24, align: 'start' as const, justify: 'start' as const, wrap: false, widthRule: 'fixed' as const, heightRule: 'fixed' as const, overflow: 'visible' as const }
}

function emptyPattern() {
  return { enabled: false, type: 'dots' as const, scale: 1, spacing: 16, rotation: 0, opacity: 0.2, color: '#f5b847' }
}
