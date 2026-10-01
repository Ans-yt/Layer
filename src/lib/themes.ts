export type ThemeId = 'black' | 'white' | 'ocean' | 'deep-blue' | 'espresso' | 'rose'

/**
 * The chrome palette is deliberately separate from authored document colors.
 * `artboard` is the default for pages which still follow the workspace theme;
 * it is never used to recolor element fills.
 */
export interface ThemePalette {
  editor: string
  panels: string
  controls: string
  hover: string
  workspace: string
  artboard: string
  cards: string
  borders: string
  text: string
  secondary: string
  primary: string
  onPrimary: string
  active: string
  selection: string
}

export interface ThemeDefinition {
  id: ThemeId
  name: string
  description: string
  /** Swatches are intentionally UI-only; they never become document colors. */
  colors: readonly string[]
  palette: ThemePalette
  /** Alias kept explicit for callers that describe a page's theme default. */
  defaultArtboard: string
  /** Stable alias for persistence/migration helpers. */
  defaultBackground: string
}

const makeTheme = (
  id: ThemeId,
  name: string,
  description: string,
  palette: ThemePalette,
  colors: readonly string[] = [palette.editor, palette.panels, palette.primary, palette.selection],
): ThemeDefinition => ({ id, name, description, colors, palette, defaultArtboard: palette.artboard, defaultBackground: palette.artboard })

const blackPalette: ThemePalette = {
  editor: '#101113', panels: '#191A1D', controls: '#222327', hover: '#2C2D32', workspace: '#101113',
  artboard: '#191B20', cards: '#24262D', borders: '#36383E', text: '#F2F1ED', secondary: '#ACAEB7',
  primary: '#F2BB54', onPrimary: '#231907', active: '#3B3222', selection: '#89B9EF',
}

const whitePalette: ThemePalette = {
  editor: '#E8E2D7', panels: '#F8F4EB', controls: '#EEE8DC', hover: '#E5DDCF', workspace: '#E6DFD2',
  artboard: '#FFFAF0', cards: '#F1E9DC', borders: '#D4C9B7', text: '#393329', secondary: '#716658',
  primary: '#99492F', onPrimary: '#FFF8F0', active: '#EEDED2', selection: '#AA6848',
}

export const THEMES: ThemeDefinition[] = [
  makeTheme('black', 'Black + Amber', 'Graphite chrome with amber signal controls.', blackPalette),
  makeTheme('white', 'Sand + Clay', 'Paper-bright panels with clay signal controls.', whitePalette),
  makeTheme('ocean', 'Ocean Deep', 'Sea-green panels with warm shell highlights.', {
    editor: '#123A37', panels: '#164541', controls: '#1D5751', hover: '#28655F', workspace: '#123A37',
    artboard: '#123A37', cards: '#1A4B47', borders: '#52817A', text: '#F4F0DF', secondary: '#C5D8D0',
    primary: '#E1C68B', onPrimary: '#123A37', active: '#376B64', selection: '#9FC6C2',
  }, ['#123a37', '#1d5751', '#e1c68b', '#9fc6c2']),
  makeTheme('deep-blue', 'Deep Blue', 'Navy chrome with icy white signal lines.', {
    editor: '#071A36', panels: '#0B254A', controls: '#12345F', hover: '#1C4677', workspace: '#071A36',
    artboard: '#071A36', cards: '#0E2A52', borders: '#416B9D', text: '#F3F7F6', secondary: '#C5D6E9',
    primary: '#CCE8F5', onPrimary: '#071A36', active: '#285487', selection: '#9FD0EB',
  }, ['#071a36', '#12345f', '#cce8f5', '#9fd0eb']),
  makeTheme('espresso', 'Espresso', 'Deep espresso, petal accents, and ivory text.', {
    editor: '#3E2723', panels: '#452D29', controls: '#5A3934', hover: '#6C4541', workspace: '#3E2723',
    artboard: '#3E2723', cards: '#4F322E', borders: '#966E70', text: '#EDE6DA', secondary: '#EAD9D5',
    primary: '#EAC6D0', onPrimary: '#3E2723', active: '#744B4A', selection: '#C5DCE5',
  }, ['#3E2723', '#5a3934', '#EAC6D0', '#EDE6DA']),
  makeTheme('rose', 'Dusty Rose', 'Muted rose chrome with porcelain contrast.', {
    editor: '#4A4147', panels: '#5A4E56', controls: '#7F707A', hover: '#9C8A95', workspace: '#4A4147',
    artboard: '#4A4147', cards: '#70626B', borders: '#C7B3BE', text: '#FFF8FC', secondary: '#F4E9EF',
    primary: '#F9DCEC', onPrimary: '#4A4147', active: '#9C8A95', selection: '#D9E0EC',
  }, ['#4A4147', '#70626B', '#F9DCEC', '#C7B3BE', '#9C8A95']),
]

export const getTheme = (id: ThemeId): ThemeDefinition => THEMES.find((theme) => theme.id === id) ?? THEMES[0]

export const getThemeDefaultBackground = (id: ThemeId): string => getTheme(id).defaultArtboard

export const isThemeId = (value: string | null): value is ThemeId => THEMES.some((theme) => theme.id === value)
