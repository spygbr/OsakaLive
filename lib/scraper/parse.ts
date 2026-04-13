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

/** Generic yen prices for fallback: ¥3,000 / 3000円 / ¥3000 (currency marker required). */
const PRICE_RE = /(?:[¥￥]\s*(\d{3,6}(?:,\d{3})*)|(\d{3,6}(?:,\d{3})*)\s*円)(?!\s*(?:tel|phone|id)\b)/gi

/** Tier labels (JP + EN). */
const ADV_LABEL_RE = /(?:前売|ADV|予約)/i
const DOOR_LABEL_RE = /(?:当日|DOOR)/i

/** Labeled tier pair: ADV/DOOR: ¥2500/¥3000, 前売・当日 2,500円 | 3,000円 */
const PRICE_TIER_PAIR_RE =
  /(?:前売|ADV|予約)\s*(?:\/|／|・|\||｜|:|：|＆|&)\s*(?:当日|DOOR)\s*(?:[:：]?\s*)?(?:[¥￥]\s*)?(\d{3,6}(?:,\d{3})*)\s*(?:円)?\s*(?:\/|／|・|\||｜|:|：|＆|&)\s*(?:[¥￥]\s*)?(\d{3,6}(?:,\d{3})*)\s*(?:円)?/gi

/** Single labeled tier price with flexible punctuation/separators. */
const PRICE_ADV_RE =
  /(?:前売|ADV|予約)\s*(?:ticket)?\s*(?:price)?\s*(?:[:：=]|\b)\s*(?:[¥￥]\s*)?(\d{3,6}(?:,\d{3})*)\s*(?:円)?/gi
const PRICE_DOOR_RE =
  /(?:当日|DOOR)\s*(?:ticket)?\s*(?:price)?\s*(?:[:：=]|\b)\s*(?:[¥￥]\s*)?(\d{3,6}(?:,\d{3})*)\s*(?:円)?/gi

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
    // Remove price patterns (¥ or 円)
    .replace(/[¥￥]\s*\d[\d,]*/g, '')
    .replace(/\d[\d,]+\s*円/g, '')
    // Remove adv/door ticket-price prefixes that survive price stripping
    // e.g. "adv&door" remaining after "adv&door ¥2500" price removal
    .replace(/\b(?:adv|door)\s*(?:&|＆|\/|・)?\s*(?:door|adv)?\b/gi, '')
    // Remove time-of-day session labels that aren't useful as event titles
    .replace(/^(?:昼の部|夜の部|昼公演|夜公演)\s*/u, '')
    // Remove leading/trailing punctuation and whitespace
    .replace(/^[\s\-\|\/・＊\*\[\]（）()【】~～＜＞<>「」『』]+/, '')
    .replace(/[\s\-\|\/・＊\*\[\]（）()【】~～＜＞<>「」『』]+$/, '')
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

/** Starts with a price label or ticket tier (remaining after cleanTitle's price removal) */
const PRICE_LABEL_RE = /^(?:[¥￥]|adv\b|door\b|ticket\b|前売\b|当日\b|優先\s*[\/・]?\s*一般|u-\d+\b)/i

/** Common non-title words/phrases that appear as standalone lines */
const NOISE_LINE_RE = /^(?:open|start|close|終演|開場|開演|発売|予約|前売|当日|sold\s*out|チケット|copyright|all\s+rights|reserved|more|詳細|info|ホールレンタル|ホール貸|hall\s*rental|coming\s*soon|season\s*off|シーズンオフ)/i

/**
 * Returns true if the cleaned string looks like a real event title.
 * Rejects day names, bare numbers, times, ticket labels, and other noise.
 */
function isValidTitle(s: string): boolean {
  if (s.length < 5) return false
  if (BARE_INT_RE.test(s)) return false
  if (DOW_EN_RE.test(s)) return false
  if (DOW_JA_RE.test(s)) return false
  if (STARTS_TIME_RE.test(s)) return false
  if (PRICE_LABEL_RE.test(s)) return false
  if (NOISE_LINE_RE.test(s)) return false
  return true
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Lightweight HTML-to-events parser.
 *
 * Strategy:
 *   1. Decode HTML entities (including &yen;) and convert block-level tags to
 *      newlines so that minified HTML produces real line breaks.
 *   2. Tokenise on newlines; filter out lines that are too long (navigation /
 *      boilerplate) or empty.
 *   3. For each line containing a date, scan forward up to 6 lines for the
 *      first line that passes the title validity check. This handles venues
 *      where date and title are on separate lines (calendar grid layouts) and
 *      also venues like namba-bears where date+price are on the same header
 *      line but the actual title (band names) follows in the next cell.
 *   4. Gather a context window around the date line for time/price extraction.
 */
export function parseEventsFromHtml(
  html: string,
  venueSlug: string,
  sourceUrl: string,
): RawEvent[] {
  const events: RawEvent[] = []

  // Strip script/style, decode entities, convert block tags → newlines, strip remaining tags
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|li|p|tr|td|th|h[1-6]|section|article|header|footer|span)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    // HTML entity decoding — order matters: specific entities before catch-all
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&yen;/gi, '¥')        // ← fix: &yen; must decode before price stripping
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#8230;/g, '…')
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]{2,8};/gi, ' ') // catch-all for remaining named entities
    .replace(/[ \t]{2,}/g, ' ')     // collapse horizontal whitespace only

  const lines = cleaned
    .split(/\r?\n|\s{3,}/)
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

    // ── Title + lineup: scan date line + up to 6 lines ahead ─────────────
    // Many venue pages (namba-bears, hokage, etc.) put date+price on the <th>
    // header line and band names / event title in the following <td> cell.
    // cleanTitle strips dates, day-of-week, times, and prices from the header
    // line — if nothing remains (or it's too short), we move to the next line.
    // After finding the title, remaining valid lines become the lineup.
    let title = ''
    const lineup: string[] = []
    let titleFound = false
    const lookAhead = [line, ...lines.slice(i + 1, i + 7)]
    for (const raw of lookAhead) {
      // Stop collecting if we hit another date (next event boundary)
      if (titleFound) {
        JP_DATE_RE.lastIndex = 0
        if (JP_DATE_RE.test(raw)) break
      }
      const candidate = cleanTitle(raw)
      if (isValidTitle(candidate)) {
        if (!titleFound) {
          title = candidate
          titleFound = true
        } else {
          lineup.push(candidate)
        }
      }
    }
    if (!title) continue

    // ── Context window for time + price extraction ─────────────────────────
    const ctx = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 7)).join(' ')

    const openMatch  = OPEN_RE.exec(ctx)
    const startMatch = START_RE.exec(ctx)

    const parsePrice = (raw: string | undefined): number | null => {
      if (!raw) return null
      const n = parseInt(raw.replace(/,/g, ''), 10)
      // Guardrails: realistic live-house ticket ranges only
      if (isNaN(n) || n < 500 || n > 30000) return null
      return n
    }

    let ticketPriceAdv: number | null = null
    let ticketPriceDoor: number | null = null

    // 1) Parse explicit tier pairs first (ADV/DOOR together).
    PRICE_TIER_PAIR_RE.lastIndex = 0
    const pairMatch = PRICE_TIER_PAIR_RE.exec(ctx)
    if (pairMatch) {
      ticketPriceAdv = parsePrice(pairMatch[1])
      ticketPriceDoor = parsePrice(pairMatch[2])
    }

    // 2) Parse explicit labeled prices from local event context.
    if (ticketPriceAdv === null) {
      PRICE_ADV_RE.lastIndex = 0
      const advMatch = PRICE_ADV_RE.exec(ctx)
      ticketPriceAdv = parsePrice(advMatch?.[1])
    }
    if (ticketPriceDoor === null) {
      PRICE_DOOR_RE.lastIndex = 0
      const doorMatch = PRICE_DOOR_RE.exec(ctx)
      ticketPriceDoor = parsePrice(doorMatch?.[1])
    }

    // 3) Fallback: generic yen matcher only when labeled tiers are absent.
    if (ticketPriceAdv === null && ticketPriceDoor === null && (ADV_LABEL_RE.test(ctx) || DOOR_LABEL_RE.test(ctx) || /[¥￥]|\d+\s*円/.test(ctx))) {
      PRICE_RE.lastIndex = 0
      const prices: number[] = []
      let pm: RegExpExecArray | null
      while ((pm = PRICE_RE.exec(ctx)) !== null && prices.length < 2) {
        const n = parsePrice(pm[1] ?? pm[2])
        if (n !== null) prices.push(n)
      }
      ticketPriceAdv = prices[0] ?? null
      ticketPriceDoor = prices[1] ?? prices[0] ?? null
    }

    const ticketMatch = TICKET_URL_RE.exec(html)
    TICKET_URL_RE.lastIndex = 0

    events.push({
      venueSlug,
      title,
      eventDate: isoDate,
      doorsTime: openMatch?.[1] ?? null,
      startTime: startMatch?.[1] ?? null,
      ticketPriceAdv,
      ticketPriceDoor,
      ticketUrl: ticketMatch?.[0] ?? null,
      lineup,
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
