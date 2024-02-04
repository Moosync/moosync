/*
 *  lastfm.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import path from 'path'
import { app } from 'electron'
import { CacheHandler } from './cacheFile'

export class LastFMScraper extends CacheHandler {
  constructor() {
    super(path.join(app.getPath('sessionData'), app.getName(), 'lastfm.cache'))
  }

  public async scrapeURL(url: string): Promise<string> {
    return this.get(url)
  }
}
