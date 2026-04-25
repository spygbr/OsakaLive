/**
 * Lightweight HTML → events parser for individual venue schedule pages.
 *
 * Ported from the v1 parse.ts (lib/scraper/parse.ts:124-248). Differences:
 *   - Returns ParseResult ({ events, rejected }) instead of RawEvent[]
 *   - No venueSlug parameter — venue is set by the calling VenueSource
 *   - Lines killed by isValidTitle() now go to rejected with a reason instead
 *     of being silently dropped
 */

import { jstYear } from './source'
import type { ParseResult, RawEvent, RejectedEvent } from './types'

// ── Regex / helpers (copied verbatim from v1 parse.ts) ─────────────────────

const JP_DATE_RE = /(?:(\d{4})[年\/\-\.])?(\d{1,2})[月\/\-\.](\d{1,2})[日]?/g
const OPEN_RE    = /(?:open|開場|open:|open：)\s*(\d{1,2}:\d{2})/i
const START_RE   = /(?:start|開演|start:|start：)\s*(\d{1,2}:\d{2})/i
const PRICE_RE   = /(?:[¥￥]\s*(\d[\d,]+)|(\d[\d,]+)\s*円)/gi
const TICKET_URL_RE =
  /https?:\/\/(?:eplus\.jp|t\.livepocket\.jp|l-tike\.com|pia\.jp|ticket\.lawson\.co\.jp)[^\s"'<>]*/gi

const DOW_EN_RE      = /^[\(\[（【]?\s*(?:mon|tue|wed|thu|fri|sat|sun)\s*[\)\]）】]?\.?$/i
const DOW_JA_RE      = /^[\(\[（【]?\s*[月火水木金土日]\s*[\)\]）】]?$/
const BARE_INT_RE    = /^\d+$/
const STARTS_TIME_RE = /^\d{1,2}:\d{2}/
const PRICE_LABEL_RE = /^(?:[¥￥]|adv\b|door\b|ticket\b|前売\b|当日\b|優先\s*[\/・]?\s*一般|u-\d+\b)/i
const NOISE_LINE_RE  = /^(?:open|start|close|終演|開場|開演|発売|予約|前売|当日|sold\s*out|チケット|copyright|all\s+rights|reserved|more|詳細|info|ホールレンタル|ホール貸|hall\s*rental|coming\s*soon|season\s*off|シーズンオフ)/i

function toISODate(year: string | undefined, month: string, day: string): string | null {
  const y = parseInt(year ?? String(jstYear()), 10)
  const m = parseInt(month, 10)
  const d = parseInt(day, 10)
  if (Number.isNaN(y) || m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Skip date matches more than 30 days in the past at parse time. Some venue
 * pages (club-joule) keep past-event sections inline with current schedule —
 * the parser would otherwise pair an old date with whatever nav/promo text
 * follows ("Discover more", "VIP SYSTEM"), only to have the validator reject
 * it as date_too_old. Cutting it here both speeds the parse and stops these
 * non-events from polluting events_rejected.
 */
const STALE_DATE_CUTOFF_MS = 30 * 86400_000
function isStaleDate(iso: string, now: number = Date.now()): boolean {
  const t = Date.parse(iso + 'T00:00:00Z')
  if (Number.isNaN(t)) return false
  return t < now - STALE_DATE_CUTOFF_MS
}

function cleanTitle(s: string): string {
  return s
    .replace(/(?:(\d{4})[年\/\-\.])?(\d{1,2})[月\/\-\.](\d{1,2})[日]?/g, '')
    .replace(/[\(\[（【]?\b(?:mon|tue|wed|thu|fri|sat|sun)\b[\)\]）】]?\.?/gi, '')
    .replace(/[\(\[（【]?[月火水木金土日][\)\]）】]?/g, '')
    .replace(/(?:open|start|close|開場|開演|終演)[:\s：]*\d{1,2}:\d{2}/gi, '')
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    .replace(/[¥￥]\s*\d[\d,]*/g, '')
    .replace(/\d[\d,]+\s*円/g, '')
    .replace(/\b(?:adv|door)\s*(?:&|＆|\/|・)?\s*(?:door|adv)?\b/gi, '')
    .replace(/^(?:昼の部|夜の部|昼公演|夜公演)\s*/u, '')
    .replace(/^[\s\-\|\/・＊\*\[\]（）()【】~～＜＞<>「」『』]+/, '')
    .replace(/[\s\-\|\/・＊\*\[\]（）()【】~～＜＞<>「」『』]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Returns null on success, reason string on failure. */
function titleRejection(s: string): string | null {
  if (s.length < 5)            return 'too_short'
  if (BARE_INT_RE.test(s))     return 'bare_integer'
  if (DOW_EN_RE.test(s))       return 'day_of_week_en'
  if (DOW_JA_RE.test(s))       return 'day_of_week_ja'
  if (STARTS_TIME_RE.test(s))  return 'starts_with_time'
  if (PRICE_LABEL_RE.test(s))  return 'price_label'
  if (NOISE_LINE_RE.test(s))   return 'noise_phrase'
  return null
}

// ── Main parser ────────────────────────────────────────────────────────────

export function parseVenueSchedule(html: string, sourceUrl: string): ParseResult {
  const events: RawEvent[] = []
  const rejected: RejectedEvent[] = []

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|li|p|tr|td|th|h[1-6]|section|article|header|footer|span)[^>]*>/gi, '\n')
    // Inject ticket-page hrefs into the text stream BEFORE stripping tags so
    // they survive into per-event context windows (TICKET_URL_RE won't find
    // them otherwise once the <a> markup is gone).
    .replace(/<a\s[^>]*href="(https?:\/\/(?:eplus\.jp|t\.livepocket\.jp|l-tike\.com|pia\.jp|ticket\.lawson\.co\.jp)[^"]*)"/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&yen;/gi, '¥')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#8230;/g, '…')
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]{2,8};/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')

  const lines = cleaned
    .split(/\r?\n|\s{3,}/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length < 300)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    JP_DATE_RE.lastIndex = 0
    const dateMatch = JP_DATE_RE.exec(line)
    if (!dateMatch) continue

    const isoDate = toISODate(dateMatch[1], dateMatch[2], dateMatch[3])
    if (!isoDate) continue
    // Drop stale dates before doing any title scanning — see isStaleDate().
    if (isStaleDate(isoDate)) continue

    // ── Title scan (date line + 6 ahead) ────────────────────────────────
    let title = ''
    const lineup: string[] = []
    let titleFound = false
    const lookAhead = [line, ...lines.slice(i + 1, i + 7)]
    for (const raw of lookAhead) {
      if (titleFound) {
        JP_DATE_RE.lastIndex = 0
        if (JP_DATE_RE.test(raw)) break
      }
      const candidate = cleanTitle(raw)
      const reason = titleRejection(candidate)
      if (reason) {
        if (!titleFound && candidate.length > 0) {
          rejected.push({ rawLine: raw, reason, sourceUrl })
        }
        continue
      }
      if (!titleFound) { title = candidate; titleFound = true }
      else lineup.push(candidate)
    }
    if (!title) continue

    // ── Time/price context ──────────────────────────────────────────────
    let ctxEnd = Math.min(lines.length, i + 10)
    for (let k = i + 1; k < ctxEnd; k++) {
      JP_DATE_RE.lastIndex = 0
      if (k > i + 1 && JP_DATE_RE.test(lines[k])) { ctxEnd = k; break }
    }
    const ctx = lines.slice(Math.max(0, i - 2), ctxEnd).join(' ')

    const openMatch  = OPEN_RE.exec(ctx)
    const startMatch = START_RE.exec(ctx)
    PRICE_RE.lastIndex = 0
    const prices: number[] = []
    let pm: RegExpExecArray | null
    while ((pm = PRICE_RE.exec(ctx)) !== null && prices.length < 2) {
      const n = parseInt((pm[1] ?? pm[2]).replace(/,/g, ''), 10)
      if (!Number.isNaN(n) && n >= 500 && n <= 30000) prices.push(n)
    }
    // Scope ticket URL search to this event's context window, not the whole
    // page — prevents a single ticket link from leaking onto every event.
    TICKET_URL_RE.lastIndex = 0
    const ticketMatch = TICKET_URL_RE.exec(ctx)

    const description = lineup.length > 0
      ? `With ${lineup.slice(0, 6).join(', ')}${lineup.length > 6 ? ' and more' : ''}.`
      : null

    events.push({
      eventDate: isoDate,
      titleRaw: title,
      doorsTime: openMatch?.[1] ?? null,
      startTime: startMatch?.[1] ?? null,
      ticketPriceAdv: prices[0] ?? null,
      ticketPriceDoor: prices[1] ?? prices[0] ?? null,
      ticketUrl: ticketMatch?.[0] ?? null,
      description,
      lineup,
      // This function always parses an index/schedule page — we have no
      // per-event detail URL, so sourceUrl is null. Custom sources
      // (club-joule, drop) set their own per-event sourceUrl directly.
      sourceUrl: null,
      payload: { lineup },
    })
  }

  // Sanity guard: if the same ticket URL appears on ≥ 2 events it's an index
  // or venue-wide link rather than per-event — null it out for all of them.
  const ticketFreq = new Map<string, number>()
  for (const e of events) {
    if (e.ticketUrl) ticketFreq.set(e.ticketUrl, (ticketFreq.get(e.ticketUrl) ?? 0) + 1)
  }
  for (const e of events) {
    if (e.ticketUrl && (ticketFreq.get(e.ticketUrl) ?? 0) >= 2) e.ticketUrl = null
  }

  return { events, rejected }
}
