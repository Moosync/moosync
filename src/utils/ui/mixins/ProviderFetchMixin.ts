import { GenericProvider } from '../providers/generics/genericProvider'
import ProviderMixin from './ProviderMixin'
import { vxm } from '@/mainWindow/store'
import { Component } from 'vue-facing-decorator'
import { convertProxy } from '../common'

@Component
export default class ProviderFetchMixin extends ProviderMixin {
  private loadingMap: Record<string, boolean> = {}
  public songList: Song[] = []
  generator:
    | ((
        provider: GenericProvider,
        nextPageToken: unknown,
      ) => AsyncGenerator<{
        songs: Song[]
        nextPageToken?: unknown
      }>)
    | undefined = undefined

  localSongFetch: ((sortBy: SongSortOptions[]) => Promise<Song[]>) | undefined

  optionalSongList: Record<string, string[]> = {}

  activeProviders: Record<string, boolean> = {
    local: true,
  }

  private nextPageToken: Record<string, unknown> = {}

  get filteredSongList() {
    return this.songList.filter((val) => {
      for (const [key, value] of Object.entries(this.activeProviders)) {
        if (this.optionalSongList[key]) {
          if (value) {
            if (this.optionalSongList[key].includes(val._id)) return true
          }
        }
      }
      return false
    })
  }

  get isLoading() {
    return Object.values(this.loadingMap).includes(true)
  }

  private async fetchProviderSonglist(provider: GenericProvider) {
    this.loadingMap[provider.key] = true
    if (this.generator) {
      for await (const items of this.generator(provider, this.nextPageToken[provider.key])) {
        this.nextPageToken[provider.key] = items.nextPageToken
        for (const s of items.songs) {
          if (!this.songList.find((val) => val._id === s._id)) {
            this.songList.push(s)

            if (!this.optionalSongList[provider.key]) {
              this.optionalSongList[provider.key] = []
            }
            this.optionalSongList[provider.key].push(s._id)
          }
        }
      }
    }

    this.loadingMap[provider.key] = false
  }

  private isFetching = false

  async fetchSongList() {
    this.loadingMap['local'] = true
    this.songList = (await this.localSongFetch?.(convertProxy(vxm.themes.songSortBy))) ?? []
    this.optionalSongList['local'] = this.songList.map((val) => val._id)
    this.loadingMap['local'] = false
  }

  public async fetchAll(afterFetch?: (songs: Song[]) => void, onFetchEnded?: (songCount: number) => void) {
    if (!this.isFetching) {
      this.isFetching = true
      let songListLastSong = this.songList.length - 1

      let count = 0

      for (const key of Object.keys(this.nextPageToken)) {
        while (this.nextPageToken[key]) {
          await this.loadNextPage()
          const newList = this.songList.slice(songListLastSong)
          count += newList.length
          afterFetch?.(newList)
          songListLastSong = this.songList.length
        }
      }

      onFetchEnded?.(count)
      this.isFetching = false
    }
  }

  async loadNextPage() {
    for (const key of Object.keys(this.nextPageToken)) {
      if (this.nextPageToken[key]) {
        for (const [key, checked] of Object.entries(this.activeProviders)) {
          if (checked) {
            await this.fetchRemoteProviderByKey(key)
          }
        }
      }
    }
  }

  private async fetchRemoteProviderByKey(key: string) {
    const provider = this.getProviderByKey(key)
    if (provider) {
      await this.fetchProviderSonglist(provider)
      return
    }
  }

  onProviderChanged({ key, checked }: { key: string; checked: boolean }) {
    this.activeProviders[key] = checked
    if (checked) {
      this.fetchRemoteProviderByKey(key)
    }
  }

  clearSongList() {
    this.songList = []
  }

  clearNextPageTokens() {
    this.nextPageToken = {}
  }

  hasNextPage() {
    return Object.keys(this.nextPageToken).length > 0
  }
}
