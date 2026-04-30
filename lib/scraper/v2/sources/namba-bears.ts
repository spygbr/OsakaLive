/**
 * Custom source for Namba BEARS.
 *
 * Why custom: the venue schedule page embeds event flyer images directly as
 * `<a href="img/FLYER/MMDD.jpg">` within each event table. There are no
 * per-event detail pages. The generic parseVenueSchedule() strips HTML tags
 * and loses these links entirely.
 *
 * Structure per event:
 *   <table>
 *     <tr><th colspan="2">4月27日（月）<br>open18:30 start19:00　¥2000</th></tr>
 *     <tr>
 *       <td width="610">Title / lineup text</td>
 *       <td width="180">
 *         <a href="img/FLYER/0427.jpg" data-lightbox="group">...</a>
 *       </td>
 *     </tr>
 *   </table>
 *
 * We parse each <table> block and set sourceUrl to the resolved absolute flyer
 * URL. The image runner detects that sourceUrl is a direct image (via HEAD
 * content-type check) and downloads it without HTML extraction.
 */

import { VenueSource } from '../source'
import type { ParseResult, RawEvent, RejectedEvent } from '../types'

const TABLE_RE    = /<table[\s\S]*?<\/table>/gi
const JP_DATE_RE  = /(\d{1,2})月(\d{1,2})日/
const YEAR_RE     = /(\d{4})年/
const OPEN_RE     = /(?:open|開場)[:\s：]*(\d{1,2}:\d{2})/i
const START_RE    = /(?:start|開演)[:\s：]*(\d{1,2}:\d{2})/i
const PRICE_RE    = /[¥￥]\s*(\d[\d,]+)|(\d[\d,]+)\s*円/g
const FLYER_RE    = /href="(img\/FLYER\/[^"]+)"/i
const TITLE_RE    = /<p[^>]*class="blue11"[^>]*>([\s\S]*?)<\/p>/i
const BR_RE       = /<br\s*\/?>/gi
const TAG_RE      = /<[^>]+>/g
const ENTITY_RE   = /&(?:amp|lt|gt|quot|nbsp|yen);/gi
const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&nbsp;': ' ', '&yen;': '¥',
}

function decodeEntities(s: string): string {
  return s.replace(ENTITY_RE, (m) => ENTITY_MAP[m.toLowerCase()] ?? m)
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(BR_RE, '\n').replace(TAG_RE, ' ')).trim()
}

export class NambaBearesSource extends VenueSource {
  readonly id = 'venue:namba-bears'
  readonly displayName = 'Namba BEARS'
  readonly baseUrl: string
  readonly venueId: string

  constructor(args: { baseUrl: string; venueId: string }) {
    super()
    this.baseUrl = args.baseUrl
    this.venueId = args.venueId
  }

  protected override parse(html: string, pageUrl: string): ParseResult {
    const events: RawEvent[] = []
    const rejected: RejectedEvent[] = []
    const baseOrigin = new URL(pageUrl).origin  // https://namba-bears.main.jp

    // Detect year from page-level header (e.g. "2026-4")
    const yearM = YEAR_RE.exec(html)
    const headerYear = yearM ? parseInt(yearM[1], 10) : new Date().getFullYear()

    TABLE_RE.lastIndex = 0
    let tableM: RegExpExecArray | null
    const now = Date.now()

    while ((tableM = TABLE_RE.exec(html)) !== null) {
      const block = tableM[0]

      // ── Date ────────────────────────────────────────────────────────────
      const dateM = JP_DATE_RE.exec(block)
      if (!dateM) continue

      const month = parseInt(dateM[1], 10)
      const day   = parseInt(dateM[2], 10)
      // Use current year; if month is in the past more than 2 months, try next year
      let year = headerYear
      const guessedTs = Date.UTC(year, month - 1, day)
      if (guessedTs < now - 60 * 86400_000) year++
      const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      // ── Flyer URL ────────────────────────────────────────────────────────
      const flyerM = FLYER_RE.exec(block)
      const sourceUrl = flyerM
        ? `${baseOrigin}/${flyerM[1]}`  // resolve relative → absolute
        : null

      // ── Title ────────────────────────────────────────────────────────────
      const titleTagM = TITLE_RE.exec(block)
      let titleRaw = titleTagM ? stripTags(titleTagM[1]).replace(/\s+/g, ' ').trim() : ''
      // Fallback: first non-date, non-noise text line from left <td>
      if (!titleRaw) {
        const tdM = /<td[^>]*width="610"[^>]*>([\s\S]*?)<\/td>/i.exec(block)
        if (tdM) {
          const lines = stripTags(tdM[1]).split('\n').map((l) => l.trim()).filter(Boolean)
          titleRaw = lines.find((l) => l.length >= 3 && !/^open|^start|^¥|\d+:\d+/.test(l)) ?? ''
        }
      }
      if (!titleRaw || titleRaw.length < 3) {
        rejected.push({ rawLine: block.slice(0, 200), reason: 'no_title', sourceUrl: pageUrl })
        continue
      }

      // ── Times + price ────────────────────────────────────────────────────
      const thText = stripTags(block.slice(0, 400))
      const openM  = OPEN_RE.exec(thText)
      const startM = START_RE.exec(thText)
      PRICE_RE.lastIndex = 0
      const prices: number[] = []
      let pm: RegExpExecArray | null
      while ((pm = PRICE_RE.exec(thText)) !== null && prices.length < 2) {
        const n = parseInt((pm[1] ?? pm[2]).replace(/,/g, ''), 10)
        if (!Number.isNaN(n) && n >= 200 && n <= 30_000) prices.push(n)
      }

      // ── Lineup ───────────────────────────────────────────────────────────
      const tdM = /<td[^>]*width="610"[^>]*>([\s\S]*?)<\/td>/i.exec(block)
      const lineup: string[] = []
      if (tdM) {
        const lines = stripTags(tdM[1]).split('\n').map((l) => l.trim()).filter(Boolean)
        for (const l of lines) {
          if (l === titleRaw) continue
          if (/^open|^start|^¥|^\d+:\d+|^[＜<]/.test(l)) continue
          if (l.length >= 2 && l.length <= 80) lineup.push(l)
        }
      }

      events.push({
        eventDate: isoDate,
        titleRaw,
        doorsTime:       openM?.[1]  ?? null,
        startTime:       startM?.[1] ?? null,
        ticketPriceAdv:  prices[0]   ?? null,
        ticketPriceDoor: prices[1]   ?? prices[0] ?? null,
        ticketUrl:       null,
        description:     lineup.length > 0
          ? `With ${lineup.slice(0, 6).join(', ')}${lineup.length > 6 ? ' and more' : ''}.`
          : null,
        lineup,
        sourceUrl,  // absolute flyer image URL (or null if no flyer on page)
        payload: { flyerUrl: sourceUrl },
      })
    }

    return { events, rejected }
  }
}
