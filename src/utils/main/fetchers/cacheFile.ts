import { promises as fsP } from 'fs'
import https from 'https'
import path from 'path'

type Cache = { [key: string]: { expiry: number; data: string } }

export class CacheHandler {
  protected cache: Cache = {}
  private cacheFile: string
  private cacheDir: string
  private tryJson = true

  constructor(cacheFile: string, tryJson = true) {
    this.cacheFile = cacheFile
    this.cacheDir = path.dirname(cacheFile)
    this.tryJson = tryJson
    this.readCache()
  }

  protected async dumpCache() {
    this.makeCacheDir()

    try {
      await fsP.writeFile(this.cacheFile, JSON.stringify(this.cache), { encoding: 'utf-8' })
    } catch (e) {
      console.error('Failed to write to cache at', this.cacheFile, e)
    }
  }

  protected async readCache() {
    this.makeCacheDir()

    try {
      const data = await fsP.readFile(this.cacheFile, { encoding: 'utf-8' })
      this.cache = JSON.parse(data)
    } catch (e) {
      console.warn(
        'Cache file',
        this.cacheFile,
        'does not exists (This may happen if the app is run for the first time).',
      )
      await this.dumpCache()
    }
  }

  protected async addToCache(url: string, data: string, exp?: number) {
    try {
      if (this.tryJson && JSON.parse(data)) {
        const expiry = exp ?? Date.now() + 2 * 60 * 60 * 1000
        this.cache[url] = { expiry, data }
        await this.dumpCache()
      }
    } catch (e) {
      console.warn('Data cant be parsed to JSON. Not storing in cache')
    }
  }

  protected getCache(url: string): string | undefined {
    const data = this.cache[url]
    if (data && data.expiry > Date.now()) {
      return data.data
    }
  }

  private async makeCacheDir() {
    try {
      await fsP.access(this.cacheDir)
    } catch (_) {
      await fsP.mkdir(this.cacheDir, { recursive: true })
    }
  }

  private randomUserAgent() {
    const agents = [
      'Mozilla/5.0 (Windows; U; Windows NT 5.1; it; rv:1.8.1.11) Gecko/20071127 Firefox/2.0.0.11',
      'Mozilla/5.0 (iPad; CPU OS 8_4_1 like Mac OS X) AppleWebKit/600.1.4 (KHTML, like Gecko) Version/8.0 Mobile/12H321 Safari/600.1.4',
      'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; SV1; .NET CLR 1.1.4322; .NET CLR 2.0.50727)',
      'Mozilla/5.0 (compatible; Konqueror/3.5; Linux) KHTML/3.5.5 (like Gecko) (Kubuntu)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.79 Safari/537.36 Edge/14.14393',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.7; rv:11.0) Gecko/20100101 Firefox/11.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:53.0) Gecko/20100101 Firefox/53.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
    ]

    return agents[Math.floor(Math.random() * agents.length)]
  }

  protected async get<T = string>(
    url: string,
    headers?: Record<string, string>,
    referrer?: string,
    tryJson = false,
    invalidateCache = false,
  ): Promise<T> {
    if (!invalidateCache) {
      const cached = this.getCache(url)
      if (cached) {
        console.debug('Cache-hit', url)
        try {
          return tryJson ? JSON.parse(cached) : cached
        } catch (e) {
          console.error(e)
        }
      }
    }

    console.debug('Cache-miss', url)

    return new Promise((resolve, reject) => {
      const parsed = new URL(url)
      const options: https.RequestOptions = {
        path: parsed.pathname + parsed.search,
        hostname: parsed.hostname,
        headers: { 'User-Agent': this.randomUserAgent(), referer: referrer ?? '', ...headers },
      }
      const request = https.get(options, (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            this.addToCache(parsed.toString(), data)

            if (tryJson) {
              resolve(JSON.parse(data))
              return
            }
            resolve(data as T)
          } catch (e) {
            console.warn('Failed to parse result from', parsed, 'to JSON')
            reject(e)
          }
        })
      })

      request.on('error', function (e) {
        reject(e.message)
      })

      request.end()
    })
  }
}
