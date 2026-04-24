/**
 * Custom source for club-joule (Shinsaibashi).
 *
 * Why custom: the generic parseVenueSchedule() pulls dates from anywhere on
 * the page, so it ends up matching CSS ratios (1.5, 2.25, …) and stale photo
 * captions on club-joule's WordPress theme. The actual upcoming schedule
 * lives in a megamenu carousel rendered into every page:
 *
 *   <article class="splide__slide p-megamenu01__item">
 *     <a href=".../events/{slug}/">
 *       …
 *       <span class="p-megamenu01__date-time">April 24th, 2026</span>
 *       …
 *       <div class="p-megamenu01__title"><span>OSAKA TECHNO MAFIA …</span></div>
 *     </a>
 *   </article>
 *
 * We extract those items directly. Anything outside the megamenu is ignored.
 */

import { VenueSource } from '../source'
import type { ParseResult, RawEvent, RejectedEvent } from '../types'

const ITEM_RE =
  /<article\b[^>]*p-megamenu01__item[^>]*>([\s\S]*?)<\/article>/gi
const HREF_RE = /href="([^"]+)"/i
const DATE_RE = /p-megamenu01__date-time[^>]*>\s*([^<]+?)\s*</i
const TITLE_RE = /p-megamenu01__title[^>]*>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/i

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  // Common abbreviations the theme might emit
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

/**
 * Parse "April 24th, 2026" / "May 1st, 2026" / "Sept 3rd 2026" into ISO.
 * Returns null on anything we don't recognise — caller decides whether to
 * record a rejection.
 */
function parseEnDate(s: string): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s.trim())
  if (!m) return null
  const month = MONTHS[m[1].toLowerCase()]
  if (!month) return null
  const day = Number(m[2])
  const year = Number(m[3])
  if (day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export class ClubJouleSource extends VenueSource {
  readonly id = 'venue:club-joule'
  readonly displayName = 'club JOULE'
  readonly baseUrl: string
  readonly venueId: string

  constructor(args: { baseUrl: string; venueId: string }) {
    super()
    this.baseUrl = args.baseUrl
    this.venueId = args.venueId
  }

  protected override parse(html: string, sourceUrl: string): ParseResult {
    const events: RawEvent[] = []
    const rejected: RejectedEvent[] = []
    const seenUrls = new Set<string>()

    let m: RegExpExecArray | null
    ITEM_RE.lastIndex = 0
    while ((m = ITEM_RE.exec(html)) !== null) {
      const block = m[1]
      const hrefM  = HREF_RE.exec(block)
      const dateM  = DATE_RE.exec(block)
      const titleM = TITLE_RE.exec(block)

      if (!hrefM || !dateM || !titleM) {
        rejected.push({
          rawLine: block.slice(0, 200),
          reason: 'megamenu_item_missing_fields',
          sourceUrl,
        })
        continue
      }

      const url = hrefM[1].trim()
      if (seenUrls.has(url)) continue
      seenUrls.add(url)

      const isoDate = parseEnDate(dateM[1])
      if (!isoDate) {
        rejected.push({ rawLine: dateM[1], reason: 'unparseable_date', sourceUrl: url })
        continue
      }

      events.push({
        eventDate: isoDate,
        titleRaw: titleM[1].trim(),
        sourceUrl: url,
        // Detail fields (open/start/price) live on the per-event page; we'd
        // need a second fetch to pull them. Skip for now — title + date is
        // enough to render a card.
        doorsTime: null,
        startTime: null,
        ticketPriceAdv: null,
        ticketPriceDoor: null,
        ticketUrl: null,
        description: null,
        lineup: [],
        payload: { source: 'club-joule.megamenu' },
      })
    }

    return { events, rejected }
  }
}
