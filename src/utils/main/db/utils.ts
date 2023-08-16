/*
 *  utils.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { app } from 'electron'
import path from 'path'

import { loadSelectivePreference } from './preferences'
import { Worker, spawn } from 'threads'
import { WorkerModule } from 'threads/dist/types/worker'

export class DBWorkerWrapper {
  private worker: Unpromise<ReturnType<typeof spawn<WorkerModule<string>>>> | undefined

  constructor(dbPath?: string) {
    this.start(dbPath ?? path.join(app.getPath('appData'), app.getName(), 'databases', 'songs.db'))
  }

  public async start(dbPath: string) {
    this.worker = await spawn(new Worker(`${__dirname}/sqlite3.worker.js`))
    await this.worker.start(app.getPath('logs'), dbPath, loadSelectivePreference('thumbnailPath'))
  }

  public close() {
    if (this.worker) this.worker.close()
  }

  protected async execute(method: string, args: unknown[]) {
    return this.worker?.execute(method, args)
  }
}
