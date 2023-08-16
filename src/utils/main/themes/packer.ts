import { loadTheme } from './preferences'
import { isThemeDetails } from '@/utils/common'
import AdmZip from 'adm-zip'
import { app } from 'electron'
import { promises as fsP } from 'fs'
import path from 'path'

export class ThemePacker {
  public async packTheme(themeId: string) {
    const theme = await loadTheme(themeId)
    if (theme) {
      // Do everything in tmp dir
      const themeDir = await fsP.mkdtemp(path.join(app.getPath('temp'), themeId))

      // If theme has a custom CSS, copy them all to the tmp dir
      if (theme.theme.customCSS) {
        const imports = await this.getAllDeps(theme.theme.customCSS)
        imports.splice(0, 0, theme.theme.customCSS)
        await this.copyDeps(themeDir, imports)
      }
      await this.writeConfig(themeDir, theme)
      const zipPath = await this.zipThemeDir(themeDir, theme.name ?? theme.id)
      return zipPath
    }
  }

  public async clean(dir: string) {
    await fsP.rm(dir, {
      maxRetries: 3,
      recursive: true,
    })
  }

  public async importTheme(zipPath: string) {
    const extractDir = await fsP.mkdtemp(path.join(app.getPath('temp'), path.basename(zipPath)))
    const zip = new AdmZip(zipPath)

    await new Promise<void>((resolve, reject) => {
      zip.extractAllToAsync(extractDir, true, true, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    const themeDetails = await this.validateTheme(extractDir)
    if (themeDetails) {
      const themeDir = path.join(app.getPath('appData'), app.getName(), 'themes', themeDetails.id)
      await fsP.rm(themeDir, { recursive: true })
      await fsP.mkdir(themeDir, { recursive: true })
      await fsP.cp(extractDir, themeDir, {
        recursive: true,
        force: true,
        errorOnExist: false,
      })

      await this.clean(extractDir)
      return true
    }

    await this.clean(extractDir)
    throw new Error('Not a valid theme')
  }

  private async validateTheme(extractDir: string) {
    await fsP.access(extractDir)
    const files = await fsP.readdir(extractDir, {
      withFileTypes: true,
    })

    for (const file of files) {
      if (file.isFile() && file.name === 'config.json') {
        const config = JSON.parse(await fsP.readFile(path.join(extractDir, file.name), { encoding: 'utf-8' }))
        if (isThemeDetails(config)) {
          return config
        }
      }
    }
  }

  private writeConfig(themeDir: string, theme: ThemeDetails) {
    if (theme.theme.customCSS) {
      theme.theme.customCSS = path.relative(themeDir, path.join(themeDir, path.basename(theme.theme.customCSS)))
    }
    return fsP.writeFile(path.join(themeDir, 'config.json'), JSON.stringify(theme))
  }

  private async zipThemeDir(themeDir: string, themeName: string) {
    const outPath = path.join(themeDir, `theme-${themeName}.mstx`)
    const zip = new AdmZip()
    await zip.addLocalFolderPromise(themeDir, {})
    await zip.writeZipPromise(outPath, {
      overwrite: true,
    })
    return outPath
  }

  private async copyDeps(themeDir: string, imports: string[]) {
    const baseFileName = path.basename(imports[0])
    await fsP.copyFile(imports[0], path.join(themeDir, baseFileName))
    for (const i of imports.slice(1)) {
      const resolved = path.resolve(path.join(themeDir, baseFileName), path.relative(imports[0], i))
      await fsP.mkdir(path.dirname(resolved), { recursive: true })
      await fsP.copyFile(i, resolved)
    }
  }

  private async getAllDeps(cssPath: string, root?: string) {
    let parsedPath = cssPath
    if (root) {
      parsedPath = path.resolve(root, cssPath)
    }

    await fsP.access(parsedPath)
    const css = await fsP.readFile(parsedPath, { encoding: 'utf-8' })

    const imports: string[] = []

    // Get all imported files
    const match = css.matchAll(new RegExp('@import', 'g'))
    for (const m of match) {
      const line = m.input
      if (line) {
        // Get the path in quotes
        const importPath = line?.match(/(["'])((\\{2})*|(.*?[^\\](\\{2})*))\1/)
        if (importPath) {
          imports.push(path.resolve(path.dirname(parsedPath), importPath[2]))
          const imported = await this.getAllDeps(importPath[2], path.dirname(parsedPath))
          imports.push(...imported)
        }
      }
    }

    return imports
  }
}
