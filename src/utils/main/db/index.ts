/*
 *  index.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { SongDBInstance } from './database'
import { FAVORITES_PLAYLIST_ID } from '@/utils/commonConstants'

let _songDB: SongDBInstance | undefined

export function getSongDB() {
  if (!_songDB) {
    _songDB = new SongDBInstance()
  }

  return _songDB
}

export async function createFavoritesPlaylist() {
  const isExist = !!(
    await getSongDB().getEntityByOptions<Playlist>({
      playlist: {
        playlist_id: FAVORITES_PLAYLIST_ID,
      },
    })
  )?.[0]

  if (!isExist) {
    await getSongDB().createPlaylist({
      playlist_id: FAVORITES_PLAYLIST_ID,
      playlist_name: 'Favorites',
      playlist_desc: 'Playlist containing your favorite songs',
    })
  }
}
