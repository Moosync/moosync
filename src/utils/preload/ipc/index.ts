/*
 *  index.ts is a part of Moosync.
 *
 *  Copyright 2021-2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { IpcRenderer } from 'electron'

export class IpcRendererHolder {
  ipcRenderer: IpcRenderer

  constructor(renderer: IpcRenderer) {
    this.ipcRenderer = renderer
  }

  public send<T>(channel: string, request: IpcRequestOptionalChannel<T>): Promise<unknown> {
    if (!request.responseChannel) {
      // require('crypto') seems to be undefined when preload script is first fires
      // Lazy load crypto since we're sure that this will always happen after the crypto is loaded
      request.responseChannel = window.crypto?.randomUUID() ?? Date.now().toString()
    }
    this.ipcRenderer.send(channel, request)

    return new Promise((resolve, reject) => {
      this.ipcRenderer.once(request.responseChannel as string, (_, response) => {
        if (response instanceof Error) {
          reject(response)
          return
        }
        resolve(response)
      })
    })
  }

  public on(channel: string, callback: Function) {
    return this.ipcRenderer.on(channel, (_, ...args) => {
      try {
        callback(...args)
      } catch (e) {
        console.log(e)
      }
    })
  }

  public off(channel: string, callback: Function) {
    return this.ipcRenderer.off(channel, callback as (...args: unknown[]) => void)
  }

  public once(channel: string, callback: Function) {
    return this.ipcRenderer.once(channel, (_, ...args) => callback(...args))
  }

  public removeAllListener(channel: string) {
    return this.ipcRenderer.removeAllListeners(channel)
  }
}
