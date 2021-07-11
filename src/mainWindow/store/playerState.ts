import { action, mutation } from 'vuex-class-component'

import { VuexModule } from './module'
import { v4 } from 'uuid';
import { vxm } from '.'

class Queue {
  data: { [id: string]: Song } = {}
  order: { id: string, songID: string }[] = []
  index: number = -1
}

export class PlayerStore extends VuexModule.With({ namespaced: 'player' }) {
  public state: PlayerState = 'PAUSED'
  public currentSong: Song | null = null
  private songQueue = new Queue()
  public repeat: boolean = false
  public volume: number = 50

  get playerState() {
    return this.state
  }

  get queue() {
    return this.songQueue
  }

  get Repeat() {
    return this.repeat
  }

  get queueOrder() {
    return this.songQueue.order
  }

  set queueOrder(order: { id: string, songID: string }[]) {
    if (order.length === 0) {
      this.currentSong = null
    }
    this.songQueue.order = order
  }

  get queueTop(): Song | null {
    if (this.songQueue.index > -1 && this.songQueue.data) {
      const songID = this.songQueue.order[this.songQueue.index]
      if (songID)
        return this.songQueue.data[songID.songID]
    }
    return null
  }

  @mutation
  private addSong(item: Song) {
    if (!this.songQueue.data[item._id!]) {
      this.songQueue.data[item._id!] = item
    }

    console.log(this.songQueue)
  }

  @mutation
  public pop(index: number) {
    if (index > -1) {
      const id = this.songQueue.order[index]
      if (id) {
        this.songQueue.order.splice(index, 1)

        if (this.songQueue.order.findIndex(val => val.songID === id.songID) === -1)
          delete this.songQueue.data[id.songID]
      }
    }
  }

  @mutation
  private addInSongQueue(item: Song) {
    this.songQueue.order.push({ id: v4(), songID: item._id! })
  }

  @action
  async loadInQueue(item: Song) {
    this.addSong(item)
    this.addInSongQueue(item)
  }

  @mutation
  private addInQueueTop(item: Song) {
    this.songQueue.order.splice(this.songQueue.index + 1, 0, { id: v4(), songID: item._id! })
  }

  @action
  async pushInQueueTop(item: Song) {
    this.addSong(item)
    this.addInQueueTop(item)
  }

  @mutation
  private incrementQueue() {
    if (this.songQueue.index < this.songQueue.order.length - 1) this.songQueue.index += 1
    else this.songQueue.index = 0
  }

  @action
  async nextSong() {
    this.incrementQueue()
    this.loadSong(this.queueTop)
  }

  @mutation
  private decrementQueue() {
    if (this.songQueue.index > 0) this.songQueue.index -= 1
    else this.songQueue.index = this.songQueue.order.length - 1
  }

  @action
  async prevSong() {
    this.decrementQueue()
    this.loadSong(this.queueTop)
  }

  @mutation
  shuffle() {
    const currentSong = this.songQueue.order[this.songQueue.index]
    this.songQueue.order.splice(this.songQueue.index, 1)

    // https://stackoverflow.com/a/12646864
    for (let i: number = this.songQueue.order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = this.songQueue.order[i]
      this.songQueue.order[i] = this.songQueue.order[j]
      this.songQueue.order[j] = temp
    }

    this.songQueue.order.unshift(currentSong)
    this.songQueue.index = 0
  }

  @action async loadSong(song: Song | null) {
    if (song && song.type === 'SPOTIFY') {
      const ytItem = await vxm.providers.spotifyProvider.spotifyToYoutube(song)
      if (ytItem) {
        song.url = ytItem._id
        song.duration = ytItem.duration
      } else {
        throw new Error('Could not convert song')
      }
    }
    this.currentSong = song
  }

  @action async pushInQueue(Song: Song) {
    this.loadInQueue(Song)
    if (this.currentSong == null) {
      this.nextSong()
    }
  }

  @mutation
  private moveIndexTo(index: number) {
    if (index > 0)
      this.songQueue.index = index
  }

  @action async playQueueSong(index: number) {
    this.moveIndexTo(index)
    this.loadSong(this.queueTop)
  }
}
