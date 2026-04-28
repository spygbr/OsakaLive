/**
 * icegrills.jp — ported to v2.
 *
 * Three-stage crawl:
 *   1. /tour index page (cache-checked)
 *   2. Pagination links from index → fetch every page
 *   3. Detail link per tour → scan for Osaka date lines
 */

import {
  AggregatorSource,
  type RunContext,
  type RunOutput,
  stripTags,
  extractDate,
} from '../source'
import type { RawEvent, RejectedEvent } from '../types'
import { mentionsOsakaVenue, extractOsakaVenueName } from '../osaka-filter'

const TOUR_LINK_RE =
  /<a[^>]+href=["'](https?:\/\/icegrills\.jp\/[^"']+|\/[^"']+)["'][^>]*>\s*<img[^>]*>/gi
const PAGINATION_RE = /href=["']([^"']*\/tour\/page\/\d+\/?)["']/gi

export class IceGrillsSource extends AggregatorSource {
  readonly id = 'icegrills'
  readonly displayName = 'Ice Grills'
  readonly baseUrl = 'https://icegrills.jp/tour/'

  override async run(ctx: RunContext): Promise<RunOutput> {
    const indexPage = await ctx.http(this.baseUrl, {
      etag: ctx.prevEtag,
      lastModified: ctx.prevLastModified,
    })

    const indexCacheHit =
      indexPage.notModified ||
      (ctx.prevHash != null && ctx.prevHash === indexPage.contentHash)

    if (indexCacheHit) {
      return {
        events: [],
        rejected: [],
        notModified: true,
        entryEtag: indexPage.etag ?? ctx.prevEtag,
        entryLastModified: indexPage.lastModified ?? ctx.prevLastModified,
        entryHash: indexPage.contentHash || ctx.prevHash,
      }
    }

    // Collect detail URLs from page 1 + every paginated index page
    const detailUrls = new Set<string>(parseTourLinks(indexPage.body))
    const paginatedPages = parsePagination(indexPage.body)
    for (const pageUrl of paginatedPages) {
      try {
        const p = await ctx.http(pageUrl)
        for (const u of parseTourLinks(p.body)) detailUrls.add(u)
      } catch { /* skip individual page failures */ }
    }

    const events: RawEvent[] = []
    const rejected: RejectedEvent[] = []

    for (const url of detailUrls) {
      try {
        const detail = await ctx.http(url)
        const title = extractH1(detail.body) || ''
        if (!title) {
          rejected.push({ rawLine: url, reason: 'detail_no_title', sourceUrl: url })
          continue
        }
        parseDetail(detail.body, title, url, events, rejected)
      } catch (e) {
        rejected.push({
          rawLine: url,
          reason: 'detail_fetch_failed',
          sourceUrl: url,
          payload: { error: (e as Error).message },
        })
      }
    }

    return {
      events,
      rejected,
      notModified: false,
      entryEtag: indexPage.etag,
      entryLastModified: indexPage.lastModified,
      entryHash: indexPage.contentHash,
    }
  }
}

function parseTourLinks(html: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  TOUR_LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOUR_LINK_RE.exec(html)) !== null) {
    let url = m[1]
    if (url.startsWith('/')) url = `https://icegrills.jp${url}`
    if (/\/tour\/?(?:page\/\d+\/?)?$/.test(url)) continue
    if (/\/(?:category|tag)\//.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}

function parsePagination(html: string): string[] {
  const urls = new Set<string>()
  PAGINATION_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PAGINATION_RE.exec(html)) !== null) {
    let url = m[1]
    if (url.startsWith('/')) url = `https://icegrills.jp${url}`
    urls.add(url)
  }
  return Array.from(urls)
}

function extractH1(html: string): string {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  return m ? stripTags(m[1]).trim() : ''
}

function parseDetail(
  html: string,
  title: string,
  sourceUrl: string,
  outEvents: RawEvent[],
  outRejected: RejectedEvent[],
): void {
  const lines = stripTags(html).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (!mentionsOsakaVenue(line)) continue
    const isoDate = extractDate(line)
    if (!isoDate) {
      outRejected.push({ rawLine: line, reason: 'no_date_on_osaka_line', sourceUrl })
      continue
    }
    const venueHint = extractOsakaVenueName(line) ?? line
    outEvents.push({
      eventDate: isoDate,
      titleRaw: title,
      venueHint,
      sourceUrl,
      description: line,
      payload: { rawLine: line },
    })
  }
}
