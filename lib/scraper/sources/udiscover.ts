/**
 * udiscovermusic.jp scraper.
 *
 * Single long-form aggregator page listing overseas artists touring Japan for
 * the current year. Title on the source reads "YYYY年 海外アーティスト来日公演情報まとめ【随時更新】".
 *
 * Page shape:
 *   - Artist headline (H2-ish) followed by a block of event lines
 *   - Event lines look like "4月16日（大阪　フェスティバルホール）"
 *     or "5月7日（大阪 フェスティバルホール）"
 *   - Sometimes the year prefix is present: "2026年4月16日..."
 *
 * Strategy: single fetch, extract every "M月D日（venue）" occurrence, pair with
 * the nearest preceding H1/H2/H3 heading as the artist/tour title, filter for
 * Osaka via the shared osaka-filter.
 */

import type { AggregatorEvent } from './types'
import { mentionsOsakaVenue, extractOsakaVenueName } from '../osaka-filter'

const SOURCE_SLUG = 'udiscover'
const SOURCE_URL  = 'https://www.udiscovermusic.jp/news/2022-coming-to-japan-musicians'

// "4月16日（大阪 フェスティバルホール）" — captures month, day, and the paren contents
const EVENT_RE =
  /(\d{1,2})月(\d{1,2})日\s*[（(]([^）)]+)[）)]/g

// Year prefix sometimes appears inline: "2026年4月16日..."
const YEAR_PREFIX_RE = /(\d{4})年\s*(?=\d{1,2}月)/

function jstYear(): number {
  return new Date(Date.now() + 9 * 3600 * 1000).getFullYear()
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(?:h[1-6]|p|div|li|section|article)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8230;/g, '…')
    .replace(/[ \t]{2,}/g, ' ')
}

/**
 * Given a split-by-newlines array of text lines, walk forward looking for
 * EVENT_RE matches. The "current heading" is updated whenever we see a line
 * that looks like a standalone artist/tour title (non-empty, no date pattern,
 * length between 3 and 120, no leading hiragana particles — a rough heuristic).
 */
export function parseUdiscoverEvents(html: string): AggregatorEvent[] {
  const out: AggregatorEvent[] = []
  const cleaned = stripTags(html)
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  let currentTitle = ''
  // If the whole page has a year prefix somewhere (e.g. "2026年 海外..." header), use that.
  const yrMatch = YEAR_PREFIX_RE.exec(cleaned)
  const defaultYear = yrMatch ? parseInt(yrMatch[1], 10) : jstYear()

  for (const line of lines) {
    // Title heuristic: line without any "M月D日" and reasonably short
    if (!EVENT_RE.test(line) && line.length >= 3 && line.length <= 120 && !/^[※＊*]/.test(line)) {
      // Skip obvious boilerplate
      if (/^(?:チケット|販売|発売|一般|料金|問い合わせ|主催|公演|共演)/.test(line)) continue
      // Looks like a title — update
      currentTitle = line
    }
    EVENT_RE.lastIndex = 0

    // Extract every date on this line
    let m: RegExpExecArray | null
    while ((m = EVENT_RE.exec(line)) !== null) {
      const [, mm, dd, paren] = m
      if (!mentionsOsakaVenue(paren)) continue

      const month = parseInt(mm, 10)
      const day   = parseInt(dd, 10)
      if (isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) continue

      // Year: look backwards in this line for an inline "YYYY年" override
      const inlineYear = YEAR_PREFIX_RE.exec(line.slice(0, m.index))
      const year = inlineYear ? parseInt(inlineYear[1], 10) : defaultYear

      const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const venueHint = extractOsakaVenueName(paren) ?? paren.trim()

      if (!currentTitle) continue // nothing to attach to

      out.push({
        sourceSlug: SOURCE_SLUG,
        title:      currentTitle,
        eventDate:  isoDate,
        venueHint,
        sourceUrl:  SOURCE_URL,
        notes:      paren.trim(),
      })
    }
    EVENT_RE.lastIndex = 0
  }

  // Dedupe by (date, title)
  const seen = new Set<string>()
  return out.filter((e) => {
    const key = `${e.eventDate}:${e.title.slice(0, 40).toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const udiscoverSource = {
  slug:      SOURCE_SLUG,
  indexUrl:  SOURCE_URL,
  parseIndex: parseUdiscoverEvents,
}
