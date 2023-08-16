/*
 *  songs.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { IpcEvents, SongEvents } from './constants'

import { getSongDB } from '../db'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

export class SongsChannel implements IpcChannelInterface {
  name = IpcEvents.SONG
  handle(event: Electron.IpcMainEvent, request: IpcRequest): void {
    switch (request.type) {
      case SongEvents.STORE_SONG:
        this.storeSongs(event, request as IpcRequest<SongRequests.Songs>)
        break
      case SongEvents.REMOVE_SONG:
        this.removeSongs(event, request as IpcRequest<SongRequests.Songs>)
        break
      case SongEvents.UPDATE_SONG:
        this.updateSong(event, request as IpcRequest<SongRequests.Songs>)
        break
      case SongEvents.UPDATE_ALBUM:
        this.updateAlbum(event, request as IpcRequest<SongRequests.UpdateAlbum>)
        break
      case SongEvents.UPDATE_ARTIST:
        this.updateArtists(event, request as IpcRequest<SongRequests.UpdateArtist>)
        break
      case SongEvents.SAVE_AUDIO_TO_FILE:
        this.saveBufferToFile(event, request as IpcRequest<SongRequests.SaveBuffer>, 'audio')
        break
      case SongEvents.SAVE_IMAGE_TO_FILE:
        this.saveBufferToFile(event, request as IpcRequest<SongRequests.SaveBuffer>, 'image')
        break
      case SongEvents.AUDIO_EXISTS:
        this.fileExists(event, request as IpcRequest<SongRequests.FileExists>, 'audio')
        break
      case SongEvents.IMAGE_EXISTS:
        this.fileExists(event, request as IpcRequest<SongRequests.FileExists>, 'image')
        break
      case SongEvents.UPDATE_LYRICS:
        this.updateLyrics(event, request as IpcRequest<SongRequests.Lyrics>)
        break
      case SongEvents.INCREMENT_PLAY_COUNT:
        this.incrementPlayCount(event, request as IpcRequest<SongRequests.PlayCount>)
        break
      case SongEvents.INCREMENT_PLAY_TIME:
        this.incrementPlayTime(event, request as IpcRequest<SongRequests.PlayTime>)
        break
    }
  }

  private removeSongs(event: Electron.IpcMainEvent, request: IpcRequest<SongRequests.Songs>) {
    const promises: Promise<void>[] = []
    if (request.params.songs) {
      const songs = request.params.songs as Song[]
      promises.push(getSongDB().removeSong(...songs))
    }
    Promise.all(promises)
      .then((data) => {
        event.reply(request.responseChannel, data)
      })
      .catch((e) => {
        console.error(e)
        event.reply(request.responseChannel)
      })
  }

  private async storeSongs(event: Electron.IpcMainEvent, request: IpcRequest<SongRequests.Songs>) {
    const results: (Song | undefined)[] = []
    if (request.params.songs) {
      const songs = request.params.songs
      results.push(...(await getSongDB().store(...songs)))
    }

    event.reply(request.responseChannel, results)
  }

  private async updateSong(event: Electron.IpcMainEvent, request: IpcRequest<SongRequests.Songs>) {
    if (request.params.songs) {
      const songs = request.params.songs as Song[]
      for (const s of songs) {
        await getSongDB().updateSong(s)
      }
    }

    event.reply(request.responseChannel)
  }

  private async updateArtists(event: Electron.IpcMainEvent, request: IpcRequest<SongRequests.UpdateArtist>) {
    await getSongDB().updateArtists(request.params.artist)
    event.reply(request.responseChannel)
  }

  private async updateAlbum(event: Electron.IpcMainEvent, request: IpcRequest<SongRequests.UpdateAlbum>) {
    await getSongDB().updateAlbum(request.params.album)
    event.reply(request.responseChannel)
  }

  private isCacheFileExists(filename: string, cacheDir: string): string {
    const cachePath = path.join(app.getPath('sessionData'), app.getName(), cacheDir)
    const filepath = path.join(cachePath, filename)

    if (fs.existsSync(cachePath)) {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath)
      }
    } else {
      fs.mkdirSync(cachePath, { recursive: true })
    }

    return filepath
  }

  private saveBufferToFile(
    event: Electron.IpcMainEvent,
    request: IpcRequest<SongRequests.SaveBuffer>,
    type: 'audio' | 'image',
  ) {
    if (request.params.path && request.params.blob) {
      const filename = request.params.path
      const filePath = this.isCacheFileExists(filename, type === 'audio' ? 'audioCache' : 'imageCache')

      fs.writeFile(filePath, request.params.blob, () => {
        event.reply(request.responseChannel, filePath)
      })
      return
    }
    event.reply(request.responseChannel)
  }

  private fileExists(
    event: Electron.IpcMainEvent,
    request: IpcRequest<SongRequests.FileExists>,
    type: 'audio' | 'image',
  ) {
    if (request.params.path) {
      const filePath = path.join(
        app.getPath('sessionData'),
        app.getName(),
        type === 'audio' ? 'audioCache' : 'imageCache',
        request.params.path,
      )
      event.reply(request.responseChannel, fs.existsSync(filePath) ? filePath : undefined)
    }
    event.reply(request.responseChannel)
  }

  private updateLyrics(event: Electron.IpcMainEvent, request: IpcRequest<SongRequests.Lyrics>) {
    if (request.params?.lyrics && request.params.id) {
      getSongDB().updateSongLyrics(request.params.id, request.params.lyrics)
    }
    event.reply(request.responseChannel)
  }

  private incrementPlayCount(event: Electron.IpcMainEvent, request: IpcRequest<SongRequests.PlayCount>) {
    if (request.params.song_id) {
      getSongDB().incrementPlayCount(request.params.song_id)
    }
    event.reply(request.responseChannel)
  }

  private incrementPlayTime(event: Electron.IpcMainEvent, request: IpcRequest<SongRequests.PlayTime>) {
    if (request.params.song_id) {
      getSongDB().incrementPlayTime(request.params.song_id, request.params.duration)
    }
    event.reply(request.responseChannel)
  }
}
