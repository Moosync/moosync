/*
 *  windowManager.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { getWindowSize, loadPreferences, setWindowSize } from './db/preferences'
import { SongEvents, WindowEvents } from './ipc/constants'
import {
  BrowserWindow,
  Menu,
  ThumbarButton,
  Tray,
  app,
  dialog,
  nativeImage,
  net,
  protocol,
  session,
  shell,
  webFrameMain,
} from 'electron'

import { getSongDB } from './db/index'
import { getExtensionHostChannel } from './ipc'
import { getMprisChannel, getSpotifyPlayerChannel } from './ipc/index'
import { logger } from './logger'
import { getActiveTheme } from './themes/preferences'
import { nativeTheme } from 'electron'
import { access, readFile } from 'fs/promises'
import { ButtonEnum, PlayerButtons } from 'media-controller'
import path from 'path'
import puppeteer from 'puppeteer-core'
import pie from 'puppeteer-in-electron'
import { Readable } from 'stream'

export class WindowHandler {
  private static mainWindow: number
  private static preferenceWindow: number

  private trayHandler = new TrayHandler()
  private isDevelopment = process.env.NODE_ENV !== 'production'
  private _isMainWindowMounted = false
  private pathQueue: string[] = []

  public static getWindow(mainWindow = true): BrowserWindow | null {
    if (mainWindow && this.mainWindow !== undefined) return BrowserWindow.fromId(this.mainWindow)

    if (!mainWindow && this.preferenceWindow !== undefined) {
      return BrowserWindow.fromId(this.preferenceWindow)
    }

    return null
  }

  public static get hasFrame() {
    return process.platform === 'linux' || process.platform === 'darwin'
  }

  public static get showTitlebarIcons() {
    return !this.hasFrame
  }

  private async getWindowBackgroundColor() {
    return (await getActiveTheme())?.theme.primary ?? '#212121'
  }

  private async getBaseWindowProps(): Promise<Electron.BrowserWindowConstructorOptions> {
    return {
      backgroundColor: await this.getWindowBackgroundColor(),
      titleBarStyle: WindowHandler.hasFrame ? 'default' : 'hidden',
      frame: WindowHandler.hasFrame,
      show: false,
      icon: path.join(__static, 'logo.png'),
      webPreferences: {
        devTools: true,
        contextIsolation: true,
        // Use pluginOptions.nodeIntegration, leave this alone
        // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration for more info
        nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
        preload: path.join(__dirname, 'preload.js'),
      },
    }
  }

  private async getMainWindowProps(): Promise<Electron.BrowserWindowConstructorOptions> {
    return {
      title: 'Moosync',
      ...getWindowSize('mainWindow', { width: 1016, height: 653 }),
      minHeight: 400,
      minWidth: 300,
      ...(await this.getBaseWindowProps()),
    }
  }

  private async getPrefWindowProps(): Promise<Electron.BrowserWindowConstructorOptions> {
    return {
      title: 'Preferences',
      ...getWindowSize('prefWindow', { width: 840, height: 653 }),
      minHeight: 672,
      minWidth: 840,
      ...(await this.getBaseWindowProps()),
    }
  }

  public async installExtensions() {
    // Do nothing here
  }

  public setHardwareAcceleration() {
    const enabled = loadPreferences().system?.find((val) => val.key === 'hardwareAcceleration')?.enabled
    if (enabled === false) {
      console.debug('Disabling hardware acceleration')
      app.disableHardwareAcceleration()
    }
  }

  public setZoom(window?: BrowserWindow) {
    let zoom = parseInt(loadPreferences()?.zoomFactor?.replace('%', '') ?? 100) / 100
    if (isNaN(zoom)) {
      zoom = 0.5
    }
    const value = Math.min(Math.max(0.5, zoom), 1.6)

    const windows = window ? [window] : BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.setZoomFactor(value)
    }
  }

  public async restartApp() {
    await this.stopAll()
    app.relaunch()
    app.quit()
  }

  public registerMediaProtocol() {
    const protocolName = 'media'
    protocol.registerFileProtocol(protocolName, (request, callback) => {
      const url = request.url.replace(`${protocolName}://`, '')
      try {
        return callback(decodeURIComponent(url))
      } catch (error) {
        console.error(error)
      }
    })
  }

  private forwardRedirectStream(
    redirectUrl: string,
    requestHeaders: Record<string, string>,
    method: string,
    callback: (response: Electron.ProtocolResponse | NodeJS.ReadableStream) => void,
  ) {
    try {
      const req = net.request(redirectUrl)
      for (const [key, val] of Object.entries(requestHeaders)) {
        req.setHeader(key, val)
      }

      req.on('response', (res) => {
        callback({
          headers: res.headers,
          statusCode: res.statusCode,
          mimeType: res.headers['content-type'] as string,
          data: res as unknown as NodeJS.ReadableStream,
        })
      })

      req.end()
    } catch (e) {
      console.error('Failed to forward redirect stream', e)
    }
  }

  public registerExtensionProtocol() {
    protocol.registerStreamProtocol('extension', async (request, callback) => {
      const extensionPackageName = new URL(request.url).hostname
      if (extensionPackageName) {
        const extensionHost = getExtensionHostChannel()
        const data = await extensionHost.sendExtraEvent({
          type: 'customRequest',
          data: [request.url],
          packageName: extensionPackageName,
        })

        if (data[extensionPackageName]) {
          const redirectUrl = (data[extensionPackageName] as CustomRequestReturnType).redirectUrl
          if (redirectUrl) {
            this.forwardRedirectStream(redirectUrl, request.headers, request.method, callback)
            return
          }

          const respData = (data[extensionPackageName] as CustomRequestReturnType).data
          const mimeType = (data[extensionPackageName] as CustomRequestReturnType).mimeType

          if (respData && mimeType) {
            callback({
              statusCode: 200,
              headers: {
                'content-type': mimeType,
              },
              data: Readable.from(Buffer.from(respData)),
            })
          }
        }
      }
    })
  }

  public handleFileOpen(argv: string[] = process.argv) {
    const parsedArgv = argv
      .filter((val) => !val.startsWith('-') && !val.startsWith('--'))
      .slice(this.isDevelopment ? 2 : 1)
    if (this._isMainWindowMounted) {
      this.sendToMainWindow(SongEvents.GOT_FILE_PATH, parsedArgv)
    } else {
      this.pathQueue.push(...parsedArgv)
    }
  }

  public mainWindowHasMounted() {
    this._isMainWindowMounted = true
    this.sendToMainWindow(SongEvents.GOT_FILE_PATH, this.pathQueue)
  }

  static interceptHttp() {
    if (!process.env.WEBPACK_DEV_SERVER_URL) {
      session.defaultSession.protocol.interceptFileProtocol('http', async (request, callback) => {
        const parsedUrl = new URL(request.url)
        const pathName = decodeURI(parsedUrl.pathname)
        const filePath = path.join(__dirname, pathName)

        // deregister intercept after we handle index.html
        if (request.url.includes('index.html')) {
          session.defaultSession.protocol.uninterceptProtocol('http')
        }

        try {
          callback(filePath)
        } catch (e) {
          logger.error(e)
        }
      })
    }
  }

  private getWindowURL(isMainWindow: boolean) {
    let url = ''

    if (process.env.WEBPACK_DEV_SERVER_URL)
      url = process.env.WEBPACK_DEV_SERVER_URL + (isMainWindow ? '' : 'preferenceWindow')
    else url = isMainWindow ? 'http://localhost/./index.html' : 'moosync://./preferenceWindow.html'

    return url
  }

  public destroyTray() {
    this.trayHandler.destroy()
  }

  public sendToMainWindow(channel: string, arg: unknown) {
    WindowHandler.getWindow()?.webContents.send(channel, arg)
  }

  public async createWindow(isMainWindow = true, args?: unknown) {
    let win: BrowserWindow | undefined | null
    if (!WindowHandler.getWindow(isMainWindow) || WindowHandler.getWindow(isMainWindow)?.isDestroyed()) {
      win = new BrowserWindow(await (isMainWindow ? this.getMainWindowProps() : this.getPrefWindowProps()))
      this.attachWindowEvents(win, isMainWindow)

      win.loadURL(this.getWindowURL(isMainWindow))

      win.removeMenu()
      Menu.setApplicationMenu(null)

      if (this.isDevelopment) win.webContents.openDevTools()

      if (isMainWindow) WindowHandler.mainWindow = win.id
      else WindowHandler.preferenceWindow = win.id
    } else {
      console.info('Window already exists, focusing')
      win = WindowHandler.getWindow(isMainWindow)
      if (win) win.focus()
      else console.warn('Cant find existing window')
    }

    if (isMainWindow) {
      this.trayHandler.createTray()
    }

    win?.webContents.on('did-finish-load', () => win?.webContents.send(WindowEvents.GOT_EXTRA_ARGS, args))
  }

  private async handleWindowClose(event: Electron.Event, window: BrowserWindow, isMainWindow: boolean) {
    if (window.webContents.isDevToolsOpened()) {
      window.webContents.closeDevTools()
    }

    const [width, height] = window.getSize()
    setWindowSize(isMainWindow ? 'mainWindow' : 'prefWindow', { width, height })

    if (isMainWindow) {
      if (!AppExitHandler._isQuitting && AppExitHandler._minimizeToTray) {
        event.preventDefault()
        window.hide()
      } else {
        this.stopAll()
        app.quit()
      }
    }
  }

  public async stopAll() {
    getSpotifyPlayerChannel().closePlayer()
    // Stop extension Host
    await getExtensionHostChannel().closeExtensionHost()
    await getSongDB().close()
  }

  private handleWindowShow(window: BrowserWindow) {
    this.setZoom(window)
    window.focus()
  }

  private attachWindowEvents(window: BrowserWindow, isMainWindow: boolean) {
    window.on('close', (event) => {
      this.handleWindowClose(event, window, isMainWindow)
    })

    window.on('ready-to-show', () => {
      window.show()
    })

    window.on('show', () => {
      this.handleWindowShow(window)
    })

    window.webContents.setWindowOpenHandler((details) => {
      if (['new-window', 'foreground-tab', 'background-tab', 'default'].includes(details.disposition)) {
        shell.openExternal(details.url, {
          activate: true,
        })
        return {
          action: 'deny',
        }
      } else {
        return {
          action: 'allow',
        }
      }
    })
    // window.webContents.on('', (event, url) {
    //   event.preventDefault()
    //   open(url)
    // })

    window.webContents.on(
      'did-frame-navigate',
      async (event, url, code, status, isMainFrame, frameProcessId, frameRoutingId) => {
        if (!isMainFrame && code === 200) {
          try {
            const parsedURL = new URL(url)
            if (parsedURL.host === 'www.youtube.com') {
              const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
              if (frame) {
                try {
                  const script = await readFile(path.join(__static, 'youtube_age_bypass.js'), { encoding: 'utf-8' })
                  await frame.executeJavaScript(script)
                } catch (e) {
                  console.error('Failed to execute youtube content warning bypass')
                }
              }
            }
          } catch {
            return
          }
        }
      },
    )

    // TODO: Hopefully expand the blocklist in future
    window.webContents.session.webRequest.onBeforeRequest(
      { urls: ['*://googleads.g.doubleclick.net/*', '*://*.youtube.com/api/stats/ads'] },
      (details, callback) => {
        callback({ cancel: true })
      },
    )

    if (isMainWindow) {
      getMprisChannel().onButtonStatusChange((buttons) => WindowToolbarButtonsHandler.setWindowToolbar(window, buttons))
    }
  }

  public minimizeWindow(isMainWindow = true) {
    const window = WindowHandler.getWindow(isMainWindow)
    window?.minimizable && window.minimize()
  }

  public toggleFullscreen(isMainWindow = true) {
    const window = WindowHandler.getWindow(isMainWindow)
    this.setFullscreen(isMainWindow, !window?.isFullScreen() ?? false)
  }

  public setFullscreen(isMainWindow: boolean, value: boolean) {
    const window = WindowHandler.getWindow(isMainWindow)
    if (window?.fullScreenable) {
      window.setFullScreen(value)
    }
  }

  public maximizeWindow(isMainWindow = true) {
    const window = WindowHandler.getWindow(isMainWindow)
    if (window?.maximizable) {
      if (window.isMaximized()) window.restore()
      else window.maximize()

      return window?.isMaximized()
    }

    return false
  }

  public toggleDevTools(isMainWindow = true) {
    const window = WindowHandler.getWindow(isMainWindow)
    window?.webContents.isDevToolsOpened() ? window.webContents.closeDevTools() : window?.webContents.openDevTools()
  }

  public async openFileBrowser(isMainWindow: boolean, options: Electron.OpenDialogOptions) {
    const window = WindowHandler.getWindow(isMainWindow)
    return window && dialog.showOpenDialog(window, options)
  }

  public async openSaveDialog(isMainWindow: boolean, options: Electron.SaveDialogOptions) {
    const window = WindowHandler.getWindow(isMainWindow)
    return window && dialog.showSaveDialog(window, options)
  }

  public closeWindow(isMainWindow = true) {
    const window = WindowHandler.getWindow(isMainWindow)
    window && !window?.isDestroyed() && window.close()
  }

  public async automateSpotifyAppCreation() {
    const browser = await pie.connect(app, puppeteer)

    const window = new BrowserWindow()
    const url = 'https://developer.spotify.com/dashboard/login'
    await window.loadURL(url)

    try {
      const page = await pie.getPage(browser, window)

      if (await page.$('button[data-ng-click="login()"]')) {
        await page.click('button[data-ng-click="login()"]')

        const loginPage = await (await browser.waitForTarget((target) => target.opener() === page.target())).page()
        if (loginPage) {
          await new Promise((resolve) => loginPage.on('close', resolve))
        }

        await page.waitForNavigation()
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      const acceptTerms = await page.$('input[value="Accept the Terms"]')
      if (acceptTerms) {
        await (await page.$('span[class="control-indicator"]'))?.evaluate((b) => (b as HTMLElement).click())
        await (await page.$('input[value="Accept the Terms"]'))?.evaluate((b) => (b as HTMLElement).click())
        await page.waitForNavigation()
      }

      await page.waitForSelector('button[ng-click="flowStart()"]')
      await page.click('button[ng-click="flowStart()"]')
      await page.waitForSelector('input[data-ng-model="name"]', { visible: true })

      await page.focus('input[data-ng-model="name"]')
      await page.type('input[data-ng-model="name"]', 'Moosync')
      await page.focus('textarea[data-ng-model="description"]')
      await page.type('textarea[data-ng-model="description"]', 'A simple music player')
      await (await page.$('span[class="control-indicator"]'))?.evaluate((b) => (b as HTMLElement).click())

      await new Promise((resolve) => setTimeout(resolve, 1000))
      await (await page.$('button[type="submit"]'))?.evaluate((b) => (b as HTMLElement).click())
      await page.waitForNavigation()

      await page.waitForSelector('button[ng-show="!showClientSecret"]')
      await (await page.$('button[ng-show="!showClientSecret"]'))?.evaluate((b) => (b as HTMLElement).click())

      await page.waitForSelector('div[ng-show="showClientSecret"] > code', { visible: true })
      await new Promise((resolve) => setTimeout(resolve, 500))

      const clientID = await (await page.$('.client-credential > code'))?.evaluate((el) => el.innerHTML)
      const clientSecret = await (
        await page.$('div[ng-show="showClientSecret"] > code')
      )?.evaluate((el) => el.innerHTML)

      await (await page.$('button[data-target="#settings-modal"]'))?.evaluate((b) => (b as HTMLElement).click())
      await page.waitForSelector('div[id="settings-modal"]', { visible: true })
      await new Promise((resolve) => setTimeout(resolve, 500))

      await page.focus('input[id="newRedirectUri"]')
      await page.type('input[id="newRedirectUri"]', 'https://moosync.app/spotify')
      await page.click('button[id="addRedirectUri"]')
      await new Promise((resolve) => setTimeout(resolve, 500))

      await page.focus('input[id="newRedirectUri"]')
      await page.type('input[id="newRedirectUri"]', 'http://localhost')
      await page.click('button[id="addRedirectUri"]')
      await new Promise((resolve) => setTimeout(resolve, 500))

      await page.focus('input[id="newRedirectUri"]')
      await page.type('input[id="newRedirectUri"]', 'http://localhost:8080')
      await page.click('button[id="addRedirectUri"]')
      await new Promise((resolve) => setTimeout(resolve, 500))

      await new Promise((resolve) => setTimeout(resolve, 300))
      await (await page.$('button[ng-click="update(application)"]'))?.evaluate((b) => (b as HTMLElement).click())

      browser.disconnect()
      window.close()

      return { clientID, clientSecret }
    } catch (e) {
      console.error(e)
    }

    browser.disconnect()
    window.close()
  }
}

class AppExitHandler {
  public static _isQuitting = false
  public static _minimizeToTray = true
}

class WindowToolbarButtonsHandler {
  static setWindowToolbar(window: BrowserWindow, buttonState: PlayerButtons) {
    const buttons: ThumbarButton[] = []

    if (buttonState.prev) {
      buttons.push({
        icon: getThemeIcon('prev_track'),
        click: () => getMprisChannel().onButtonPressed(ButtonEnum.Previous),
        tooltip: 'Previous track',
      })
    }

    if (buttonState.play) {
      buttons.push({
        icon: getThemeIcon('play'),
        click: () => getMprisChannel().onButtonPressed(ButtonEnum.Play),
        tooltip: 'Play',
      })
    }

    if (buttonState.pause) {
      buttons.push({
        icon: getThemeIcon('pause'),
        click: () => getMprisChannel().onButtonPressed(ButtonEnum.Pause),
        tooltip: 'Pause',
      })
    }

    if (buttonState.next) {
      buttons.push({
        icon: getThemeIcon('next_track'),
        click: () => getMprisChannel().onButtonPressed(ButtonEnum.Next),
        tooltip: 'Next track',
      })
    }

    if (!window.isDestroyed()) {
      window.setThumbarButtons(buttons)
    }
  }
}

class TrayHandler {
  private _tray: Tray | null = null

  private extraButtons: (Electron.MenuItem | Electron.MenuItemConstructorOptions)[] = []

  constructor() {
    getMprisChannel().onButtonStatusChange((buttons) => {
      this.extraButtons = this.buildControlButtons(buttons)
      // Tray will be updated only if it exists
      this.setupContextMenu()
    })

    nativeTheme.on('updated', () => {
      this.extraButtons = this.buildControlButtons(getMprisChannel().buttonStatus)
      this.setupContextMenu()
    })
  }

  public async createTray() {
    if (!this._tray || this._tray?.isDestroyed()) {
      try {
        const iconPath = path.join(app.getPath('appData'), 'moosync', 'trayIcon', 'icon.png')
        await access(iconPath)
        this._tray = new Tray(iconPath)
      } catch (e) {
        this._tray = new Tray(path.join(__static, process.platform === 'darwin' ? 'logo_osx.png' : 'logo.png'))
      }
      this.setupContextMenu()
    }
  }

  private buildControlButtons(buttonState: PlayerButtons) {
    const buttons: (Electron.MenuItem | Electron.MenuItemConstructorOptions)[] = []
    if (buttonState.play) {
      buttons.push({
        label: 'Play',
        icon: getThemeIcon('play'),
        click: () => {
          getMprisChannel().onButtonPressed(ButtonEnum.Play)
        },
      })
    }

    if (buttonState.pause) {
      buttons.push({
        label: 'Pause',
        icon: getThemeIcon('pause'),
        click: () => {
          getMprisChannel().onButtonPressed(ButtonEnum.Pause)
        },
      })
    }

    if (buttonState.next) {
      buttons.push({
        label: 'Next',
        icon: getThemeIcon('next_track'),
        click: () => {
          getMprisChannel().onButtonPressed(ButtonEnum.Next)
        },
      })
    }

    if (buttonState.prev) {
      buttons.push({
        label: 'Prev',
        icon: getThemeIcon('prev_track'),
        click: () => {
          getMprisChannel().onButtonPressed(ButtonEnum.Previous)
        },
      })
    }

    if (buttonState.loop) {
      buttons.push({
        label: 'Repeat',
        icon: getThemeIcon('repeat'),
        click: () => {
          getMprisChannel().onButtonPressed(ButtonEnum.Repeat)
        },
      })
    } else {
      buttons.push({
        label: 'No Repeat',
        icon: getThemeIcon('repeat'),
        click: () => {
          getMprisChannel().onButtonPressed(ButtonEnum.Repeat)
        },
      })
    }

    if (buttonState.shuffle) {
      buttons.push({
        label: 'Shuffle',
        icon: getThemeIcon('shuffle'),
        click: () => {
          getMprisChannel().onButtonPressed(ButtonEnum.Shuffle)
        },
      })
    }

    return buttons
  }

  private setupContextMenu() {
    if (this._tray && !this._tray.isDestroyed()) {
      this._tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: 'Show App',
            icon: getThemeIcon('show_eye'),
            click: () => {
              // this.destroy()
              AppExitHandler._isQuitting = false
              WindowHandler.getWindow()?.show()
              WindowHandler.getWindow()?.focus()
            },
          },
          ...this.extraButtons,
          {
            label: 'Quit',
            icon: getThemeIcon('close'),
            click: function () {
              AppExitHandler._isQuitting = true
              app.quit()
            },
          },
        ]),
      )
    }
  }

  public destroy() {
    if (this._tray) {
      console.debug('Destroying tray icon')
      this._tray.destroy()
      console.debug('Tray destroy status:', this._tray.isDestroyed())
      this._tray = null
    }
  }
}

function getThemeIcon(iconName: string) {
  return nativeImage.createFromPath(
    path.join(__static, `${iconName}${nativeTheme.shouldUseDarkColors ? '' : '_light'}.png`),
  )
}

export function setMinimizeToTray(enabled: boolean) {
  AppExitHandler._minimizeToTray = enabled
}

export function setIsQuitting(val: boolean) {
  AppExitHandler._isQuitting = val
}

export const _windowHandler = new WindowHandler()
