/*
 *  preferences.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import {
  loadSelectiveArrayPreference,
  loadSelectivePreference,
  onPreferenceChanged,
  removeSelectivePreference,
  resetPrefsToDefault,
  saveSelectivePreference,
  setPreferenceListenKey,
} from '../db/preferences'
import { EventBus, IpcEvents, PreferenceEvents } from './constants'

import { ThemePacker } from '../themes/packer'
import {
  getActiveTheme,
  getSongView,
  loadAllThemes,
  loadTheme,
  removeTheme,
  saveTheme,
  setActiveTheme,
  setSongView,
  transformCSS,
} from '../themes/preferences'
import { WindowHandler, _windowHandler } from '../windowManager'
import { app, ipcMain } from 'electron'
import { promises as fsP } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import path from 'path/posix'
import { v1 } from 'uuid'

export class PreferenceChannel implements IpcChannelInterface {
  name = IpcEvents.PREFERENCES

  handle(event: Electron.IpcMainEvent, request: IpcRequest): void {
    switch (request.type) {
      case PreferenceEvents.SAVE_SELECTIVE_PREFERENCES:
        this.saveSelective(event, request as IpcRequest<PreferenceRequests.Save>)
        break
      case PreferenceEvents.LOAD_SELECTIVE_PREFERENCES:
        this.loadSelective(event, request as IpcRequest<PreferenceRequests.Load>)
        break
      case PreferenceEvents.LOAD_SELECTIVE_ARRAY:
        this.loadSelectiveArrayItem(event, request as IpcRequest<PreferenceRequests.Load>)
        break
      case PreferenceEvents.PREFERENCE_REFRESH:
        this.onPreferenceChanged(event, request as IpcRequest<PreferenceRequests.PreferenceChange>)
        break
      case PreferenceEvents.SET_THEME:
        this.setTheme(event, request as IpcRequest<PreferenceRequests.Theme>)
        break
      case PreferenceEvents.GET_THEME:
        this.getTheme(event, request as IpcRequest<PreferenceRequests.ThemeID>)
        break
      case PreferenceEvents.REMOVE_THEME:
        this.removeTheme(event, request as IpcRequest<PreferenceRequests.ThemeID>)
        break
      case PreferenceEvents.SET_ACTIVE_THEME:
        this.setActiveTheme(event, request as IpcRequest<PreferenceRequests.ThemeID>)
        break
      case PreferenceEvents.GET_ACTIVE_THEME:
        this.getActiveTheme(event, request)
        break
      case PreferenceEvents.GET_ALL_THEMES:
        this.getAllThemes(event, request)
        break
      case PreferenceEvents.GET_SONG_VIEW:
        this.getSongView(event, request)
        break
      case PreferenceEvents.SET_SONG_VIEW:
        this.setSongView(event, request as IpcRequest<PreferenceRequests.SongView>)
        break
      case PreferenceEvents.LISTEN_PREFERENCE:
        this.setListenKey(event, request as IpcRequest<PreferenceRequests.ListenKey>)
        break
      case PreferenceEvents.RESET_TO_DEFAULT:
        this.resetToDefault(event, request)
        break
      case PreferenceEvents.TRANSFORM_CSS:
        this.transformCSS(event, request as IpcRequest<PreferenceRequests.TransformCSS>)
        break
      case PreferenceEvents.PACK_THEME:
        this.packTheme(event, request as IpcRequest<PreferenceRequests.ThemeID>)
        break
      case PreferenceEvents.IMPORT_THEME:
        this.importTheme(event, request as IpcRequest<PreferenceRequests.ImportTheme>)
        break
    }
  }

  private saveSelective(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.Save>) {
    if (request.params.key) {
      if (request.params.value !== undefined)
        event.reply(
          request.responseChannel,
          saveSelectivePreference(request.params.key, request.params.value, request.params.isExtension),
        )
      else
        event.reply(request.responseChannel, removeSelectivePreference(request.params.key, request.params.isExtension))
    }
    event.reply(request.responseChannel)
  }

  private loadSelective(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.Load>) {
    if (request.params.key) {
      event.reply(
        request.responseChannel,
        loadSelectivePreference(request.params.key, request.params.isExtension, request.params.defaultValue),
      )
    }
    event.reply(request.responseChannel, request.params.defaultValue)
  }

  private loadSelectiveArrayItem(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.Load>) {
    if (request.params.key) {
      event.reply(
        request.responseChannel,
        loadSelectiveArrayPreference(request.params.key, request.params.defaultValue),
      )
    }
    event.reply(request.responseChannel, request.params.defaultValue)
  }

  private onPreferenceChanged(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.PreferenceChange>) {
    if (request.params.key) {
      onPreferenceChanged(request.params.key, request.params.value)
    }
    event.reply(request.responseChannel)
  }

  private setTheme(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.Theme>) {
    if (request.params.theme) {
      saveTheme(request.params.theme)
    }
    event.reply(request.responseChannel)
  }

  private async transformCSS(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.TransformCSS>) {
    if (request.params.cssPath) {
      const data = await transformCSS(request.params.cssPath)
      event.reply(request.responseChannel, data)
    }
    event.reply(request.responseChannel)
  }

  private async packTheme(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.ThemeID>) {
    if (request.params.id) {
      const packer = new ThemePacker()
      const zipPath = await packer.packTheme(request.params.id)
      if (zipPath) {
        const ret = await _windowHandler.openSaveDialog(false, {
          title: 'Export theme',
          defaultPath: path.join(app.getPath('documents'), path.basename(zipPath)),
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        })

        if (ret?.filePath) {
          await fsP.copyFile(zipPath, ret.filePath)
          await packer.clean(path.dirname(zipPath))
        }
      }
    }
    event.reply(request.responseChannel)
  }

  private async importTheme(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.ImportTheme>) {
    if (request.params.themeZipPath) {
      const packer = new ThemePacker()
      try {
        await packer.importTheme(request.params.themeZipPath)
      } catch (e) {
        console.error(e)
      }
    }
    event.reply(request.responseChannel)
  }

  private async getTheme(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.ThemeID>) {
    event.reply(request.responseChannel, await loadTheme(request.params.id))
  }

  private async removeTheme(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.ThemeID>) {
    event.reply(request.responseChannel, await removeTheme(request.params.id))
  }

  private async getAllThemes(event: Electron.IpcMainEvent, request: IpcRequest) {
    event.reply(request.responseChannel, await loadAllThemes())
  }

  private async setActiveTheme(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.ThemeID>) {
    if (request.params.id) {
      const theme = await loadTheme(request.params.id)
      if (theme || request.params.id === 'default') {
        setActiveTheme(request.params.id)
        this.generateIconFile(theme)
      }
    }
    event.reply(request.responseChannel)
  }

  private async generateIconFile(theme?: ThemeDetails) {
    const iconPath = path.join(app.getPath('appData'), 'moosync', 'trayIcon', 'icon.png')
    await rm(iconPath, { force: true })
    await mkdir(path.dirname(iconPath), { recursive: true })

    if (theme) {
      const size = process.platform === 'darwin' ? 18 : 512
      const window = WindowHandler.getWindow()
      const responseChannel = v1()

      const listener = async (_: Electron.IpcMainEvent, data: { channel: string; buffer: string }) => {
        if (responseChannel === data.channel) {
          await writeFile(iconPath, Buffer.from(data.buffer, 'base64'))
          ipcMain.off(PreferenceEvents.GENERATE_ICON, listener)
        }
      }
      ipcMain.on(PreferenceEvents.GENERATE_ICON, listener)

      window?.webContents.send(PreferenceEvents.GENERATE_ICON, {
        type: PreferenceEvents.GENERATE_ICON,
        responseChannel,
        params: {
          size,
          colors: theme,
        },
      } as IpcRequest<PreferenceRequests.GenerateIcon>)
    }
  }

  private async getActiveTheme(event: Electron.IpcMainEvent, request: IpcRequest) {
    event.reply(request.responseChannel, await getActiveTheme())
  }

  private setSongView(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.SongView>) {
    if (request.params.menu) {
      setSongView(request.params.menu)
    }
    event.reply(request.responseChannel)
  }

  private getSongView(event: Electron.IpcMainEvent, request: IpcRequest) {
    event.reply(request.responseChannel, getSongView())
  }

  public notifyWindow(key: string, value: unknown, isMainWindow: boolean, channel: string) {
    console.debug('notifying pref change on channel', channel)
    WindowHandler.getWindow(isMainWindow)?.webContents.send(channel, key, value)
  }

  private setListenKey(event: Electron.IpcMainEvent, request: IpcRequest<PreferenceRequests.ListenKey>) {
    if (request.params?.key) {
      const channel = setPreferenceListenKey(request.params.key, request.params.isMainWindow)
      event.reply(request.responseChannel, channel)
    }
  }

  private resetToDefault(event: Electron.IpcMainEvent, request: IpcRequest) {
    resetPrefsToDefault()
    event.reply(request.responseChannel)
  }
}
