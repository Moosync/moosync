/*
 *  index.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import {
  mainRequests,
  mainRequestsKeys,
  providerExtensionKeys,
  providerFetchRequests,
} from '@/utils/extensions/constants'

import { ExtensionHandler } from '@/utils/extensions/sandbox/extensionHandler'
import { prefixLogger, setLogLevel } from '@/utils/main/logger/utils'
import log, { LogLevelDesc } from 'loglevel'

class ExtensionHostIPCHandler {
  private extensionHandler: ExtensionHandler
  private mainRequestHandler: MainRequestHandler
  private logsPath: string

  constructor() {
    let extensionPath = ''
    let logsPath = ''
    let installPath = ''
    for (const [index, arg] of process.argv.entries()) {
      if (process.argv[index + 1]) {
        if (arg === 'extensionPath') {
          extensionPath = process.argv[index + 1]
        }

        if (arg === 'logPath') {
          logsPath = process.argv[index + 1]
        }

        if (arg === 'installPath') {
          installPath = process.argv[index + 1]
        }
      }
    }

    this.logsPath = logsPath
    this.setupLogger()

    this.extensionHandler = new ExtensionHandler([extensionPath], logsPath, installPath)
    this.mainRequestHandler = new MainRequestHandler(this.extensionHandler)

    this.registerListeners()
    this.extensionHandler.startAll()
  }

  private setupLogger() {
    const logger = log.getLogger('Extension Host')
    prefixLogger(this.logsPath, logger)
    const logLevel = process.env.DEBUG_LOGGING ? log.levels.DEBUG : log.levels.INFO
    logger.setLevel(logLevel)

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

  private isExtensionEvent(key: keyof MoosyncExtensionTemplate) {
    return key === 'onStarted' || key === 'onStopped'
  }

  private isMainRequest(key: string) {
    return mainRequestsKeys.includes(key as mainRequests)
  }

  private isProviderFetchRequest(key: string) {
    return providerExtensionKeys.includes(key as providerFetchRequests)
  }

  private registerListeners() {
    process.on('message', (message: extensionHostMessage) => {
      this.parseMessage(message as mainRequestMessage)
    })

    process.on('exit', () => this.mainRequestHandler.killSelf())
    process.on('SIGQUIT', () => this.mainRequestHandler.killSelf())
    process.on('SIGINT', () => this.mainRequestHandler.killSelf())
    process.on('SIGUSR1', () => this.mainRequestHandler.killSelf())
    process.on('SIGUSR2', () => this.mainRequestHandler.killSelf())
    process.on('SIGHUP', () => this.mainRequestHandler.killSelf())
    process.on('uncaughtException', (e) => {
      console.error('Asynchronous error caught.', e.message ?? e.toString())
      if (e.message === 'Channel closed') {
        process.exit()
      }
    })
  }

  private parseMessage(message: extensionHostMessage) {
    if (this.isExtensionEvent(message.type as keyof MoosyncExtensionTemplate)) {
      this.extensionHandler.sendEvent(message as extensionEventMessage)
      return
    }

    if (this.isMainRequest(message.type)) {
      this.mainRequestHandler.parseRequest(message as mainRequestMessage)
      return
    }

    if (this.isProviderFetchRequest(message.type)) {
      this.mainRequestHandler.parseProviderRequest(message as providerFetchRequestMessage)
    }
  }
}

class MainRequestHandler {
  handler: ExtensionHandler

  constructor(handler: ExtensionHandler) {
    this.handler = handler
  }

  public parseProviderRequest(message: providerFetchRequestMessage) {
    this.sendToMain(message.channel, this.handler.handleProviderRequests(message.type, message.data.packageName))
  }

  public parseRequest(message: mainRequestMessage) {
    console.debug('Received message from main process', message.type)
    if (message.type === 'find-new-extensions') {
      this.handler
        .registerPlugins()
        .then(() => this.handler.startAll())
        .then(() => this.sendToMain(message.channel))
      return
    }

    if (message.type === 'get-installed-extensions') {
      this.sendToMain(message.channel, this.handler.getInstalledExtensions())
      return
    }

    if (message.type === 'get-extension-icon') {
      this.sendToMain(message.channel, this.handler.getExtensionIcon(message.data.packageName))
      return
    }

    if (message.type === 'toggle-extension-status') {
      this.handler.toggleExtStatus(message.data.packageName, message.data.enabled as boolean).then(() => {
        this.sendToMain(message.channel)
      })
      return
    }

    if (message.type === 'remove-extension') {
      this.handler.removeExt(message.data.packageName).then((val) => this.sendToMain(message.channel, val))
      return
    }

    if (message.type === 'stop-process') {
      this.killSelf(message.channel)
      return
    }

    if (message.type === 'extra-extension-events') {
      this.handler
        .sendExtraEventToExtensions(message.data as unknown as ExtraExtensionEvents<ExtraExtensionEventTypes>)
        .then((val) => {
          this.sendToMain(message.channel, val)
        })
      return
    }

    if (message.type === 'get-extension-context-menu') {
      const items = this.handler.getExtensionContextMenu(message.data.type as ContextMenuTypes)
      this.sendToMain(message.channel, items)
      return
    }

    if (message.type === 'on-clicked-context-menu') {
      this.handler.fireContextMenuCallback(
        message.data.id as string,
        message.data.packageName,
        message.data.arg as Song | Artists | Album | Song[] | Playlist | undefined,
      )
      this.sendToMain(message.channel)
      return
    }

    if (message.type === 'set-log-level') {
      setLogLevel(message.data.level as LogLevelDesc)
      this.sendToMain(message.channel)
      return
    }

    if (message.type === 'get-accounts') {
      const items = this.handler.getExtensionAccounts(message.data?.packageName)
      this.sendToMain(message.channel, items)
      return
    }

    if (message.type === 'perform-account-login') {
      this.handler
        .performExtensionAccountLogin(
          message.data.packageName,
          message.data.accountId as string,
          message.data.loginStatus as boolean,
        )
        .then((val) => this.sendToMain(message.channel, val))

      return
    }

    if (message.type === 'get-display-name') {
      const name = this.handler.getDisplayName(message.data.packageName)
      this.sendToMain(message.channel, name)
    }
  }

  private sendToMain(channel: string, data?: unknown) {
    if (process.send) {
      process.send({ channel, data } as mainReplyMessage)
    }
  }

  public killSelf(channel?: string) {
    this.handler.stopAllExtensions().then(() => {
      if (channel) this.sendToMain(channel)
      process.exit()
    })
  }
}

new ExtensionHostIPCHandler()
