/*
 *  PlayerControls.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { Component, Vue } from 'vue-property-decorator'

import { PeerMode } from '@/mainWindow/store/syncState'
import { vxm } from '@/mainWindow/store'
import { Player } from '../players/player'
import { VolumePersistMode } from '@/utils/commonConstants'

const maxp = 100

@Component
export default class PlayerControls extends Vue {
  get playerState() {
    return vxm.player.playerState
  }

  get isSyncing() {
    return vxm.sync.mode !== PeerMode.UNDEFINED
  }

  public async nextSong() {
    if (this.isSyncing) await vxm.sync.nextSong()
    else await vxm.player.nextSong()
  }

  public prevSong() {
    if (this.isSyncing) vxm.sync.prevSong()
    else vxm.player.prevSong()
  }

  public async queueSong(songs: Song[]) {
    if (this.isSyncing) {
      await vxm.sync.pushInQueue({ item: songs, top: false, skipImmediate: false })
    } else {
      await vxm.player.pushInQueue({ item: songs, top: false, skipImmediate: false })
    }

    this.$toasted.show(`Queued ${songs.length} song${songs.length !== 1 ? 's' : ''}`)
  }

  public async playTop(songs: Song[]) {
    if (this.isSyncing) {
      await vxm.sync.pushInQueue({ item: songs.slice(), top: true, skipImmediate: true })
    } else {
      await vxm.player.pushInQueue({ item: songs.slice(), top: true, skipImmediate: true })
    }

    if (!this.isSyncing) vxm.player.playAfterLoad = true

    this.$toasted.show(`Queued ${songs.length} song${songs.length !== 1 ? 's' : ''}`)
    this.play()
  }

  public async playNext(songs: Song[]) {
    if (this.isSyncing) {
      await vxm.sync.pushInQueue({ item: songs.slice(), top: true, skipImmediate: false })
    } else {
      await vxm.player.pushInQueue({ item: songs.slice(), top: true, skipImmediate: false })
    }

    if (!this.isSyncing) vxm.player.playAfterLoad = true

    this.$toasted.show(`Queued ${songs.length} song${songs.length !== 1 ? 's' : ''}`)
  }

  public clearQueue() {
    vxm.player.clearQueue()
  }

  public play() {
    vxm.player.playerState = 'PLAYING'
  }

  public pause() {
    vxm.player.playerState = 'PAUSED'
  }

  public togglePlay() {
    if (!vxm.player.loading) {
      vxm.player.playerState = vxm.player.playerState === 'PLAYING' ? 'PAUSED' : 'PLAYING'
    }
  }

  public shuffle() {
    vxm.themes.queueSortBy = undefined
    vxm.player.shuffle()
    this.$toasted.show('Shuffled', {
      duration: 1000
    })
  }

  public togglePlayerState() {
    if (this.playerState == 'PAUSED' || this.playerState == 'STOPPED') {
      vxm.player.playerState = 'PLAYING'
    } else {
      vxm.player.playerState = 'PAUSED'
    }
  }

  public stop() {
    vxm.player.playerState = 'STOPPED'
  }

  public playFromQueue(index: number) {
    if (this.isSyncing) {
      vxm.sync.playQueueSong(index)
    } else {
      vxm.player.playQueueSong(index)
    }
  }

  public async removeFromQueue(index: number) {
    await vxm.player.pop(index)
  }

  public setSongIndex(oldIndex: number, newIndex: number) {
    vxm.player.setSongIndex({ oldIndex, newIndex, ignoreMove: false })
  }

  get repeat() {
    return vxm.player.Repeat
  }

  set repeat(val: boolean) {
    vxm.player.Repeat = val
  }

  public toggleRepeat() {
    this.repeat = !this.repeat
  }

  private oldVolume = 50

  get volume() {
    const maxv = Math.log(this.clamp)
    const scale = maxv / maxp

    const volume = vxm.player.volume

    if (volume > 0) {
      return Math.log(volume) / scale
    }

    return volume
  }

  set volume(value: number) {
    const maxv = Math.log(this.clamp)
    const scale = maxv / maxp

    if (value > 0) {
      value = Math.exp(scale * value)
    }

    vxm.player.volume = value
    if (value != 0) {
      this.oldVolume = value
    }
  }

  private get clamp() {
    if (vxm.player.volumeMode === VolumePersistMode.CLAMP_MAP) {
      const currentSong = vxm.player.currentSong
      if (currentSong) {
        return (
          vxm.player.clampMap[
            currentSong?.type.toLowerCase() ?? currentSong?.providerExtension?.replaceAll('.', '_').toLowerCase()
          ]?.clamp ?? 100
        )
      }
    }

    return 100
  }

  public muteToggle() {
    if (this.volume !== 0) {
      this.mute()
    } else {
      this.unmute()
    }
  }

  public mute() {
    this.oldVolume = this.volume
    this.volume = 0
  }

  public unmute() {
    this.volume = this.oldVolume
  }

  public findPlayer(canPlay: PlayerTypes, blacklist: string[] = []) {
    let lowest: [Player | undefined, number] = [undefined, vxm.playerRepo.allPlayers.length]
    for (const p of vxm.playerRepo.allPlayers) {
      const index = p.provides().indexOf(canPlay)
      if (index >= 0 && index < lowest[1] && !blacklist.includes(p.key)) {
        lowest = [p, index]
      }
    }

    return lowest[0]
  }

  public clearAllListeners() {
    for (const p of vxm.playerRepo.allPlayers) {
      p.removeAllListeners()
    }
  }
}
