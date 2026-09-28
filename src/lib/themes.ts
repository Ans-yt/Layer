export type ThemeId = 'black' | 'white' | 'ocean' | 'deep-blue' | 'espresso' | 'rose'

export interface ThemeDefinition {
  id: ThemeId
  name: string
  description: string
  /** Swatches are intentionally UI-only; they never become document colors. */
  colors: readonly string[]
}

export const THEMES: ThemeDefinition[] = [
  { id: 'black', name: 'Black', description: 'Graphite chrome with amber signal controls.', colors: ['#0b0c0e', '#171b22', '#f5b847', '#8dccff'] },
  { id: 'white', name: 'White', description: 'Paper-bright panels with high-contrast ink controls.', colors: ['#f4f1ea', '#ffffff', '#9a520b', '#1f5f8f'] },
  { id: 'ocean', name: 'Ocean Deep', description: 'Sea-green panels with warm shell highlights.', colors: ['#123a37', '#1d5751', '#e1c68b', '#9fc6c2'] },
  { id: 'deep-blue', name: 'Deep Blue', description: 'Navy chrome with icy white signal lines.', colors: ['#071a36', '#12345f', '#cce8f5', '#9fd0eb'] },
  { id: 'espresso', name: 'Espresso', description: 'Deep espresso, petal accents, and ivory text.', colors: ['#3E2723', '#5a3934', '#EAC6D0', '#EDE6DA'] },
  { id: 'rose', name: 'Dusty Rose', description: 'Muted rose chrome with porcelain contrast.', colors: ['#4A4147', '#70626B', '#F9DCEC', '#C7B3BE', '#9C8A95'] },
]

export const getTheme = (id: ThemeId) => THEMES.find((theme) => theme.id === id) ?? THEMES[0]

export const isThemeId = (value: string | null): value is ThemeId => THEMES.some((theme) => theme.id === value)
