/*
 *  index.ts is a part of Moosync.
 *
 *  Copyright 2021-2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { ExtensionHostChannel } from './extensionHost'
import { LoggerChannel } from './logger'
import { MprisChannel } from './mpris'
import { NotifierChannel } from './notifier'
import { PlaylistsChannel } from './playlists'
import { PreferenceChannel } from './preferences'
import { ScannerChannel } from './scanner'
import { SearchChannel } from './search'
import { SongsChannel } from './songs'
import { SpotifyPlayerChannel } from './spotifyPlayer'
import { StoreChannel } from './store'
import { UpdateChannel } from './update'
import { BrowserWindowChannel } from './window'
import { ipcMain } from 'electron'

let scannerChannel: ScannerChannel | undefined = undefined
let updateChannel: UpdateChannel | undefined = undefined
let extensionChannel: ExtensionHostChannel | undefined = undefined
let preferenceChannel: PreferenceChannel | undefined = undefined
let storeChannel: StoreChannel | undefined = undefined
let mprisChannel: MprisChannel | undefined = undefined
let spotifyPlayerChannel: SpotifyPlayerChannel | undefined = undefined

export function registerIpcChannels() {
  const ipcChannels = [
    new SongsChannel(),
    getScannerChannel(),
    new PlaylistsChannel(),
    new BrowserWindowChannel(),
    getPreferenceChannel(),
    new SearchChannel(),
    getStoreChannel(),
    new LoggerChannel(),
    getExtensionHostChannel(),
    getUpdateChannel(),
    new NotifierChannel(),
    getMprisChannel(),
    getSpotifyPlayerChannel(),
  ]
  ipcChannels.forEach((channel) => ipcMain.on(channel.name, (event, request) => channel.handle(event, request)))
}

export function getExtensionHostChannel() {
  if (!extensionChannel) {
    extensionChannel = new ExtensionHostChannel()
  }
  return extensionChannel
}

export function getUpdateChannel() {
  if (!updateChannel) {
    updateChannel = new UpdateChannel()
  }
  return updateChannel
}

export function getScannerChannel() {
  if (!scannerChannel) {
    scannerChannel = new ScannerChannel()
  }
  return scannerChannel
}

export function getPreferenceChannel() {
  if (!preferenceChannel) {
    preferenceChannel = new PreferenceChannel()
  }
  return preferenceChannel
}

export function getStoreChannel() {
  if (!storeChannel) {
    storeChannel = new StoreChannel()
  }
  return storeChannel
}

export function getMprisChannel() {
  if (!mprisChannel) {
    mprisChannel = new MprisChannel()
  }
  return mprisChannel
}

export function getSpotifyPlayerChannel() {
  if (!spotifyPlayerChannel) {
    spotifyPlayerChannel = new SpotifyPlayerChannel()
  }
  return spotifyPlayerChannel
}
