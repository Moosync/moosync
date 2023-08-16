/*
 *  index.ts is a part of Moosync.
 *
 *  Copyright 2021-2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { loadSelectivePreference, saveSelectivePreference } from '../main/db/preferences'
import { extensionUIRequestsKeys, mainRequests, providerFetchRequests } from '@/utils/extensions/constants'
import { ChildProcess, Serializable, fork } from 'child_process'
import { app, ipcMain, shell } from 'electron'

import { getStoreChannel } from '../main/ipc'
import { WindowHandler } from '../main/windowManager'
import { playerControlRequests } from './constants'
import { getVersion, sanitizeSong } from '@/utils/common'
import { sanitizePlaylist } from '@/utils/common'
import { getSongDB } from '@/utils/main/db/index'
import { ExtensionHostEvents } from '@/utils/main/ipc/constants'
import { oauthHandler } from '@/utils/main/oauth/handler'
import { BrowserWindow } from 'electron'
import { promises as fsP } from 'fs'
import { LogLevelDesc } from 'loglevel'
import { async } from 'node-stream-zip'
import path from 'path'
import { v4 } from 'uuid'

export const defaultExtensionPath = path.join(app.getPath('appData'), app.getName(), 'extensions')
const defaultLogPath = path.join(app.getPath('logs'))

export class MainHostIPCHandler {
  private sandboxProcess: ChildProcess

  private extensionRequestHandler = new ExtensionRequestHandler()
  private extensionResourceHandler = new ExtensionHandler()
  public mainRequestGenerator: MainRequestGenerator

  private isAlive = false
  private ignoreRespawn = false

  constructor() {
    this.sandboxProcess = this.createExtensionHost()
    this.mainRequestGenerator = new MainRequestGenerator(this.sandboxProcess, this.sendToExtensionHost.bind(this))
    this.registerListeners()
  }

  private reSpawnProcess() {
    try {
      console.debug('Killing extension host (Attempt to respawn)')
      this.sandboxProcess.kill()

      console.debug('Creating new extension host')
      this.sandboxProcess = this.createExtensionHost()

      console.debug('Registering listeners to extension host')
      this.registerListeners()
      this.mainRequestGenerator.reAssignSandbox(this.sandboxProcess)

      console.debug('Extension host respawned')
    } catch (e) {
      console.error(e)
    }
  }

  private registerListeners() {
    this.sandboxProcess.on('message', this.parseMessage.bind(this))
    this.sandboxProcess.on('error', (e) => console.error('Extension Error:', e))
    this.sandboxProcess.on('exit', () => {
      this.isAlive = false
    })
    this.sandboxProcess.on('close', () => this.isAlive === false)
  }

  private createExtensionHost() {
    const process = fork(`${__dirname}/sandbox.js`, [
      'extensionPath',
      defaultExtensionPath,
      'logPath',
      defaultLogPath,
      'installPath',
      app.getAppPath(),
    ])
    this.isAlive = true
    return process
  }

  public mainWindowCreated() {
    this.extensionRequestHandler.mainWindowCreated()
  }

  private parseMessage(message: mainHostMessage) {
    this.extensionRequestHandler.parseRequest(message as extensionRequestMessage).then((resp) => {
      if (resp) {
        this.sendToExtensionHost(resp)
      }
    })
  }

  public async installExtension(zipPaths: string[]): Promise<installMessage> {
    const resp = await this.extensionResourceHandler.installExtension(zipPaths, this.uninstallExtension.bind(this))
    await this.mainRequestGenerator.findNewExtensions()
    return resp
  }

  public async uninstallExtension(packageName: string): Promise<void> {
    await this.mainRequestGenerator.removeExtension(packageName)
    await this.extensionResourceHandler.uninstallExtension(packageName)

    console.debug('Removed extension', packageName)
  }

  public async sendExtraEventToExtensions<T extends ExtraExtensionEventTypes>(event: ExtraExtensionEvents<T>) {
    const data = await this.mainRequestGenerator.sendExtraEvent(event)
    return data
  }

  public async setExtensionLogLevel(level: LogLevelDesc) {
    await this.mainRequestGenerator.setLogLevel(level)
  }

  private sendToExtensionHost(data: Serializable) {
    const isKilled = !this.isAlive || !this.sandboxProcess.connected || this.sandboxProcess.killed
    if (isKilled && !this.ignoreRespawn) {
      this.reSpawnProcess()
    }

    !isKilled &&
      this.sandboxProcess.send(data, (err) => {
        if (err) {
          console.warn('Error communicating with sandbox process. Probably killed.', err.message)
        }
      })
  }

  public async closeHost() {
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject('Failed to stop extension host gracefully'), 5000)
        this.mainRequestGenerator
          .stopProcess()
          .then(() => {
            clearTimeout(timeout)
            resolve()
          })
          .catch((e) => reject(e))
      })
    } catch (e) {
      console.error(e)
    }

    console.debug('Killing extension host')
    this.ignoreRespawn = true
    this.sandboxProcess.kill('SIGKILL')
  }
}

class MainRequestGenerator {
  private sandboxProcess: ChildProcess
  private _sendSync: (data: Serializable) => void

  constructor(process: ChildProcess, sendSync: (data: Serializable) => void) {
    this.sandboxProcess = process
    this._sendSync = sendSync
  }

  public reAssignSandbox(sandbox: ChildProcess) {
    this.sandboxProcess = sandbox
  }

  public async stopProcess() {
    return this.sendAsync<void>('stop-process')
  }

  public async findNewExtensions() {
    await this.sendAsync<void>('find-new-extensions')
  }

  public async getInstalledExtensions() {
    return this.sendAsync<ExtensionDetails[]>('get-installed-extensions')
  }

  public async getExtensionIcon(packageName: string) {
    return this.sendAsync<string>('get-extension-icon', { packageName })
  }

  public async toggleExtensionStatus(packageName: string, enabled: boolean) {
    return this.sendAsync<void>('toggle-extension-status', { packageName, enabled })
  }

  public async removeExtension(packageName: string) {
    return this.sendAsync<void>('remove-extension', { packageName })
  }

  public async sendExtraEvent<T extends ExtraExtensionEventTypes>(event: ExtraExtensionEvents<T>) {
    return this.sendAsync<ExtraExtensionEventCombinedReturnType<T>>('extra-extension-events', event)
  }

  public async getContextMenuItems<T extends ContextMenuTypes>(type: T) {
    return this.sendAsync<ExtendedExtensionContextMenuItems<T>>('get-extension-context-menu', { type })
  }

  public async setLogLevel(level: LogLevelDesc) {
    return this.sendAsync<void>('set-log-level', { level })
  }

  public async getAccounts(packageName: string) {
    return this.sendAsync<Record<string, StrippedAccountDetails[]>>('get-accounts', { packageName })
  }

  public async performAccountLogin(packageName: string, accountId: string, loginStatus: boolean) {
    return this.sendAsync<void>('perform-account-login', { packageName, accountId, loginStatus })
  }

  public async getDisplayName(packageName: string) {
    return this.sendAsync<void>('get-display-name', { packageName })
  }

  public async getProviderScopes(packageName: string) {
    return this.sendAsync<Record<string, string>>('get-extension-provider-scopes', { packageName })
  }

  public async sendContextMenuItemClicked(
    id: string,
    packageName: string,
    arg: ExtensionContextMenuHandlerArgs<ContextMenuTypes>,
  ) {
    return this.sendAsync<void>('on-clicked-context-menu', { id, packageName, arg })
  }

  private sendAsync<T>(type: mainRequests | providerFetchRequests, data?: unknown): Promise<T> {
    const channel = v4()

    return new Promise<T>((resolve) => {
      const listener: (data: mainReplyMessage) => void = (data: mainReplyMessage) => {
        if (data.channel === channel) {
          this.sandboxProcess.off('message', listener)
          resolve(data.data as T)
        }
      }
      this.sandboxProcess.on('message', listener)
      this._sendSync({ type, channel, data } as mainRequestMessage)
    })
  }
}

class ExtensionRequestHandler {
  private mainWindowCallsQueue: { func: unknown; args: Serializable[] }[] = []

  public mainWindowCreated() {
    for (const f of this.mainWindowCallsQueue) {
      // rome-ignore lint/complexity/noExtraSemicolon: False-positive linting
      ;(f.func as (...args: Serializable[]) => void)(...f.args)
    }
  }

  private requestToRenderer(message: extensionRequestMessage) {
    const fireAndForgetRequests: typeof message['type'][] = ['update-preferences', 'extension-updated']
    return new Promise((resolve) => {
      if (!fireAndForgetRequests.includes(message.type)) {
        const listener: (event: Electron.IpcMainEvent, data: extensionReplyMessage) => void = (
          event,
          data: extensionReplyMessage,
        ) => {
          if (data.channel === message.channel) {
            ipcMain.off(ExtensionHostEvents.EXTENSION_REQUESTS, listener)
            resolve(data.data)
          }
        }
        ipcMain.on(ExtensionHostEvents.EXTENSION_REQUESTS, listener)
      }

      // Defer call till mainWindow is created
      if (WindowHandler.getWindow(true)) this.sendToRenderer(message)
      else {
        this.mainWindowCallsQueue.push({ func: this.sendToRenderer, args: [message] })
      }
    })
  }

  private sendToRenderer(message: extensionRequestMessage) {
    let window: BrowserWindow | null
    if (message.type === 'update-preferences') {
      window = WindowHandler.getWindow(false)
    } else {
      window = WindowHandler.getWindow(true)
    }

    window?.webContents.send(ExtensionHostEvents.EXTENSION_REQUESTS, message)
  }

  private getPreferenceKey(packageName: string, key?: string) {
    let str = packageName
    if (key) str += `.${key}`
    return str
  }

  public async parseRequest(message: extensionRequestMessage): Promise<extensionReplyMessage | undefined> {
    message.type && console.debug('Received message from extension', message.extensionName, message.type)
    const resp: extensionReplyMessage = { ...message, data: undefined }
    if (message.type === 'get-songs') {
      const songs = await getSongDB().getSongByOptions(message.data as SongAPIOptions)
      resp.data = songs
    }

    if (message.type === 'get-entity') {
      const entity = await getSongDB().getEntityByOptions(
        message.data as EntityApiOptions<Artists | Album | Playlist | Genre>,
      )
      resp.data = entity
    }

    if (message.type === 'add-songs') {
      resp.data = []
      if (Array.isArray(message.data)) {
        for (const s of message.data) {
          if (s) {
            // rome-ignore lint/complexity/noExtraSemicolon: False-positive
            ;(resp.data as Song[]).push(...(await getSongDB().store(...sanitizeSong(message.extensionName, s))))
          }
        }
      }
    }

    if (message.type === 'add-playlist') {
      const playlist = message.data as Playlist
      resp.data = await getSongDB().createPlaylist(sanitizePlaylist(message.extensionName, false, playlist)[0])
    }

    if (message.type === 'add-song-to-playlist') {
      const data = message.data as { playlistID: string; songs: Song[] }
      await getSongDB().addToPlaylist(data.playlistID, ...sanitizeSong(message.extensionName, ...data.songs))
    }

    if (message.type === 'remove-song') {
      await getSongDB().removeSong(
        ...(message.data as Song[]).filter((val) => val._id.startsWith(`${message.extensionName}:`)),
      )
    }

    if (message.type === 'get-preferences') {
      const { packageName, key, defaultValue } = message.data as {
        packageName: string
        key?: string
        defaultValue?: unknown
      }
      resp.data = await loadSelectivePreference(this.getPreferenceKey(packageName, key), true, defaultValue)
    }

    if (message.type === 'get-secure-preferences') {
      const { packageName, key, defaultValue } = message.data as {
        packageName: string
        key?: string
        defaultValue?: unknown
      }
      const secure = await getStoreChannel().getSecure(this.getPreferenceKey(packageName, key))
      if (secure) {
        try {
          resp.data = JSON.parse(secure)
        } catch {
          console.error('Failed to parse secure token as json')
          resp.data = secure
        }
      } else {
        resp.data = defaultValue
      }
    }

    if (message.type === 'set-preferences') {
      const { packageName, key, value } = message.data as { packageName: string; key: string; value: unknown }
      resp.data = saveSelectivePreference(this.getPreferenceKey(packageName, key), value, true)
    }

    if (message.type === 'set-secure-preferences') {
      const { packageName, key, value } = message.data as { packageName: string; key: string; value: unknown }
      resp.data = await getStoreChannel().setSecure(this.getPreferenceKey(packageName, key), JSON.stringify(value))
    }

    if (message.type === 'register-oauth') {
      oauthHandler.registerHandler(message.data as string, true, message.extensionName)
    }

    if (message.type === 'open-external') {
      await shell.openExternal(message.data as string)
    }

    if (message.type === 'register-account') {
      WindowHandler.getWindow(true)?.webContents.send(ExtensionHostEvents.ON_ACCOUNT_REGISTERED, {
        packageName: message.extensionName,
        data: message.data,
      })
    }

    if (message.type === 'set-artist-editable-info') {
      const data = message.data as { artist_id: string; object: Record<string, Record<string, string | undefined>> }
      if (typeof data.artist_id === 'string' && data.object) {
        getSongDB().updateArtistExtraInfo(data.artist_id, data.object, message.extensionName)
      }
    }

    if (message.type === 'set-album-editable-info') {
      const data = message.data as { album_id: string; object: Record<string, Record<string, string | undefined>> }
      if (typeof data.album_id === 'string' && data.object) {
        getSongDB().updateAlbumExtraInfo(data.album_id, data.object, message.extensionName)
      }
    }

    if (
      extensionUIRequestsKeys.includes(message.type as typeof extensionUIRequestsKeys[number]) ||
      playerControlRequests.includes(message.type as typeof playerControlRequests[number])
    ) {
      const data = await this.requestToRenderer(message)
      resp.data = data
    }

    return resp
  }
}

class ExtensionHandler {
  private async checkVersion(oldS: string, newS: string) {
    const oldV = getVersion(oldS)
    const newV = getVersion(newS)

    return newV > oldV
  }

  private async createDir(path: string) {
    await fsP.rm(path, { recursive: true, force: true })
    await fsP.mkdir(path, { recursive: true })
  }

  private async isExistingExtension(packageName: string): Promise<string | undefined> {
    try {
      const extPath = path.join(defaultExtensionPath, packageName)
      await fsP.access(extPath)
      const manifest = JSON.parse(await fsP.readFile(path.join(extPath, 'package.json'), 'utf-8'))
      return manifest.version
    } catch (e) {
      console.debug(`No existing extension found with packageName: ${packageName}`)
    }
  }

  public async installExtension(
    zipPaths: string[],
    uninstallMethod: (P: string) => Promise<void>,
  ): Promise<installMessage> {
    for (const filePath of zipPaths) {
      const zip = new async({ file: filePath })
      const manifestRaw = await zip.entryData('package.json')
      const manifest = JSON.parse(manifestRaw.toString('utf-8'))
      if (
        manifest.moosyncExtension &&
        manifest.displayName &&
        manifest.extensionEntry &&
        manifest.name &&
        manifest.version
      ) {
        const existingVersion = await this.isExistingExtension(manifest.name)
        if (existingVersion) {
          if (!(await this.checkVersion(existingVersion, manifest.version))) {
            return {
              success: false,
              message: `Duplicate extension ${manifest.name}. Can not install`,
            }
          }
          await uninstallMethod(manifest.name)
        }
        const installPath = path.join(defaultExtensionPath, manifest.name)
        await this.createDir(installPath)
        await zip.extract(null, installPath)
        return {
          success: true,
          message: 'Extension installed successfully',
        }
      }
    }
    return {
      success: false,
    }
  }

  public async uninstallExtension(packageName: string) {
    if (await this.isExistingExtension(packageName)) {
      await fsP.rm(path.join(defaultExtensionPath, packageName), { recursive: true, force: true })
    }
  }
}
