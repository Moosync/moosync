/*
 *  background.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

'use strict'

import 'threads/register'

import { WindowHandler, _windowHandler, setIsQuitting } from './utils/main/windowManager'
import { BrowserWindow, app, protocol, session } from 'electron'
import { resolve } from 'path'

import { createFavoritesPlaylist } from './utils/main/db'
import { loadPreferences, setInitialPreferences, shouldWatchFileChanges } from './utils/main/db/preferences'
import { loadSelectiveArrayPreference } from './utils/main/db/preferences'
import { logger } from './utils/main/logger/index'
import { migrateThemes, setupDefaultThemes, setupSystemThemes } from './utils/main/themes/preferences'
import { getExtensionHostChannel, registerIpcChannels } from '@/utils/main/ipc'
import { oauthHandler } from '@/utils/main/oauth/handler'
import { setupScanTask, setupScrapeTask } from '@/utils/main/scheduler/index'
import { setupUpdateCheckTask } from '@/utils/main/scheduler/index'
import { exit } from 'process'
import pie from 'puppeteer-in-electron'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    if (process.argv.includes('--version')) {
      console.log(`Moosync version ${process.env.MOOSYNC_VERSION}`)
      exit(0)
    }

    // Set the path of electron.exe and your app.
    // These two additional parameters are only available on windows.
    // Setting this is required to get this working in dev mode.
    app.setAsDefaultProtocolClient('moosync', process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('moosync')
}

if (process.platform !== 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')
}

const isDevelopment = process.env.NODE_ENV !== 'production'

if (isDevelopment) {
  // process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  // app.commandLine.appendSwitch('ignore-certificate-errors')
  // app.commandLine.appendSwitch('allow-insecure-localhost', 'true')
}

overrideConsole()
_windowHandler.setHardwareAcceleration()
pie.initialize(app)

process.on('uncaughtException', (err) => {
  console.error(err)
})

process.on('unhandledRejection', (err) => {
  console.error(err)
})

if (!app.requestSingleInstanceLock() && !isDevelopment) {
  app.exit()
} else {
  registerProtocols()

  // Quit when all windows are closed.
  app.on('window-all-closed', windowsClosed)
  app.on('activate', activateMac)
  app.addListener('before-quit', beforeQuit)
  app.on('ready', onReady)
  app.on('open-url', openURL)
  app.on('second-instance', handleSecondInstance)
}

function forceAllowCors(headers: Record<string, string[] | undefined | null>) {
  // rome-ignore lint/performance/noDelete: Electron fucks up undefined or null values for some reason
  delete headers['Access-Control-Allow-Origin']
  // rome-ignore lint/performance/noDelete:
  delete headers['access-control-allow-origin']

  return {
    ...headers,
    'Access-Control-Allow-Origin': ['*'],
  }
}

function interceptHttp() {
  // Youtube images don't have a CORS header set [Access-Control-Allow-Origin]
  // So to display them and export them, we spoof the request here
  // This should pose any security risk as such since we're only doing it for youtube trusted urls

  const useInvidious = loadSelectiveArrayPreference<Checkbox>('youtubeAlt.use_invidious')?.enabled ?? false
  const useEmbeds = loadSelectiveArrayPreference<Checkbox>('youtubeOptions.youtube_embeds')?.enabled ?? true

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    let headers = { ...details.responseHeaders }

    if (
      details.url.startsWith('https') &&
      (details.url.startsWith('https://i.ytimg.com') ||
        ((useInvidious || !useEmbeds) && details.url.includes('.googlevideo.com')))
    ) {
      headers = forceAllowCors(headers)
    }

    callback({
      responseHeaders: headers,
    })
  })

  // Since youtube embeds are blocked on custom protocols like file:// or app://
  // We'll load the app on http://localhost
  // Which will then be intercepted here and normal files will be delivered
  // Essentially spoofing window.location.origin to become http://localhost
  WindowHandler.interceptHttp()
}

function windowsClosed() {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
}

function activateMac() {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) _windowHandler.createWindow(true)
}
function beforeQuit() {
  setIsQuitting(true)
}

function openURL(event: Electron.Event, data: string) {
  event.preventDefault()
  oauthHandler.handleEvents(data)
}

async function onReady() {
  const { isFirstLaunch } = loadPreferences()
  if (isFirstLaunch) {
    setupDefaultThemes()
  }

  await setupSystemThemes()

  registerIpcChannels()
  setInitialPreferences()

  await _windowHandler.installExtensions()
  _windowHandler.registerMediaProtocol()
  _windowHandler.registerExtensionProtocol()
  _windowHandler.handleFileOpen()

  createProtocol('moosync')

  interceptHttp()

  createFavoritesPlaylist()
  await migrateThemes()

  await _windowHandler.createWindow(true)

  // Notify extension host of main window creation
  getExtensionHostChannel().onMainWindowCreated()

  // Setup scheduler tasks
  setupScanTask()
  setupUpdateCheckTask()
  setupScrapeTask()
  shouldWatchFileChanges()
}

function registerProtocols() {
  // Scheme must be registered before the app is ready
  protocol.registerSchemesAsPrivileged([
    { scheme: 'moosync', privileges: { secure: true, standard: true } },
    { scheme: 'media', privileges: { corsEnabled: true, supportFetchAPI: true } },
    {
      scheme: 'extension',
      privileges: {
        supportFetchAPI: true,
        stream: true,
      },
    },
  ])
}

if (process.platform === 'win32') {
  process.on('message', async (data) => {
    if (data === 'graceful-exit') {
      await _windowHandler.stopAll()
      app.quit()
    }
  })
}

process.on('SIGTERM', async () => {
  await _windowHandler.stopAll()
  app.quit()
})

process.on('SIGINT', async () => {
  await _windowHandler.stopAll()
  app.quit()
})

/**
 * Parses process.argv to find if app was started by protocol
 * @param argv array of all arguments passed to process
 * @returns array of string which start with app protocol
 */
function findOAuthArg(argv: string[]) {
  return argv?.find((arg) => arg.startsWith('moosync'))
}

function handleSecondInstance(event: Electron.Event, argv: string[]) {
  if (process.platform !== 'darwin') {
    const arg = findOAuthArg(argv)
    if (arg) {
      oauthHandler.handleEvents(arg)
    } else {
      _windowHandler.handleFileOpen(argv)
    }
  }

  if (!isDevelopment) {
    const window = WindowHandler.getWindow()
    if (window && !window.isFocused()) {
      _windowHandler.destroyTray()
      window.show()
    }
  }
}

/**
 * Overrides console with logger
 */
function overrideConsole() {
  console.info = (...args: unknown[]) => {
    logger.info(...args)
  }

  console.error = (...args: unknown[]) => {
    logger.error(...args)
  }

  console.warn = (...args: unknown[]) => {
    logger.warn(...args)
  }

  console.debug = (...args: unknown[]) => {
    logger.debug(...args)
  }

  console.trace = (...args: unknown[]) => {
    logger.trace(...args)
  }
}

export function mainWindowHasMounted() {
  _windowHandler.mainWindowHasMounted()
}
