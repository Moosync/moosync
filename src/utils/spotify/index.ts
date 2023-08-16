import { sleep } from '../common'
import { Serializable } from 'child_process'
import { ConstructorConfig, PlayerEvent, PlayerEventTypes, SpotifyPlayerSpirc, Token, TokenScope } from 'librespot-node'

class SpotifyPlayerProcess {
  private player: SpotifyPlayerSpirc | undefined

  constructor() {
    this.setupLogger()
    this.registerListeners()
  }

  private prefixLogger(method: string) {
    const originalMethod = console[method as 'info' | 'warn' | 'debug' | 'trace' | 'error']
    console[method as 'info' | 'warn' | 'debug' | 'trace' | 'error'] = (...args: unknown[]) => {
      // Offset by 21 characters
      originalMethod(`[00000000000000000000 ${method} ]`, ...args)
    }
  }

  private setupLogger() {
    const methods = ['info', 'warn', 'debug', 'trace', 'error']
    for (const m of methods) {
      this.prefixLogger(m)
    }
  }

  private async connect(config: ConstructorConfig) {
    if (this.player) {
      await this.player.close()
    }

    return new Promise<void>((resolve, reject) => {
      this.player = new SpotifyPlayerSpirc(config)
      const errorListener = (e: PlayerEvent<'InitializationError'>) => {
        this.player?.removeAllListeners()
        reject(e)
      }

      const successListener = () => {
        this.player?.removeAllListeners()

        this.player?.on('Playing', this.sendEvent.bind(this))
        this.player?.on('Paused', this.sendEvent.bind(this))
        this.player?.on('Stopped', this.sendEvent.bind(this))
        this.player?.on('TrackChanged', this.sendEvent.bind(this))
        this.player?.on('EndOfTrack', this.sendEvent.bind(this))
        this.player?.on('VolumeChanged', this.sendEvent.bind(this))
        this.player?.on('Seeked', this.sendEvent.bind(this))
        this.player?.on('Loading', this.sendEvent.bind(this))
        this.player?.on('Unavailable', this.sendEvent.bind(this))
        this.player?.on('TimeUpdated', this.sendEvent.bind(this))
        resolve()
      }

      this.player.once('InitializationError', errorListener)
      this.player.once('PlayerInitialized', successListener)
    })
  }

  private sendEvent<T extends PlayerEventTypes>(event: PlayerEvent<T>) {
    event.event !== 'TimeUpdated' && console.debug('Emitting event', JSON.stringify(event))
    process.send?.(event)
  }

  private async waitForPlayerInitialize() {
    await new Promise<void>((resolve) => {
      if (this.player?.isInitialized) {
        resolve()
        return
      }

      this.player?.once('PlayerInitialized', () => {
        resolve()
      })
    })
  }

  private async queueCommand(command: SpotifyRequests.SpotifyCommands, args?: unknown[]) {
    await this.waitForPlayerInitialize()

    if (command === 'PLAY') {
      await this.player?.play()
    }

    if (command === 'PAUSE') {
      await this.player?.pause()
    }

    if (args) {
      if (command === 'LOAD') {
        await (this.player?.load as (...args: unknown[]) => Promise<void>)(...args)
      }

      if (command === 'ADD_TO_QUEUE') {
        await this.player?.addToQueue(args[0] as string)
      }

      if (command === 'VOLUME') {
        await this.player?.setVolume(args[0] as number, false)
      }

      if (command === 'SEEK') {
        await this.player?.seek(args[0] as number)
      }

      if (command === 'GET_CANVAS') {
        return await this.player?.getCanvas(args[0] as string)
      }

      if (command === 'GET_LYRICS') {
        return await this.player?.getLyrics(args[0] as string)
      }
    }
  }

  private isMessage(val: unknown): val is PlayerChannelMessage {
    return !!(val as { channel: string }).channel
  }

  private async getToken(scopes: TokenScope[], tries = 0): Promise<Token | undefined> {
    await this.waitForPlayerInitialize()
    try {
      return await this.player?.getToken(...scopes)
    } catch (e) {
      if (tries < 3) {
        await sleep(500)
        console.warn('Failed to get token, retrying')
        return await this.getToken(scopes, tries + 1)
      } else {
        console.error('Failed to get token')
      }
    }
  }

  private isErrorEvent(val: unknown): val is PlayerEvent<'InitializationError'> {
    return (val as PlayerEvent<'InitializationError'>).event === 'InitializationError'
  }

  private async parseMessage(message: Serializable) {
    if (this.isMessage(message)) {
      const type = (message.data as SpotifyMessage)?.type
      const args = (message.data as SpotifyMessage)?.args

      const ret: PlayerChannelMessage = { channel: message.channel }
      if (type === 'CONNECT' && args?.auth) {
        try {
          await this.connect(args)
        } catch (e) {
          if (this.isErrorEvent(e)) {
            this.player?.removeAllListeners()
            this.player = undefined
            ret.error = (e.error as Error).toString()
            console.debug('sending error', ret)
            process.send?.(ret)
          }
          process.exit(1)
        }
      }

      if (type === 'COMMAND') {
        try {
          ret.data = await this.queueCommand(args.command, args.args)
        } catch (e) {
          ret.error = (e as Error).toString()
        }
      }

      if (type === 'TOKEN') {
        try {
          ret.data = await this.getToken(args)
        } catch (e) {
          ret.error = (e as Error).toString()
        }
      }

      console.debug('sending reply', ret)
      process.send?.(ret)
    }
  }

  private async killSelf() {
    if (this.player) {
      this.player.removeAllListeners()
      await this.player.close()
    }

    process.exit(1)
  }

  private registerListeners() {
    process.on('message', (message: SpotifyMessage) => {
      this.parseMessage(message)
    })

    process.on('exit', () => this.killSelf())
    process.on('SIGQUIT', () => this.killSelf())
    process.on('SIGINT', () => this.killSelf())
    process.on('SIGUSR1', () => this.killSelf())
    process.on('SIGUSR2', () => this.killSelf())
    process.on('SIGHUP', () => this.killSelf())
  }
}

new SpotifyPlayerProcess()
