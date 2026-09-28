import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Icon } from './Icon'
import { SelectField } from './SelectField'
import type { Page, Project, Snapshot } from '../lib/model'
import { computeLayout } from '../lib/layout'
import { disableOcr, enableOcr, getOcrStatus, installOcr, recognizeImage, removeOcr, supportedOcrLanguages } from '../lib/ocr'
import { readFileAsDataUrl } from '../lib/storage'
import './review-panel.css'

export interface ReviewPanelProps {
  project: Project
  page: Page
  onUpdate: (mutator: (draft: Project) => void, label?: string) => void
  onNotify: (message: string) => void
  onExport: () => void
  onCopy: () => void
  onRestoreSnapshot?: (id: string) => void
}

interface ReviewIssue { severity: 'warn' | 'info'; label: string; detail: string; id?: string }

const extension = <T,>(value: unknown): T | undefined => value && typeof value === 'object' ? value as T : undefined

export const parseColor = (value: string): [number, number, number] | null => {
  const normalized = value.trim().toLowerCase()
  const hex = normalized.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    const expanded = hex[1].length <= 4 ? hex[1].slice(0, 4).split('').map((char) => char + char).join('') : hex[1]
    return [Number.parseInt(expanded.slice(0, 2), 16), Number.parseInt(expanded.slice(2, 4), 16), Number.parseInt(expanded.slice(4, 6), 16)]
  }
  const channels = normalized.match(/^rgba?\((.+)\)$/i)?.[1]?.replaceAll(',', ' ').split(/[\s/]+/).filter(Boolean)
  if (channels && channels.length >= 3) {
    const rgb = channels.slice(0, 3).map((channel) => channel.endsWith('%') ? Number(channel.slice(0, -1)) * 2.55 : Number(channel))
    if (rgb.every((channel) => Number.isFinite(channel))) return rgb.map((channel) => Math.min(255, Math.max(0, channel))) as [number, number, number]
  }
  const hsl = normalized.match(/^hsla?\(\s*([\d.+-]+)(?:deg)?[\s,]+([\d.+-]+)%[\s,]+([\d.+-]+)%/i)
  if (hsl) {
    const hue = ((Number(hsl[1]) % 360) + 360) % 360 / 360
    const saturation = Math.min(1, Math.max(0, Number(hsl[2]) / 100))
    const lightness = Math.min(1, Math.max(0, Number(hsl[3]) / 100))
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
    const x = chroma * (1 - Math.abs((hue * 6) % 2 - 1))
    const match = hue < 1 / 6 ? [chroma, x, 0] : hue < 2 / 6 ? [x, chroma, 0] : hue < 3 / 6 ? [0, chroma, x] : hue < 4 / 6 ? [0, x, chroma] : hue < 5 / 6 ? [x, 0, chroma] : [chroma, 0, x]
    const offset = lightness - chroma / 2
    return match.map((channel) => Math.round((channel + offset) * 255)) as [number, number, number]
  }
  return null
}

const luminance = ([r, g, b]: [number, number, number]) => [r, g, b].map((value) => value / 255).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
export const contrastRatio = (foreground: string, background: string): number | null => { const fg = parseColor(foreground); const bg = parseColor(background); if (!fg || !bg) return null; const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a); return (light + .05) / (dark + .05) }
export const checkerTextColor = (element: { type: string }, textColor?: string) => textColor ?? (element.type === 'button' ? '#0b0c0e' : '#f4f1e8')
const isInteractive = (type: string) => ['button', 'input', 'nav', 'tabs', 'accordion'].includes(type)

const copyText = async (value: string, onNotify: (message: string) => void) => {
  try { await navigator.clipboard.writeText(value); onNotify('Page text copied.') } catch { onNotify('Clipboard is unavailable in this browser.') }
}

export function ReviewPanel({ project, page, onUpdate, onNotify, onExport, onCopy, onRestoreSnapshot }: ReviewPanelProps) {
  const [running, setRunning] = useState(false)
  const [checked, setChecked] = useState(false)
  const [issues, setIssues] = useState<ReviewIssue[]>([])
  const [ocrText, setOcrText] = useState('')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrPhase, setOcrPhase] = useState('Preparing OCR')
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [ocrLanguage, setOcrLanguage] = useState('eng')
  const [ocrBusy, setOcrBusy] = useState(false)
  const ocrInputRef = useRef<HTMLInputElement>(null)
  const ocrStatus = getOcrStatus()
  const layout = useMemo(() => computeLayout(page, { width: page.width }), [page])
  const nativePageText = useMemo(() => page.elements.map((element) => extension<{ content?: string }>(element)?.content ?? element.text ?? '').filter(Boolean).join('\n\n'), [page])
  const snapshots = project.versions ?? []
  const effectiveOcrError = ocrError ?? (project.settings.ocrStatus === 'error' ? ocrStatus.error ?? null : null)
  const ocrLabel = ocrBusy ? 'Working' : effectiveOcrError ? 'Needs attention' : ocrStatus.ready && project.settings.ocrEnabled ? 'Ready' : !ocrStatus.enabled ? 'Disabled' : 'Not installed'
  const ocrLabelClass = ocrBusy ? 'busy' : effectiveOcrError ? 'error' : ocrStatus.ready && project.settings.ocrEnabled ? 'ready' : ''

  const runChecks = () => {
    setRunning(true)
    window.setTimeout(() => {
      const findings: ReviewIssue[] = []
      for (const element of page.elements) {
        const resolved = layout.get(element.id)
        const extensionData = extension<{ textColor?: string; required?: boolean; inputType?: string; content?: string }>(element)
        if (element.type === 'image' && !element.alt) findings.push({ severity: 'warn', label: 'Missing text alternative', detail: `${element.name} needs alt text for the handoff.`, id: element.id })
        if (isInteractive(element.type) && (element.width < 44 || element.height < 44)) findings.push({ severity: 'warn', label: 'Small interactive target', detail: `${element.name} resolves to ${Math.round(element.width)}×${Math.round(element.height)} px. Aim for 44 px.`, id: element.id })
        if (resolved && (resolved.x < 0 || resolved.y < 0 || resolved.x + resolved.width > page.width || resolved.y + resolved.height > page.height)) findings.push({ severity: 'warn', label: 'Resolved layout overflow', detail: `${element.name} extends beyond the ${page.width}×${page.height} page after responsive rules are applied.`, id: element.id })
        if ((element.type === 'text' || element.text || extensionData?.content) && element.visible) {
           const ratio = contrastRatio(checkerTextColor(element, extensionData?.textColor), element.fill === 'transparent' ? page.background : element.fill)
          if (ratio !== null && ratio < 4.5) findings.push({ severity: 'warn', label: 'Low text contrast', detail: `${element.name} is approximately ${ratio.toFixed(2)}:1 against its resolved surface; target 4.5:1 for normal text.`, id: element.id })
          if (ratio === null) findings.push({ severity: 'info', label: 'Contrast needs visual review', detail: `${element.name} uses a non-literal color or image surface that this local checker cannot resolve.`, id: element.id })
        }
        if (extensionData?.required && !element.text?.trim() && element.type === 'input') findings.push({ severity: 'info', label: 'Required field has no sample value', detail: `${element.name} is marked required; confirm the empty and error states in implementation.`, id: element.id })
      }
      if (!page.notes) findings.push({ severity: 'info', label: 'Add page intent', detail: 'A short page note will help a builder preserve this page.' })
      if (!findings.length) findings.push({ severity: 'info', label: 'No obvious findings', detail: 'The local checks passed for this page and viewport. Test real content and keyboard behavior in the target implementation.' })
      setIssues(findings); setChecked(true); setRunning(false)
    }, 180)
  }

  const restore = (snapshot: Snapshot) => {
    if (onRestoreSnapshot) onRestoreSnapshot(snapshot.id)
    else onUpdate((draft) => { const source = structuredClone(snapshot.project); draft.pages = source.pages; draft.activePageId = source.activePageId; draft.styles = source.styles; draft.components = source.components; draft.assets = source.assets }, `Restored ${snapshot.name}`)
    onNotify(`Restored ${snapshot.name}.`)
  }
  const deleteSnapshot = (id: string) => onUpdate((draft) => { draft.versions = draft.versions.filter((snapshot) => snapshot.id !== id) }, 'Deleted snapshot')

  const install = async () => {
    if (ocrBusy) return
    setOcrBusy(true); setOcrError(null); setOcrProgress(0); setOcrPhase('Loading OCR runtime')
    onUpdate((draft) => { draft.settings.ocrStatus = 'installing' }, 'Starting OCR install')
    try {
      await installOcr({ language: ocrLanguage, onProgress: (progress, status) => { setOcrProgress(progress); if (status) setOcrPhase(status) } })
      onUpdate((draft) => { draft.settings.ocrStatus = 'ready'; draft.settings.ocrEnabled = true }, 'Enabled OCR')
      setOcrProgress(100); setOcrPhase('Ready')
      onNotify(`OCR is ready for ${ocrLanguage}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OCR installation failed.'
      setOcrError(message)
      onUpdate((draft) => { draft.settings.ocrStatus = 'error' }, 'Recorded OCR error')
    } finally { setOcrBusy(false) }
  }

  const remove = async () => {
    if (ocrBusy) return
    setOcrBusy(true); setOcrError(null); setOcrPhase('Removing OCR data')
    try {
      await removeOcr()
      onUpdate((draft) => { draft.settings.ocrStatus = 'not-installed'; draft.settings.ocrEnabled = false }, 'Removed OCR')
      setOcrText(''); setOcrProgress(0); onNotify('OCR worker and cached language data removed.')
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : 'OCR data could not be removed.')
    } finally { setOcrBusy(false) }
  }

  const disable = async () => {
    if (ocrBusy) return
    setOcrBusy(true); setOcrError(null); setOcrPhase('Disabling OCR')
    try {
      await disableOcr()
      onUpdate((draft) => { draft.settings.ocrEnabled = false; draft.settings.ocrStatus = 'not-installed' }, 'Disabled OCR')
      onNotify('OCR disabled; cached data was preserved.')
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : 'OCR could not be disabled.')
    } finally { setOcrBusy(false) }
  }

  const enable = () => {
    if (ocrBusy) return
    enableOcr()
    onUpdate((draft) => { draft.settings.ocrEnabled = true; draft.settings.ocrStatus = 'not-installed' }, 'Enabled OCR')
    setOcrError(null); onNotify('OCR enabled; install the worker to start recognition.')
  }

  const runOcr = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || ocrBusy) return
    setOcrBusy(true); setOcrError(null); setOcrText(''); setOcrProgress(0); setOcrPhase('Reading image')
    try {
      const data = await readFileAsDataUrl(file)
      setOcrPhase('Recognizing image')
      const text = await recognizeImage(data, ocrLanguage, (progress) => setOcrProgress(progress))
      setOcrText(text.trim() || 'No text detected.')
      setOcrProgress(100); setOcrPhase('Ready'); onNotify('OCR text extracted.')
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : 'OCR failed.')
    } finally { setOcrBusy(false); event.target.value = '' }
  }

  return <div className="workspace-panel review-panel">
    <PanelHeading kicker="REVIEW" title="Checks & handoff" icon="check-circle" />
    <section className="review-card review-hero"><div><h3>Resolved document checks</h3><p>Contrast, responsive overflow, alt text, and touch targets for {page.name} at {page.width}px. Color checks cannot resolve images, gradients, or custom CSS.</p></div><button type="button" className="primary-button" onClick={runChecks} disabled={running}><Icon name={running ? 'refresh' : 'check-circle'} /> {running ? 'Checking…' : 'Run checks'}</button></section>
    <div className="issue-list" aria-live="polite">{issues.length ? issues.map((issue, index) => <div className={`issue-row ${issue.severity}`} key={`${issue.label}-${issue.id ?? index}`}><Icon name={issue.severity === 'warn' ? 'warning' : 'info'} size={15} /><div><strong>{issue.label}</strong><small>{issue.detail}</small></div></div>) : <div className="empty-panel compact"><Icon name="check-circle" size={20} /><p>{checked ? 'No obvious findings on this page.' : 'Run the checks to see page findings.'}</p></div>}</div>
    <section className="review-card compact-card"><div><h3>Page text</h3><p>Copy the document text without OCR.</p></div><button type="button" className="secondary-button" onClick={() => void copyText(nativePageText, onNotify)} disabled={!nativePageText}><Icon name="copy" /> Copy native text</button></section>
    <section className="review-card compact-card"><div><h3>Snapshots</h3><p>{snapshots.length} bounded document versions.</p></div>{snapshots.length ? <div className="snapshot-list">{snapshots.map((snapshot) => <div className="snapshot-row" key={snapshot.id}><div><strong>{snapshot.name}</strong><small>{new Date(snapshot.createdAt).toLocaleString()}</small></div><button type="button" className="mini-link" onClick={() => restore(snapshot)}>Restore</button><button type="button" className="icon-button tiny" aria-label={`Delete ${snapshot.name}`} onClick={() => deleteSnapshot(snapshot.id)}><Icon name="trash" size={13} /></button></div>)}</div> : <div className="empty-panel compact"><p>Save a snapshot from the canvas status bar to see it here.</p></div>}</section>
    <section className="review-card compact-card ocr-card"><div className="ocr-heading"><div><h3>Optional OCR</h3><p>Downloads language data only when you ask, then caches it locally.</p></div><span className={`status-pill ${ocrLabelClass}`}>{ocrLabel}</span></div><div className="ocr-controls"><label className="full-field"><span>Language</span><SelectField value={ocrLanguage} disabled={ocrBusy} options={supportedOcrLanguages.map((language) => ({ value: language, label: language }))} ariaLabel="OCR language" onChange={setOcrLanguage} /></label><div className="ocr-actions">{ocrStatus.ready ? <><button type="button" className="secondary-button" onClick={() => ocrInputRef.current?.click()} disabled={ocrBusy}><Icon name="image" /> {ocrBusy ? 'Extracting…' : 'Extract text'}</button><button type="button" className="secondary-button" onClick={() => void disable()} disabled={ocrBusy}>Disable · keep cache</button><button type="button" className="secondary-button" onClick={() => void remove()} disabled={ocrBusy}><Icon name="trash" /> Remove OCR</button></> : <button type="button" className="secondary-button" onClick={() => ocrStatus.enabled ? void install() : enable()} disabled={ocrBusy}><Icon name={ocrBusy ? 'refresh' : ocrStatus.enabled ? 'download-cloud' : 'check-circle'} /> {ocrBusy ? `${ocrPhase} · ${ocrProgress}%` : ocrStatus.enabled ? 'Install OCR worker' : 'Re-enable OCR'}</button>}</div>{ocrBusy && <div className="ocr-progress-block" role="status" aria-live="polite"><div className="ocr-progress-label"><span>{ocrPhase}</span><strong>{ocrProgress}%</strong></div><div className="progress-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ocrProgress}><span style={{ width: `${ocrProgress}%` }} /></div></div>}{effectiveOcrError && <div className="ocr-error" role="alert"><Icon name="warning" size={14} /><span>{effectiveOcrError}</span></div>}{ocrText && <div className="ocr-result"><div className="result-heading"><Icon name="check-circle" size={12} /> Extracted text</div><pre>{ocrText}</pre></div>}<input ref={ocrInputRef} className="visually-hidden" type="file" accept="image/*" onChange={(event) => void runOcr(event)} /></div></section>
    <section className="review-card handoff-card"><span className="panel-kicker">EXPORT</span><h3>Builder handoff</h3><p>Export the complete structured package, or copy the readable implementation prompt.</p><div className="handoff-actions"><button type="button" className="primary-button" onClick={onExport}><Icon name="download" /> Export package</button><button type="button" className="secondary-button" onClick={onCopy}><Icon name="copy" /> Copy builder prompt</button></div></section>
  </div>
}

function PanelHeading({ kicker, title, icon }: { kicker: string; title: string; icon: 'layers' | 'plug' | 'check-circle' }) { return <div className="panel-heading"><div><span className="panel-kicker">{kicker}</span><h2>{title}</h2></div><Icon name={icon} size={18} /></div> }
