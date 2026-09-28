import type { Page } from './model'

/** Include each match's ancestor path, even when its container doesn't match. */
export function filterLayerTree(page: Page, query: string) {
  const needle = query.trim().toLowerCase()
  const matches = new Set(page.elements.filter((element) => !needle || `${element.name} ${element.type} ${element.text ?? ''}`.toLowerCase().includes(needle)).map((element) => element.id))
  const visible = new Set(matches)
  const byId = new Map(page.elements.map((element) => [element.id, element]))
  for (const id of matches) {
    const seen = new Set([id])
    let parentId = byId.get(id)?.parentId
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      visible.add(parentId)
      parentId = byId.get(parentId)?.parentId
    }
  }
  return { needle, matches, visible }
}
