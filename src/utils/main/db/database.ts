/*
 *  database.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { getExtensionHostChannel } from '../ipc'
import { DBWorkerWrapper } from './utils'

interface GenericDBInstance {
  store(...songsToAdd: Song[]): Promise<Song[]>
  removeSong(...songs: Song[]): Promise<void>
  updateSong(song: Song, skipChecks?: boolean): Promise<void>
  searchAll(term: string, exclude?: string[]): Promise<SearchResult>
  getSongByOptions(options?: SongAPIOptions, exclude?: string[]): Promise<Song[]>
  getEntityByOptions<T extends Artists | Album | Genre | Playlist>(options: EntityApiOptions<T>): Promise<T[]>
  updateSongLyrics(id: string, lyrics: string): Promise<void>
  updateAlbum(album: Album): Promise<void>
  updateAlbumExtraInfo(id: string, info: Album['album_extra_info'], extension?: string): Promise<void>
  updateArtists(artist: Artists): Promise<void>
  updateArtistExtraInfo(id: string, info: Artists['artist_extra_info'], extension?: string): Promise<void>
  createPlaylist(playlist: Partial<Playlist>): Promise<string>
  updatePlaylist(playlist: Partial<Playlist>): Promise<void>
  addToPlaylist(playlist_id: string, ...songs: Song[]): Promise<void>
  removeFromPlaylist(playlist: string, ...songs: Song[]): Promise<void>
  removePlaylist(...playlists: Playlist[]): Promise<void>
  incrementPlayCount(song_id: string): Promise<void>
  getPlayCount(...song_id: string[]): Promise<Record<string, { playCount: number; playTime: number }>>
  incrementPlayTime(song_id: string, duration: number): Promise<void>
  cleanDb(): Promise<void>
}

export class SongDBInstance extends DBWorkerWrapper implements GenericDBInstance {
  async store(...songsToAdd: Song[]): Promise<Song[]> {
    const resp = await this.execute('store', songsToAdd)
    resp && this.notifyExtensionHostSongChanged(true, resp)
    return resp
  }

  async removeSong(...songs: Song[]): Promise<void> {
    await this.execute('removeSong', songs)
    this.notifyExtensionHostSongChanged(false, songs)
  }

  updateSong(song: Song, skipChecks?: boolean | undefined): Promise<void> {
    return this.execute('updateSong', [song, skipChecks])
  }

  searchAll(term: string, exclude?: string[] | undefined): Promise<SearchResult> {
    return this.execute('searchAll', [term, exclude])
  }

  getSongByOptions(options?: SongAPIOptions | undefined, exclude?: string[] | undefined): Promise<Song[]> {
    return this.execute('getSongByOptions', [options, exclude])
  }

  getEntityByOptions<T extends Artists | Album | Genre | Playlist>(options: EntityApiOptions<T>): Promise<T[]> {
    return this.execute('getEntityByOptions', [options])
  }

  updateSongLyrics(id: string, lyrics: string): Promise<void> {
    return this.execute('updateSongLyrics', [id, lyrics])
  }

  updateAlbum(album: Album): Promise<void> {
    return this.execute('updateAlbum', [album])
  }

  updateAlbumExtraInfo(
    id: string,
    info:
      | {
          spotify?: { album_id?: string | undefined } | undefined
          youtube?: { album_id?: string | undefined } | undefined
          extensions?: Record<string, Record<string, string | undefined> | undefined> | undefined
        }
      | undefined,
    extension?: string | undefined,
  ): Promise<void> {
    return this.execute('updateAlbumExtraInfo', [id, info, extension])
  }

  updateArtists(artist: Artists): Promise<void> {
    return this.execute('updateArtists', [artist])
  }

  updateArtistExtraInfo(
    id: string,
    info:
      | {
          youtube?: { channel_id?: string | undefined } | undefined
          spotify?: { artist_id?: string | undefined } | undefined
          extensions?: Record<string, Record<string, string | undefined> | undefined> | undefined
        }
      | undefined,
    extension?: string | undefined,
  ): Promise<void> {
    return this.execute('updateArtistExtraInfo', [id, info, extension])
  }

  async createPlaylist(playlist: Partial<Playlist>): Promise<string> {
    const resp = await this.execute('createPlaylist', [playlist])
    resp && this.notifyExtensionHostPlaylistChanged(true, [resp])
    return resp
  }

  updatePlaylist(playlist: Partial<Playlist>): Promise<void> {
    return this.execute('updatePlaylist', [playlist])
  }

  addToPlaylist(playlist_id: string, ...songs: Song[]): Promise<void> {
    return this.execute('addToPlaylist', [playlist_id, ...songs])
  }

  removeFromPlaylist(playlist: string, ...songs: Song[]): Promise<void> {
    return this.execute('removeFromPlaylist', [playlist, ...songs])
  }

  async removePlaylist(...playlists: Playlist[]): Promise<void> {
    await this.execute('removePlaylist', playlists)
    this.notifyExtensionHostPlaylistChanged(false, playlists)
  }
  incrementPlayCount(song_id: string): Promise<void> {
    return this.execute('incrementPlayCount', [song_id])
  }

  getPlayCount(...song_id: string[]): Promise<Record<string, { playCount: number; playTime: number }>> {
    return this.execute('getPlayCount', song_id)
  }

  incrementPlayTime(song_id: string, duration: number): Promise<void> {
    return this.execute('incrementPlayTime', [song_id, duration])
  }

  cleanDb(): Promise<void> {
    return this.execute('cleanDb', [])
  }

  private notifyExtensionHostSongChanged(added: boolean, songs: Song[]) {
    if (songs.length > 0) {
      getExtensionHostChannel().sendExtraEvent({
        type: added ? 'songAdded' : 'songRemoved',
        data: [songs],
      })
    }
  }

  private notifyExtensionHostPlaylistChanged(added: boolean, playlist: Playlist[]) {
    if (playlist.length > 0) {
      getExtensionHostChannel().sendExtraEvent({
        type: added ? 'playlistAdded' : 'playlistRemoved',
        data: [playlist],
      })
    }
  }
}
