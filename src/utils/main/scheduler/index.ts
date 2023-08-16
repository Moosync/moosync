/*
 *  index.ts is a part of Moosync.
 *
 *  Copyright 2021-2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { AsyncTask, SimpleIntervalJob, ToadScheduler } from 'toad-scheduler'

import { loadSelectivePreference } from '../db/preferences'
import { getScannerChannel, getUpdateChannel } from '@/utils/main/ipc'

const SCAN_TASK_ID = 'scan-task'
const UPDATE_TASK_ID = 'update-task'
const SCRAPE_TASK_ID = 'scrape-task'

let scheduler: ToadScheduler | undefined

function getScheduler() {
  if (!scheduler) {
    scheduler = new ToadScheduler()
  }

  return scheduler
}

export function setupScanTask() {
  const scheduler = getScheduler()

  scheduler.removeById(SCAN_TASK_ID)

  const minutes = loadSelectivePreference<number>('scan_interval') ?? 1 * 60 // 1 hour

  if (minutes < 0) {
    console.info('Disabling scan task')
    return
  }

  const task = new AsyncTask(
    SCAN_TASK_ID,
    () => getScannerChannel().scanAll(),
    (err: Error) => {
      console.error(err)
    },
  )

  console.info('Setting scan task for', minutes, 'minutes')
  const job = new SimpleIntervalJob({ minutes }, task, { id: SCAN_TASK_ID })

  scheduler.addSimpleIntervalJob(job)
}

export function setupUpdateCheckTask() {
  const scheduler = getScheduler()

  const task = new AsyncTask(
    UPDATE_TASK_ID,
    () => getUpdateChannel().checkUpdates(),
    (err: Error) => {
      console.error(err)
    },
  )

  console.info('Setting update check task for 3 hours')
  const job = new SimpleIntervalJob({ hours: 3 }, task, { id: UPDATE_TASK_ID })

  scheduler.addSimpleIntervalJob(job)
}

export function setupScrapeTask() {
  const scheduler = getScheduler()

  const task = new AsyncTask(
    SCRAPE_TASK_ID,
    () => getScannerChannel().runScraper(),
    (err: Error) => {
      console.error(err)
    },
  )

  console.info('Setting scrape task for 30 minutes')
  const job = new SimpleIntervalJob({ minutes: 30 }, task, { id: SCRAPE_TASK_ID })

  scheduler.addSimpleIntervalJob(job)
}
