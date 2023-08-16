import { getSongDB } from '../db'
import { CacheHandler } from './cacheFile'
import { createHash } from 'crypto'
import { app } from 'electron'
import path from 'path'
import { setTimeout } from 'timers/promises'

const musicBrainzHeaders = {
  'User-Agent': `moosync/${process.env.MOOSYNC_VERSION.toString()} (ovenoboyo@gmail.com)`,
}

export class MetadataFetcher extends CacheHandler {
  private lastMusicBrainzCall = 0

  protected async get<T = string>(
    url: string,
    headers?: Record<string, string>,
    referrer?: string,
    tryJson?: boolean,
    invalidateCache?: boolean,
  ): Promise<T> {
    const isMusicbrainzRequest = url.startsWith('https://musicbrainz.org/')
    if (isMusicbrainzRequest) {
      const callAfter = this.lastMusicBrainzCall + 1000
      if (Date.now() < callAfter) {
        await setTimeout(callAfter - Date.now())
        this.lastMusicBrainzCall = Date.now() + 100
      }
    }
    return super.get<T>(url, headers, referrer, tryJson, invalidateCache)
  }

  constructor() {
    super(path.join(app.getPath('sessionData'), app.getName(), 'metadata.cache'))
  }

  private sanitizeArtistName(name: string) {
    return name.trim().replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replaceAll('vevo', '')
  }

  public async fetchMBID(artists: Artists[]) {
    for (const a of artists) {
      if (!a.artist_mbid && a.artist_name) {
        const resp = await this.get<MusicBrainz.ArtistSearchResponse>(
          `https://musicbrainz.org/ws/2/artist/?limit=1&query=artist:${this.sanitizeArtistName(
            a.artist_name,
          )}&fmt=json`,
          musicBrainzHeaders,
          undefined,
          true,
        )

        if (resp.artists?.[0]) {
          a.artist_mbid = resp.artists[0].id
          await getSongDB().updateArtists(a)
        }
      }

      if (a.artist_mbid && !a.artist_coverPath) {
        await this.fetchArtwork(a)
      }
    }
  }

  public async fetchArtwork(...artists: Artists[]) {
    for (const a of artists) {
      const url = (await this.getFanartTvImage(a)) ?? (await this.getMusicBrainzImage(a))
      a.artist_coverPath = url
      await getSongDB().updateArtists(a)
    }
  }

  private async getFanartTvImage(artist: Artists) {
    if (artist.artist_mbid) {
      const resp = await this.get<FanartTv.ArtistQuery>(
        `http://webservice.fanart.tv/v3/music/${artist.artist_mbid}?api_key=68746a37e506c5fe70c80e13dc84d8b2`,
        undefined,
        undefined,
        true,
      )

      return resp.artistthumb?.sort((a, b) => parseInt(b.likes) - parseInt(a.likes))?.[0].url
    }
  }

  private async getMusicBrainzImage(artist: Artists) {
    if (artist.artist_mbid) {
      const resp = await this.get<MusicBrainz.ArtistInfo>(
        `https://musicbrainz.org/ws/2/artist/${encodeURIComponent(artist.artist_mbid)}?inc=url-rels&fmt=json`,
        musicBrainzHeaders,
        undefined,
        true,
      )

      const imageUrl = resp.relations?.find((val) => val.type === 'image')?.url?.resource
      const finalUrl = imageUrl && (await this.getImageUrl(imageUrl))
      return finalUrl
    }
  }

  private async getImageUrl(url: string) {
    const parsed = new URL(url)
    switch (parsed.hostname) {
      case 'commons.wikimedia.org':
        return this.getWikiMediaImage(parsed)
    }
  }

  private async getWikiMediaImage(url: URL) {
    const fileName = url.pathname.substring(url.pathname.lastIndexOf('/') + 1)
    const resp = await this.get<Wikimedia.FileNameQuery>(
      `https://commons.wikimedia.org/w/api.php?action=query&redirects=1&titles=${fileName}&format=json`,
      undefined,
      undefined,
      true,
    )

    const parsedFileName =
      Object.values(resp?.query?.pages)?.[0]?.title?.replace('File:', '')?.replaceAll(/\s+/g, '_') ?? fileName
    const md5 = createHash('md5').update(parsedFileName).digest('hex')
    return encodeURI(`https://upload.wikimedia.org/wikipedia/commons/${md5[0]}/${md5[0] + md5[1]}/${parsedFileName}`)
  }
}
