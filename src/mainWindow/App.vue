<!-- 
  App.vue is a part of Moosync.
  
  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
  Licensed under the GNU General Public License. 
  
  See LICENSE in the project root for license information.
-->

<template>
  <div id="app">
    <ContextMenu />
    <Titlebar :isJukeboxModeActive="isJukeboxModeActive" />
    <div class="appContainer">
      <router-view></router-view>
    </div>
    <NewPlaylistModal />
    <SongFromUrlModal />
    <PlaylistFromUrlModal />
    <SongInfoModal />
    <SetupModal />
    <OAuthModal />
    <FormModal />
    <EntityInfoModal />
    <PinEntryModal />
    <IncorrectPlaybackModal />
  </div>
</template>

<script lang="ts">
import { Component, Watch } from 'vue-property-decorator'
import Titlebar from '@/commonComponents/Titlebar.vue'
import { mixins } from 'vue-class-component'
import ThemeHandler from '@/utils/ui/mixins/ThemeHandler'
import ContextMenu from './components/generic/Context.vue'
import NewPlaylistModal from '@/mainWindow/components/modals/NewPlaylistModal.vue'
import SongFromUrlModal from './components/modals/SongFromURLModal.vue'
import PlaylistFromUrlModal from './components/modals/PlaylistFromURLModal.vue'
import SetupModal from './components/setupModal/SetupModal.vue'
import SongInfoModal from './components/modals/SongInfoModal.vue'

import { vxm } from './store'
import { bus } from './main'
import PlayerControls from '@/utils/ui/mixins/PlayerControls'
import KeyHandlerMixin from '@/utils/ui/mixins/KeyHandlerMixin'
import { EventBus } from '@/utils/main/ipc/constants'
import OAuthModal from './components/modals/OAuthModal.vue'
import FormModal from './components/modals/FormModal.vue'
import EntityInfoModal from './components/modals/EntityInfoModal.vue'
import { i18n } from './plugins/i18n'
import JukeboxMixin from '@/utils/ui/mixins/JukeboxMixin'
import ProviderMixin from '@/utils/ui/mixins/ProviderMixin'
import { ProviderScopes, VolumePersistMode } from '@/utils/commonConstants'
import { YoutubeAlts } from './store/providers'
import PinEntryModal from './components/modals/PinEntryModal.vue'
import { ExtensionProvider } from '@/utils/ui/providers/extensionWrapper'
import { sortSongListFn } from '@/utils/common'
import IncorrectPlaybackModal from './components/modals/IncorrectPlaybackModal.vue'

@Component({
  components: {
    Titlebar,
    ContextMenu,
    NewPlaylistModal,
    SongFromUrlModal,
    PlaylistFromUrlModal,
    SetupModal,
    SongInfoModal,
    OAuthModal,
    FormModal,
    EntityInfoModal,
    PinEntryModal,
    IncorrectPlaybackModal
  }
})
export default class App extends mixins(ThemeHandler, PlayerControls, KeyHandlerMixin, JukeboxMixin, ProviderMixin) {
  async created() {
    this.fetchProviderExtensions()
    this.registerNotifier()
    this.setLanguage()
    this.listenPreferenceChanges()
    this.listenExtensionEvents()
    this.listenExtensionRequests()
    this.setYoutubeAlt()
    this.watchQueueSort()

    this.themeStore = vxm.themes
  }

  mounted() {
    this.registerFileOpenRequests()
    this.watchPlaylistUpdates()
    this.populatePlaylists()
    this.registerKeyboardHotkeys()
    this.registerFileDragListener()
    this.handleInitialSetup()
    this.checkUpdate()
    this.watchLibrespotUserChange()
    this.registerPlayTimeListeners()
  }

  private registerPlayTimeListeners() {
    vxm.player.$watch('currentSong', async (newVal?: Song, oldVal?: Song) => {
      if (oldVal) {
        console.debug(oldVal?.title, 'played for', this.playTime)
        await window.DBUtils.incrementPlayTime(oldVal._id, this.playTime)
      }
      this.clearPlaytimeTracker()
      this.playTime = 0

      if (newVal && vxm.player.playerState === 'PLAYING') {
        this.setPlaytimeTracker()
      }
    })

    vxm.player.$watch('playerState', (newVal: PlayerState) => {
      if (newVal === 'PLAYING') {
        this.setPlaytimeTracker()
      } else {
        this.clearPlaytimeTracker()
      }
    })

    window.onbeforeunload = () => {
      console.debug('unloading page')
      if (vxm.player.currentSong) {
        window.DBUtils.incrementPlayTime(vxm.player.currentSong?._id, this.playTime)
      }
    }
  }

  private playtimeTracker: ReturnType<typeof setInterval> | undefined
  private playTime = 0

  private setPlaytimeTracker() {
    if (!this.playtimeTracker) {
      this.playtimeTracker = setInterval(() => {
        this.playTime += 1
      }, 1000)
    }
  }

  private clearPlaytimeTracker() {
    if (this.playtimeTracker) {
      clearInterval(this.playtimeTracker)
      this.playtimeTracker = undefined
    }
  }

  private watchLibrespotUserChange() {
    window.PreferenceUtils.listenPreferenceChanged('spotify.username', true, async () => {
      if (await vxm.providers.spotifyProvider.updateConfig()) {
        bus.$emit(EventBus.REFRESH_ACCOUNTS, vxm.providers.spotifyProvider.key)
      }
    })

    window.PreferenceUtils.listenPreferenceChanged('secure.spotify.password', true, async () => {
      if (await vxm.providers.spotifyProvider.updateConfig()) {
        bus.$emit(EventBus.REFRESH_ACCOUNTS, vxm.providers.spotifyProvider.key)
      }
    })
  }

  private fetchProviderExtensions() {
    vxm.providers.fetchExtensionProviders()
    window.ExtensionUtils.listenExtensionsChanged(() => vxm.providers.fetchExtensionProviders())

    window.ExtensionUtils.listenAccountRegistered((details) => {
      const provider = this.getProviderByKey(details.packageName) as ExtensionProvider
      if (provider) {
        provider.setAccountDetails(details.data)
      }
    })
  }

  @Watch('isJukeboxModeActive')
  private onJukeboxModeChanged(val: boolean) {
    if (val) {
      window.WindowUtils.enableFullscreen(true)
    } else {
      window.WindowUtils.disableFullscreen(true)
    }
  }

  private watchQueueSort() {
    vxm.themes.$watch('queueSortBy', async (newVal?: SongSortOptions[]) => {
      if (newVal) {
        if (newVal?.[0]?.type === 'playCount') {
          await vxm.player.updatePlayCounts()
        }

        vxm.player.sortQueue(sortSongListFn(newVal))
      }
    })
  }

  private async setLanguage() {
    const langs = await window.PreferenceUtils.loadSelective<Checkbox[]>('system_language')
    const active = (langs ?? []).find((val) => val.enabled)
    if (active) {
      i18n.locale = active?.key
    }

    window.PreferenceUtils.listenPreferenceChanged('system_language', true, (_, value: Checkbox[]) => {
      const activeLang = value.find((val) => val.enabled)?.key
      if (activeLang) {
        i18n.locale = activeLang
      }
    })
  }

  private async setYoutubeAlt() {
    const youtubeAlt = (await window.PreferenceUtils.loadSelective<Checkbox[]>('youtubeAlt', false, [])) as Checkbox[]
    for (const val of youtubeAlt) {
      if (val.enabled) {
        switch (val.key) {
          case 'use_youtube':
            vxm.providers.youtubeAlt = YoutubeAlts.YOUTUBE
            break
          case 'use_invidious':
            vxm.providers.youtubeAlt = YoutubeAlts.INVIDIOUS
            break
          case 'use_piped':
            vxm.providers.youtubeAlt = YoutubeAlts.PIPED
            break
        }
      }
    }
  }

  private checkUpdate() {
    window.UpdateUtils.listenUpdate((available) => {
      console.debug('Got update')
      vxm.themes.isUpdateAvailable = available
    })

    window.UpdateUtils.check()
  }

  private watchPlaylistUpdates() {
    vxm.playlist.$watch('updated', (updated: boolean) => {
      if (updated) {
        vxm.playlist.updated = false
        this.populatePlaylists()
      }
    })
  }

  private async populatePlaylists() {
    const RawPlaylists = await window.SearchUtils.searchEntityByOptions<Playlist>({
      playlist: true
    })
    const playlists: playlistInfo = {}
    for (const p of RawPlaylists) {
      playlists[p.playlist_id] = p.playlist_name
    }
    vxm.playlist.playlists = playlists
  }

  private registerNotifier() {
    window.NotifierUtils.registerMainProcessNotifier((obj) => {
      vxm.notifier.emit(obj)
      if (obj.id === 'started-scan' || obj.id === 'completed-scan') {
        if (obj.id === 'completed-scan') {
          vxm.themes.refreshPage = true
        }
        this.$toasted.show(obj.message, {
          className: obj.id === 'completed-scan' ? 'success-toast' : 'custom-toast'
        })
      }
    })
  }

  private getFileName(path: string) {
    const li = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    const fileName = path.substring(li + 1)
    return fileName.split('.')[0]
  }

  private getDuration(src: string): Promise<number> {
    return new Promise(function (resolve) {
      const audio = new Audio()
      audio.addEventListener('loadedmetadata', function () {
        resolve(audio.duration)
      })
      audio.src = 'media://' + src
    })
  }

  private async getSongFromPath(path: string): Promise<Song | undefined> {
    const results = await window.SearchUtils.searchSongsByOptions({
      song: {
        path: path
      }
    })
    if (results.length > 0) {
      return results[0]
    }

    return (await window.FileUtils.scanSingleSong(path)).song ?? undefined
  }

  private registerFileOpenRequests() {
    window.FileUtils.listenInitialFileOpenRequest(async (paths) => {
      if (paths.length > 0) {
        for (const [index, path] of paths.entries()) {
          const song = await this.getSongFromPath(path)
          if (song) {
            if (index === 0) {
              await this.playTop([song])
            } else {
              await this.queueSong([song])
            }
          }
        }
      }
    })
    window.WindowUtils.mainWindowHasMounted()
  }

  private registerFileDragListener() {
    document.addEventListener('drop', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) {
        console.debug('Got drag files', event.dataTransfer.files.length)
        for (const f of event.dataTransfer.files) {
          if (f) {
            const song = await this.getSongFromPath(f.path)
            if (song) {
              await this.playTop([song])
            }
          }
        }
      }
    })

    document.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
  }

  private listenExtensionRequests() {
    window.ExtensionUtils.listenRequests((data) => {
      if (data.type === 'get-current-song') {
        window.ExtensionUtils.replyToRequest({ ...data, data: vxm.player.currentSong })
        return
      }

      if (data.type === 'get-volume') {
        window.ExtensionUtils.replyToRequest({ ...data, data: vxm.player.volume })
        return
      }

      if (data.type === 'get-time') {
        window.ExtensionUtils.replyToRequest({ ...data, data: vxm.player.currentTime })
        return
      }

      if (data.type === 'get-queue') {
        window.ExtensionUtils.replyToRequest({ ...data, data: vxm.player.queue })
        return
      }

      if (data.type === 'get-player-state') {
        window.ExtensionUtils.replyToRequest({ ...data, data: vxm.player.playerState })
      }

      if (data.type === 'play') {
        window.ExtensionUtils.replyToRequest({ ...data, data: this.play() })
      }

      if (data.type === 'pause') {
        window.ExtensionUtils.replyToRequest({ ...data, data: this.pause() })
      }

      if (data.type === 'stop') {
        window.ExtensionUtils.replyToRequest({ ...data, data: this.stop() })
      }

      if (data.type === 'prev') {
        window.ExtensionUtils.replyToRequest({ ...data, data: this.prevSong() })
      }

      if (data.type === 'next') {
        window.ExtensionUtils.replyToRequest({ ...data, data: this.nextSong() })
      }

      if (data.type === 'open-login-modal') {
        bus.$emit(EventBus.SHOW_OAUTH_MODAL, data.data)
        window.ExtensionUtils.replyToRequest({ ...data, data: true })
      }

      if (data.type === 'close-login-modal') {
        bus.$emit(EventBus.HIDE_OAUTH_MODAL)
        window.ExtensionUtils.replyToRequest({ ...data, data: true })
      }

      if (data.type === 'show-toast') {
        this.$toasted.show(data.data.message, {
          duration: Math.max(data.data.duration, 5000),
          type: data.data.type
        })
        window.ExtensionUtils.replyToRequest({ ...data, data: true })
      }
    })
  }

  private listenExtensionEvents() {
    vxm.player.$watch(
      'currentSong',
      async (newVal: Song | undefined | null) => {
        console.debug('Got song change request for extension host')
        if (newVal?.type !== 'LOCAL' && !newVal?.playbackUrl) {
          console.debug('Song is missing playback url')
          return
        }

        window.ExtensionUtils.sendEvent({
          type: 'songChanged',
          data: [newVal]
        })

        const scrobbleableProviderList =
          (await window.PreferenceUtils.loadSelective<Checkbox[]>('scrobble.provider_toggle')) ?? []

        if (newVal.path) {
          const providerStatus = scrobbleableProviderList.find((val) => val.key === 'local')?.enabled ?? true
          if (providerStatus) {
            console.debug('scrobbling', newVal.title)
            this.getProvidersByScope(ProviderScopes.SCROBBLES).forEach((val) => {
              val.scrobble(newVal)
            })
          } else {
            console.debug('not scrobbling', newVal.title)
          }
        } else {
          const providers = this.getAllProviders()
          for (const p of providers) {
            if (p.matchEntityId(newVal._id)) {
              const providerStatus = scrobbleableProviderList.find((val) => val.key === p.key)?.enabled ?? true
              if (providerStatus) {
                console.debug('scrobbling', newVal.title)
                this.getProvidersByScope(ProviderScopes.SCROBBLES).forEach((val) => {
                  val.scrobble(newVal)
                })
                return
              } else {
                console.debug('not scrobbling', newVal.title)
              }
            }
          }
        }
      },
      { deep: true, immediate: true }
    )

    vxm.player.$watch('playerState', (newVal: PlayerState) =>
      window.ExtensionUtils.sendEvent({
        type: 'playerStateChanged',
        data: [newVal]
      })
    )

    let volumeDebounce: ReturnType<typeof setTimeout> | undefined = undefined
    vxm.player.$watch('volume', (newVal: number) => {
      if (volumeDebounce) clearTimeout(volumeDebounce)
      volumeDebounce = setTimeout(() => {
        window.ExtensionUtils.sendEvent({
          type: 'volumeChanged',
          data: [newVal]
        })
      }, 800)
    })

    vxm.player.$watch('songQueue', (newVal: SongQueue) =>
      window.ExtensionUtils.sendEvent({
        type: 'songQueueChanged',
        data: [newVal]
      })
    )

    bus.$on('forceSeek', (newVal: number) =>
      window.ExtensionUtils.sendEvent({
        type: 'seeked',
        data: [newVal]
      })
    )
  }

  private async listenPreferenceChanges() {
    window.PreferenceUtils.listenPreferenceChanged('activeTheme', true, async () => {
      const theme = await window.ThemeUtils.getActiveTheme()
      this.setColorsToRoot(theme)
    })

    window.PreferenceUtils.listenPreferenceChanged<songMenu>('songView', true, (_, value) => {
      vxm.themes.songView = value
    })

    vxm.themes.showSpotifyCanvas =
      (await window.PreferenceUtils.loadSelectiveArrayItem<Checkbox>('spotify.librespot.options.use_spotify_canvas'))
        ?.enabled ?? true

    window.PreferenceUtils.listenPreferenceChanged('spotify.librespot.options', true, (_, value) => {
      vxm.themes.showSpotifyCanvas =
        (value as Checkbox[]).find((val) => val.key === 'use_spotify_canvas')?.enabled ?? true
    })

    this.listenVolumeModes()
  }

  private async listenVolumeModes() {
    vxm.player.volumeMode = this.mapVolumeMode(
      (await window.PreferenceUtils.loadSelective<Checkbox[]>('volumePersistMode')) ?? []
    )
    window.PreferenceUtils.listenPreferenceChanged<Checkbox[]>('volumePersistMode', true, (_, value) => {
      vxm.player.volumeMode = this.mapVolumeMode(value)
    })

    vxm.player.clampMap = (await window.PreferenceUtils.loadSelective('clampMap')) ?? {}
    window.PreferenceUtils.listenPreferenceChanged<Record<string, { clamp: number }>>('clampMap', true, (_, value) => {
      vxm.player.clampMap = value
    })
  }

  private mapVolumeMode(value: Checkbox[]): VolumePersistMode {
    const active = (value as Checkbox[]).find((val) => val.enabled)
    return (active?.key ?? VolumePersistMode.SINGLE) as VolumePersistMode
  }

  private async handleInitialSetup() {
    const isFirstLaunch = await window.PreferenceUtils.loadSelective<boolean>('isFirstLaunch', false, true)
    if (isFirstLaunch) {
      bus.$emit(EventBus.SHOW_SETUP_MODAL)
      await window.FileUtils.scan()
      await window.PreferenceUtils.saveSelective('isFirstLaunch', false, false)
    }
  }
}
</script>
