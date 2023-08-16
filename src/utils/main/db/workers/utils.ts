import { prefixLogger } from '../../logger/utils'
import { migrations } from '../migrations'
import { isEmpty } from '@/utils/common'
import DB, { BetterSqlite3Helper } from 'better-sqlite3-helper'
import log, { getLogger, levels } from 'loglevel'
import { v1 } from 'uuid'

export class DBUtils {
  protected db: BetterSqlite3Helper.DBInstance
  protected thumbnailPath: string

  private logger: log.Logger

  constructor(dbPath: string, thumbnailPath: string, loggerPath: string) {
    this.logger = getLogger(`Sqlite3Worker (${v1()})`)
    this.logger.setLevel(process.env.DEBUG_LOGGING ? levels.DEBUG : levels.INFO)
    prefixLogger(loggerPath, this.logger)

    const options: Record<string, unknown> = {
      path: dbPath,
      readonly: false,
      fileMustExist: false,
      WAL: true,
      migrate: {
        migrations: migrations,
      },
    }

    if (process.env.DEBUG_LOGGING) {
      options['verbose'] = (...args: unknown[]) => this.logger.debug('Executing query', ...args)
    }

    this.db = DB(options)
    this.registerRegexp()

    this.thumbnailPath = thumbnailPath
  }

  close() {
    if (this.db?.open) {
      this.db.close()
    }
  }

  private registerRegexp() {
    this.db.function('regexp', (pattern: string, str: string) => {
      if (str != null) {
        return str.match(new RegExp(pattern, 'i')) ? 1 : 0
      }
      return 0
    })
  }

  private parseArtists(artistStr: string) {
    const artists = artistStr.split(',')
    const ret: Artists[] = []
    for (const a of artists) {
      const split = a.split(';')
      if (split.length !== 4) {
        console.error('invalid artist info')
        continue
      }

      ret.push({
        artist_id: split[0],
        artist_name: Buffer.from(split[1], 'hex').toString('utf8'),
        artist_coverPath: Buffer.from(split[2], 'hex').toString('utf8'),
        artist_extra_info: JSON.parse(Buffer.from(split[3], 'hex').toString('utf8') || '{}'),
      })
    }

    return ret
  }

  protected unMarshalSong(dbSong: marshaledSong): Song {
    return {
      _id: dbSong._id,
      path: dbSong.path,
      size: dbSong.size,
      title: dbSong.title,
      song_coverPath_high: dbSong.song_coverPath_high,
      song_coverPath_low: dbSong.song_coverPath_low,
      album: {
        album_id: dbSong.album_id,
        album_name: dbSong.album_name,
        album_coverPath_high: dbSong.album_coverPath_high,
        album_coverPath_low: dbSong.album_coverPath_low,
        album_song_count: dbSong.album_song_count,
        album_extra_info: JSON.parse(dbSong.album_extra_info ?? '{}'),
        album_artist: dbSong.album_artist,
        year: dbSong.album_year,
      },
      date: dbSong.date,
      year: dbSong.year,
      artists: (dbSong.artists && this.parseArtists(dbSong.artists)) || [],
      genre: dbSong.genre_name ? dbSong.genre_name.split(',') : [],
      lyrics: dbSong.lyrics,
      releaseType: undefined,
      bitrate: dbSong.bitrate,
      codec: dbSong.codec,
      container: dbSong.container,
      duration: dbSong.duration,
      sampleRate: dbSong.sampleRate,
      hash: dbSong.hash,
      inode: dbSong.inode,
      deviceno: dbSong.deviceno,
      type: dbSong.type,
      url: dbSong.url,
      icon: dbSong.icon,
      date_added: dbSong.date_added,
      playbackUrl: dbSong.playbackUrl,
      providerExtension: dbSong.provider_extension,
      playCount: dbSong.play_count ?? 0,
      track_no: dbSong.track_no,
      showInLibrary: !!dbSong.show_in_library,
    }
  }

  protected marshalSong(song: Partial<Song>): marshaledSong {
    if (!song._id) {
      throw new Error('song _id cannot be null')
    }

    return {
      _id: song._id,
      path: song.path?.trim(),
      size: song.size,
      title: song.title?.trim() ?? '',
      song_coverPath_high: song.song_coverPath_high?.trim(),
      song_coverPath_low: song.song_coverPath_low?.trim(),
      date: song.date,
      year: song.year,
      lyrics: song.lyrics,
      bitrate: song.bitrate,
      codec: song.codec,
      container: song.container,
      duration: song.duration ?? 0,
      sampleRate: song.sampleRate,
      hash: song.hash?.trim(),
      inode: song.inode,
      deviceno: song.deviceno,
      type: song.type ?? 'URL',
      url: song.url?.trim(),
      playbackUrl: song.playbackUrl?.trim(),
      date_added: Date.now(),
      icon: song.icon,
      track_no: song.track_no,
      provider_extension: song.providerExtension,
      show_in_library: isEmpty(song.showInLibrary) || song.showInLibrary ? 1 : 0,
    }
  }

  protected batchUnmarshal(marshaled: marshaledSong[]) {
    const unmarshaled: Song[] = []
    for (const m of marshaled) {
      const um = this.unMarshalSong(m)
      unmarshaled.push(um)
    }
    return unmarshaled
  }

  protected addExcludeWhereClause(where: boolean, exclude?: string[]): string {
    return exclude && exclude.length > 0
      ? `${where ? 'WHERE' : 'AND '} allsongs.path NOT REGEXP '${exclude.join('|').replaceAll('\\', '\\\\')}'`
      : ''
  }

  private leftJoinSongs(bridgeTable?: string, exclude_table?: string) {
    if (exclude_table !== 'allsongs') {
      return ` LEFT JOIN allsongs ON ${bridgeTable}.song = allsongs._id`
    }
    return ''
  }

  private leftJoinAlbums(exclude_table?: string) {
    if (exclude_table !== 'album') {
      return ' LEFT JOIN album_bridge ON allsongs._id = album_bridge.song'
    }
    return ''
  }

  private leftJoinArtists(exclude_table?: string) {
    if (exclude_table !== 'artists') {
      return ' LEFT JOIN artist_bridge ON allsongs._id = artist_bridge.song'
    }
    return ''
  }

  private leftJoinGenre(exclude_table?: string) {
    if (exclude_table !== 'genres') {
      return ' LEFT JOIN genre_bridge ON allsongs._id = genre_bridge.song'
    }
    return ''
  }

  private leftJoinPLaylists(exclude_table?: string) {
    if (exclude_table !== 'playlists') {
      return ' LEFT JOIN playlist_bridge ON allsongs._id = playlist_bridge.song'
    }
    return ''
  }

  private leftJoinAnalytics(exclude_table?: string) {
    if (exclude_table !== 'analytics') {
      return ' LEFT JOIN analytics ON allsongs._id = analytics.song_id'
    }
    return ''
  }

  private leftJoinCommon(tableName: string, rowName: string, bridgeTable?: string) {
    return ` LEFT JOIN ${tableName} ON ${bridgeTable}.${rowName} = ${tableName}.${rowName}_id`
  }

  protected addLeftJoinClause(bridgeTable?: string, exclude_table?: 'album' | 'artists' | 'genres' | 'allsongs') {
    return (
      this.leftJoinSongs(bridgeTable, exclude_table) +
      this.leftJoinAlbums(exclude_table) +
      this.leftJoinArtists(exclude_table) +
      this.leftJoinGenre(exclude_table) +
      this.leftJoinPLaylists(exclude_table) +
      this.leftJoinAnalytics(exclude_table) +
      this.leftJoinCommon('albums', 'album', 'album_bridge') +
      this.leftJoinCommon('artists', 'artist', 'artist_bridge') +
      this.leftJoinCommon('genres', 'genre', 'genre_bridge') +
      this.leftJoinCommon('playlists', 'playlist', 'playlist_bridge')
    )
  }

  protected addGroupConcatClause() {
    return `group_concat(artist_id || ';' || hex(artist_name) || ';' || hex(artist_coverPath) || ';' || hex(artist_extra_info)) as artists, group_concat(genre_name) as genre_name`
  }

  protected getSelectClause() {
    return 'allsongs._id, allsongs.path, allsongs.size, allsongs.inode, allsongs.deviceno, allsongs.title, allsongs.song_coverPath_high, allsongs.song_coverPath_low, allsongs.date, allsongs.date_added, allsongs.year, allsongs.lyrics, allsongs.bitrate, allsongs.codec, allsongs.container, allsongs.duration, allsongs.sampleRate, allsongs.hash, allsongs.type, allsongs.url, allsongs.icon, allsongs.playbackUrl, allsongs.provider_extension, allsongs.show_in_library, allsongs.track_no, albums.album_id, albums.album_name, albums.album_coverPath_high, albums.album_coverPath_low, albums.album_song_count, albums.year as album_year, albums.album_extra_info, albums.album_artist, analytics.play_count'
  }
}
