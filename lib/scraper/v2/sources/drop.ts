/**
 * Custom source for Amerikamura DROP (clubdrop.jp).
 *
 * Why custom: the calendar page encodes dates as `data-date` attributes on
 * <td> elements — invisible to the generic text-based parser — and start time
 * / ticket price only appear on individual event detail pages, not the calendar
 * listing.
 *
 * Two-level crawl:
 *   1. Fetch calendar pages for the current and next two JST months.
 *      Extract (isoDate, detailUrl, title) from
 *        <td data-date="YYYYMMDD">…<a href="…/detail/{id}">Title</a>…</td>
 *   2. For each detail URL, fetch and parse:
 *        - open / start times  from  <dl class="openTime"><dd>HH:MM/HH:MM</dd>
 *        - ticket prices       from  <dl class="price"><dd>…N円…</dd>
 */

import { VenueSource } from '../source'
import type { RunContext, RunOutput } from '../source'
import type { RawEvent, RejectedEvent } from '../types'

// ── Calendar page patterns ───────────────────────────────────────────────────

/** Matches one <td data-date="YYYYMMDD">…</td> block. */
const TD_RE = /<td[^>]*\bdata-date="(\d{8})"[^>]*>([\s\S]*?)<\/td>/gi

/** Event detail links within a <td> block (full URLs). */
const EVENT_LINK_RE =
  /href="(https:\/\/clubdrop\.jp\/schedule\/detail\/(\d+))"[^>]*>([^<]+)<\/a>/gi

// ── Detail page patterns ─────────────────────────────────────────────────────

/** [OPEN/START] → group 1 = open time, group 2 = start time (both HH:MM). */
const OPEN_START_RE =
  /openTime[\s\S]*?<dd>\s*(\d{1,2}:\d{2})(?:\s*\/\s*(\d{1,2}:\d{2}))?\s*<\/dd>/i

/** [料金] block text. */
const PRICE_BLOCK_RE = /class="price"[\s\S]*?<dd>([\s\S]*?)<\/dd>/i

/** Yen amounts in the price block (e.g. "0円", "1,500円"). */
const YEN_RE = /(\d[\d,]*)円/g

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Decode common HTML entities in a text node. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
}

/** "YYYYMMDD" → "YYYY-MM-DD", or null if invalid. */
function ymd8ToIso(s: string): string | null {
  if (s.length !== 8) return null
  const y = parseInt(s.slice(0, 4), 10)
  const m = parseInt(s.slice(4, 6), 10)
  const d = parseInt(s.slice(6, 8), 10)
  if (Number.isNaN(y) || m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Returns the [year, month] pairs for the current and next `count-1` JST
 * months, so calendarMonths(3) = [current, +1, +2].
 */
function calendarMonths(count = 3, now: number = Date.now()): [number, number][] {
  // Shift to JST (UTC+9) then read year/month.
  const jst = new Date(now + 9 * 3600_000)
  const baseYear = jst.getUTCFullYear()
  const baseMonth = jst.getUTCMonth() // 0-based
  const pairs: [number, number][] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(baseYear, baseMonth + i, 1))
    pairs.push([d.getUTCFullYear(), d.getUTCMonth() + 1])
  }
  return pairs
}

// ── Source class ──────────────────────────────────────────────────────────────

export class DropSource extends VenueSource {
  readonly id: string
  readonly displayName: string
  readonly baseUrl: string
  readonly venueId: string

  constructor(args: { baseUrl: string; venueId: string }) {
    super()
    this.id = 'venue:drop'
    this.displayName = 'Amerikamura DROP'
    this.baseUrl = args.baseUrl
    this.venueId = args.venueId
  }

  /**
   * Full override: multi-page calendar crawl + per-event detail fetch.
   * VenueSource.run() (which just calls parse() on baseUrl) is bypassed.
   */
  override async run(ctx: RunContext): Promise<RunOutput> {
    const events: RawEvent[] = []
    const rejected: RejectedEvent[] = []

    // ── Step 1: collect detail links from calendar pages ─────────────────────

    const seenUrls = new Set<string>()
    const queue: { date: string; url: string; title: string }[] = []

    let firstPage: { etag: string | null; lastModified: string | null; contentHash: string } | null =
      null

    for (const [year, month] of calendarMonths(3)) {
      const calUrl = `https://clubdrop.jp/schedule/calendar/${year}/${String(month).padStart(2, '0')}/`
      let html: string
      try {
        const page = await ctx.http(calUrl)
        html = page.body
        if (firstPage === null) {
          firstPage = {
            etag: page.etag,
            lastModified: page.lastModified,
            contentHash: page.contentHash,
          }
        }
      } catch (e) {
        rejected.push({
          rawLine: calUrl,
          reason: 'calendar_fetch_failed',
          sourceUrl: calUrl,
          payload: { error: (e as Error).message },
        })
        continue
      }

      TD_RE.lastIndex = 0
      let tdM: RegExpExecArray | null
      while ((tdM = TD_RE.exec(html)) !== null) {
        const [, dateStr, tdHtml] = tdM
        const isoDate = ymd8ToIso(dateStr)
        if (!isoDate) continue

        EVENT_LINK_RE.lastIndex = 0
        let evM: RegExpExecArray | null
        while ((evM = EVENT_LINK_RE.exec(tdHtml)) !== null) {
          const [, url, , rawTitle] = evM
          if (seenUrls.has(url)) continue
          seenUrls.add(url)
          queue.push({ date: isoDate, url, title: decodeEntities(rawTitle.trim()) })
        }
      }
    }

    // ── Step 2: fetch each detail page for times + prices ────────────────────

    for (const item of queue) {
      let detailHtml: string
      try {
        const page = await ctx.http(item.url)
        detailHtml = page.body
      } catch (e) {
        rejected.push({
          rawLine: item.url,
          reason: 'detail_fetch_failed',
          sourceUrl: item.url,
          payload: { error: (e as Error).message },
        })
        continue
      }

      // Parse open / start times.
      const osM = OPEN_START_RE.exec(detailHtml)
      const doorsTime = osM?.[1] ?? null
      const startTime = osM?.[2] ?? null

      // Parse ticket prices (yen amounts in the [料金] block).
      const priceBlockM = PRICE_BLOCK_RE.exec(detailHtml)
      const prices: number[] = []
      if (priceBlockM) {
        YEN_RE.lastIndex = 0
        let pm: RegExpExecArray | null
        while ((pm = YEN_RE.exec(priceBlockM[1])) !== null && prices.length < 2) {
          const n = parseInt(pm[1].replace(/,/g, ''), 10)
          // Allow 0 (free events) up to 30,000 yen.
          if (!Number.isNaN(n) && n >= 0 && n <= 30_000) prices.push(n)
        }
      }

      events.push({
        eventDate: item.date,
        titleRaw: item.title,
        venueId: this.venueId,
        doorsTime,
        startTime,
        ticketPriceAdv: prices[0] ?? null,
        ticketPriceDoor: prices[1] ?? prices[0] ?? null,
        ticketUrl: null,
        description: null,
        lineup: [],
        sourceUrl: item.url,
        payload: { calendarDate: item.date },
      })
    }

    return {
      events,
      rejected,
      notModified: false,
      entryEtag: firstPage?.etag ?? null,
      entryLastModified: firstPage?.lastModified ?? null,
      entryHash: firstPage?.contentHash ?? null,
    }
  }
}
