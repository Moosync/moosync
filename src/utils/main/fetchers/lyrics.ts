import { loadSelectiveArrayPreference } from '../db/preferences'
import { getSpotifyPlayerChannel } from '../ipc'
import { CacheHandler } from './cacheFile'
import { getSongDB } from '@/utils/main/db/index'
import { app } from 'electron'
import { access, readFile } from 'fs/promises'
import path from 'path'

interface AZSuggestions {
  term?: string
  songs?: {
    url: string
    autocomplete: string
  }[]
}

export class LyricsFetcher extends CacheHandler {
  private blocked = false

  constructor() {
    super(path.join(app.getPath('sessionData'), app.getName(), 'azlyrics.cache'), false)
  }

  public async getLyrics(song: Song) {
    const dbLyrics = (
      await getSongDB().getSongByOptions({
        song: {
          _id: song._id,
        },
      })
    )[0]?.lyrics

    if (dbLyrics) return dbLyrics

    const useAzLyrics = loadSelectiveArrayPreference<Checkbox>('lyrics_fetchers.az_lyrics')?.enabled ?? true
    const useGoogleLyrics = loadSelectiveArrayPreference<Checkbox>('lyrics_fetchers.az_lyrics')?.enabled ?? true
    const useSpotifyLyrics = loadSelectiveArrayPreference<Checkbox>('lyrics_fetchers.spotify_lyrics')?.enabled ?? true
    const useGeniusLyrics = loadSelectiveArrayPreference<Checkbox>('lyrics_fetchers.genius_lyrics')?.enabled ?? true

    let lyrics: string | undefined

    const artists = song.artists?.map((val) => val.artist_name ?? '') ?? []
    const title = song.title

    if (song.path) {
      lyrics = await this.findLRCFile(song.path)
    }

    if (!lyrics && useGeniusLyrics) {
      lyrics = await this.queryGenius(artists, title)
    }

    if (!lyrics && useSpotifyLyrics) {
      lyrics = await this.querySpotify(song)
    }

    if (!lyrics && useAzLyrics) {
      lyrics = await this.queryAZLyrics(artists, title)
    }

    if (!lyrics && useGoogleLyrics) {
      lyrics = await this.queryGoogle(artists, title)
    }

    if (lyrics) {
      getSongDB().updateSongLyrics(song._id, lyrics)
    }

    return lyrics
  }

  private async findLRCFile(filePath: string) {
    const lrcFile = filePath.replace(`${path.extname(filePath)}`, '.lrc')
    console.debug('Trying to find LRC file at', lrcFile)

    try {
      await access(lrcFile)
      if (lrcFile) {
        const lrcRegex = /\[\d{2}:\d{2}.\d{2}\]/gm
        const lyricsContent = await readFile(lrcFile, { encoding: 'utf-8' })
        let parsedLyrics = ''
        for (const line of lyricsContent.split('\n')) {
          if (line.match(lrcRegex)) {
            parsedLyrics += line.replaceAll(lrcRegex, '') + '\n'
          }
        }

        return parsedLyrics
      }
    } catch {
      console.debug('Could not find LRC file')
    }
  }

  private async queryAZLyrics(artists: string[], title: string) {
    if (!this.blocked) {
      const baseURL = 'https://search.azlyrics.com/suggest.php?q='
      const sanitizedTitle = this.sanitizeTitle(title)
      const url = this.formulateUrl(baseURL, artists, sanitizedTitle)
      console.debug('Searching for lyrics at', url)

      let resp: AZSuggestions = {}
      try {
        resp = (await this.get(url, undefined, undefined, true)) as AZSuggestions
      } catch (e) {
        console.warn('AZ Lyrics probably blocked this IP. Not using AZ lyrics for this session')
        this.blocked = true
      }

      if (resp.songs && resp.songs.length > 0) {
        const url = resp.songs[0].url
        console.debug('Got lyrics url', url, resp.songs[0].autocomplete)

        const lyricsResp = await this.get(url)

        // const parsed = parse(lyricsResp)
        const lyrics = lyricsResp.split('<div class="ringtone">')[1].split('<div class="noprint"')[0]
        return lyrics
          .substring(lyrics.indexOf('-->') + 3)
          .split('</div>')[0]
          .replaceAll('<br>', '\n')
      }
    }
  }

  private formulateUrl(baseURL: string, artists: string[], title: string, appendLyrics = false) {
    let parsedTitle = title

    // If title contains - then it probably already has artists included in it
    if (appendLyrics) {
      parsedTitle = `${title.trim()} lyrics`
    }

    if (title.split('-').length >= 2) {
      return encodeURI(baseURL + parsedTitle)
    }

    parsedTitle = title.toLowerCase()
    for (const a of artists) {
      parsedTitle.replaceAll(a.toLowerCase(), '')
    }
    return encodeURI(`${baseURL}${artists.join(', ')} - ${parsedTitle}`)
  }

  private sanitizeTitle(title: string) {
    // TODO: Combine all regex in one line
    return title
      .replaceAll(/\((.*?)\)|\[(.*?)\]/gm, '')
      .replaceAll(/(\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDDFF]|\u274C)/g, '')
      .replaceAll(/(?<=\/\/).+/g, '')
      .toLowerCase()
      .replaceAll('official', '')
      .replaceAll('music', '')
      .replaceAll('video', '')
  }

  private async queryGoogle(artists: string[], title: string) {
    const url = this.formulateUrl('https://www.google.com/search?q=', artists, this.sanitizeTitle(title), true)

    console.debug('Searching for lyrics at', url)

    const resp = await this.get(url, undefined, 'https://www.google.com/')

    const final = resp
      ?.split('<div class="BNeawe tAd8D AP7Wnd"><div><div class="BNeawe tAd8D AP7Wnd">')
      .slice(1)
      .join('')
      .split('<div class="BNeawe uEec3 AP7Wnd">')[0]
      .replaceAll(/<(.*?)>/g, '')

    if (final && !final.includes('did not match')) {
      console.debug('Found lyrics on google', url)
      return final
    }
  }

  private async querySpotify(song: Song): Promise<string | undefined> {
    const isSpotifySong = song._id.startsWith('spotify:')
    const spotifyChannel = getSpotifyPlayerChannel()
    if (isSpotifySong && spotifyChannel.isConnected) {
      const trackId = song.url

      const data = await spotifyChannel.command(undefined, {
        type: '',
        responseChannel: '',
        params: {
          command: 'GET_LYRICS',
          args: [`spotify:track:${trackId}`],
        },
      })

      if (data) {
        if (data instanceof Error) {
          console.error(data.message)
          return
        }

        let ret = ''
        for (const line of data.lyrics.lines) {
          ret += line.words + '\n'
        }

        return ret
      }
    }

    return
  }

  private async queryGenius(artists: string[], title: string): Promise<string | undefined> {
    const url = this.formulateUrl('https://genius.com/api/search/song?q=', artists, this.sanitizeTitle(title))
    console.debug('Searching for lyrics at', url)

    try {
      const resp = await this.get<GeniusLyrics.Root>(url, undefined, undefined, true)
      const lyricsUrl = resp?.response?.sections?.[0]?.hits?.[0]?.result?.url

      if (lyricsUrl) {
        const lyricsResp = await this.get(lyricsUrl)

        const split = lyricsResp?.split('window.__PRELOADED_STATE__ = ')
        const parsed = JSON.parse(eval(`${split[1]?.split("');")?.[0]?.replaceAll('JSON.parse(', '')}'`))

        const data = parsed?.songPage?.lyricsData?.body?.html?.replaceAll(new RegExp(/(<([^>]+)>)/, 'ig'), '')
        return data
      }
    } catch (e) {
      console.warn('Failed to parse genius lyrics', url)
    }
  }
}
