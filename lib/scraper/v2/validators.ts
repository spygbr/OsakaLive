/**
 * Title / event validators.
 *
 * These rules decide whether a parsed line is a real event or noise.
 * Rejects are NOT silently dropped — the runner pushes them into
 * events_rejected with a reason so we can tune the rules without flying blind.
 *
 * Patterns lifted from the old parse.ts (lines 76-105) and consolidated so
 * every Source uses the same gate.
 */

const DOW_EN_RE      = /^[\(\[（【]?\s*(?:mon|tue|wed|thu|fri|sat|sun)\s*[\)\]）】]?\.?$/i
const DOW_JA_RE      = /^[\(\[（【]?\s*[月火水木金土日]\s*[\)\]）】]?$/
const BARE_INT_RE    = /^\d+$/
const STARTS_TIME_RE = /^\d{1,2}:\d{2}/
const PRICE_LABEL_RE = /^(?:[¥￥]|adv\b|door\b|ticket\b|前売\b|当日\b|優先\s*[\/・]?\s*一般|u-\d+\b)/i
const NOISE_LINE_RE  = /^(?:open|start|close|終演|開場|開演|発売|予約|前売|当日|sold\s*out|チケット|copyright|all\s+rights|reserved|more|詳細|info|ホールレンタル|ホール貸|hall\s*rental|coming\s*soon|season\s*off|シーズンオフ)/i

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

/** Validate a candidate event title. */
export function validateTitle(title: string): ValidationResult {
  const s = title.trim()
  if (s.length < 5)         return { ok: false, reason: 'too_short' }
  if (s.length > 300)       return { ok: false, reason: 'too_long' }
  if (BARE_INT_RE.test(s))  return { ok: false, reason: 'bare_integer' }
  if (DOW_EN_RE.test(s))    return { ok: false, reason: 'day_of_week_en' }
  if (DOW_JA_RE.test(s))    return { ok: false, reason: 'day_of_week_ja' }
  if (STARTS_TIME_RE.test(s)) return { ok: false, reason: 'starts_with_time' }
  if (PRICE_LABEL_RE.test(s)) return { ok: false, reason: 'price_label' }
  if (NOISE_LINE_RE.test(s))  return { ok: false, reason: 'noise_phrase' }
  return { ok: true }
}

/** Validate ISO date string YYYY-MM-DD and require it to be in a sane range. */
export function validateDate(iso: string): ValidationResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { ok: false, reason: 'bad_date_format' }
  const t = Date.parse(iso + 'T00:00:00Z')
  if (Number.isNaN(t)) return { ok: false, reason: 'unparseable_date' }
  const now = Date.now()
  const past = now - 30 * 86400_000        // 30 days ago — drop very old listings
  const future = now + 730 * 86400_000     // 2 years out — drop bogus far-future
  if (t < past)   return { ok: false, reason: 'date_too_old' }
  if (t > future) return { ok: false, reason: 'date_too_far_future' }
  return { ok: true }
}

/** Convenience: validate a RawEvent in one call. */
export function validateEvent(input: { titleRaw: string; eventDate: string }): ValidationResult {
  const t = validateTitle(input.titleRaw); if (!t.ok) return t
  const d = validateDate(input.eventDate); if (!d.ok) return d
  return { ok: true }
}
