import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { CustomCommand, McpConnection, Project, ProviderRecord, SkillRecord } from '../lib/model'
import { DEFAULT_MAIN_PROMPT, DEFAULT_VISION_PROMPT, uid } from '../lib/model'
import { discoverProviderModels, listProviders, saveProvider, testProvider as testProviderApi } from '../lib/ai'
import { callMcpTool, listMcpConnections, removeMcpConnection, saveMcpConnection, testMcpConnection, type McpConnectionConfig, type McpTool } from '../lib/mcp'
import { ThemePicker } from './ThemePicker'
import { SelectField } from './SelectField'
import type { ThemeId } from '../lib/themes'
import './provider-picker.css'
import './library-polish.css'
import './search-polish.css'

interface ConnectionsProps {
  project: Project
  onUpdate: (mutator: (draft: Project) => void, label?: string) => void
  onCommit: (mutator: (draft: Project) => void, label: string) => void
  onNotify: (message: string) => void
  onBack?: () => void
  theme: ThemeId
  onTheme: (theme: ThemeId) => void
}

type ProviderConfig = ProviderRecord & { advanced?: { maxTokens: number; temperature: number | null; tokenParameter: string }; error?: string; lastTestedAt?: string }
type Tool = McpTool & { allowed?: boolean }
type PromptVersion = { id: string; name: string; mainPrompt: string; visionPrompt: string; createdAt: string }
type ExtraSettings = Project['settings'] & { mainProviderId?: string; visionProviderId?: string; promptVersions?: PromptVersion[] }
type ServerConnection = Omit<McpConnectionConfig, 'tools'> & { tools: Tool[] }

const providerDefaults: Record<string, { maxTokens: number; temperature: number | null; tokenParameter: string }> = {
  openrouter: { maxTokens: 3000, temperature: 0.2, tokenParameter: 'max_tokens' },
  openai: { maxTokens: 3000, temperature: 0.2, tokenParameter: 'max_tokens' },
  nvidia: { maxTokens: 3000, temperature: 0.2, tokenParameter: 'max_tokens' },
  custom: { maxTokens: 3000, temperature: 0.2, tokenParameter: 'max_tokens' },
  anthropic: { maxTokens: 3000, temperature: 0.2, tokenParameter: 'max_tokens' },
}

const publicProvider = (provider: ProviderConfig): ProviderConfig => ({
  id: provider.id, name: provider.name, kind: provider.kind, endpoint: provider.endpoint, model: provider.model,
  credentialSet: Boolean(provider.credentialSet), connected: Boolean(provider.connected), imageInput: Boolean(provider.imageInput),
  videoInput: Boolean(provider.videoInput), manualModel: Boolean(provider.manualModel), advanced: provider.advanced, error: provider.error, lastTestedAt: provider.lastTestedAt,
})

const publicConnection = (connection: ServerConnection): McpConnection => ({
  id: connection.id, name: connection.name, url: connection.url, enabled: connection.enabled !== false,
  status: connection.status || 'disconnected', tools: (connection.tools || []).map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })), error: connection.error,
})

function settingsOf(project: Project): ExtraSettings { return project.settings as ExtraSettings }
function connectionTools(connection: ServerConnection): Tool[] { const allowed = new Set(connection.allowedTools || connection.tools.map((tool) => tool.name)); return connection.tools.map((tool) => ({ ...tool, allowed: allowed.has(tool.name) })) }
function inputType(schema: Record<string, unknown> | undefined, key: string) { const type = schema?.properties && typeof schema.properties === 'object' ? (schema.properties as Record<string, Record<string, unknown>>)[key]?.type : undefined; return type === 'boolean' ? 'checkbox' : type === 'number' || type === 'integer' ? 'number' : 'text' }

export function ConnectionsPanel({ project, onUpdate, onCommit, onNotify, onBack, theme, onTheme }: ConnectionsProps) {
  const [tab, setTab] = useState<'providers' | 'mcp' | 'library' | 'prompts' | 'themes'>('providers')
  const [providerMode, setProviderMode] = useState<'main' | 'vision'>('main')
  const [providerId, setProviderId] = useState('')
  const [credential, setCredential] = useState('')
  const [models, setModels] = useState<Record<string, string[]>>({})
  const [modelSearch, setModelSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mcpName, setMcpName] = useState('MCP server')
  const [mcpUrl, setMcpUrl] = useState('https://example.invalid/mcp')
  const [mcpToken, setMcpToken] = useState('')
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({})
  const [toolResults, setToolResults] = useState<Record<string, string>>({})
  const [toolErrors, setToolErrors] = useState<Record<string, string>>({})
  const [skillImport, setSkillImport] = useState('')
  const [commandImport, setCommandImport] = useState('')
  const settings = settingsOf(project)
  const providers = project.providers as ProviderConfig[]
  const provider = providers.find((item) => item.id === providerId) || providers.find((item) => item.id === (providerMode === 'main' ? settings.mainProviderId : settings.visionProviderId)) || providers[0]
  const serverConnections = project.connections as ServerConnection[]
  const selectedModels = (provider && models[provider.id] || []).filter((model) => model.toLowerCase().includes(modelSearch.toLowerCase())).slice(0, 100)

  useEffect(() => {
    const main = providerMode === 'main' ? settings.mainProviderId : settings.visionProviderId
    if (main && providers.some((item) => item.id === main)) setProviderId(main)
    else if (providers[0]) setProviderId(providers[0].id)
  }, [providerMode, settings.mainProviderId, settings.visionProviderId, providers.length])

  useEffect(() => {
    let alive = true
    void Promise.all([listProviders(), listMcpConnections()]).then(([providerResponse, connectionResponse]) => {
      if (!alive) return
      const nextProviders = (providerResponse.providers || []) as ProviderConfig[]
      const nextConnections = connectionResponse.connections || []
      if (nextProviders.length) onUpdate((draft) => { draft.providers = nextProviders.map(publicProvider) }, 'Loaded server provider configuration')
      if (nextConnections.length || project.connections.length) onUpdate((draft) => { draft.connections = nextConnections.map(publicConnection) }, 'Loaded server MCP configuration')
    }).catch(() => { if (alive) setError('The local service is unavailable. Manual editing still works.') })
    return () => { alive = false }
  }, [])

  const updateProvider = (patch: Partial<ProviderConfig>) => provider && onUpdate((draft) => { const target = draft.providers.find((item) => item.id === provider.id); if (target) Object.assign(target, patch) }, 'Updated provider settings')
  const updateSelectedProvider = (id: string) => { setProviderId(id); setCredential(''); setError(null); const next = providers.find((item) => item.id === id); if (next) onUpdate((draft) => { const target = draft.providers.find((item) => item.id === id); if (target) target.connected = Boolean(next.connected) }, 'Selected provider') }

  const saveAndTestProvider = async (discoverOnly = false) => {
    if (!provider) return
    setBusy(true); setError(null)
    try {
      await saveProvider({ id: provider.id, name: provider.name, kind: provider.kind, endpoint: provider.endpoint, model: provider.model, key: credential || undefined, imageInput: provider.imageInput, videoInput: provider.videoInput, manualModel: provider.manualModel, advanced: provider.advanced || providerDefaults[provider.kind] })
      const result = discoverOnly ? await discoverProviderModels(provider.id) : await testProviderApi(provider.id)
      const found = (result.models || []).map((item) => typeof item === 'string' ? item : item.id).filter((item): item is string => Boolean(item))
      setModels((current) => ({ ...current, [provider.id]: found }))
      onCommit((draft) => { const target = draft.providers.find((item) => item.id === provider.id); if (target) { target.connected = discoverOnly ? target.connected : result.connected !== false; target.credentialSet = Boolean(credential) || target.credentialSet; target.manualModel = Boolean(result.manualFallback) || !found.length; if (result.selected) target.model = result.selected } }, `${discoverOnly ? 'Refreshed' : 'Tested'} ${provider.name}`)
      onNotify(result.discoveryMessage || (found.length ? `${provider.name} connected · ${found.length} models available.` : `${provider.name} tested with the manual model ID.`))
    } catch (caught) { const message = caught instanceof Error ? caught.message : 'Provider request failed.'; setError(message); onUpdate((draft) => { const target = draft.providers.find((item) => item.id === provider.id) as (ProviderRecord & { error?: string }) | undefined; if (target) { target.connected = false; target.error = message } }, 'Recorded provider failure') }
    finally { setBusy(false) }
  }

  const toggleSetting = (key: 'autoApplyAi' | 'visionEnabled' | 'videoEnabled') => onCommit((draft) => { const target = draft.settings as ExtraSettings; target[key] = !target[key] }, `Toggled ${key}`)
  const setProviderRole = (role: 'mainProviderId' | 'visionProviderId', id: string) => onCommit((draft) => { (draft.settings as ExtraSettings)[role] = id }, `Selected ${role === 'mainProviderId' ? 'main' : 'vision'} provider`)

  const reloadConnections = async () => { const response = await listMcpConnections(); onUpdate((draft) => { draft.connections = response.connections.map(publicConnection) }, 'Refreshed MCP connections') }
  const connectMcp = async () => {
    const id = `mcp_${uid('connection').slice(-16)}`
    setMcpBusy(true); setMcpError(null)
    try {
      const input: McpConnectionConfig = { id, name: mcpName.trim() || 'MCP server', url: mcpUrl.trim(), enabled: true, status: 'testing', tools: [], ...(mcpToken ? { authToken: mcpToken } : {}) }
      await saveMcpConnection(input); const result = await testMcpConnection(input); setMcpToken(''); await reloadConnections(); onNotify(`${input.name} connected · ${result.tools.length} tools discovered.`)
    } catch (caught) { setMcpError(caught instanceof Error ? caught.message : 'MCP connection failed.') }
    finally { setMcpBusy(false) }
  }
  const updateConnection = async (connection: ServerConnection, patch: Partial<ServerConnection>) => { try { await saveMcpConnection({ ...connection, ...patch }); await reloadConnections() } catch (caught) { setMcpError(caught instanceof Error ? caught.message : 'MCP update failed.') } }
  const removeConnection = async (id: string) => { try { await removeMcpConnection(id); onCommit((draft) => { draft.connections = draft.connections.filter((item) => item.id !== id) }, 'Removed MCP connection') } catch (caught) { setMcpError(caught instanceof Error ? caught.message : 'MCP removal failed.') } }
  const callTool = async (connection: ServerConnection, tool: Tool) => {
    const key = `${connection.id}:${tool.name}`; setToolErrors((current) => ({ ...current, [key]: '' }));
    try {
      const parsed = toolArgs[key]?.trim() ? JSON.parse(toolArgs[key]) : {}
      const result = await callMcpTool(connection, tool.name, parsed)
      setToolResults((current) => ({ ...current, [key]: JSON.stringify(result, null, 2) })); onNotify(`${tool.name} completed.`)
    } catch (caught) { setToolErrors((current) => ({ ...current, [key]: caught instanceof Error ? caught.message : 'Tool call failed.' })) }
  }

  return <div className="workspace-panel connections-panel"><PanelHeading onBack={onBack} /><div className="panel-tabs"><Tab active={tab === 'providers'} onClick={() => setTab('providers')}>Providers</Tab><Tab active={tab === 'mcp'} onClick={() => setTab('mcp')}>MCP</Tab><Tab active={tab === 'library'} onClick={() => setTab('library')}>Skills & commands</Tab><Tab active={tab === 'prompts'} onClick={() => setTab('prompts')}>Prompts</Tab><Tab active={tab === 'themes'} onClick={() => setTab('themes')}>Themes</Tab></div>
    {tab === 'providers' && <ProvidersView provider={provider} providers={providers} providerMode={providerMode} providerId={providerId} credential={credential} models={selectedModels} modelSearch={modelSearch} busy={busy} error={error} settings={settings} onMode={setProviderMode} onSelect={updateSelectedProvider} onCredential={setCredential} onPatch={updateProvider} onRole={setProviderRole} onModelSearch={setModelSearch} onRefresh={() => void saveAndTestProvider(true)} onTest={() => void saveAndTestProvider(false)} onToggle={toggleSetting} />}
    {tab === 'mcp' && <McpView connections={serverConnections} name={mcpName} url={mcpUrl} token={mcpToken} busy={mcpBusy} error={mcpError} toolArgs={toolArgs} toolResults={toolResults} toolErrors={toolErrors} onName={setMcpName} onUrl={setMcpUrl} onToken={setMcpToken} onConnect={() => void connectMcp()} onRefresh={() => void reloadConnections()} onToggle={(connection) => void updateConnection(connection, { enabled: !connection.enabled })} onAllow={(connection, tool, allowed) => void updateConnection(connection, { allowedTools: (connection.allowedTools || connection.tools.map((item) => item.name)).filter((name) => name !== tool.name).concat(allowed ? [tool.name] : []) })} onRemove={(id) => void removeConnection(id)} onArgs={(key, value) => setToolArgs((current) => ({ ...current, [key]: value }))} onCall={callTool} />}
    {tab === 'library' && <LibraryView project={project} importSkill={skillImport} importCommand={commandImport} onImportSkill={setSkillImport} onImportCommand={setCommandImport} onCommit={onCommit} onNotify={onNotify} />}
     {tab === 'prompts' && <PromptsView project={project} settings={settings} onCommit={onCommit} onToggle={toggleSetting} />}
     {tab === 'themes' && <div className="themes-settings"><div className="panel-explainer"><strong>Workspace appearance</strong><p>These themes change Layer’s editor chrome only; your page colors and exported prototype stay yours.</p></div><ThemePicker value={theme} onChange={onTheme} /></div>}
  </div>
}

function PanelHeading({ onBack }: { onBack?: () => void }) {
  const backRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { backRef.current?.focus({ preventScroll: true }) }, [])
  return <header className="connections-header">
    {onBack && <button ref={backRef} className="panel-back-button" onClick={onBack} aria-label="Back to Layer AI"><Icon name="arrow-left" size={15} /> Back to chat</button>}
    <div className="connections-heading-row"><h2>Connections</h2><Icon name="plug" size={18} /></div>
  </header>
}
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) { return <button type="button" role="tab" aria-selected={active} className={active ? 'active' : ''} onClick={onClick}>{children}</button> }
function Field({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string | number; onChange: (value: string) => void; type?: string; placeholder?: string }) { return <label className="full-field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label> }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) { return <label className="skill-row"><span>{label}</span><button type="button" className={`toggle-button ${checked ? 'active' : ''}`} onClick={onChange}><span className={`switch-dot ${checked ? 'on' : ''}`} />{checked ? 'On' : 'Off'}</button></label> }

function ProvidersView({ provider, providers, providerMode, providerId, credential, models, modelSearch, busy, error, settings, onMode, onSelect, onCredential, onPatch, onRole, onModelSearch, onRefresh, onTest, onToggle }: { provider?: ProviderConfig; providers: ProviderConfig[]; providerMode: 'main' | 'vision'; providerId: string; credential: string; models: string[]; modelSearch: string; busy: boolean; error: string | null; settings: ExtraSettings; onMode: (mode: 'main' | 'vision') => void; onSelect: (id: string) => void; onCredential: (value: string) => void; onPatch: (patch: Partial<ProviderConfig>) => void; onRole: (role: 'mainProviderId' | 'visionProviderId', id: string) => void; onModelSearch: (value: string) => void; onRefresh: () => void; onTest: () => void; onToggle: (key: 'autoApplyAi' | 'visionEnabled' | 'videoEnabled') => void }) {
  const advanced = provider?.advanced || providerDefaults[provider?.kind || 'custom']
  return <div className="provider-panel"><div className="provider-list"><div className="panel-explainer">Server-side credentials stay encrypted. This panel only receives public connection state.</div><div className="provider-role"><button className={`toggle-button ${providerMode === 'main' ? 'active' : ''}`} onClick={() => onMode('main')}>Main model</button><button className={`toggle-button ${providerMode === 'vision' ? 'active' : ''}`} onClick={() => onMode('vision')}>Vision</button></div>{providers.map((item) => {
  const status = item.connected ? 'Connected' : item.manualModel ? 'Manual model' : 'Not connected'
  return <button key={item.id} type="button" className={`provider-row ${item.id === providerId ? 'active' : ''}`} aria-pressed={item.id === providerId} aria-label={`${item.name} ${status}`} onClick={() => onSelect(item.id)}><span className={`provider-dot ${item.connected ? 'connected' : ''}`} aria-hidden="true" /><span className="provider-row-copy"><strong>{item.name}</strong><small className="provider-model" title={item.model}>{item.model || 'Model not set'}</small></span><span className="provider-status">{status}</span></button>
})}</div><div className="provider-detail">{provider ? <><div className="provider-detail-head"><div><span className="panel-kicker">{providerMode === 'main' ? 'LAYER AI' : 'VISION ROUTE'}</span><h3>{provider.name}</h3></div><span className={`status-pill ${provider.connected ? 'success' : ''}`}>{provider.connected ? 'Connected' : 'Not connected'}</span></div><label className="full-field"><span>Use as {providerMode === 'main' ? 'main' : 'vision'} provider</span><SelectField value={providerMode === 'main' ? settings.mainProviderId || provider.id : settings.visionProviderId || provider.id} options={providers.map((item) => ({ value: item.id, label: item.name }))} ariaLabel={`Use as ${providerMode === 'main' ? 'main' : 'vision'} provider`} onChange={(value) => onRole(providerMode === 'main' ? 'mainProviderId' : 'visionProviderId', value)} /></label><Field label="Endpoint" value={provider.endpoint} onChange={(value) => onPatch({ endpoint: value })} /><Field label="API key · held by the local service" value={credential} onChange={onCredential} type="password" placeholder={provider.credentialSet ? 'Saved on server · leave blank to keep' : 'Enter once, then test'} /><Field label="Model ID" value={provider.model} onChange={(value) => onPatch({ model: value, manualModel: true })} /><div className="provider-actions"><button className="primary-button" onClick={onTest} disabled={busy}><Icon name={busy ? 'refresh' : 'plug'} /> {busy ? 'Testing…' : 'Save & test model'}</button><button className="secondary-button" onClick={onRefresh} disabled={busy}><Icon name="refresh" /> Refresh models</button></div>{error && <div className="error-callout"><Icon name="warning" size={14} />{error}</div>}<div className="provider-note"><Icon name="info" size={14} /><span>Discovery is optional. A 404/405 list falls back to the manual model ID, then Save & test sends a real completion request.</span></div><label className="catalog-search"><Icon name="search" size={13} /><input value={modelSearch} onChange={(event) => onModelSearch(event.target.value)} placeholder="Search discovered models" /><span>{models.length}</span></label>{models.length > 0 && <div className="catalog-list">{models.map((model) => <button className="catalog-row" key={model} onClick={() => onPatch({ model, manualModel: false })}><strong>{model}</strong><span className="mini-link">Use</span></button>)}</div>}<div className="asset-subsection"><div className="subsection-heading">Media & behavior <span>independent capabilities</span></div><Toggle label="Image input" checked={provider.imageInput} onChange={() => onPatch({ imageInput: !provider.imageInput })} /><Toggle label="Video capability toggle" checked={provider.videoInput} onChange={() => onPatch({ videoInput: !provider.videoInput })} /><Toggle label="Video setting enabled" checked={Boolean(settings.videoEnabled)} onChange={() => onToggle('videoEnabled')} /><Toggle label="Vision helper enabled" checked={Boolean(settings.visionEnabled)} onChange={() => onToggle('visionEnabled')} /><Toggle label="Auto-apply validated AI operations" checked={Boolean(settings.autoApplyAi)} onChange={() => onToggle('autoApplyAi')} /><div className="note-hint">Native video is explicitly unsupported until a provider protocol is verified. Sampled video frames are accepted as labeled images.</div></div><div className="asset-subsection"><div className="subsection-heading">Advanced overrides <span>provider request only</span></div><Field label="Max output tokens" value={advanced.maxTokens} onChange={(value) => onPatch({ advanced: { ...advanced, maxTokens: Number(value) || advanced.maxTokens } })} type="number" /><Field label="Temperature · blank to omit" value={advanced.temperature ?? ''} onChange={(value) => onPatch({ advanced: { ...advanced, temperature: value === '' ? null : Number(value) } })} type="number" /><label className="full-field"><span>Token parameter</span><select value={advanced.tokenParameter} onChange={(event) => onPatch({ advanced: { ...advanced, tokenParameter: event.target.value } })}><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option></select></label></div></> : <div className="empty-panel"><Icon name="plug" size={22} /><p>Add a provider record to continue.</p></div>}</div></div>
}

function McpView({ connections, name, url, token, busy, error, toolArgs, toolResults, toolErrors, onName, onUrl, onToken, onConnect, onRefresh, onToggle, onAllow, onRemove, onArgs, onCall }: { connections: ServerConnection[]; name: string; url: string; token: string; busy: boolean; error: string | null; toolArgs: Record<string, string>; toolResults: Record<string, string>; toolErrors: Record<string, string>; onName: (value: string) => void; onUrl: (value: string) => void; onToken: (value: string) => void; onConnect: () => void; onRefresh: () => void; onToggle: (connection: ServerConnection) => void; onAllow: (connection: ServerConnection, tool: Tool, allowed: boolean) => void; onRemove: (id: string) => void; onArgs: (key: string, value: string) => void; onCall: (connection: ServerConnection, tool: Tool) => void }) { return <div className="mcp-panel"><div className="mcp-note"><Icon name="plug" size={16} /><div><strong>Streamable HTTP MCP</strong><p>Tokens are sent to the local service and encrypted there. stdio and arbitrary local execution are not supported.</p></div></div><Field label="Name" value={name} onChange={onName} /><Field label="HTTPS endpoint · localhost requires server opt-in" value={url} onChange={onUrl} /><Field label="Bearer token · never saved in project state" value={token} onChange={onToken} type="password" /><div className="provider-actions"><button className="primary-button" onClick={onConnect} disabled={busy}><Icon name={busy ? 'refresh' : 'plug'} />{busy ? 'Connecting…' : 'Connect & discover'}</button><button className="secondary-button" onClick={onRefresh}><Icon name="refresh" />Refresh</button></div>{error && <div className="error-callout"><Icon name="warning" size={14} />{error}</div>}<div className="mcp-list">{connections.map((connection) => <div className="mcp-card" key={connection.id}><div className="mcp-card-head"><span className={`status-light ${connection.status}`} /><div><strong>{connection.name}</strong><small>{connection.url}</small></div><button className="icon-button tiny" onClick={() => onRemove(connection.id)} aria-label={`Remove ${connection.name}`}><Icon name="trash" size={13} /></button></div><div className="provider-actions"><button className="toggle-button" onClick={() => onToggle(connection)}><span className={`switch-dot ${connection.enabled ? 'on' : ''}`} />{connection.enabled ? 'Enabled' : 'Disabled'}</button><span className="integration-pill">{connection.tools.length} tools</span></div>{connection.error && <div className="error-text">{connection.error}</div>}{connectionTools(connection).map((tool) => <McpToolRow key={tool.name} connection={connection} tool={tool} args={toolArgs[`${connection.id}:${tool.name}`] || '{}'} result={toolResults[`${connection.id}:${tool.name}`]} toolError={toolErrors[`${connection.id}:${tool.name}`]} onAllow={(allowed) => onAllow(connection, tool, allowed)} onArgs={(value) => onArgs(`${connection.id}:${tool.name}`, value)} onCall={() => onCall(connection, tool)} />)}</div>)}</div></div> }

function McpToolRow({ connection, tool, args, result, toolError, onAllow, onArgs, onCall }: { connection: ServerConnection; tool: Tool; args: string; result?: string; toolError?: string; onAllow: (allowed: boolean) => void; onArgs: (value: string) => void; onCall: () => void }) {
  const schema = tool.inputSchema
  const properties = schema?.properties && typeof schema.properties === 'object' ? schema.properties as Record<string, Record<string, unknown>> : {}
  let parsed: Record<string, unknown> = {}
  try { const value = JSON.parse(args); if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value } catch { /* JSON editor reports the parse error on call */ }
  const setProperty = (key: string, value: unknown) => onArgs(JSON.stringify({ ...parsed, [key]: value }, null, 2))
  const required = Array.isArray(schema?.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []
  return <div className="tool-row"><Icon name="code" size={13} /><div><strong>{tool.name}</strong><small>{tool.description}</small><label className="switch"><input type="checkbox" checked={Boolean(tool.allowed)} onChange={(event) => onAllow(event.target.checked)} /><span /></label>{Object.keys(properties).map((key) => { const type = inputType(schema, key); const value = parsed[key]; return <label className="full-field" key={key}><span>{key}{required.includes(key) ? ' · required' : ''}</span><input type={type} checked={type === 'checkbox' ? Boolean(value) : undefined} value={type === 'checkbox' ? undefined : value === undefined ? '' : String(value)} placeholder={String(properties[key].description || '')} onChange={(event) => setProperty(key, type === 'checkbox' ? event.target.checked : type === 'number' ? Number(event.target.value) : event.target.value)} /></label> })}<textarea value={args} onChange={(event) => onArgs(event.target.value)} aria-label={`${tool.name} JSON arguments`} placeholder="{}" rows={3} /><button className="mini-link" onClick={onCall} disabled={!tool.allowed || !connection.enabled}>Call permitted tool</button>{toolError && <pre className="error-text">{toolError}</pre>}{result && <pre className="ocr-result"><span className="result-heading">RESULT</span>{result}</pre>}</div></div>
}

function LibraryView({ project, importSkill, importCommand, onImportSkill, onImportCommand, onCommit, onNotify }: { project: Project; importSkill: string; importCommand: string; onImportSkill: (value: string) => void; onImportCommand: (value: string) => void; onCommit: (mutator: (draft: Project) => void, label: string) => void; onNotify: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const matches = (...values: string[]) => !normalizedQuery || values.some((value) => value.toLowerCase().includes(normalizedQuery))
  const skills = project.skills.filter((skill) => matches(skill.name, skill.description, skill.instructions, skill.requiredTools.join(' ')))
  const commands = project.commands.filter((command) => matches(command.name, command.description, command.instructions, command.scope))
  const createSkill = () => onCommit((draft) => draft.skills.push({ id: uid('skill'), name: 'New skill', description: '', instructions: '', enabled: true, requiredTools: [] }), 'Created skill')
  const createCommand = () => onCommit((draft) => draft.commands.push({ id: uid('cmd'), name: 'new-command', description: '', instructions: '', scope: 'page', enabled: true }), 'Created command')
  const importSkills = () => {
    try {
      const parsed = JSON.parse(importSkill); const records = Array.isArray(parsed) ? parsed : parsed.skills
      if (!Array.isArray(records)) throw new Error('Expected an array or {skills: []}.')
      onCommit((draft) => records.slice(0, 32).forEach((item) => { if (item && typeof item.name === 'string' && typeof item.instructions === 'string') draft.skills.push({ id: uid('skill'), name: item.name.slice(0, 100), description: String(item.description || '').slice(0, 500), instructions: item.instructions.slice(0, 10000), enabled: item.enabled !== false, requiredTools: Array.isArray(item.requiredTools) ? item.requiredTools.filter((value: unknown): value is string => typeof value === 'string').slice(0, 32) : [] }) }), 'Imported skills')
      onImportSkill('')
    } catch { onNotify('Skill import must be JSON: an array or {skills: []}.') }
  }
  const importCommands = () => {
    try {
      const parsed = JSON.parse(importCommand); const records = Array.isArray(parsed) ? parsed : parsed.commands
      if (!Array.isArray(records)) throw new Error('Expected an array or {commands: []}.')
      onCommit((draft) => records.slice(0, 32).forEach((item) => { if (item && typeof item.name === 'string' && typeof item.instructions === 'string') draft.commands.push({ id: uid('cmd'), name: item.name.replace(/^\//, '').slice(0, 80), description: String(item.description || '').slice(0, 500), instructions: item.instructions.slice(0, 10000), scope: ['selection', 'page', 'project'].includes(item.scope) ? item.scope : 'page', enabled: item.enabled !== false }) }), 'Imported commands')
      onImportCommand('')
    } catch { onNotify('Command import must be JSON: an array or {commands: []}.') }
  }
  const emptyMessage = (label: string, count: number) => normalizedQuery ? `No ${label.toLowerCase()} match “${query.trim()}”.` : count ? '' : `No ${label.toLowerCase()} yet. Create one to make it available to Layer AI.`

  return <div className="skills-library">
    <div className="skills-library-header"><div><h3>Skills &amp; commands</h3><p>Keep reusable instructions close to the project. Enable only the resources you want Layer AI to use.</p></div><span className="library-summary">{project.skills.length + project.commands.length} total</span></div>
    <div className="library-search skills-search"><Icon name="search" size={14} /><label className="visually-hidden" htmlFor="skills-library-search">Search skills and commands</label><input id="skills-library-search" aria-label="Search skills and commands" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, scope, or instruction" />{query && <button type="button" className="library-search-clear" onClick={() => setQuery('')} aria-label="Clear skills and commands search"><Icon name="close" size={13} /></button>}</div>
    <section className="skills-library-section"><div className="library-section-heading"><div><strong>Skills</strong><span>Reusable guidance</span></div><div className="library-section-tools"><span className="library-section-count">{skills.length}{normalizedQuery ? ` / ${project.skills.length}` : ''}</span><button type="button" className="secondary-button compact-button" onClick={createSkill}><Icon name="plus" size={12} />Add skill</button></div></div>{skills.length ? <div className="skills-card-list">{skills.map((skill) => <EditableSkill key={skill.id} skill={skill} onCommit={onCommit} />)}</div> : <div className="skills-empty"><Icon name={normalizedQuery ? 'search' : 'book'} size={17} /><span>{emptyMessage('skills', project.skills.length)}</span></div>}<div className="skills-import"><div className="skills-import-heading"><div><strong>Import skills JSON</strong><small>Accepts an array or <code>{'{skills: []}'}</code>.</small></div><Icon name="download" size={14} /></div><textarea aria-label="Import skills JSON" value={importSkill} onChange={(event) => onImportSkill(event.target.value)} placeholder='[{"name":"Audit","instructions":"..."}]' rows={3} /><button type="button" className="secondary-button full" onClick={importSkills}><Icon name="download" />Import skills</button></div></section>
    <section className="skills-library-section"><div className="library-section-heading"><div><strong>Custom commands</strong><span>Slash commands for focused work</span></div><div className="library-section-tools"><span className="library-section-count">{commands.length}{normalizedQuery ? ` / ${project.commands.length}` : ''}</span><button type="button" className="secondary-button compact-button" onClick={createCommand}><Icon name="plus" size={12} />Add command</button></div></div>{commands.length ? <div className="skills-card-list">{commands.map((command) => <EditableCommand key={command.id} command={command} onCommit={onCommit} />)}</div> : <div className="skills-empty"><Icon name={normalizedQuery ? 'search' : 'command'} size={17} /><span>{emptyMessage('commands', project.commands.length)}</span></div>}<div className="skills-import"><div className="skills-import-heading"><div><strong>Import commands JSON</strong><small>Scope each command to selection, page, or project.</small></div><Icon name="download" size={14} /></div><textarea aria-label="Import commands JSON" value={importCommand} onChange={(event) => onImportCommand(event.target.value)} placeholder='[{"name":"audit","scope":"page","instructions":"..."}]' rows={3} /><button type="button" className="secondary-button full" onClick={importCommands}><Icon name="download" />Import commands</button></div></section>
  </div>
}

function EditableSkill({ skill, onCommit }: { skill: SkillRecord; onCommit: (mutator: (draft: Project) => void, label: string) => void }) {
  const patch = (value: Partial<SkillRecord>) => onCommit((draft) => Object.assign(draft.skills.find((item) => item.id === skill.id)!, value), 'Edited skill')
  return <article className="skill-row skills-card"><div className="skills-card-fields"><label className="skills-field skills-field-name"><span>Skill name</span><input aria-label={`Skill name: ${skill.name || 'unnamed'}`} value={skill.name} onChange={(event) => patch({ name: event.target.value })} /></label><label className="skills-field"><span>Description</span><input aria-label={`Description for ${skill.name || 'skill'}`} value={skill.description} placeholder="What this skill is for" onChange={(event) => patch({ description: event.target.value })} /></label><label className="skills-field"><span>Instructions</span><textarea aria-label={`Instructions for ${skill.name || 'skill'}`} value={skill.instructions} placeholder="Instructions Layer AI should follow" rows={3} onChange={(event) => patch({ instructions: event.target.value })} /></label></div><div className="skills-card-actions"><label className="skills-toggle"><span>Enabled</span><span className="switch"><input type="checkbox" aria-label={`Enable ${skill.name || 'skill'}`} checked={skill.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /><span /></span></label><button type="button" className="icon-button tiny" onClick={() => onCommit((draft) => { draft.skills = draft.skills.filter((item) => item.id !== skill.id) }, 'Removed skill')} aria-label={`Remove ${skill.name || 'skill'}`}><Icon name="trash" size={13} /></button></div></article>
}

function EditableCommand({ command, onCommit }: { command: CustomCommand; onCommit: (mutator: (draft: Project) => void, label: string) => void }) {
  const patch = (value: Partial<CustomCommand>) => onCommit((draft) => Object.assign(draft.commands.find((item) => item.id === command.id)!, value), 'Edited command')
  return <article className="skill-row skills-card"><div className="skills-card-fields"><label className="skills-field skills-field-name"><span>Command</span><input aria-label={`Command name: ${command.name || 'unnamed'}`} value={`/${command.name}`} onChange={(event) => patch({ name: event.target.value.replace(/^\//, '') })} /></label><label className="skills-field"><span>Description</span><input aria-label={`Description for ${command.name || 'command'}`} value={command.description} placeholder="What this command does" onChange={(event) => patch({ description: event.target.value })} /></label><div className="skills-field"><span>Scope</span><SelectField value={command.scope} options={[{ value: 'selection', label: 'selection' }, { value: 'page', label: 'page' }, { value: 'project', label: 'project' }]} ariaLabel={`Scope for ${command.name || 'command'}`} onChange={(value) => patch({ scope: value as CustomCommand['scope'] })} /></div><label className="skills-field"><span>Instructions</span><textarea aria-label={`Instructions for ${command.name || 'command'}`} value={command.instructions} placeholder="Instructions Layer AI should follow" rows={3} onChange={(event) => patch({ instructions: event.target.value })} /></label></div><div className="skills-card-actions"><label className="skills-toggle"><span>Enabled</span><span className="switch"><input type="checkbox" aria-label={`Enable ${command.name || 'command'}`} checked={command.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /><span /></span></label><button type="button" className="icon-button tiny" onClick={() => onCommit((draft) => { draft.commands = draft.commands.filter((item) => item.id !== command.id) }, 'Removed command')} aria-label={`Remove ${command.name || 'command'}`}><Icon name="trash" size={13} /></button></div></article>
}

function PromptsView({ project, settings, onCommit, onToggle }: { project: Project; settings: ExtraSettings; onCommit: (mutator: (draft: Project) => void, label: string) => void; onToggle: (key: 'autoApplyAi' | 'visionEnabled' | 'videoEnabled') => void }) { const [main, setMain] = useState(project.settings.mainPrompt); const [vision, setVision] = useState(project.settings.visionPrompt); const [versionName, setVersionName] = useState('Prompt version'); const versions = settings.promptVersions || []; const save = () => { const oldMain = project.settings.mainPrompt; const oldVision = project.settings.visionPrompt; onCommit((draft) => { const target = draft.settings as ExtraSettings; target.mainPrompt = main; target.visionPrompt = vision; target.promptVersions = [...(target.promptVersions || []), { id: uid('prompt'), name: versionName || 'Prompt version', mainPrompt: oldMain, visionPrompt: oldVision, createdAt: new Date().toISOString() }].slice(-20) }, 'Saved prompt version') }; const restore = () => { setMain(DEFAULT_MAIN_PROMPT); setVision(DEFAULT_VISION_PROMPT) }; return <div className="prompts-panel"><div className="panel-explainer">Prompts are sent with the requested document scope. Imported content and MCP output remain untrusted data.</div><Toggle label="Auto-apply validated operations" checked={Boolean(settings.autoApplyAi)} onChange={() => onToggle('autoApplyAi')} /><Field label="Version name" value={versionName} onChange={setVersionName} /><label className="full-field"><span>Main Layer AI prompt</span><textarea value={main} onChange={(event) => setMain(event.target.value)} rows={10} /></label><label className="full-field"><span>Vision helper prompt</span><textarea value={vision} onChange={(event) => setVision(event.target.value)} rows={8} /></label><div className="provider-actions"><button className="primary-button" onClick={save}><Icon name="check" />Save prompts</button><button className="secondary-button" onClick={restore}><Icon name="refresh" />Restore defaults</button></div><div className="subsection-heading">Prompt history <span>{versions.length}/20 snapshots</span></div>{versions.slice().reverse().map((version) => <div className="skill-row" key={version.id}><div><strong>{version.name}</strong><small>{new Date(version.createdAt).toLocaleString()}</small></div><button className="mini-link" onClick={() => { setMain(version.mainPrompt); setVision(version.visionPrompt) }}>Restore draft</button></div>)}</div> }
