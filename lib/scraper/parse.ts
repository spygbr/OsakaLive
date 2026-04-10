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

function parsePrice(text: string): number | null {
  const m = /(?:[¥￥]\s*(\d[\d,]+)|(\d[\d,]+)\s*円)/i.exec(text)
  if (!m) return null
  const n = parseInt((m[1] ?? m[2]).replace(/,/g, ''), 10)
  return isNaN(n) || n < 500 || n > 30000 ? null : n
}

// ── Ticket URL ────────────────────────────────────────────────────────────────

/** e-plus, Ticket Pia, Lawson Ticket, eplus, LivePocket */
const TICKET_URL_RE =
  /https?:\/\/(?:eplus\.jp|t\.livepocket\.jp|l-tike\.com|pia\.jp|ticket\.lawson\.co\.jp)[^\s"'<>]*/gi

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Lightweight HTML-to-events parser.
 * Works by extracting date anchors then collecting surrounding text for time/price.
 */
export function parseEventsFromHtml(
  html: string,
  venueSlug: string,
  sourceUrl: string,
): RawEvent[] {
  const events: RawEvent[] = []

  // Strip script/style blocks to reduce noise
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')          // strip remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s{2,}/g, ' ')

  // Tokenise by line (~paragraphs)
  // Note: stripped HTML has no newlines, so also split on 3+ whitespace chars
  const lines = cleaned
    .split(/\r?\n|\s{3,}/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length < 300)

  console.log(`[parse:${venueSlug}] ${lines.length} lines after tokenize`)

  // Sliding window: look for a date line, then gather context
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Reset regex lastIndex for each line
    JP_DATE_RE.lastIndex = 0
    const dateMatch = JP_DATE_RE.exec(line)
    if (!dateMatch) continue

    const isoDate = toISODate(dateMatch[1], dateMatch[2], dateMatch[3])
    if (!isoDate) continue

    // Skip dates in the past (more than 7 days ago, allow rolling)
    const eventMs = new Date(isoDate + 'T00:00:00+09:00').getTime()
    const nowMs   = Date.now() + 9 * 3600 * 1000
    if (eventMs < nowMs - 7 * 86_400_000) continue

    // Gather a context window of ±3 lines around this date line
    const ctx = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 4)).join(' ')

    // Extract time
    const openMatch  = OPEN_RE.exec(ctx)
    const startMatch = START_RE.exec(ctx)

    // Extract prices (take first two numbers that look like yen)
    PRICE_RE.lastIndex = 0
    const prices: number[] = []
    let pm: RegExpExecArray | null
    while ((pm = PRICE_RE.exec(ctx)) !== null && prices.length < 2) {
      const n = parseInt((pm[1] ?? pm[2]).replace(/,/g, ''), 10)
      if (!isNaN(n) && n >= 500 && n <= 30000) prices.push(n)
    }

    // Extract ticket URL
    const ticketMatch = TICKET_URL_RE.exec(html) // search full html for ticket urls
    TICKET_URL_RE.lastIndex = 0

    // Extract title — prefer the line itself if it contains Japanese, else adjacent line
    const titleLine = line.replace(JP_DATE_RE, '').trim() || (lines[i + 1] ?? '')
    const title = titleLine
      .replace(/open\s*\d{1,2}:\d{2}/i, '')
      .replace(/start\s*\d{1,2}:\d{2}/i, '')
      .replace(/[¥￥]\s*\d[\d,]*/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()

    if (!title || title.length < 2) continue

    events.push({
      venueSlug,
      title,
      eventDate: isoDate,
      doorsTime: openMatch?.[1] ?? null,
      startTime: startMatch?.[1] ?? null,
      ticketPriceAdv: prices[0] ?? null,
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
