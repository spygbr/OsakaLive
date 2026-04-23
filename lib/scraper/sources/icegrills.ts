/**
 * icegrills.jp scraper.
 *
 * Two-level crawl — same shape as punx.ts:
 *   1. /tour grid lists ~10 pages of tour thumbnails, each linking to a
 *      per-tour detail page (e.g. /knuckle-puck-japan-2025).
 *   2. Detail pages carry a Japan tour schedule with city + venue rows.
 *      Formatting varies but typically "MM.DD (DOW) CITY / VENUE".
 *
 * Parsing strategy mirrors punx — extract detail links from the index (with
 * pagination), then on each detail page, line-scan for Osaka matches.
 */

import type { AggregatorEvent } from './types'
import { mentionsOsakaVenue, extractOsakaVenueName } from '../osaka-filter'

const SOURCE_SLUG = 'icegrills'
const INDEX_URL   = 'https://icegrills.jp/tour/'

// Grid item links — icegrills.jp uses simple <a href="/slug"><img ...></a> cells
const TOUR_LINK_RE =
  /<a[^>]+href=["'](https?:\/\/icegrills\.jp\/[^"']+|\/[^"']+)["'][^>]*>\s*<img[^>]*>/gi

// Pagination link matcher to discover all pages from page 1
const PAGINATION_RE = /href=["']([^"']*\/tour\/page\/\d+\/?)["']/gi

// Detail-page date line — e.g. "2025.4.12 (SAT) OSAKA / SOCORE FACTORY"
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

/** Extract per-tour detail URLs from an index page. */
export function parseIceGrillsIndex(html: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()

  TOUR_LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOUR_LINK_RE.exec(html)) !== null) {
    let url = m[1]
    if (url.startsWith('/')) url = `https://icegrills.jp${url}`
    // Skip anchor links, category/tag archives, pagination, the /tour root itself
    if (/\/tour\/?(?:page\/\d+\/?)?$/.test(url)) continue
    if (/\/(?:category|tag)\//.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }

  return urls
}

/** Return additional index-page URLs (pagination) discovered from page 1. */
export function parseIceGrillsPagination(html: string): string[] {
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

/**
 * Parse a detail (per-tour) page. We take postTitle from the index (normally
 * the <h1> of the tour detail), then scan for Osaka date lines.
 */
export function parseIceGrillsDetail(
  html: string,
  postTitle: string,
  sourceUrl: string,
): AggregatorEvent[] {
  const out: AggregatorEvent[] = []
  const cleaned = stripTags(html)
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  // Derive a better postTitle from the first H1 if caller didn't supply one
  let title = postTitle
  if (!title) {
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
    if (h1) title = stripTags(h1[1]).trim()
  }
  if (!title) return out

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
      title,
      eventDate:  isoDate,
      venueHint,
      sourceUrl,
      notes:      line.trim(),
    })
  }

  return out
}

export const iceGrillsSource = {
  slug:             SOURCE_SLUG,
  indexUrl:         INDEX_URL,
  parseIndex:       parseIceGrillsIndex,
  parsePagination:  parseIceGrillsPagination,
  parseDetail:      parseIceGrillsDetail,
}
