/*
 *  update.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { logger } from '../logger/index'
import { WindowHandler } from '../windowManager'
import { IpcEvents, UpdateEvents } from './constants'
import { autoUpdater } from 'electron-updater'

export class UpdateChannel implements IpcChannelInterface {
  name = IpcEvents.UPDATE

  constructor() {
    autoUpdater.logger = logger
    autoUpdater.on('update-available', () => {
      if (process.platform === 'linux') {
        if (!process.env.APPIMAGE) {
          console.info('Update found but not an AppImage. Please use your package manager to update or manually do it.')
          return
        }
      }
      console.debug('Notifying main window, Update available')
      this.notifyMainWindow(true)
    })
  }

  handle(event: Electron.IpcMainEvent, request: IpcRequest): void {
    switch (request.type) {
      case UpdateEvents.CHECK_UPDATES:
        this.checkUpdates()
        break
      case UpdateEvents.UPDATE_NOW:
        this.updateNow()
        break
    }
  }

  private notifyMainWindow(available: boolean) {
    WindowHandler.getWindow(true)?.webContents.send(UpdateEvents.GOT_UPDATE, available)
  }

  private async updateNow() {
    await autoUpdater.downloadUpdate()
    autoUpdater.quitAndInstall()
  }

  public async checkUpdates() {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    try {
      // Dont wait for promise to resolve
      await autoUpdater.checkForUpdates()
    } catch (e) {
      console.error(e)
    }
  }
}
