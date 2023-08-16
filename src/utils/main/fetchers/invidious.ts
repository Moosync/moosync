import { loadSelectivePreference } from '../db/preferences'
import { CacheHandler } from './cacheFile'
import { app } from 'electron'
import path from 'path'

export class InvidiousRequester extends CacheHandler {
  constructor() {
    super(path.join(app.getPath('sessionData'), app.getName(), 'invidious.cache'))
  }

  public async makeInvidiousRequest<
    T extends InvidiousResponses.InvidiousApiResources,
    K extends InvidiousResponses.SearchTypes,
  >(
    resource: T,
    search: InvidiousResponses.SearchObject<T, K>,
    authorization?: string | undefined,
    invalidateCache = false,
  ): Promise<InvidiousResponses.ResponseType<T, K> | undefined> {
    let BASE_URL = loadSelectivePreference<string>('invidious_instance')

    if (BASE_URL) {
      if (!BASE_URL.startsWith('http')) {
        BASE_URL = `https://${BASE_URL}`
      }

      let parsedResource: string = resource
      if (search.params) {
        const matches = resource.matchAll(new RegExp(/\{(.*?)\}/g))
        if (matches) {
          for (const match of matches) {
            parsedResource = parsedResource.replaceAll(match[0], (search.params as { [key: string]: string })[match[1]])
          }
        }
      }

      const url = `${BASE_URL}/api/v1/${parsedResource}`
      const parsed = new URL(url)
      if (search.params) {
        for (const [key, value] of Object.entries(search.params)) {
          if (value) {
            parsed.searchParams.set(key, value?.toString())
          }
        }
      }

      try {
        const resp = (await this.request(parsed, authorization, invalidateCache)) as InvidiousResponses.ResponseType<
          T,
          K
        >
        return resp
      } catch (e) {
        console.error('Error in invidious', e)
      }
    }
  }

  private request(parsed: URL, authorization?: string, invalidateCache = false) {
    const headers: { [key: string]: string } = { 'Content-Type': 'application/json' }
    if (authorization) {
      headers['Authorization'] = `Bearer ${authorization}`
    }
    return this.get<unknown>(parsed.toString(), headers, undefined, true, invalidateCache)
  }
}
