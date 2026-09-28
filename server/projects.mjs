import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite, badRequest, DEFAULT_DATA_DIR, isPlainObject, notFound, validateId } from './security.mjs'

export const MAX_PROJECT_BYTES = 12 * 1024 * 1024
export const MAX_PROJECTS = 256
export const MAX_SHARE_BYTES = 12 * 1024 * 1024

function clone(value) { return structuredClone(value) }

function removeSecrets(value) {
  if (Array.isArray(value)) return value.map(removeSecrets)
  if (!isPlainObject(value)) return value
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:key|token|secret|password|credential|apiKey|authorization|authToken|masterKey|keyEncrypted|authTokenEncrypted|sessionId)$/i.test(key)) continue
    result[key] = removeSecrets(child)
  }
  return result
}

export function publicProject(project, { shared = false } = {}) {
  if (!isPlainObject(project)) throw badRequest('project must be an object.')
  const result = removeSecrets(clone(project))
  if (shared) {
    result.providers = []
    result.connections = []
    result.skills = []
    result.commands = []
    result.versions = []
    if (isPlainObject(result.settings)) {
      result.settings.mainPrompt = ''
      result.settings.visionPrompt = ''
      result.settings.promptVersions = []
      result.settings.mainProviderId = undefined
      result.settings.visionProviderId = undefined
    }
  }
  return result
}

function validateProject(project) {
  if (!isPlainObject(project)) throw badRequest('project must be a JSON object.')
  if (typeof project.id !== 'string') throw badRequest('project.id is required.')
  validateId(project.id, 'project id')
  if (typeof project.name !== 'string' || project.name.length > 200) throw badRequest('project.name is invalid.')
  if (!Array.isArray(project.pages) || project.pages.length > 256) throw badRequest('project.pages must contain at most 256 pages.')
  let elementCount = 0
  const pageIds = new Set()
  const elementIds = new Set()
  for (const page of project.pages) {
    if (!isPlainObject(page) || typeof page.id !== 'string' || pageIds.has(page.id) || !Array.isArray(page.elements) || page.elements.length > 20000) throw badRequest('project contains an invalid or duplicate page.')
    pageIds.add(page.id)
    elementCount += page.elements.length
    for (const element of page.elements) {
      if (!isPlainObject(element) || typeof element.id !== 'string' || elementIds.has(element.id)) throw badRequest('project contains an invalid or duplicate element.')
      elementIds.add(element.id)
    }
  }
  if (elementCount > 100000) throw badRequest('project contains too many elements.')
  const bytes = Buffer.byteLength(JSON.stringify(project), 'utf8')
  if (bytes > MAX_PROJECT_BYTES) throw badRequest('project exceeds the storage size limit.')
  return project
}

async function readJson(filePath, fallback) {
  try { return JSON.parse(await fsp.readFile(filePath, 'utf8')) } catch (error) { if (error?.code === 'ENOENT') return fallback; throw error }
}

export class ProjectStore {
  constructor({ dataDir = DEFAULT_DATA_DIR } = {}) {
    this.dataDir = path.resolve(dataDir)
    this.projectsDir = path.join(this.dataDir, 'projects')
    this.sharesPath = path.join(this.dataDir, 'shares.json')
    this.writeQueue = Promise.resolve()
  }

  projectPath(id) { validateId(id, 'project id'); return path.join(this.projectsDir, `${id}.json`) }

  async list() {
    await fsp.mkdir(this.projectsDir, { recursive: true, mode: 0o700 })
    const names = await fsp.readdir(this.projectsDir).catch(() => [])
    const projects = []
    for (const name of names.slice(0, MAX_PROJECTS)) if (name.endsWith('.json')) {
      try {
        const project = await readJson(path.join(this.projectsDir, name), null)
        if (project) projects.push({ id: project.id, name: project.name, updatedAt: project.updatedAt, pageCount: project.pages?.length || 0 })
      } catch { /* skip a corrupt record without exposing its contents */ }
    }
    return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  async get(id) {
    const project = await readJson(this.projectPath(id), null)
    if (!project) throw notFound(`Project '${id}' was not found.`)
    return publicProject(project)
  }

  async put(project) {
    const clean = publicProject(validateProject(project))
    const filePath = this.projectPath(clean.id)
    await fsp.mkdir(this.projectsDir, { recursive: true, mode: 0o700 })
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => atomicWrite(filePath, clean))
    await this.writeQueue
    return clean
  }

  async remove(id) {
    await fsp.rm(this.projectPath(id), { force: true })
  }

  async addSnapshot(id, name = 'Snapshot') {
    const project = await this.get(id)
    const snapshotProject = publicProject(project)
    snapshotProject.versions = []
    const snapshot = { id: crypto.randomBytes(10).toString('hex'), name: String(name).slice(0, 160) || 'Snapshot', createdAt: new Date().toISOString(), project: snapshotProject }
    project.versions = [...(Array.isArray(project.versions) ? project.versions : []), snapshot].slice(-80)
    const saved = await this.put(project)
    return saved.versions.at(-1)
  }

  async createShare(project) {
    const snapshot = publicProject(validateProject(project), { shared: true })
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_SHARE_BYTES) throw badRequest('Share snapshot exceeds the size limit.')
    const token = crypto.randomBytes(32).toString('base64url')
    const shares = await readJson(this.sharesPath, {})
    const next = { ...shares, [token]: { createdAt: new Date().toISOString(), project: snapshot } }
    const oldTokens = Object.keys(next)
    for (const oldToken of oldTokens.slice(0, Math.max(0, oldTokens.length - 256))) delete next[oldToken]
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => atomicWrite(this.sharesPath, next))
    await this.writeQueue
    return { token, url: `/?share=${encodeURIComponent(token)}`, createdAt: next[token].createdAt }
  }

  async getShare(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw notFound('Share not found.')
    const shares = await readJson(this.sharesPath, {})
    const share = shares[token]
    if (!share?.project) throw notFound('Share not found.')
    return { project: publicProject(share.project, { shared: true }), createdAt: share.createdAt }
  }
}
