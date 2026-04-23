/**
 * unionwayjp.com scraper.
 *
 * Promoter site with a "Latest Schedule" block on the homepage + news posts
 * that announce individual tour dates. Volume is low ("現在ライブの予定はありません"
 * is a common state), but the outputs are high-signal when present — Unionway
 * brings touring punk/alt-rock acts through Osaka clubs.
 *
 * Strategy:
 *   - Single-page scrape of the homepage
 *   - Extract date-lines that mention Osaka venues
 *   - Titles come from the nearest preceding H2/H3/article heading
 *   - Same filter as other aggregators
 */

import type { AggregatorEvent } from './types'
import { mentionsOsakaVenue, extractOsakaVenueName } from '../osaka-filter'

const SOURCE_SLUG = 'unionway'
const INDEX_URL   = 'https://unionwayjp.com/'

// Match dates formatted as:  2025/4/12  |  2025.4.12  |  4/12 (Sat)  |  4月12日
const DATE_TOKEN_RE =
  /(?:(\d{4})[.\/\-年])?\s*(\d{1,2})[.\/\-月](\d{1,2})日?/

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

export function parseUnionwayEvents(html: string): AggregatorEvent[] {
  // Short-circuit the "no scheduled events" state
  if (/現在ライブの予定はありません/.test(html)) return []

  const cleaned = stripTags(html)
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  const out: AggregatorEvent[] = []
  let currentTitle = ''

  for (const line of lines) {
    // Title heuristic: uppercase-heavy line without a date, between 4 and 200 chars
    if (!/\d{1,2}[\/\.\-月]\d{1,2}/.test(line) && line.length >= 4 && line.length <= 200) {
      // Skip obvious boilerplate
      if (/^(?:ticket|チケット|料金|information|info|問い合わせ|主催|協力|企画)/i.test(line)) continue
      // Punk/alt-rock titles tend to be uppercase or Title Case — light check
      const upperRatio = (line.match(/[A-Z]/g)?.length ?? 0) / line.length
      if (upperRatio > 0.3 || /TOUR|JAPAN|LIVE/i.test(line)) {
        currentTitle = line
      }
    }

    if (!mentionsOsakaVenue(line)) continue
    const m = DATE_TOKEN_RE.exec(line)
    if (!m) continue
    const [, yyyy, mm, dd] = m
    const year  = yyyy ? parseInt(yyyy, 10) : jstYear()
    const month = parseInt(mm, 10)
    const day   = parseInt(dd, 10)
    if (isNaN(year) || isNaN(month) || isNaN(day)) continue
    if (month < 1 || month > 12 || day < 1 || day > 31) continue

    const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const venueHint = extractOsakaVenueName(line) ?? line.trim()

    if (!currentTitle) continue

    out.push({
      sourceSlug: SOURCE_SLUG,
      title:      currentTitle,
      eventDate:  isoDate,
      venueHint,
      sourceUrl:  INDEX_URL,
      notes:      line.trim(),
    })
  }

  return out
}

export const unionwaySource = {
  slug:       SOURCE_SLUG,
  indexUrl:   INDEX_URL,
  parseIndex: parseUnionwayEvents,
}
