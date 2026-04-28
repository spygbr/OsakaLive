/**
 * punxsavetheearth.com — ported to the v2 Source contract.
 *
 * Two-level crawl:
 *   1. Index page lists tour announcements; each links to a detail post.
 *   2. Detail post contains a schedule block with one line per stop. We emit
 *      one RawEvent per Osaka line; non-Osaka lines are dropped (not rejected,
 *      since they're explicitly out-of-scope rather than malformed).
 *
 * Differences vs v1:
 *   - Subclasses AggregatorSource and uses ctx.http() so the runner can
 *     short-circuit on the index page's ETag / hash.
 *   - stripTags / extractDate come from the shared base helpers.
 *   - Returns ParseResult (events + rejected) instead of a flat array.
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

const ARTICLE_LINK_RE =
  /<article[^>]*>[\s\S]*?<a[^>]+href=["'](https:\/\/punxsavetheearth\.com\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi

export class PunxSource extends AggregatorSource {
  readonly id = 'punx'
  readonly displayName = 'Punx Save The Earth'
  readonly baseUrl = 'https://punxsavetheearth.com/category/live-info/'

  /** Override run() because we need to crawl detail pages after the index. */
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

    const detailLinks = parseIndex(indexPage.body)

    const events: RawEvent[] = []
    const rejected: RejectedEvent[] = []

    for (const link of detailLinks) {
      let detailHtml: string
      try {
        const page = await ctx.http(link.url)
        detailHtml = page.body
      } catch (e) {
        rejected.push({
          rawLine: link.url,
          reason: 'detail_fetch_failed',
          sourceUrl: link.url,
          payload: { error: (e as Error).message },
        })
        continue
      }
      parseDetail(detailHtml, link.title, link.url, events, rejected)
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

// ── Helpers ────────────────────────────────────────────────────────────────

/** Detail URLs + post titles from the category index page. */
export function parseIndex(html: string): Array<{ url: string; title: string }> {
  const out: Array<{ url: string; title: string }> = []
  const seen = new Set<string>()
  ARTICLE_LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ARTICLE_LINK_RE.exec(html)) !== null) {
    const [, url, inner] = m
    if (/\/category\/|\/tag\//.test(url)) continue
    if (/\/page\/\d+/.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)
    const title = stripTags(inner).trim().slice(0, 200)
    if (title.length > 0) out.push({ url, title })
  }
  return out
}

/** Walk the schedule block; emit one RawEvent per Osaka stop. */
export function parseDetail(
  html: string,
  postTitle: string,
  sourceUrl: string,
  outEvents: RawEvent[],
  outRejected: RejectedEvent[],
): void {
  const lines = stripTags(html)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  for (const line of lines) {
    if (!mentionsOsakaVenue(line)) continue
    const isoDate = extractDate(line)
    if (!isoDate) {
      outRejected.push({
        rawLine: line,
        reason: 'no_date_on_osaka_line',
        sourceUrl,
      })
      continue
    }
    const venueHint = extractOsakaVenueName(line) ?? line
    outEvents.push({
      eventDate: isoDate,
      titleRaw: postTitle,
      venueHint,
      sourceUrl,
      description: line,
      payload: { rawLine: line, postTitle },
    })
  }
}
