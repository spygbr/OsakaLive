/**
 * HTML parsing helpers for Japanese live house schedule pages.
 * Uses pure string / regex operations — no external deps needed.
 */

import type { RawEvent } from './types'

// ── Date patterns ────────────────────────────────────────────────────────────

/** Match JP date patterns:  2026年4月15日 / 2026.04.15 / 2026/04/15 / 04/15 */
const JP_DATE_RE =
  /(?:(\d{4})[年\/\-\.])?(\d{1,2})[月\/\-\.](\d{1,2})[日]?/g

/** Current year in JST — used when only M/D is present */
function jstYear(): number {
  return new Date(Date.now() + 9 * 3600 * 1000).getFullYear()
}

/** Normalise a date match → YYYY-MM-DD or null */
function toISODate(year: string | undefined, month: string, day: string): string | null {
  const y = parseInt(year ?? String(jstYear()), 10)
  const m = parseInt(month, 10)
  const d = parseInt(day, 10)
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ── Time patterns ─────────────────────────────────────────────────────────────

/** OPEN 18:00 / OPEN: 18:00 / 開場 18:00 */
const OPEN_RE  = /(?:open|開場|open:|open：)\s*(\d{1,2}:\d{2})/i
/** START 19:00 / START: 19:00 / 開演 19:00 */
const START_RE = /(?:start|開演|start:|start：)\s*(\d{1,2}:\d{2})/i

// ── Price patterns ────────────────────────────────────────────────────────────

/** ¥3,000 / 3000円 / ¥3000 — requires yen symbol OR 円 suffix to avoid bare numbers */
const PRICE_RE = /(?:[¥￥]\s*(\d[\d,]+)|(\d[\d,]+)\s*円)/gi

// ── Ticket URL ────────────────────────────────────────────────────────────────

/** e-plus, Ticket Pia, Lawson Ticket, eplus, LivePocket */
const TICKET_URL_RE =
  /https?:\/\/(?:eplus\.jp|t\.livepocket\.jp|l-tike\.com|pia\.jp|ticket\.lawson\.co\.jp)[^\s"'<>]*/gi

// ── Title validation ──────────────────────────────────────────────────────────

/** Strip date, day names, times, prices, and surrounding punctuation from a candidate */
function cleanTitle(s: string): string {
  return s
    // Remove date patterns
    .replace(/(?:(\d{4})[年\/\-\.])?(\d{1,2})[月\/\-\.](\d{1,2})[日]?/g, '')
    // Remove English day-of-week (with optional brackets/parens)
    .replace(/[\(\[（【]?\b(?:mon|tue|wed|thu|fri|sat|sun)\b[\)\]）】]?\.?/gi, '')
    // Remove Japanese day-of-week kanji (with optional brackets)
    .replace(/[\(\[（【]?[月火水木金土日][\)\]）】]?/g, '')
    // Remove time patterns like OPEN 18:00 / 開場18:00 / bare 18:00
    .replace(/(?:open|start|close|開場|開演|終演)[:\s：]*\d{1,2}:\d{2}/gi, '')
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    // Remove price patterns
    .replace(/[¥￥]\s*\d[\d,]*/g, '')
    .replace(/\d[\d,]+\s*円/g, '')
    // Remove leading/trailing punctuation and whitespace
    .replace(/^[\s\-\|\/・＊\*\[\]（）()【】~～]+/, '')
    .replace(/[\s\-\|\/・＊\*\[\]（）()【】~～]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Day-of-week patterns (English and Japanese, with/without brackets) */
const DOW_EN_RE = /^[\(\[（【]?\s*(?:mon|tue|wed|thu|fri|sat|sun)\s*[\)\]）】]?\.?$/i
const DOW_JA_RE = /^[\(\[（【]?\s*[月火水木金土日]\s*[\)\]）】]?$/

/** Bare integers */
const BARE_INT_RE = /^\d+$/

/** Starts with a time */
const STARTS_TIME_RE = /^\d{1,2}:\d{2}/

/** Common non-title words that appear as standalone lines */
const NOISE_LINE_RE = /^(?:open|start|close|終演|開場|開演|発売|予約|前売|当日|sold\s*out|チケット|copyright|all\s+rights|reserved|more|詳細|info)/i

/**
 * Returns true if the cleaned string looks like a real event title.
 * Rejects day names, bare numbers, times, and other noise.
 */
function isValidTitle(s: string): boolean {
  if (s.length < 4) return false
  if (BARE_INT_RE.test(s)) return false
  if (DOW_EN_RE.test(s)) return false
  if (DOW_JA_RE.test(s)) return false
  if (STARTS_TIME_RE.test(s)) return false
  if (NOISE_LINE_RE.test(s)) return false
  return true
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Lightweight HTML-to-events parser.
 *
 * Strategy:
 *   1. Convert block-level HTML tags to newlines to preserve structure in
 *      minified pages that have no real newlines.
 *   2. Tokenise on newlines; filter out lines that are too long (navigation /
 *      boilerplate) or empty.
 *   3. For each line containing a date, scan forward up to 6 lines for the
 *      first line that passes the title validity check. This handles venues
 *      where date and title are on separate lines (calendar grid layouts).
 *   4. Gather a context window around the date line for time/price extraction.
 */
export function parseEventsFromHtml(
  html: string,
  venueSlug: string,
  sourceUrl: string,
): RawEvent[] {
  const events: RawEvent[] = []

  // Strip script/style, convert block tags → newlines, then strip remaining tags
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|li|p|tr|td|th|h[1-6]|section|article|header|footer|span)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')      // collapse horizontal whitespace only

  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length < 300)

  console.log(`[parse:${venueSlug}] ${lines.length} lines after tokenize`)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    JP_DATE_RE.lastIndex = 0
    const dateMatch = JP_DATE_RE.exec(line)
    if (!dateMatch) continue

    const isoDate = toISODate(dateMatch[1], dateMatch[2], dateMatch[3])
    if (!isoDate) continue

    // Skip dates more than 7 days in the past
    const eventMs = new Date(isoDate + 'T00:00:00+09:00').getTime()
    const nowMs   = Date.now() + 9 * 3600 * 1000
    if (eventMs < nowMs - 7 * 86_400_000) continue

    // ── Title: scan date line + up to 6 lines ahead ────────────────────────
    // Many venue pages use a calendar layout where the date cell and event
    // name cell are adjacent — the day-of-week abbreviation on the same line
    // is noise, and the title is on a subsequent line.
    let title = ''
    const lookAhead = [line, ...lines.slice(i + 1, i + 7)]
    for (const raw of lookAhead) {
      const candidate = cleanTitle(raw)
      if (isValidTitle(candidate)) {
        title = candidate
        break
      }
    }
    if (!title) continue

    // ── Context window for time + price extraction ─────────────────────────
    const ctx = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 7)).join(' ')

    const openMatch  = OPEN_RE.exec(ctx)
    const startMatch = START_RE.exec(ctx)

    PRICE_RE.lastIndex = 0
    const prices: number[] = []
    let pm: RegExpExecArray | null
    while ((pm = PRICE_RE.exec(ctx)) !== null && prices.length < 2) {
      const n = parseInt((pm[1] ?? pm[2]).replace(/,/g, ''), 10)
      if (!isNaN(n) && n >= 500 && n <= 30000) prices.push(n)
    }

    const ticketMatch = TICKET_URL_RE.exec(html)
    TICKET_URL_RE.lastIndex = 0

    events.push({
      venueSlug,
      title,
      eventDate: isoDate,
      doorsTime: openMatch?.[1] ?? null,
      startTime: startMatch?.[1] ?? null,
      ticketPriceAdv:  prices[0] ?? null,
      ticketPriceDoor: prices[1] ?? prices[0] ?? null,
      ticketUrl: ticketMatch?.[0] ?? null,
      sourceUrl,
    })
  }

  // Deduplicate by date + rough title prefix
  const seen = new Set<string>()
  return events.filter((e) => {
    const key = `${e.eventDate}:${e.title.slice(0, 20).toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
