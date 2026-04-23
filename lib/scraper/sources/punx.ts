/**
 * punxsavetheearth.com scraper.
 *
 * Two-level crawl:
 *   1. Index page /category/live-info/ lists touring bands coming to Japan.
 *      Each entry is a card linking to a detail post (tour announcement).
 *      City/venue info is NOT on the index — we must visit each detail page.
 *   2. Detail page contains the schedule block with JP-formatted lines like:
 *        "2026.5.12 (tue) 大阪 Namba Bears"
 *        "5/13 (水) OSAKA SOCORE FACTORY  OPEN 18:30 / START 19:00"
 *
 * Strategy:
 *   - parseIndex() returns detail URLs + post titles (used as event title)
 *   - parseDetail() walks the schedule block and emits one AggregatorEvent per
 *     Osaka date. Non-Osaka lines are discarded here (no need to carry them).
 */

import type { AggregatorEvent } from './types'
import { mentionsOsakaVenue, extractOsakaVenueName } from '../osaka-filter'

const SOURCE_SLUG = 'punx'
const INDEX_URL   = 'https://punxsavetheearth.com/category/live-info/'

// WordPress "Read More" / article links on the category page
// The site uses standard <article><a href="..."> patterns
const ARTICLE_LINK_RE =
  /<article[^>]*>[\s\S]*?<a[^>]+href=["'](https:\/\/punxsavetheearth\.com\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi

// Date patterns on detail pages
// 2026.5.12 / 2026/5/12 / 5.12 / 5/12
const DATE_LINE_RE =
  /(?:(\d{4})[.\/\-])?(\d{1,2})[.\/\-](\d{1,2})\s*(?:\([^)]*\))?\s*(.+)?/

function jstYear(): number {
  return new Date(Date.now() + 9 * 3600 * 1000).getFullYear()
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(?:h[1-6]|p|div|li|section|article|tr|td)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]{2,}/g, ' ')
}

/** Returns detail URLs discovered on the category index page, with post titles. */
export function parsePunxIndex(html: string): Array<{ url: string; title: string }> {
  const results: Array<{ url: string; title: string }> = []
  const seen = new Set<string>()

  ARTICLE_LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ARTICLE_LINK_RE.exec(html)) !== null) {
    const [, url, inner] = m
    // Skip category/tag archive links
    if (/\/category\/|\/tag\//.test(url)) continue
    // Skip pagination links
    if (/\/page\/\d+/.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)

    const title = stripTags(inner).trim().slice(0, 200)
    if (title.length > 0) results.push({ url, title })
  }

  return results
}

/**
 * Parse a detail post. postTitle comes from the index (artist/tour name).
 * Returns Osaka-only events.
 */
export function parsePunxDetail(
  html: string,
  postTitle: string,
  sourceUrl: string,
): AggregatorEvent[] {
  const out: AggregatorEvent[] = []
  const cleaned = stripTags(html)
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  for (const line of lines) {
    if (!mentionsOsakaVenue(line)) continue
    const m = DATE_LINE_RE.exec(line)
    if (!m) continue
    const [, yyyy, mm, dd] = m
    const year  = yyyy ? parseInt(yyyy, 10) : jstYear()
    const month = parseInt(mm, 10)
    const day   = parseInt(dd, 10)
    if (isNaN(year) || isNaN(month) || isNaN(day)) continue
    if (month < 1 || month > 12 || day < 1 || day > 31) continue

    const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const venueHint = extractOsakaVenueName(line) ?? line.trim()

    out.push({
      sourceSlug: SOURCE_SLUG,
      title:      postTitle,
      eventDate:  isoDate,
      venueHint,
      sourceUrl,
      notes:      line.trim(),
    })
  }

  return out
}

export const punxSource = {
  slug:        SOURCE_SLUG,
  indexUrl:    INDEX_URL,
  parseIndex:  parsePunxIndex,
  parseDetail: parsePunxDetail,
}
