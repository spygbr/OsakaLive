/**
 * udiscovermusic.jp — ported to v2.
 *
 * Single long-form aggregator page. The default Source.run() handles fetching
 * and cache-checking; we only implement parse().
 */

import { AggregatorSource, stripTags, jstYear } from '../source'
import type { ParseResult, RawEvent, RejectedEvent } from '../types'
import { mentionsOsakaVenue, extractOsakaVenueName } from '../../osaka-filter'

const EVENT_RE = /(\d{1,2})月(\d{1,2})日\s*[（(]([^）)]+)[）)]/g
const YEAR_PREFIX_RE = /(\d{4})年\s*(?=\d{1,2}月)/
const TITLE_NOISE_RE = /^(?:チケット|販売|発売|一般|料金|問い合わせ|主催|公演|共演)/

export class UDiscoverSource extends AggregatorSource {
  readonly id = 'udiscover'
  readonly displayName = 'uDiscover Music JP'
  readonly baseUrl = 'https://www.udiscovermusic.jp/news/2022-coming-to-japan-musicians'

  protected override parse(html: string, url: string): ParseResult {
    const events: RawEvent[] = []
    const rejected: RejectedEvent[] = []
    const cleaned = stripTags(html)
    const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

    const yrMatch = YEAR_PREFIX_RE.exec(cleaned)
    const defaultYear = yrMatch ? Number(yrMatch[1]) : jstYear()

    let currentTitle = ''
    for (const line of lines) {
      if (!EVENT_RE.test(line) && line.length >= 3 && line.length <= 120 && !/^[※＊*]/.test(line)) {
        if (!TITLE_NOISE_RE.test(line)) currentTitle = line
      }
      EVENT_RE.lastIndex = 0

      let m: RegExpExecArray | null
      while ((m = EVENT_RE.exec(line)) !== null) {
        const [, mm, dd, paren] = m
        if (!mentionsOsakaVenue(paren)) continue
        const month = Number(mm), day = Number(dd)
        if (month < 1 || month > 12 || day < 1 || day > 31) continue

        const inlineYear = YEAR_PREFIX_RE.exec(line.slice(0, m.index))
        const year = inlineYear ? Number(inlineYear[1]) : defaultYear
        const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const venueHint = extractOsakaVenueName(paren) ?? paren.trim()

        if (!currentTitle) {
          rejected.push({ rawLine: line, reason: 'no_preceding_title', sourceUrl: url })
          continue
        }

        events.push({
          eventDate: isoDate,
          titleRaw: currentTitle,
          venueHint,
          sourceUrl: url,
          description: paren.trim(),
          payload: { rawParen: paren.trim() },
        })
      }
      EVENT_RE.lastIndex = 0
    }

    return { events, rejected }
  }
}
