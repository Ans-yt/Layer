import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { CopyMessageButton } from './CopyMessageButton'
import { SelectField } from './SelectField'
import type { DesignElement, Page, Project } from '../lib/model'

interface Props {
  active?: boolean
  project: Project
  page: Page
  selected: DesignElement[]
  scope: 'selection' | 'page' | 'project'
  messages: { id: string; role: 'user' | 'assistant' | 'system'; text: string; status?: 'working' | 'error' }[]
  busy: boolean
  proposal: { label: string; apply: () => void } | null
  attachmentCount: number
  onScope: (scope: 'selection' | 'page' | 'project') => void
  onSend: (prompt: string) => void
  onApply: () => void
  onCancel: () => void
  onCancelRequest: () => void
  onCapture: () => void
  onAttach: () => void
  onClearAttachments: () => void
  onSettings: () => void
}

export function AiPanel({ active = true, project, page, selected, scope, messages, busy, proposal, attachmentCount, onScope, onSend, onApply, onCancel, onCancelRequest, onCapture, onAttach, onClearAttachments, onSettings }: Props) {
  const [input, setInput] = useState('')
  const [attachContext, setAttachContext] = useState(true)
  const [showPrompt, setShowPrompt] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef(false)
  const followLatestRef = useRef(true)
  const [showLatest, setShowLatest] = useState(false)
  const sendShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ Enter' : 'Ctrl Enter'

  useEffect(() => {
    if (!active) return
    if (followLatestRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    if (returnFocusRef.current) { settingsRef.current?.focus({ preventScroll: true }); returnFocusRef.current = false }
  }, [active, messages, proposal])

  const openSettings = () => { returnFocusRef.current = true; onSettings() }
  const trackScroll = () => {
    const scroller = scrollRef.current
    if (!scroller) return
    followLatestRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 36
    setShowLatest(!followLatestRef.current)
  }
  const jumpToLatest = () => {
    followLatestRef.current = true
    setShowLatest(false)
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }

  const send = () => {
    if (busy || !input.trim()) return
    jumpToLatest()
    onSend(input)
    setInput('')
  }
  const scopeLabel = scope === 'selection'
    ? selected.length ? `${selected.length} selected ${selected.length === 1 ? 'object' : 'objects'}` : 'Selection (empty)'
    : scope === 'page' ? `Current page · ${page.name}` : 'Entire project'
  const quick = ['Make this 10% larger', 'Prepare a responsive stack', 'Check spacing and accessibility', 'Add a primary button']

  return <div className="workspace-panel ai-panel" hidden={!active}>
    <div className="panel-heading ai-heading">
      <div className="ai-heading-copy"><h2>Layer AI</h2><span className="ai-connection-status"><span />{project.providers.some((provider) => provider.connected) ? 'Provider ready' : 'Manual tools'}</span></div>
      <div className="ai-heading-actions"><button className="icon-button" onClick={onCapture} aria-label="Capture canvas" data-tooltip="Capture canvas" data-tooltip-side="bottom"><Icon name="camera" /></button><button ref={settingsRef} className="icon-button" onClick={openSettings} aria-label="AI settings" data-tooltip="AI parameters" data-tooltip-side="bottom"><Icon name="sliders" /></button></div>
    </div>
     <div className="ai-scope-row"><Icon name={scope === 'selection' ? 'cursor' : scope === 'page' ? 'frame' : 'layers'} size={14} /><SelectField value={scope} options={[{ value: 'selection', label: selected.length ? `${selected.length} selected ${selected.length === 1 ? 'object' : 'objects'}` : 'Selection (empty)' }, { value: 'page', label: `Current page · ${page.name}` }, { value: 'project', label: 'Entire project' }]} ariaLabel="AI editing scope" onChange={(value) => onScope(value as typeof scope)} /><button className={`context-toggle ${attachContext ? 'active' : ''}`} aria-pressed={attachContext} onClick={() => setAttachContext((value) => !value)} data-tooltip={attachContext ? 'Detach document context' : 'Attach document context'}><Icon name={attachContext ? 'link' : 'unlink'} size={13} /> {attachContext ? 'Attached' : 'Attach'}</button></div>
    <div className="ai-context-summary"><span>Context</span><span>{attachContext ? scopeLabel : 'No document context'}</span><span className="context-count">{attachContext ? scope === 'project' ? `${project.pages.length} pages` : `${scope === 'page' ? page.elements.length : selected.length} layers` : '—'}</span>{attachmentCount > 0 && <button className="attachment-chip" onClick={onClearAttachments}><Icon name="paperclip" size={11} /> {attachmentCount} ref{attachmentCount === 1 ? '' : 's'} · clear</button>}</div>
    <div className="ai-thread">
    <div className="ai-messages" ref={scrollRef} onScroll={trackScroll} role="region" aria-label="Chat messages" tabIndex={0}>
      {messages.map((message) => <div key={message.id} className={`ai-message ${message.role} ${message.status ?? ''}`}>
        <div className="message-avatar">{message.role === 'assistant' ? <Icon name="spark" size={13} /> : message.role === 'system' ? <Icon name="info" size={13} /> : 'You'}</div>
        <div className="message-body"><Markdown source={message.text} />{message.status === 'working' ? <div className="typing-dots" role="status" aria-label="Layer is responding"><span /><span /><span /></div> : message.role !== 'system' && message.text.trim() && <CopyMessageButton text={message.text} />}</div>
      </div>)}
      {proposal && <div className="ai-proposal"><div className="proposal-header"><span><Icon name="wand" size={14} /> Proposed edit</span><span className="proposal-scope">Undoable</span></div><Markdown source={proposal.label} className="proposal-label" /><p>Review the result on the canvas, then apply it to the same document.</p><div className="proposal-actions"><button className="primary-button" onClick={onApply}><Icon name="check" /> Apply change</button><button className="secondary-button" onClick={onCancel}>Cancel</button></div></div>}
    </div>
    {showLatest && <button className="ai-jump-latest" onClick={jumpToLatest}><Icon name="arrow-down" size={13} /> Latest message</button>}
    </div>
    <div className="ai-quick-actions" aria-label="Suggested requests">{quick.map((item) => <button key={item} onClick={() => { jumpToLatest(); onSend(item) }} disabled={busy}>{item}</button>)}</div>
    <div className="ai-composer">
      <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send() } }} placeholder="Ask Layer to edit, explain, or check…" rows={3} aria-label="Ask Layer" aria-describedby="ai-composer-help" />
      <div className="composer-footer">
        <button className="icon-button" data-tooltip="Attach a reference" data-tooltip-side="top" aria-label="Attach reference" onClick={onAttach}><Icon name="paperclip" size={15} /></button>
        <span className="composer-hint" id="ai-composer-help">Markdown · {sendShortcut}</span>
        {busy ? <button className="ai-stop-button" onClick={onCancelRequest} data-tooltip="Stop generating" aria-label="Stop generating"><Icon name="pause" size={14} /> Stop</button> : <button className="send-button" onClick={send} disabled={!input.trim()} aria-label="Send to Layer AI" data-tooltip={input.trim() ? 'Send message' : 'Write a message first'} data-tooltip-shortcut={sendShortcut} data-tooltip-side="top"><Icon name="send" size={16} /></button>}
      </div>
    </div>
    <div className="ai-footer"><span><Icon name="info" size={12} /> Manual editor works without a provider.</span><button className="text-button" onClick={() => setShowPrompt((value) => !value)}>{showPrompt ? 'Hide prompt' : 'Prompt details'}</button></div>
    {showPrompt && <div className="prompt-preview"><span>Active system prompt</span><p>{project.settings.mainPrompt.slice(0, 420)}.</p><button className="text-button" onClick={openSettings}>Edit in connections</button></div>}
  </div>
}
