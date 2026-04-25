/**
 * unionwayjp.com — ported to v2.
 *
 * Single-page scrape. Often empty ("現在ライブの予定はありません").
 */

import { AggregatorSource, stripTags, extractDate } from '../source'
import type { ParseResult, RawEvent, RejectedEvent } from '../types'
import { mentionsOsakaVenue, extractOsakaVenueName } from '../../osaka-filter'

const TITLE_NOISE_RE = /^(?:ticket|チケット|料金|information|info|問い合わせ|主催|協力|企画)/i
const HAS_DATE_RE = /\d{1,2}[\/\.\-月]\d{1,2}/

export class UnionwaySource extends AggregatorSource {
  readonly id = 'unionway'
  readonly displayName = 'Unionway JP'
  readonly baseUrl = 'https://unionwayjp.com/'

  protected override parse(html: string, url: string): ParseResult {
    if (/現在ライブの予定はありません/.test(html)) {
      return { events: [], rejected: [] }
    }

    const events: RawEvent[] = []
    const rejected: RejectedEvent[] = []
    const lines = stripTags(html).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

    let currentTitle = ''
    for (const line of lines) {
      // Update current title on uppercase-heavy / punk-tour-styled lines
      if (!HAS_DATE_RE.test(line) && line.length >= 4 && line.length <= 200 && !TITLE_NOISE_RE.test(line)) {
        const upperRatio = (line.match(/[A-Z]/g)?.length ?? 0) / line.length
        if (upperRatio > 0.3 || /TOUR|JAPAN|LIVE/i.test(line)) currentTitle = line
      }

      if (!mentionsOsakaVenue(line)) continue
      const isoDate = extractDate(line)
      if (!isoDate) {
        rejected.push({ rawLine: line, reason: 'no_date_on_osaka_line', sourceUrl: url })
        continue
      }
      if (!currentTitle) {
        rejected.push({ rawLine: line, reason: 'no_preceding_title', sourceUrl: url })
        continue
      }
      const venueHint = extractOsakaVenueName(line) ?? line
      events.push({
        eventDate: isoDate,
        titleRaw: currentTitle,
        venueHint,
        // Single flat page with no per-event anchor or detail URL.
        // Setting the homepage URL would show the same link on every event.
        // Null suppresses the Source button in the UI.
        sourceUrl: null,
        description: line,
        payload: { rawLine: line },
      })
    }

    return { events, rejected }
  }
}
