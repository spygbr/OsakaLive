/**
 * HTTP fetch with timeout, ETag / Last-Modified support, and content hashing.
 *
 * Sources call this instead of bare fetch() so the runner can short-circuit
 * unchanged pages without re-parsing.
 */

import { createHash } from 'node:crypto'
import type { FetchedPage } from './types'

const DEFAULT_TIMEOUT_MS = 15_000
const RETRY_AFTER_CAP_MS = 30_000
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

/** Parse Retry-After header → milliseconds, capped at RETRY_AFTER_CAP_MS. */
function parseRetryAfterMs(header: string | null): number {
  if (!header) return 800
  const secs = Number(header.trim())
  if (!Number.isNaN(secs) && secs > 0) {
    return Math.min(secs * 1000, RETRY_AFTER_CAP_MS)
  }
  // HTTP-date format
  const date = Date.parse(header)
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - Date.now(), 0), RETRY_AFTER_CAP_MS)
  }
  return 800
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

  // Up to 3 attempts for 429/503; 2 attempts for transient network errors.
  // Respects Retry-After header on 429/503, falls back to 800ms otherwise.
  let lastErr: unknown
  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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

      // 429 / 503 — rate-limited or temporarily unavailable: honour Retry-After.
      if (res.status === 429 || res.status === 503) {
        if (attempt < maxAttempts - 1) {
          const waitMs = parseRetryAfterMs(res.headers.get('retry-after'))
          await new Promise((r) => setTimeout(r, waitMs))
          continue
        }
        throw new Error(`HTTP ${res.status} ${res.statusText}`)
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
      // Don't retry HTTP-status errors (already thrown above for non-429/503).
      const msg = (e as Error).message ?? ''
      if (msg.startsWith('HTTP ')) throw e
      // Network/timeout errors: one retry with fixed 800ms backoff.
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800))
      else break
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}
