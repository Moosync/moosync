/*
 *  scanner.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { IpcEvents, ScannerEvents } from './constants'

import { getSongDB } from '@/utils/main/db/index'
import { IpcMainEvent, app } from 'electron'
import fs from 'fs'
import os from 'os'

import { getCombinedMusicPaths, loadPreferences, loadSelectivePreference } from '../db/preferences'
import { setupScanTask } from '../scheduler'
import { WindowHandler } from '../windowManager'
import path from 'path'

import { MetadataFetcher } from '../fetchers/metadata'
import type { Playlist as ScanPlaylist, Song as ScanSong, SongWithLen } from 'scanner-native'
import { v4 } from 'uuid'

enum ScanStatus {
  UNDEFINED = 0,
  SCANNING = 1,
  QUEUED = 2,
}

export class ScannerChannel implements IpcChannelInterface {
  name = IpcEvents.SCANNER
  private scanStatus: ScanStatus = ScanStatus.UNDEFINED
  private scrapeStatus: ScanStatus = ScanStatus.UNDEFINED

  private totalScanFiles = 0
  private currentScanFile = 0

  handle(event: IpcMainEvent, request: IpcRequest) {
    switch (request.type) {
      case ScannerEvents.SCAN_MUSIC:
        this.scanAll(event, request as IpcRequest<ScannerRequests.ScanSongs>)
        break
      case ScannerEvents.SCAN_SINGLE_SONG:
        this.scanSingleSong(event, request as IpcRequest<ScannerRequests.ScanSingleSong>)
        break
      case ScannerEvents.GET_PROGRESS:
        this.getScanProgress(event, request)
        break
      case ScannerEvents.SCAN_SINGLE_PLAYLIST:
        this.scanSinglePlaylist(event, request as IpcRequest<ScannerRequests.ScanSinglePlaylist>)
        break
      case ScannerEvents.RESET_SCAN_TASK:
        this.resetScanTask(event, request)
        break
      case ScannerEvents.GET_RECOMMENDED_CPUS:
        this.getRecommendedCpus(event, request)
        break
    }
  }

  private getRecommendedCpus(event?: IpcMainEvent, request?: IpcRequest) {
    let ret = 0
    if (process.platform === 'win32') {
      ret = Math.max(os.cpus().length - 1, 1)
    } else {
      ret = os.cpus().length
    }

    request && event?.reply(request.responseChannel, ret)
    return ret
  }

  private async getScanProgress(event: IpcMainEvent, request: IpcRequest) {
    event.reply(request.responseChannel, {
      status: this.scanStatus,
      total: this.totalScanFiles,
      current: this.currentScanFile,
    })
  }

  private async destructiveScan(paths: togglePaths) {
    const allSongs = await getSongDB().getSongByOptions()
    const excludePaths = paths.filter((val) => !val.enabled).map((val) => val.path)
    const excludeRegex = new RegExp(excludePaths.length > 0 ? excludePaths.join('|').replaceAll('\\', '\\\\') : /(?!)/)

    const toRemove: Song[] = []
    for (const s of allSongs) {
      if (s.type === 'LOCAL') {
        if (paths.length === 0 || !s.path || s.path?.match(excludeRegex)) {
          toRemove.push(s)
          continue
        }

        try {
          await fs.promises.access(s.path, fs.constants.F_OK)
        } catch (e) {
          toRemove.push(s)
        }
      }
    }

    await getSongDB().removeSong(...toRemove)
    if (toRemove.length === 0) {
      await getSongDB().cleanDb()
    }
  }

  private reportProgress(currentScanIndex: number) {
    this.currentScanFile = currentScanIndex

    WindowHandler.getWindow(false)?.webContents.send(ScannerEvents.PROGRESS_CHANNEL, {
      current: this.currentScanFile,
      total: this.totalScanFiles,
      status: this.scanStatus,
    } as Progress)
  }

  private parseScannedSong(data: ScanSong): Song {
    return {
      ...data,
      _id: v4(),
      date_added: Date.now(),
    } as Song
  }

  private async saveToDb(songs: Song[]) {
    await getSongDB().store(...songs)
  }

  private songList: Song[] = new Proxy<Song[]>([], {
    set: (target, property, value) => {
      target[property as unknown as number] = value
      if (target.length >= 50) {
        this.saveToDb(target.splice(0, target.length))
      }
      return true
    },
  })

  private async storeSong(data: SongWithLen) {
    this.totalScanFiles = data.size
    this.reportProgress(data.current)

    this.songList.push(this.parseScannedSong(data.song))
  }

  private parseScannedPlaylist(data: ScanPlaylist): Playlist {
    return {
      playlist_name: data.title,
      playlist_path: data.path,
      playlist_id: data.id,
    }
  }

  private async storePlaylist(data: ScanPlaylist) {
    await getSongDB().createPlaylist(this.parseScannedPlaylist(data))
  }

  private async scanFilePromisified(paths: string[], forceScan = false, store = false) {
    const splitPattern = loadSelectivePreference<string>('scan_splitter') ?? ';'
    const maxThreads = os.cpus().length
    const thumbPath = loadPreferences().thumbnailPath

    const { scanFiles } = await import('scanner-native')

    const lastValue: { songs: Song[]; playlists: Playlist[] } = { songs: [], playlists: [] }

    for (const p of paths) {
      const promises: Promise<void>[] = []
      await new Promise<typeof lastValue>((resolve) => {
        scanFiles(
          p,
          thumbPath,
          path.join(app.getPath('appData'), app.getName(), 'databases', 'songs.db'),
          splitPattern,
          maxThreads,
          forceScan,
          (err, res) => {
            if (!err) {
              if (store) {
                promises.push(this.storeSong(res))
              } else {
                lastValue.songs.push(this.parseScannedSong(res.song))
              }
            }
          },
          (err, res) => {
            if (!err) {
              if (store) {
                promises.push(this.storePlaylist(res))
              } else {
                lastValue.playlists.push(this.parseScannedPlaylist(res))
              }
            }
          },
          () =>
            Promise.allSettled(promises).then(() => {
              if (store) this.saveToDb(this.songList)
              this.songList = []
              return resolve(lastValue)
            }),
        )
      })
    }

    return lastValue
  }

  public async runScraper() {
    if (this.scrapeStatus !== ScanStatus.UNDEFINED) {
      console.debug('Another scrape job already in progress, setting status to queued')
      this.scrapeStatus = ScanStatus.QUEUED
      return
    }

    this.scrapeStatus = ScanStatus.SCANNING as ScanStatus

    const artists = await getSongDB().getEntityByOptions<Artists>({
      artist: true,
    })
    const fetcher = new MetadataFetcher()
    await fetcher.fetchMBID(artists)

    if (this.scrapeStatus === ScanStatus.QUEUED) {
      await this.runScraper()
    }

    this.scanStatus = ScanStatus.UNDEFINED
  }

  public async scanAll(event?: IpcMainEvent, request?: IpcRequest<ScannerRequests.ScanSongs>): Promise<void> {
    if (this.scanStatus !== ScanStatus.UNDEFINED) {
      console.debug('Another scan already in progress, setting status to queued')
      this.scanStatus = ScanStatus.QUEUED
      return
    }

    const paths = getCombinedMusicPaths() ?? []
    await this.destructiveScan(paths)

    this.scanStatus = ScanStatus.SCANNING as ScanStatus

    await this.scanFilePromisified(
      paths.filter((val) => val.enabled).map((val) => val.path),
      request?.params.forceScan,
      true,
    )

    this.reportProgress(this.totalScanFiles)

    if (this.scanStatus === ScanStatus.QUEUED) {
      return this.scanAll(event, request)
    }

    this.scanStatus = ScanStatus.UNDEFINED
    this.runScraper()

    request && event?.reply(request.responseChannel)
  }

  private async scanSingleSong(event: IpcMainEvent, request: IpcRequest<ScannerRequests.ScanSingleSong>) {
    if (request.params.songPath) {
      const result = await this.scanFilePromisified([request.params.songPath], true, false)
      event.reply(request.responseChannel, { song: result.songs[0] })
    }
  }

  private async scanSinglePlaylist(event: IpcMainEvent, request: IpcRequest<ScannerRequests.ScanSinglePlaylist>) {
    if (request.params.playlistPath) {
      event.reply(request.responseChannel, await this.scanFilePromisified([request.params.playlistPath], true, false))
    }
  }

  private resetScanTask(event: IpcMainEvent, request: IpcRequest) {
    setupScanTask()
    event.reply(request.responseChannel)
  }
}
