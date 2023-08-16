import { isEmpty, isThemeDetails } from '../../common'
import { loadSelectivePreference, saveSelectivePreference, store } from '../db/preferences'
import { SystemThemeHandler } from './system'
import { app } from 'electron'
import { promises as fsP } from 'fs'
import path from 'path'

/**
 * Saves theme under key "themes"
 * @param theme details of theme to save
 */
export async function saveTheme(theme: ThemeDetails) {
  const themeDir = path.join(app.getPath('appData'), app.getName(), 'themes', theme.id)
  await fsP.mkdir(themeDir, { recursive: true })
  await fsP.writeFile(path.join(themeDir, 'config.json'), JSON.stringify(theme))
}

/**
 * Removes theme by id
 * @param id of theme
 */
export async function removeTheme(id: string) {
  const themeDir = path.join(app.getPath('appData'), app.getName(), 'themes', id)
  await fsP.rm(themeDir, { maxRetries: 5, recursive: true })
}

/**
 * Fetches theme by id
 * @param id of theme
 * @returns details of theme if found otherwise undefined
 */
export async function loadTheme(id: string): Promise<ThemeDetails | undefined> {
  if (id === 'default') {
    return defaultTheme
  }

  const themeDir = path.join(app.getPath('appData'), app.getName(), 'themes', id)

  try {
    const data = await fsP.readFile(path.join(themeDir, 'config.json'), { encoding: 'utf-8' })
    const parsed = JSON.parse(data)
    if (isThemeDetails(parsed)) {
      if (parsed.theme.customCSS && !path.isAbsolute(parsed.theme.customCSS)) {
        parsed.theme.customCSS = path.resolve(themeDir, parsed.theme.customCSS)
      }
      return parsed
    }
  } catch (e) {
    console.error(e)
  }
}

function validateTheme(theme: unknown): ThemeDetails | undefined {
  const tryTheme = theme as ThemeDetails
  if (!isEmpty(tryTheme.id) && !isEmpty(tryTheme.name)) {
    return {
      id: tryTheme.id,
      name: tryTheme.name,
      author: tryTheme.author,
      theme: {
        accent: tryTheme?.theme?.accent,
        primary: tryTheme?.theme?.primary,
        secondary: tryTheme?.theme?.secondary,
        tertiary: tryTheme?.theme?.tertiary,
        textPrimary: tryTheme?.theme?.textPrimary,
        textSecondary: tryTheme?.theme?.textSecondary,
        textInverse: tryTheme?.theme?.textInverse,
        divider: tryTheme?.theme?.divider,
        customCSS: tryTheme?.theme?.customCSS,
      },
    }
  }
}

/**
 * Fetches all themes
 * @returns Dictionary of themes with their id's as keys
 */
export async function loadAllThemes() {
  const themeDir = path.join(app.getPath('appData'), app.getName(), 'themes')
  const ret: { [key: string]: ThemeDetails } = {}

  const dirs = await fsP.readdir(themeDir, { withFileTypes: true })
  for (const d of dirs) {
    if (d.isDirectory()) {
      try {
        const data = JSON.parse(
          await fsP.readFile(path.join(themeDir, d.name, 'config.json'), { encoding: 'utf-8' }),
        ) as ThemeDetails
        const theme = validateTheme(data)
        if (theme) {
          ret[data.id] = theme
        }
      } catch {}
    }
  }

  return ret
}

/**
 * Fetches all themes
 * @deprecated
 * @returns Dictionary of themes with their id's as keys
 */
export function loadAllThemesLegacy(): { [key: string]: ThemeDetails } | undefined {
  return store.get('themes') as { [key: string]: ThemeDetails } | undefined
}

/**
 * Sets active theme by id
 * @param id of theme
 */
export function setActiveTheme(id: string) {
  saveSelectivePreference('activeTheme', id, false)
}

/**
 * Sets song view to active
 * @param menu to be set active
 */
export function setSongView(menu: songMenu) {
  saveSelectivePreference('songView', menu, false)
}

/**
 * Gets active song view
 * @returns song view if active otherwise compact
 */
export function getSongView(): songMenu {
  return loadSelectivePreference('songView', false, 'compact' as songMenu) ?? 'compact'
}

const defaultTheme: ThemeDetails = {
  id: 'default',
  name: 'Default',
  author: 'Moosync',
  theme: {
    primary: '#212121',
    secondary: '#282828',
    tertiary: '#151515',
    textPrimary: '#ffffff',
    textSecondary: '#565656',
    textInverse: '#000000',
    accent: '#65CB88',
    divider: 'rgba(79, 79, 79, 0.67)',
  },
}

/**
 * Gets active theme
 * @returns details of active theme if exists otherwise undefined
 */
export async function getActiveTheme(): Promise<ThemeDetails> {
  const id = loadSelectivePreference('activeTheme', false) as string
  return (await loadTheme(id)) ?? defaultTheme
}

export async function setupSystemThemes() {
  const themes: { [key: string]: ThemeDetails } = {}

  const systemThemeHandler = new SystemThemeHandler()
  if (process.platform === 'linux') {
    const theme = await systemThemeHandler.getLinuxStyle()
    if (theme) {
      themes[theme.id] = theme
    }
  }

  if (process.platform === 'win32') {
    const theme = await systemThemeHandler.getWindowsStyle()
    if (theme) {
      themes[theme.id] = theme
    }
  }

  for (const key in themes) {
    saveTheme(themes[key])
  }
}

/**
 * Setups default themes
 */
export function setupDefaultThemes() {
  const themes: { [key: string]: ThemeDetails } = {
    '809b7310-f852-11eb-82e2-0985b6365ce4': {
      id: '809b7310-f852-11eb-82e2-0985b6365ce4',
      name: 'Fluid',
      author: 'Androbuddy',
      theme: {
        primary: '#202125',
        secondary: '#2D2F36',
        tertiary: '#27292E',
        textPrimary: '#FFFFFF',
        textSecondary: 'rgba(255, 255, 255, 0.32)',
        textInverse: '#000000',
        accent: '#72BBFF',
        divider: 'rgba(79, 79, 79, 0.67)',
      },
    },
  }

  for (const key in themes) {
    if (!store.has(`themes.${key}`)) {
      saveTheme(themes[key])
    }
  }
}

export async function transformCSS(cssPath: string, root?: string) {
  let parsedPath = cssPath
  if (root) {
    parsedPath = path.resolve(root, cssPath)
  }
  await fsP.access(parsedPath)

  let css = await fsP.readFile(parsedPath, { encoding: 'utf-8' })

  const match = css.matchAll(new RegExp('@import', 'g'))
  for (const m of match) {
    const line = m.input
    if (line) {
      const importPath = line?.match(/(["'])((\\{2})*|(.*?[^\\](\\{2})*))\1/)
      if (importPath) {
        const imported = await transformCSS(importPath[2], path.dirname(parsedPath))
        css = css.replaceAll(line, imported)
      }
    }
  }

  return css
}

export async function migrateThemes() {
  const themes = loadAllThemesLegacy()
  const baseDir = path.join(app.getPath('appData'), app.getName(), 'themes')
  await fsP.mkdir(baseDir, { recursive: true })
  if (themes) {
    for (const value of Object.values(themes)) {
      const themeDir = path.join(baseDir, value.id)

      try {
        await fsP.access(themeDir)
      } catch {
        await fsP.mkdir(themeDir, { recursive: true })

        const configPath = path.join(themeDir, 'config.json')
        await fsP.writeFile(configPath, JSON.stringify(value))
      }
    }
  }
}
