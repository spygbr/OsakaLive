/**
 * HTTP fetch with timeout, ETag / Last-Modified support, and content hashing.
 *
 * Sources call this instead of bare fetch() so the runner can short-circuit
 * unchanged pages without re-parsing.
 */

import { createHash } from 'node:crypto'
import type { FetchedPage } from './types'

const DEFAULT_TIMEOUT_MS = 15_000
// Plain desktop-Chrome UA. Some venues (banana-hall) WAF-block anything with
// "bot" in the User-Agent string. We're polite — low rate, robots.txt-respecting
// in spirit — but identifying as a bot trips overzealous filters.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export type FetchOptions = {
  timeoutMs?: number
  /** Previously seen ETag — sent as If-None-Match. */
  etag?: string | null
  /** Previously seen Last-Modified — sent as If-Modified-Since. */
  lastModified?: string | null
  /** Extra headers (overrides defaults). */
  headers?: Record<string, string>
}

export async function fetchPage(
  url: string,
  opts: FetchOptions = {},
): Promise<FetchedPage> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja,en;q=0.5',
    ...(opts.etag         ? { 'If-None-Match':     opts.etag }         : {}),
    ...(opts.lastModified ? { 'If-Modified-Since': opts.lastModified } : {}),
    ...opts.headers,
  }

  // One retry with short backoff — covers transient TCP/TLS hiccups on JP hosts
  // without making a flaky source block the whole cron for ~30s.
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers, redirect: 'follow' })

      if (res.status === 304) {
        return {
          url,
          body: '',
          etag: opts.etag ?? null,
          lastModified: opts.lastModified ?? null,
          contentHash: '',
          notModified: true,
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

      const body = await res.text()
      return {
        url,
        body,
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
        contentHash: createHash('sha1').update(body).digest('hex'),
        notModified: false,
      }
    } catch (e) {
      lastErr = e
      // Don't retry HTTP-status errors (4xx/5xx) — those won't change.
      const msg = (e as Error).message ?? ''
      if (msg.startsWith('HTTP ')) throw e
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}
