/*
 *  logger.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { getExtensionHostChannel } from '.'
import { rendererLogger } from '../logger'
import { getLogPath, setLogLevel } from '../logger/utils'
import { WindowHandler } from '../windowManager'
import { IpcEvents, LoggerEvents } from './constants'
import { ReverseFileReader } from 'file-reader-reverse'
import { Tail } from 'tail'

export class LoggerChannel implements IpcChannelInterface {
  name = IpcEvents.LOGGER
  private tail: Tail | undefined

  handle(event: Electron.IpcMainEvent, request: IpcRequest): void {
    switch (request.type) {
      case LoggerEvents.INFO:
        this.logInfo(event, request as IpcRequest<LoggerRequests.LogEvents>)
        break
      case LoggerEvents.ERROR:
        this.logError(event, request as IpcRequest<LoggerRequests.LogEvents>)
        break
      case LoggerEvents.WARN:
        this.logWarn(event, request as IpcRequest<LoggerRequests.LogEvents>)
        break
      case LoggerEvents.DEBUG:
        this.logDebug(event, request as IpcRequest<LoggerRequests.LogEvents>)
        break
      case LoggerEvents.TRACE:
        this.logTrace(event, request as IpcRequest<LoggerRequests.LogEvents>)
        break
      case LoggerEvents.WATCH_LOGS:
        this.listenLogs(event, request)
        break
      case LoggerEvents.UNWATCH_LOGS:
        this.stopListenLogs(event, request)
        break
      case LoggerEvents.TOGGLE_DEBUG:
        this.setLogLevel(event, request as IpcRequest<LoggerRequests.LogLevels>)
        break
    }
  }

  private logInfo(event: Electron.IpcMainEvent, request: IpcRequest<LoggerRequests.LogEvents>) {
    rendererLogger.info(...request.params.message)
    event.reply(request.responseChannel)
  }

  private logError(event: Electron.IpcMainEvent, request: IpcRequest<LoggerRequests.LogEvents>) {
    rendererLogger.error(...request.params.message)
    event.reply(request.responseChannel)
  }

  private logDebug(event: Electron.IpcMainEvent, request: IpcRequest<LoggerRequests.LogEvents>) {
    rendererLogger.debug(...request.params.message)
    event.reply(request.responseChannel)
  }

  private logWarn(event: Electron.IpcMainEvent, request: IpcRequest<LoggerRequests.LogEvents>) {
    rendererLogger.warn(...request.params.message)
    event.reply(request.responseChannel)
  }

  private logTrace(event: Electron.IpcMainEvent, request: IpcRequest<LoggerRequests.LogEvents>) {
    rendererLogger.trace(...request.params.message)
    event.reply(request.responseChannel)
  }

  private async listenLogs(event: Electron.IpcMainEvent, request: IpcRequest) {
    let lineIndex = 0
    const reverseReader = new ReverseFileReader(getLogPath())
    const parsed: LogLines[] = []

    for await (const lines of reverseReader.getLatestEntires()) {
      for (const l of lines) {
        const p = this.parseLogLineReverse(l, lineIndex)
        if (p) {
          parsed.push(p)
        }
        lineIndex++
      }
    }

    WindowHandler.getWindow(false)?.webContents.send(LoggerEvents.WATCH_LOGS, parsed)
    this.prev = undefined

    event.reply(request.responseChannel)
  }

  private stopListenLogs(event: Electron.IpcMainEvent, request: IpcRequest) {
    this.tail?.unwatch()
    this.tail = undefined
    event.reply(request.responseChannel)
  }

  private prev: string | undefined
  private parseLogLineReverse(line: string, index: number) {
    const split = line.split(']')
    if (split.length > 3) {
      const time = split[0]?.substring(1)
      if (!isNaN(Date.parse(time))) {
        const level = split[1]?.trim().substring(1)
        const process = split[2]?.trim().substring(1)
        const message = split.slice(3).join(']').substring(1).trim()

        const currentMessage = { id: index, time, level, process, message }

        if (this.prev) currentMessage.message += '\n' + this.prev
        this.prev = undefined

        return currentMessage
      }
    }

    if (this.prev) this.prev = line + '\n' + this.prev
    else this.prev = line
  }

  private setLogLevel(event: Electron.IpcMainEvent, request: IpcRequest<LoggerRequests.LogLevels>) {
    if (request.params.level) {
      setLogLevel(request.params.level)
      getExtensionHostChannel().setLogLevel(request.params.level)
    }
    event.reply(request.responseChannel)
  }
}
