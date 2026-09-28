import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialProject } from '../src/lib/model'
import { addSnapshot, clearStoredProject, deleteSavedProject, listSavedProjects, loadProject, loadSavedProject, restoreSnapshot, saveProject } from '../src/lib/storage'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const installStorage = () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
const fixture = (id: string, name: string) => ({ ...structuredClone(createInitialProject()), id, name })

describe('multi-project local recovery storage', () => {
  beforeEach(() => { installStorage() })

  it('saves, lists, loads, and deletes more than one project without IndexedDB', async () => {
    const first = await saveProject(fixture('project_storage_a', 'A'))
    const second = await saveProject(fixture('project_storage_b', 'B'))
    const summaries = await listSavedProjects()
    expect(summaries.map((item) => item.id).sort()).toEqual(['project_storage_a', 'project_storage_b'])
    expect((await loadSavedProject(first.id))?.name).toBe('A')
    expect((await loadSavedProject(second.id))?.name).toBe('B')
    await deleteSavedProject(first.id)
    expect(await loadSavedProject(first.id)).toBeNull()
    expect((await listSavedProjects()).map((item) => item.id)).toEqual(['project_storage_b'])
  })

  it('retains the synchronous legacy recovery path and returns a promise save', async () => {
    const project = fixture('project_recovery', 'Recovered')
    const saved = saveProject(project)
    expect(saved).toBeInstanceOf(Promise)
    await saved
    expect(loadProject().id).toBe('project_recovery')
    clearStoredProject()
    expect((await loadSavedProject('project_recovery'))?.name).toBe('Recovered')
  })

  it('bounds snapshots and restores document contents', () => {
    let project = fixture('project_snapshots', 'Snapshots')
    const firstName = project.pages[0].name
    project = addSnapshot(project, 'Original', 2).project
    const firstId = project.versions[0].id
    project.pages[0].name = 'Changed'
    expect(restoreSnapshot(project, firstId).pages[0].name).toBe(firstName)
    project = addSnapshot(project, 'Second', 2).project
    project = addSnapshot(project, 'Third', 2).project
    expect(project.versions).toHaveLength(2)
    expect(project.versions.map((snapshot) => snapshot.name)).toEqual(['Second', 'Third'])
  })
})
