/*
 *  scanner.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { IpcEvents, ScannerEvents } from './constants'
import { spawn, Worker, Pool, ModuleThread, Thread } from 'threads'

import { IpcMainEvent, app } from 'electron'
import { getSongDB } from '@/utils/main/db/index'
import fs from 'fs'
import { getCombinedMusicPaths, loadPreferences } from '@/utils/main/db/preferences'

import path from 'path'
import { loadSelectivePreference } from '../db/preferences'
import { ObservablePromise } from 'threads/dist/observable-promise'

// @ts-expect-error it don't want .ts
import scannerWorker from 'threads-plugin/dist/loader?name=0!/src/utils/main/workers/scanner.ts'
import { EventEmitter } from 'events'
import { SongDBInstance } from '@/utils/main/db/database'
import { v4 } from 'uuid'
import os from 'os'
import { ipcMain } from 'electron'
import { WindowHandler } from '../windowManager'

const loggerPath = app.getPath('logs')
const audioPatterns = new RegExp('.flac|.mp3|.ogg|.m4a|.webm|.wav|.wv|.aac|.opus', 'i')
const playlistPatterns = new RegExp('.m3u|.m3u8|.wpl')

enum ScanStatus {
  UNDEFINED,
  SCANNING,
  QUEUED
}

export class ScannerChannel implements IpcChannelInterface {
  name = IpcEvents.SCANNER
  private scanStatus: ScanStatus = ScanStatus.UNDEFINED

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
    }
  }

  private async getScanProgress(event: IpcMainEvent, request: IpcRequest) {
    event.reply(request.responseChannel, {
      status: this.scanStatus,
      total: this.totalScanFiles,
      current: this.currentScanFile
    })
  }

  private async destructiveScan(paths: togglePaths) {
    const allSongs = getSongDB().getSongByOptions()
    const excludePaths = paths.filter((val) => !val.enabled).map((val) => val.path)
    const excludeRegex = new RegExp(excludePaths.length > 0 ? excludePaths.join('|').replaceAll('\\', '\\\\') : /(?!)/)

    const toRemove: Song[] = []
    for (const s of allSongs) {
      if (s.type == 'LOCAL') {
        if (paths.length == 0 || !s.path || s.path?.match(excludeRegex)) {
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

  private async getAllFiles(p: string, excludeRegex: RegExp) {
    const allFiles: { path: string; type: 'PLAYLIST' | 'SONG' }[] = []
    if (fs.existsSync(p)) {
      const files = await fs.promises.readdir(p)
      for (const file of files) {
        const filePath = path.resolve(path.join(p, file))
        if (!filePath.match(excludeRegex)) {
          if ((await fs.promises.stat(filePath)).isDirectory()) {
            allFiles.push(...(await this.getAllFiles(filePath, excludeRegex)))
          } else {
            let type: 'PLAYLIST' | 'SONG' | undefined = undefined

            if (audioPatterns.exec(path.extname(file).toLowerCase())) {
              type = 'SONG'
            }

            if (playlistPatterns.exec(path.extname(file).toLowerCase())) {
              type = 'PLAYLIST'
            }

            if (type) {
              allFiles.push({ path: filePath, type })
            }
          }
        }
      }
    }
    return allFiles
  }

  private promisifyWorker<T>(obs: ObservablePromise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let ret: T | undefined = undefined
      obs.subscribe(
        (data) => (ret = data as T),
        reject,
        () => resolve(ret as T)
      )
    })
  }

  private async isDuplicate(scanned: Song, scanner: ModuleThread<ScanWorkerWorkerType>) {
    if (scanned.path) {
      const songDb = getSongDB()
      const existingByPath = songDb.getSongByOptions({
        song: {
          path: scanned.path
        }
      })

      if (existingByPath.length > 0) {
        return true
      }

      const existingByINode = songDb.getSongByOptions({
        song: {
          inode: scanned.inode,
          deviceno: scanned.deviceno
        },
        inclusive: true
      })

      if (existingByINode.length > 0) {
        return true
      }

      const existingBySize = songDb.getSongByOptions({
        song: {
          size: scanned.size
        }
      })

      if (existingBySize.length > 0) {
        const scannedHash = await this.promisifyWorker(scanner.getHash(scanned.path, loggerPath))
        scanned.hash = scannedHash

        for (const e of existingBySize) {
          if (e.path) {
            const existingHash = e.hash || (await this.promisifyWorker(scanner.getHash(e.path, loggerPath)))

            songDb.updateSong({
              ...e,
              hash: existingHash
            })

            if (scannedHash === existingHash) {
              return true
            }
          }
        }
      }
    }

    return false
  }

  private async checkDuplicateAndStore(
    scanWorker: ModuleThread<ScanWorkerWorkerType>,
    song: Song,
    songDb: SongDBInstance,
    scanEmitter: EventEmitter
  ) {
    const isDuplicate = await this.isDuplicate(song, scanWorker)
    if (isDuplicate) {
      return
    }
    console.debug('storing', song)
    songDb.store(song)
    scanEmitter.emit('song', song)
  }

  private async scanSong(
    scanWorker: ModuleThread<ScanWorkerWorkerType>,
    songDb: SongDBInstance,
    path: string,
    splitPattern: string,
    scanEmitter: EventEmitter
  ) {
    try {
      const scanned = await this.promisifyWorker(scanWorker.scanSingleSong(path, splitPattern, loggerPath))
      await this.checkDuplicateAndStore(scanWorker, scanned.song, songDb, scanEmitter)
    } catch (e) {
      console.error('Scanner error:', e)
    }
  }

  private async storeCover(
    coverWorker: ModuleThread<ScanWorkerWorkerType>,
    song: Song,
    basePath: string,
    songDb: SongDBInstance
  ) {
    const cover = await this.promisifyWorker(
      coverWorker.getCover(song.path ?? '', basePath, song._id, false, loggerPath)
    )

    console.debug('Saved cover for', song.title, 'at', cover)

    songDb.updateSong({
      ...song,
      song_coverPath_high: cover?.high,
      song_coverPath_low: cover?.low,
      album: {
        ...song.album,
        album_coverPath_high: cover?.high,
        album_coverPath_low: cover?.low
      }
    })
  }

  private reportProgress(currentScanIndex: number) {
    this.currentScanFile = currentScanIndex

    WindowHandler.getWindow(false)?.webContents.send(ScannerEvents.PROGRESS_CHANNEL, {
      current: this.currentScanFile,
      total: this.totalScanFiles,
      status: this.scanStatus
    } as Progress)
  }

  public async scanAll(event?: IpcMainEvent, request?: IpcRequest<ScannerRequests.ScanSongs>) {
    if (this.scanStatus !== ScanStatus.UNDEFINED) {
      return
    }

    this.scanStatus = ScanStatus.SCANNING as ScanStatus

    const paths = getCombinedMusicPaths() ?? []
    await this.destructiveScan(paths)

    const splitPattern = loadSelectivePreference<string>('scan_splitter') ?? ';'

    const excludePaths = paths.filter((val) => !val.enabled)
    const excludeRegex = new RegExp(
      excludePaths.length > 0
        ? excludePaths
            .map((val) => val.path)
            .join('|')
            .replaceAll('\\', '\\\\')
        : /(?!)/
    )

    const allFiles: { path: string; type: 'PLAYLIST' | 'SONG' }[] = []
    for (const p of paths) {
      allFiles.push(...(await this.getAllFiles(p.path, excludeRegex)))
    }

    const existingFiles = getSongDB().getAllPaths()
    const newFiles = allFiles.filter((x) => !existingFiles.includes(x.path))

    const songDb = getSongDB()
    const scannerPool = Pool(() => spawn<ScanWorkerWorkerType>(new Worker(scannerWorker)), {
      concurrency: 2
    })

    const coverPool = Pool(() => spawn<ScanWorkerWorkerType>(new Worker(scannerWorker)), {
      concurrency: 2
    })

    const thumbPath = loadPreferences().thumbnailPath
    await this.createDirIfNotExists(thumbPath)

    const scanEmitter = new EventEmitter()
    scanEmitter.setMaxListeners(os.cpus().length + 2)

    scanEmitter.on('song', async (song: Song) => {
      if (song.path) {
        coverPool.queue(async (worker) => this.storeCover(worker, song, thumbPath, songDb))
      }
    })

    this.totalScanFiles = newFiles.length

    let index = 0
    for (const f of newFiles.filter((val) => val.type === 'SONG')) {
      scannerPool.queue((worker) => {
        index++
        this.reportProgress(index)
        return this.scanSong(worker, songDb, f.path, splitPattern, scanEmitter)
      })
    }

    for (const f of newFiles.filter((val) => val.type === 'PLAYLIST')) {
      scannerPool.queue(async (worker) => {
        const scanned = await this.promisifyWorker(worker.scanSinglePlaylist(f.path, splitPattern, loggerPath))

        if (scanned.songs.length > 0) {
          const existing = getSongDB().getPlaylistByPath(scanned.filePath)[0]

          let id = existing?.playlist_id
          if (!id) {
            id = songDb.createPlaylist({
              playlist_name: scanned.title,
              playlist_path: scanned.filePath
            })
          }

          for (const song of scanned.songs) {
            await this.checkDuplicateAndStore(worker, song, songDb, scanEmitter)
            songDb.addToPlaylist(id, song)
          }
        }
      })
    }

    console.log('waiting for settle')
    await scannerPool.settled(true)

    console.log('scanner settled')

    console.log('settled')
    await scannerPool.terminate()

    console.log('reporting progress', newFiles.length, this.totalScanFiles)
    this.reportProgress(newFiles.length)

    event?.reply(request?.responseChannel)

    if (this.scanStatus === ScanStatus.QUEUED) {
      this.scanStatus = ScanStatus.UNDEFINED
      ipcMain.emit(IpcEvents.SCANNER, request)
    } else {
      this.scanStatus = ScanStatus.UNDEFINED
    }
  }

  private async createDirIfNotExists(thumbPath: string) {
    try {
      await fs.promises.access(thumbPath)
    } catch (e) {
      await fs.promises.mkdir(thumbPath, { recursive: true })
    }
  }

  private async scanSingleSong(event: IpcMainEvent, request: IpcRequest<ScannerRequests.ScanSingleSong>) {
    if (request.params.songPath) {
      const splitPattern = loadSelectivePreference<string>('scan_splitter') ?? ';'
      const scanner = await spawn<ScanWorkerWorkerType>(new Worker(scannerWorker))
      const scanned = await this.promisifyWorker(
        scanner.scanSingleSong(request.params.songPath, splitPattern, loggerPath)
      )

      if (scanned.song?.path) {
        const thumbPath = loadPreferences().thumbnailPath
        await this.createDirIfNotExists(thumbPath)

        const cover = await this.promisifyWorker(
          scanner.getCover(scanned.song.path, thumbPath, scanned.song._id, false, loggerPath)
        )
        scanned.song.song_coverPath_high = cover?.high
        scanned.song.song_coverPath_low = cover?.low
      }
      event?.reply(request?.responseChannel, scanned)
      await Thread.terminate(scanner)
    }
  }

  private async scanSinglePlaylist(event: IpcMainEvent, request: IpcRequest<ScannerRequests.ScanSinglePlaylist>) {
    if (request.params.playlistPath) {
      const splitPattern = loadSelectivePreference<string>('scan_splitter') ?? ';'
      const scanner = await spawn<ScanWorkerWorkerType>(new Worker(scannerWorker))
      const scanned = await this.promisifyWorker(
        scanner.scanSinglePlaylist(request.params.playlistPath, splitPattern, loggerPath)
      )

      const thumbPath = loadPreferences().thumbnailPath
      await this.createDirIfNotExists(thumbPath)

      let playlist = getSongDB().getPlaylistByPath(scanned.filePath)[0]
      if (!playlist) {
        playlist = {
          playlist_id: v4(),
          playlist_name: scanned.title,
          playlist_path: scanned.filePath
        }
      }

      const scannerPool = Pool(() => spawn<ScanWorkerWorkerType>(new Worker(scannerWorker)), {
        concurrency: 2
      })
      for (const song of scanned.songs) {
        if (song.path) {
          scannerPool.queue(async (worker) => {
            const cover = await worker.getCover(song.path ?? '', thumbPath, song._id, false, loggerPath)
            song.song_coverPath_high = cover?.high
            song.song_coverPath_low = cover?.low
          })
        }
      }

      await scannerPool.completed(true)
      await scannerPool.terminate()

      event.reply(request.responseChannel, scanned)
    }
  }
}
