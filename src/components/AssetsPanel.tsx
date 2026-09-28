import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { AssetRecord, ComponentDefinition, DesignElement, DesignStyle, Project, ShapeVariant } from '../lib/model'
import { makeElement, uid } from '../lib/model'
import { SHAPE_OPTIONS } from '../lib/shapes'
import {
  createFontAssets,
  createIconAsset,
  getCatalogCategories,
  hydrateInstalledFonts,
  loadIconSvgDataUrl,
  searchCatalog,
  type CatalogItem,
  type CatalogPage,
} from '../lib/catalog'
import { ColorPicker } from './ColorPicker'
import { SelectField } from './SelectField'
import './assets-panel.css'

export interface AssetsPanelProps {
  project: Project
  onUpdate: (mutator: (draft: Project) => void, label?: string) => void
  onCommit: (mutator: (draft: Project) => void, label: string) => void
  onInsertElement: (element: DesignElement) => void
  onUpload: () => void
  onNotify: (message: string) => void
  onInsertElements?: (elements: DesignElement[]) => void
  onInsertComponent?: (id: string) => void
  onApplyStyle?: (styleId: string) => void
}

type AssetTab = 'library' | 'marketplace' | 'fonts' | 'icons' | 'components' | 'tokens'

const insertBatch = (elements: DesignElement[], props: AssetsPanelProps) => {
  if (!elements.length) return
  if (props.onInsertElements) props.onInsertElements(elements)
  else elements.forEach(props.onInsertElement)
}

const child = (element: DesignElement, parentId: string, x: number, y: number, overrides: Partial<DesignElement> = {}) => ({ ...element, parentId, x, y, ...overrides })

const starterElements = (id: string): DesignElement[] => {
  const frame = makeElement('frame', { id: uid('starter'), name: id === 'starter-dashboard' ? 'Dashboard shell' : id === 'starter-contact' ? 'Contact flow' : 'Landing section', x: 80, y: 80, width: 880, height: id === 'starter-dashboard' ? 650 : 560, fill: '#11151b', stroke: '#3a414d', radius: 18 })
  if (id === 'starter-dashboard') {
    const nav = child(makeElement('nav', { name: 'Dashboard navigation', width: 220, height: 580, fill: '#151a22', text: 'LAYER\n\nOverview\nProjects\nActivity', fontSize: 15, lineHeight: 2 }), frame.id, 18, 18)
    const heading = child(makeElement('text', { name: 'Dashboard heading', text: 'Good morning, build something clear.', fontSize: 30, fontWeight: 700, fill: 'transparent', width: 570, height: 46 }), frame.id, 270, 32)
    const cards = [0, 1, 2].map((index) => child(makeElement('card', { name: `Metric ${index + 1}`, text: ['Published flows\n12', 'Open reviews\n04', 'Reusable assets\n28'][index], fontSize: 15, lineHeight: 1.7, width: 170, height: 112, fill: '#1a2029' }), frame.id, 270 + index * 190, 112))
    const activity = child(makeElement('card', { name: 'Activity list', text: 'Recent activity\n\nUpdated the onboarding flow\nAdded a responsive card component\nSaved a handoff snapshot', fontSize: 14, lineHeight: 1.65, width: 570, height: 260, fill: '#151a22' }), frame.id, 270, 250)
    return [frame, nav, heading, ...cards, activity]
  }
  if (id === 'starter-contact') {
    const heading = child(makeElement('text', { name: 'Contact heading', text: 'Let’s make the next layer useful.', fontSize: 34, fontWeight: 700, fill: 'transparent', width: 560, height: 82 }), frame.id, 48, 42)
    const copy = child(makeElement('text', { name: 'Contact supporting copy', text: 'Tell us what you are building and where the handoff feels unclear.', fontSize: 16, lineHeight: 1.5, fill: 'transparent', width: 500, height: 58 }), frame.id, 52, 140)
    const fields = [
      child(makeElement('input', { name: 'Name field', text: 'Your name', width: 360, height: 48, fill: '#171d26' }), frame.id, 52, 230),
      child(makeElement('input', { name: 'Email field', text: 'Email address', width: 360, height: 48, fill: '#171d26', inputType: 'email' } as Partial<DesignElement>), frame.id, 52, 294),
      child(makeElement('input', { name: 'Message field', text: 'What are you working on?', width: 520, height: 96, fill: '#171d26' }), frame.id, 52, 358),
      child(makeElement('button', { name: 'Send button', text: 'Send message', width: 160, height: 48, fill: '#f5b847', stroke: '#f5b847', interactions: [{ id: uid('int'), trigger: 'click', action: 'submit-form' }] }), frame.id, 52, 478),
    ]
    return [frame, heading, copy, ...fields]
  }
  const nav = child(makeElement('nav', { name: 'Landing navigation', text: 'LAYER                                      Work   About', fontWeight: 700, width: 780, height: 50, fill: 'transparent' }), frame.id, 48, 26)
  const heading = child(makeElement('text', { name: 'Landing heading', text: 'Make the next layer obvious.', fontSize: 52, lineHeight: 1.05, fontWeight: 700, fill: 'transparent', width: 560, height: 124 }), frame.id, 48, 126)
  const copy = child(makeElement('text', { name: 'Landing copy', text: 'Design the structure, test the behavior, and leave a clean handoff.', fontSize: 17, lineHeight: 1.5, fill: 'transparent', width: 420, height: 64 }), frame.id, 52, 278)
  const button = child(makeElement('button', { name: 'Landing CTA', text: 'Open canvas', width: 154, height: 48, fill: '#f5b847', stroke: '#f5b847', interactions: [{ id: uid('int'), trigger: 'click', action: 'scroll', targetId: frame.id }] }), frame.id, 52, 382)
  const proof = child(makeElement('card', { name: 'Proof card', text: 'ONE DOCUMENT\nPages, tokens, responsive rules, and interactions in one source of truth.', fontSize: 14, lineHeight: 1.55, width: 230, height: 154, fill: '#1a2029' }), frame.id, 590, 178)
  return [frame, nav, heading, copy, button, proof]
}

const patternElement = (type: 'dots' | 'grid' | 'stripes'): DesignElement => makeElement('rect', { name: `${type[0].toUpperCase()}${type.slice(1)} pattern`, width: 360, height: 180, pattern: { enabled: true, type, scale: 1, spacing: 18, rotation: type === 'stripes' ? 45 : 0, opacity: 0.28, color: '#f5b847' }, fill: '#11151b', stroke: '#3a414d' })
const savedPatternType = (asset: AssetRecord): 'dots' | 'grid' | 'stripes' => asset.metadata?.patternType === 'stripes' ? 'stripes' : asset.metadata?.patternType === 'dots' ? 'dots' : 'grid'
const LAYER_LOGO_URL = new URL('../../img/logo-circle.png', import.meta.url).href

export function AssetsPanel(props: AssetsPanelProps) {
  const { project, onCommit, onNotify } = props
  const [tab, setTab] = useState<AssetTab>('library')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [page, setPage] = useState<CatalogPage | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [catalogNonce, setCatalogNonce] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([])
  const [tokenName, setTokenName] = useState('New token')
  const [tokenValue, setTokenValue] = useState('#f5b847')
  const [tokenKind, setTokenKind] = useState<DesignStyle['kind']>('color')
  const [busyId, setBusyId] = useState<string | null>(null)
  const catalogRequestRef = useRef(0)
  const installRequestRef = useRef(0)

  useEffect(() => { hydrateInstalledFonts(project.assets) }, [project.assets])
  useEffect(() => {
    let active = true
    void getCatalogCategories().then((items) => { if (active) setCategories(items.map(({ id, label }) => ({ id, label }))) }).catch(() => { if (active) setCategories([{ id: 'all', label: 'All' }]) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (tab !== 'marketplace') return
    const requestId = ++catalogRequestRef.current
    let active = true
    setLoading(true); setError(null); setPage(null)
    void searchCatalog({ query, category, page: pageNumber, pageSize: 12 }).then((nextPage) => {
      if (active && requestId === catalogRequestRef.current) setPage(nextPage)
    }).catch((caught: unknown) => {
      if (active && requestId === catalogRequestRef.current) setError(caught instanceof Error ? caught.message : 'Marketplace is unavailable.')
    }).finally(() => {
      if (active && requestId === catalogRequestRef.current) setLoading(false)
    })
    return () => { active = false }
  }, [tab, query, category, pageNumber, catalogNonce])

  const installedAssets = useMemo(() => project.assets.filter((asset) => asset.kind !== 'pattern'), [project.assets])
  const integration = (id: string) => project.integrations.find((item) => item.id === id)
  const updateIntegration = (id: string, patch: Partial<Project['integrations'][number]>) => onCommit((draft) => { const target = draft.integrations.find((item) => item.id === id); if (target) Object.assign(target, patch) }, `Updated ${id} integration`)
  const insert = (elements: DesignElement[]) => insertBatch(elements, props)

  const installItem = async (item: CatalogItem) => {
    if (busyId) return
    const requestId = ++installRequestRef.current
    setBusyId(item.id); setError(null)
    try {
      if (item.kind === 'template') { insert(starterElements(item.id)); onNotify(`${item.title} added as editable layers.`) }
       else if (item.kind === 'pattern') { const type = item.id.includes('dots') ? 'dots' : item.id.includes('stripes') ? 'stripes' : 'grid'; const element = patternElement(type); onCommit((draft) => draft.assets.push({ id: uid('asset'), name: item.title, kind: 'pattern', source: 'Layer marketplace', license: item.license, installedAt: new Date().toISOString(), metadata: { catalogId: item.id, category: 'pattern', patternType: type } }), `Installed ${item.title}`); insert([element]); onNotify(`${item.title} added.`) }
      else if (item.kind === 'font' && item.font) { const assets = await createFontAssets({ ...item.font, source: item.source === 'local' ? 'fontsource' : item.source }, {}); onCommit((draft) => { draft.assets = [...draft.assets.filter((asset) => asset.metadata?.catalogId !== item.id), ...assets.map((asset) => ({ ...asset, metadata: { ...asset.metadata, catalogId: item.id } }))] }, `Installed ${item.title}`); hydrateInstalledFonts(assets); onNotify(`${item.title} font files downloaded and ready.`) }
      else if (item.kind === 'icon' && item.icon) { const asset = await createIconAsset(item.icon, {}); const next = { ...asset, metadata: { ...asset.metadata, catalogId: item.id } }; onCommit((draft) => draft.assets.push(next), `Installed ${item.title}`); props.onInsertElement(makeElement('icon', { name: item.title, iconName: item.icon.icon, src: asset.src, alt: item.title, x: 180, y: 180, width: 64, height: 64, fill: 'transparent', stroke: 'transparent' })); onNotify(`${item.title} icon saved with ${asset.license} licensing.`) }
    } catch (caught) { if (requestId === installRequestRef.current) { setError(caught instanceof Error ? caught.message : 'Install failed.'); onNotify('Install failed; no project asset was added.') } } finally { if (requestId === installRequestRef.current) setBusyId(null) }
  }

  const installIntegration = async (id: string) => { updateIntegration(id, { installed: true, enabled: true, error: undefined, lastSynced: new Date().toISOString() }); setTab('marketplace'); setCategory(id === 'google-fonts' ? 'font' : 'icon'); setPageNumber(1); onNotify('Integration enabled; fetching its catalog.') }
  const removeIntegration = (id: string) => { updateIntegration(id, { installed: false, enabled: false, error: undefined }); onNotify('Integration removed. Existing project assets were preserved.') }
  const updateIntegrationCatalog = async (id: string, categoryName: 'font' | 'icon') => {
    try {
      await searchCatalog({ category: categoryName, page: 1, pageSize: 1 })
      updateIntegration(id, { error: undefined, lastSynced: new Date().toISOString() })
      onNotify(`${id === 'google-fonts' ? 'Google Fonts' : 'Iconify'} catalog updated.`)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Catalog update failed.'
      updateIntegration(id, { error: message })
      onNotify(message)
    }
  }

  const addToken = () => { if (!tokenName.trim() || !tokenValue.trim()) return; onCommit((draft) => draft.styles.push({ id: uid('style'), name: tokenName.trim(), kind: tokenKind, value: tokenValue.trim() }), `Added ${tokenName.trim()}`); setTokenName('New token'); onNotify('Token saved.') }
   const insertQuick = (type: 'text' | 'button' | 'rect' | 'circle' | 'image' | 'icon') => {
    if (type !== 'icon') { props.onInsertElement(makeElement(type, type === 'image' ? { alt: 'Describe this image' } : undefined)); return }
    void (async () => {
      try {
        const result = { name: 'layers', prefix: 'lucide', icon: 'lucide:layers', title: 'Layers', source: 'iconify' as const }
        const asset = await createIconAsset(result, {})
        onCommit((draft) => draft.assets.push(asset), 'Installed Layers icon')
        props.onInsertElement(makeElement('icon', { name: 'Layers icon', iconName: result.icon, src: asset.src, alt: 'Layers icon', width: 64, height: 64, fill: 'transparent', stroke: 'transparent' }))
        onNotify('Layers icon fetched and inserted with collection licensing.')
      } catch (caught) { onNotify(caught instanceof Error ? caught.message : 'Icon catalog is unavailable.') }
    })()
  }
  const insertShape = (shape: ShapeVariant) => {
    const isFrame = shape === 'round'
    const size = isFrame ? 180 : 220
    const element = makeElement(isFrame ? 'frame' : 'rect', { name: `${SHAPE_OPTIONS.find((option) => option.value === shape)?.label ?? 'Shape'} symbol`, shape, width: size, height: isFrame ? size : 180, radius: shape === 'pill' || shape === 'round' ? 999 : 12, corners: { topLeft: shape === 'pill' || shape === 'round' ? 999 : 12, topRight: shape === 'pill' || shape === 'round' ? 999 : 12, bottomRight: shape === 'pill' || shape === 'round' ? 999 : 12, bottomLeft: shape === 'pill' || shape === 'round' ? 999 : 12 }, layout: isFrame ? { ...(makeElement('frame').layout!), overflow: 'hidden' } : undefined })
    props.onInsertElement(element)
  }
  const insertLogo = () => props.onInsertElement(makeElement('image', { name: 'Layer logo', src: LAYER_LOGO_URL, alt: 'Layer logo', width: 180, height: 180, imageFit: 'contain', imagePosition: 'center', aspectRatioLocked: true, fill: 'transparent', stroke: 'transparent' }))

  return <div className="workspace-panel assets-panel">
    <PanelHeading kicker="ASSETS" title="Library" icon="layers" />
    <div className="panel-tabs" role="tablist" aria-label="Asset library sections">{(['library', 'marketplace', 'fonts', 'icons', 'components', 'tokens'] as AssetTab[]).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => { setTab(item); if (item !== 'marketplace') setError(null) }}>{item === 'marketplace' ? 'Marketplace' : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
     {error && <div className="error-callout" role="alert"><Icon name="warning" size={14} /><span>{error}</span><button type="button" className="mini-link" onClick={() => setError(null)}>Dismiss</button></div>}
     {tab === 'library' && <LibraryView project={project} onUpload={props.onUpload} onInsert={insert} onQuickInsert={insertQuick} onQuickShape={insertShape} onLogo={insertLogo} onNotify={onNotify} />}
    {tab === 'marketplace' && <MarketplaceView page={page} categories={categories} category={category} query={query} pageNumber={pageNumber} loading={loading} busyId={busyId} onCategory={(value) => { setCategory(value); setPageNumber(1) }} onQuery={(value) => { setQuery(value); setPageNumber(1) }} onPage={setPageNumber} onInstall={(item) => void installItem(item)} onRefresh={() => setCatalogNonce((value) => value + 1)} />}
    {tab === 'fonts' && <IntegrationView title="Google Fonts" integration={integration('google-fonts')} category="font" onInstall={() => void installIntegration('google-fonts')} onUpdate={() => void updateIntegrationCatalog('google-fonts', 'font')} onRemove={() => removeIntegration('google-fonts')} onDisable={() => updateIntegration('google-fonts', { enabled: false })} onEnable={() => updateIntegration('google-fonts', { enabled: true })} onBrowse={() => { setCategory('font'); setTab('marketplace') }} assets={installedAssets.filter((asset) => asset.kind === 'font')} />}
    {tab === 'icons' && <IntegrationView title="Iconify" integration={integration('iconify')} category="icon" onInstall={() => void installIntegration('iconify')} onUpdate={() => void updateIntegrationCatalog('iconify', 'icon')} onRemove={() => removeIntegration('iconify')} onDisable={() => updateIntegration('iconify', { enabled: false })} onEnable={() => updateIntegration('iconify', { enabled: true })} onBrowse={() => { setCategory('icon'); setTab('marketplace') }} assets={installedAssets.filter((asset) => asset.kind === 'icon')} />}
    {tab === 'components' && <ComponentsView project={project} onInsert={props.onInsertComponent} />}
    {tab === 'tokens' && <TokensView project={project} tokenName={tokenName} tokenValue={tokenValue} tokenKind={tokenKind} setTokenName={setTokenName} setTokenValue={setTokenValue} setTokenKind={setTokenKind} onAdd={addToken} onDelete={(id) => onCommit((draft) => { draft.styles = draft.styles.filter((style) => style.id !== id) }, 'Deleted token')} onApply={props.onApplyStyle} />}
  </div>
}

function LibraryView({ project, onUpload, onInsert, onQuickInsert, onQuickShape, onLogo, onNotify }: { project: Project; onUpload: () => void; onInsert: (elements: DesignElement[]) => void; onQuickInsert: (type: 'text' | 'button' | 'rect' | 'circle' | 'image' | 'icon') => void; onQuickShape: (shape: ShapeVariant) => void; onLogo: () => void; onNotify: (message: string) => void }) {
  const patterns = project.assets.filter((asset) => asset.kind === 'pattern')
  const localAssets = project.assets.filter((asset) => asset.kind !== 'pattern')
  return <>
    <div className="asset-intro"><span className="signal-dot" /> Installed content is available without an AI account.</div>
     <section className="asset-subsection"><div className="subsection-heading">Quick insert <span>real editable layers</span></div><div className="starter-grid">{(['text', 'button', 'rect', 'circle', 'image', 'icon'] as const).map((type) => <button key={type} type="button" className="starter-tile" onClick={() => onQuickInsert(type)}><span className="starter-preview"><Icon name={type === 'text' ? 'text' : type === 'image' ? 'image' : type === 'icon' ? 'icon' : 'shape'} size={16} /></span><span>{type[0].toUpperCase() + type.slice(1)}</span></button>)}</div></section>
     <section className="asset-subsection"><div className="subsection-heading">Symbols & logo marks <span>editable vectors and frames</span></div><div className="starter-grid shapes-grid">{SHAPE_OPTIONS.slice(1).map((option) => <button key={option.value} type="button" className="starter-tile" onClick={() => onQuickShape(option.value)}><span className={`starter-preview shape-preview shape-${option.value}`}><Icon name="shape" size={16} /></span><span>{option.label}</span></button>)}<button type="button" className="starter-tile" onClick={onLogo}><span className="starter-preview logo-preview"><img src={LAYER_LOGO_URL} alt="" /></span><span>Layer logo</span></button></div></section>
    <section className="asset-subsection"><div className="subsection-heading">Starter layouts <span>multi-layer structures</span></div><div className="starter-grid">{(['starter-landing', 'starter-dashboard', 'starter-contact'] as const).map((id) => <button key={id} type="button" className="starter-tile" onClick={() => { onInsert(starterElements(id)); onNotify('Starter layout inserted as editable layers.') }}><span className={`starter-preview starter-layout-preview ${id.replace('starter-', '')}`} aria-hidden="true"><i /><b>{id === 'starter-dashboard' ? '12' : id === 'starter-contact' ? '→' : 'L'}</b></span><span>{id.replace('starter-', '')}</span></button>)}</div></section>
    {patterns.length > 0 && <section className="asset-subsection"><div className="subsection-heading">Saved patterns <span>reusable fills</span></div><div className="starter-grid">{patterns.map((asset) => { const type = savedPatternType(asset); return <button key={asset.id} type="button" className="starter-tile" onClick={() => { onInsert([patternElement(type)]); onNotify(`${asset.name} inserted.`) }}><span className={`starter-preview pattern-${type}`} aria-hidden="true" /><span>{asset.name}</span></button> })}</div></section>}
    <section className="asset-subsection"><div className="subsection-heading">Local assets</div><button type="button" className="upload-tile" onClick={onUpload}><Icon name="upload" /><span>Upload an image</span><small>PNG, JPG, SVG · kept in this project</small></button>{localAssets.length > 0 && <div className="asset-list">{localAssets.map((asset) => <div className="asset-list-row" key={asset.id}><span className="asset-thumb">{asset.kind === 'image' && asset.src ? <img src={asset.src} alt="" /> : <Icon name={asset.kind === 'font' ? 'type' : 'icon'} size={14} />}</span><span>{asset.name}</span><small>{asset.source} · {asset.license}</small></div>)}</div>}</section>
  </>
}

function MarketplaceView({ page, categories, category, query, pageNumber, loading, busyId, onCategory, onQuery, onPage, onInstall, onRefresh }: { page: CatalogPage | null; categories: Array<{ id: string; label: string }>; category: string; query: string; pageNumber: number; loading: boolean; busyId: string | null; onCategory: (value: string) => void; onQuery: (value: string) => void; onPage: (value: number) => void; onInstall: (item: CatalogItem) => void; onRefresh: () => void }) {
  return <div className="catalog-tab">
    <div className="catalog-header"><div><h3>Marketplace</h3><p>Official catalogs plus editable Layer starters. Preview an item before installing it.</p></div>{page?.cached && <span className="integration-pill">Cached catalog</span>}</div>
    <div className="catalog-controls"><label className="catalog-search"><Icon name="search" size={14} /><input aria-label="Search marketplace" value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onRefresh() }} placeholder="Search fonts, icons, starters" /><button type="button" onClick={onRefresh}>{loading ? '…' : 'Search'}</button></label></div>
    <div className="marketplace-categories" role="group" aria-label="Marketplace categories">{categories.map((item) => <button key={item.id} type="button" aria-pressed={category === item.id} className={category === item.id ? 'active' : ''} onClick={() => onCategory(item.id)}>{item.label}</button>)}</div>
    {loading && <div className="empty-panel" role="status"><Icon name="refresh" size={20} /><p>Fetching catalog content…</p></div>}
    {!loading && page && <>
      <div className="catalog-list" aria-live="polite">{page.items.map((item) => <article className="catalog-row" key={item.id}><CatalogPreview item={item} /><div className="catalog-row-copy"><strong>{item.title}</strong><small>{item.description} · {item.license}</small></div><button type="button" className="mini-link catalog-install" onClick={() => onInstall(item)} disabled={busyId !== null}>{busyId === item.id ? 'Installing…' : 'Install'}</button></article>)}</div>
      {!page.items.length && <div className="empty-panel"><Icon name="search" size={20} /><p>No catalog items matched this query.</p></div>}
      <nav className="catalog-pagination" aria-label="Marketplace pagination"><button type="button" className="mini-link" disabled={pageNumber <= 1} onClick={() => onPage(pageNumber - 1)}>Previous</button><span>Page {pageNumber} · {page.total} results</span><button type="button" className="mini-link" disabled={!page.hasNext} onClick={() => onPage(pageNumber + 1)}>Next</button></nav>
    </>}
  </div>
}

function CatalogPreview({ item }: { item: CatalogItem }) {
  const [src, setSrc] = useState<string | null>(null)
  const [fontLoaded, setFontLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    setSrc(null)
    if (item.kind !== 'icon' || !item.icon) return () => { alive = false }
    void loadIconSvgDataUrl(item.icon.icon, {}).then((value) => { if (alive) setSrc(value) }).catch(() => { if (alive) setSrc(null) })
    return () => { alive = false }
  }, [item.id, item.kind, item.icon?.icon])
  useEffect(() => {
    let alive = true
    setFontLoaded(false)
    if (item.kind !== 'font' || !item.font?.family || typeof document === 'undefined') return () => { alive = false }
    const family = item.font.family
    const loaded = () => Array.from(document.fonts ?? []).some((face) => face.status === 'loaded' && face.family.replace(/["']/g, '') === family)
    const check = () => { if (alive) setFontLoaded(loaded()) }
    check()
    void document.fonts?.ready.then(check).catch(() => undefined)
    return () => { alive = false }
  }, [item.id, item.kind, item.font?.family])
  if (item.kind === 'icon') return <span className="catalog-preview catalog-preview-icon" aria-hidden="true">{src ? <img src={src} alt="" /> : <Icon name="icon" size={22} />}</span>
  if (item.kind === 'font') return <span className="catalog-preview catalog-preview-font" data-font-loaded={fontLoaded} style={{ fontFamily: fontLoaded ? `"${item.font?.family}", sans-serif` : 'Aptos, "Segoe UI", sans-serif' }}><span>Aa</span><small>{fontLoaded ? 'loaded' : 'system fallback'}</small></span>
  if (item.kind === 'pattern') return <span className={`catalog-preview catalog-preview-pattern ${item.id.includes('dots') ? 'pattern-dots' : item.id.includes('stripes') ? 'pattern-stripes' : 'pattern-grid'}`} aria-hidden="true" />
  const templateClass = item.id.endsWith('dashboard') ? 'template-dashboard' : item.id.endsWith('contact') ? 'template-contact' : 'template-landing'
  return <span className={`catalog-preview catalog-preview-template ${templateClass}`} aria-hidden="true"><i /><i /><i /><b>{item.id.endsWith('dashboard') ? '12' : item.id.endsWith('contact') ? '→' : 'L'}</b></span>
}

function IntegrationView({ title, integration, category, onInstall, onUpdate, onRemove, onDisable, onEnable, onBrowse, assets }: { title: string; integration?: Project['integrations'][number]; category: string; onInstall: () => void; onUpdate: () => void; onRemove: () => void; onDisable: () => void; onEnable: () => void; onBrowse: () => void; assets: AssetRecord[] }) {
  return <div className="catalog-tab"><div className="catalog-header"><div><h3>{title}</h3><p>Install content locally, keep source/license metadata, and preserve assets when disabled or removed.</p></div><span className={`integration-pill ${integration?.installed && integration.enabled ? 'on' : ''}`}>{integration?.installed ? integration.enabled ? 'Enabled' : 'Disabled' : 'Not installed'}</span></div>{!integration?.installed ? <button type="button" className="primary-button full" onClick={onInstall}><Icon name="download-cloud" /> Install integration</button> : <div className="provider-actions"><button type="button" className="secondary-button" onClick={integration.enabled ? onDisable : onEnable}>{integration.enabled ? 'Disable' : 'Enable'}</button><button type="button" className="secondary-button" onClick={onBrowse}><Icon name="search" /> Browse {category}</button><button type="button" className="secondary-button" onClick={onUpdate}><Icon name="refresh" /> Update catalog</button><button type="button" className="secondary-button" onClick={onRemove}><Icon name="trash" /> Remove integration</button></div>}{integration?.error && <div className="error-text" role="alert">{integration.error}</div>}{assets.length > 0 && <div className="asset-list">{assets.map((asset) => <div className="asset-list-row" key={asset.id}><span>{asset.name}</span><small>{asset.source} · {asset.license}</small></div>)}</div>}</div>
}

function ComponentsView({ project, onInsert }: { project: Project; onInsert?: (id: string) => void }) { return <div className="components-panel">{project.components.length ? project.components.map((component: ComponentDefinition) => <div className="component-row" key={component.id}><span className="component-symbol"><Icon name="link" size={14} /></span><div><strong>{component.name}</strong><small>{component.elementIds.length} source layers · {component.variants.length} variants</small></div>{onInsert && <button type="button" className="mini-link" onClick={() => onInsert(component.id)}>Insert</button>}</div>) : <div className="empty-panel"><Icon name="link" size={20} /><h3>No components yet</h3><p>Selected layers can become reusable components from the inspector.</p></div>}</div> }

function TokensView({ project, tokenName, tokenValue, tokenKind, setTokenName, setTokenValue, setTokenKind, onAdd, onDelete, onApply }: { project: Project; tokenName: string; tokenValue: string; tokenKind: DesignStyle['kind']; setTokenName: (value: string) => void; setTokenValue: (value: string) => void; setTokenKind: (value: DesignStyle['kind']) => void; onAdd: () => void; onDelete: (id: string) => void; onApply?: (id: string) => void }) {
  return <div className="tokens-panel"><div className="asset-intro"><span className="signal-dot" /> Tokens are saved in the project and can be applied to the current selection.</div><div className="token-form">
    <label className="token-field"><span>Name</span><input aria-label="Token name" value={tokenName} onChange={(event) => setTokenName(event.target.value)} /></label>
     <label className="token-field"><span>Kind</span><SelectField value={tokenKind} options={[['color', 'Color'], ['type', 'Type'], ['spacing', 'Spacing'], ['shadow', 'Shadow']].map(([value, label]) => ({ value, label }))} ariaLabel="Token kind" onChange={(value) => setTokenKind(value as DesignStyle['kind'])} /></label>
    <div className="token-value-field"><span>Value</span>{tokenKind === 'color' ? <ColorPicker label="Token value" value={/^#[0-9a-f]{6}$/i.test(tokenValue) ? tokenValue : '#f5b847'} onChange={setTokenValue} /> : <input aria-label="Token value" value={tokenValue} onChange={(event) => setTokenValue(event.target.value)} />}</div>
    <button type="button" className="primary-button" onClick={onAdd} disabled={!tokenName.trim() || !tokenValue.trim()}><Icon name="plus" /> Add token</button>
  </div><div className="token-list">{project.styles.length ? project.styles.map((style) => <div className="token-row" data-token-id={style.id} key={style.id}><span className={`token-swatch token-${style.kind}`} aria-hidden="true" style={style.kind === 'color' ? { background: style.value } : undefined} /><div className="token-copy"><strong>{style.name}</strong><small><span className="token-kind">{style.kind}</span><span aria-label="Token value" className="token-value">{style.value}</span></small></div><div className="token-actions">{onApply && <button type="button" className="mini-link" onClick={() => onApply(style.id)} aria-label={`Apply ${style.name} token`}>Apply</button>}<button type="button" className="icon-button tiny" aria-label={`Delete ${style.name}`} onClick={() => onDelete(style.id)}><Icon name="trash" size={13} /></button></div></div>) : <div className="empty-panel compact"><Icon name="palette" size={19} /><p>No project tokens yet. Add one above to make a value reusable.</p></div>}</div></div>
}

function PanelHeading({ kicker, title, icon }: { kicker: string; title: string; icon: 'layers' | 'plug' | 'check-circle' }) { return <div className="panel-heading"><div><span className="panel-kicker">{kicker}</span><h2>{title}</h2></div><Icon name={icon} size={18} /></div> }
