import { Component, Vue } from 'vue-property-decorator'
import { PlayerModule, PlayerState } from '../../mainWindow/store/playerState'

import { Song } from '../../models/songs'

@Component
export default class PlayerControls extends Vue {
  get playerState() {
    return PlayerModule.playerState
  }

  public nextSong() {
    PlayerModule.nextSong()
  }

  public prevSong() {
    PlayerModule.prevSong()
  }

  public queueSong(song: Song) {
    PlayerModule.pushInQueue(song)
  }

  public playTop(song: Song) {
    PlayerModule.loadInQueueTop(song)
    PlayerModule.nextSong()
  }

  public play() {
    PlayerModule.setState(PlayerState.PLAYING)
  }

  public pause() {
    PlayerModule.setState(PlayerState.PAUSED)
  }

  public togglePlayerState() {
    if (this.playerState == PlayerState.PAUSED || this.playerState == PlayerState.STOPPED) {
      PlayerModule.setState(PlayerState.PLAYING)
    } else {
      PlayerModule.setState(PlayerState.PAUSED)
    }
  }

  public stop() {
    PlayerModule.setState(PlayerState.STOPPED)
  }
}
