/**
 * lib/pipeline/artist-pipeline.ts
 *
 * Shared helpers for the automated artist extraction pipeline.
 * Used by both cron routes (app/api/cron/*) and CLI scripts (scripts/*).
 *
 * Contents:
 *   - Filter constants  (GENRE_BLOCKLIST, BOILERPLATE_PATTERNS, PRICING_PATTERNS)
 *   - Token helpers     (normaliseToken, stripTitleNoise, scoreToken, …)
 *   - Bilingual helpers (parseBilingualEntry, parseBilingualName, hasJapanese, isRoman)
 *   - Slug helpers      (slugify, uniqueSlug)
 *   - Venue lookup      (buildVenueLookup, isVenueName, checkAgainstVenues)
 *   - Description       (extractDescriptionTokens)
 *   - Types             (Confidence, CandidateRow, AggRow, …)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ── Admin client factory (re-exported for cron routes) ─────────────────────

export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── Types ──────────────────────────────────────────────────────────────────

export type Confidence = 'high' | 'medium' | 'low' | 'discard'
export type LlmVerdict = 'artist' | 'not_artist' | 'uncertain'

export interface CandidateRow {
  raw_name: string
  source: 'title' | 'description' | 'title_fallback'
  confidence: Confidence
  confidence_reason: string
  event_id: string
}

export interface AggRow {
  name_norm: string
  name_display: string
  event_count: number
  confidence: 'high' | 'medium' | 'low'
}

export interface VenueRow { name_en: string; name_ja: string | null }
export interface VenueRowWithSlug extends VenueRow { slug: string }

// ── Filter constants ───────────────────────────────────────────────────────

export const GENRE_BLOCKLIST = new Set([
  'HARDCORE', 'METAL', 'POWERVIOLENCE', 'ALTERNATIVE', 'PUNK', 'NOISE',
  'ROCK', 'POP', 'JAZZ', 'HIPHOP', 'HIP-HOP', 'ELECTRONIC', 'TECHNO',
  'HOUSE', 'INDIE', 'EMO', 'CORE', 'HEAVYMETAL', 'DEATH METAL',
  'BLACK METAL', 'GRINDCORE', 'POST-ROCK', 'POST ROCK', 'SHOEGAZE',
  'THRASH METAL', 'THRASH', 'DOOM', 'SLUDGE', 'PSYCH', 'PSYCHEDELIC',
  'FOLK', 'COUNTRY', 'AMBIENT', 'EXPERIMENTAL', 'MATH ROCK',
  'POST PUNK', 'POST-PUNK', 'CROSSOVER', 'GRUNGE', 'DRONE', 'NOISE ROCK',
])

export const BOILERPLATE_PATTERNS: RegExp[] = [
  /^live\s*info$/i,
  /^live[：:]/i,
  /^\.\.\.more\s*schedule/i,
  /公演に関する注意事項はこちら/,
  /^ワンマン$/,
  /^access\s*map$/i,
  /^pick\s*up\s*event$/i,
  /^read\s*more\s*news$/i,
  /^続きを読む/,
  /^過去のイベント/,
  /^お楽しみに/,
  /\bpresents$/i,
  /\bpre\.$/i,
  /\bpres\.$/i,
  /^presents$/i,
  /debut\s+\d+\w+\s+anniversary/i,
  /copyright/i,
  /©|®|℗/,
  /all\s+right[s]?\s+reserved/i,
  /\d+th\s+anniversary/i,
  /anniversary/i,
  /\d{4}年/,
  /^act[：:]/i,
  /^talk[：:]/i,
  /^dj[：:]/i,
  /^host[：:]/i,
  /^vj[：:]/i,
  /^mc[：:]/i,
  /^support[：:]/i,
  /^open[：:]/i,
  /^guest[：:]/i,
  /[：:]$/,
  /^※/,
  /^→/,
  /^▼/,
  /\bjapan\s+(tour|show|leg)\b/i,
  /\blive\s+in\s+japan\b/i,
  /\bin\s+japan\b/i,
  /@[\w.]+\.[a-z]{2,}/,
  /https?:\/\//,
  /^(vo|gt?|ba?|dr?|key|kb|vio?|perc|sax|cho|tr|mc)\s*[・.]\s+/i,
  /ダービー/,
  /まつり$|祭り?$/,
  /nights?$/i,
  /session$/i,
]

export const PRICING_PATTERNS: RegExp[] = [
  /円/, /D代/, /\b1D\b/, /1ドリンク/, /前方/, /一般/, /優先/,
  /チケット/, /入場時/, /別途/, /前売/, /当日/, /当券/,
  /ENTRANCE\s*FREE/i, /-\s*\/\s*-/, /\+\d+D/, /¥\s*\d/, /￥\s*\d/,
  /^\d{1,3},\d{3}/, /^-\s/, /\(\d+\)/, /\+\s*\d*\s*drink/i,
  /\bdrink\s+\d{2,}/i,
]

const GENERIC_STANDALONE = new Set([
  'NIGHT', 'DAY', 'MORNING', 'LIVE', 'EVENT', 'SHOW', 'TOUR', 'PRESENTS',
  'SPECIAL', 'SESSION', 'PARTY', 'CONCERT', 'GIG', 'PERFORMANCE', 'STAGE',
  'OPEN', 'START', 'DOORS', 'SCHEDULE', 'INFO', 'NEWS',
])

const JP_PARTICLES_MID = /[のはをがでにへと].+/

// ── Bilingual helpers ──────────────────────────────────────────────────────

export function hasJapanese(s: string): boolean {
  return /[぀-ヿ㐀-鿿豈-﫿＀-￯]/.test(s)
}

export function isRoman(s: string): boolean {
  return /^[A-Za-z0-9\s\-_.!?'"&+*()[\]]+$/.test(s.trim())
}

const BILINGUAL_SEP = /\s*[／/]\s*/

export function parseBilingualEntry(entry: string): { nameJa: string; nameEn: string } | null {
  const parts = entry.split(BILINGUAL_SEP)
  if (parts.length !== 2) return null
  const [a, b] = parts.map(p => p.trim())
  if (!a || !b) return null
  if (hasJapanese(a) && isRoman(b)) return { nameJa: a, nameEn: b }
  if (isRoman(a) && hasJapanese(b)) return { nameJa: b, nameEn: a }
  return null
}

export function parseBilingualName(displayName: string): { nameEn: string; nameJa: string | null } {
  const parts = displayName.split(BILINGUAL_SEP)
  if (parts.length !== 2) return { nameEn: displayName, nameJa: null }
  const [a, b] = parts.map(p => p.trim())
  if (!a || !b) return { nameEn: displayName, nameJa: null }
  if (hasJapanese(a) && isRoman(b)) return { nameEn: b, nameJa: a }
  if (isRoman(a) && hasJapanese(b)) return { nameEn: a, nameJa: b }
  return { nameEn: displayName, nameJa: null }
}

// ── Slug helpers ───────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function randomHex(bytes = 4): string {
  return [...Array(bytes * 2)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
}

export function uniqueSlug(name: string, existingSlugs: Set<string>): string {
  let base = slugify(name)
  if (!base) {
    base = `artist-${randomHex(4)}`
    while (existingSlugs.has(base)) base = `artist-${randomHex(4)}`
    return base
  }
  if (!existingSlugs.has(base)) return base
  for (let i = 2; i <= 999; i++) {
    const candidate = `${base.slice(0, 57)}-${i}`
    if (!existingSlugs.has(candidate)) return candidate
  }
  return `${base.slice(0, 51)}-${randomHex(4)}`
}

// ── Venue lookup ───────────────────────────────────────────────────────────

const MIN_VENUE_TOKEN_LEN = 3

export interface VenueLookup {
  exactNames: Set<string>
  tokenSet: Set<string>
  venueList: string[]
}

export function buildVenueLookup(venues: VenueRowWithSlug[]): VenueLookup {
  const exactNames = new Set<string>()
  const tokenSet = new Set<string>()
  const venueList: string[] = []
  for (const v of venues) {
    const names = [v.name_en, v.name_ja].filter(Boolean) as string[]
    for (const name of names) {
      const lower = name.toLowerCase().trim()
      exactNames.add(lower)
      for (const token of lower.split(/[\s\-_/・]+/)) {
        if (token.length >= MIN_VENUE_TOKEN_LEN) tokenSet.add(token)
      }
    }
    venueList.push(v.name_ja ? `${v.name_en} (${v.name_ja})` : v.name_en)
  }
  return { exactNames, tokenSet, venueList }
}

export function buildVenueLookupSimple(venues: VenueRow[]): VenueLookup {
  return buildVenueLookup(venues.map(v => ({ ...v, slug: '' })))
}

export function isVenueName(candidate: string, lookup: VenueLookup): boolean {
  const lower = candidate.toLowerCase().trim()
  if (lookup.exactNames.has(lower)) return true
  if (lower.length >= MIN_VENUE_TOKEN_LEN && lookup.tokenSet.has(lower)) return true
  for (const venueName of lookup.exactNames) {
    if (venueName.length >= MIN_VENUE_TOKEN_LEN && lower.includes(venueName)) return true
  }
  return false
}

export function checkAgainstVenues(
  candidate: string,
  lookup: VenueLookup,
): { verdict: LlmVerdict; reason: string } | null {
  const lower = candidate.toLowerCase().trim()
  const MIN = 4
  if (lookup.exactNames.has(lower)) {
    return { verdict: 'not_artist', reason: 'exact match to known venue name' }
  }
  if (lower.length >= MIN && lookup.tokenSet.has(lower)) {
    return { verdict: 'not_artist', reason: `"${candidate}" is a token from a known venue name` }
  }
  for (const venueName of lookup.exactNames) {
    if (lower.includes(venueName) && venueName.length >= MIN) {
      return { verdict: 'not_artist', reason: `contains known venue name "${venueName}"` }
    }
  }
  return null
}

// ── Token filters ──────────────────────────────────────────────────────────

export function isPricingGarbage(token: string): boolean {
  return PRICING_PATTERNS.some(p => p.test(token))
}
export function isGenreLabel(token: string): boolean {
  return GENRE_BLOCKLIST.has(token.trim().toUpperCase())
}
export function isBoilerplate(token: string): boolean {
  return BOILERPLATE_PATTERNS.some(p => p.test(token.trim()))
}
export function isEventTourDescriptor(token: string): boolean {
  return (
    (/\b(tour|ツアー)\b/i.test(token) && /\b20\d\d\b/.test(token)) ||
    /\bjapan\s+(tour|show|leg)\b/i.test(token) ||
    /\blive\s+in\s+japan\b/i.test(token) ||
    /\bin\s+japan\b/i.test(token)
  )
}

// ── Title noise helpers ────────────────────────────────────────────────────

const NOISE_SEGMENTS: RegExp[] = [
  /\s+(presents?|pre\.|pres\.)(\s+.*)?$/i,
  /\s*[-–—]?\s*(vol\.?\s*\d+|#\d+|day\s*\.?\s*\d+|part\s+\d+)\s*/gi,
  /\s*(release\s+(event|party|live)|birthday\s+(live|party)|生誕祭?|周年)\s*/gi,
  /\s*(tour|ツアー|festival|fest)\b/gi,
  /\s*\bjapan\s+(tour|show|leg)\b/gi,
  /\s*\blive\s+in\s+japan\b/gi,
  /\s*\bin\s+japan\b/gi,
  /\s+oneman(\s+live)?\s*/gi,
  /ワンマン/g,
  /\s+live(\s+tour)?\s*$/i,
  /\s+ライブ(\s+tour)?\s*$/gi,
  /\s+20\d\d\s*$/,
  /\d+周年/, /\d+記念/, /記念/,
]

export function stripTitleNoise(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^\d+[部章節][】]?\s*/, '')
  s = s.replace(/^[『【〈《「（(]+|[』】〉》」）)]+$/g, '').trim()
  s = s.replace(/^["'「」]+|["'「」]+$/g, '').trim()
  for (const re of NOISE_SEGMENTS) s = s.replace(re, ' ')
  s = s.replace(/^[\s\-–—_/\\*#@!()\[\]{}<>,"'`~^。、]+/, '')
  s = s.replace(/[\s\-–—_/\\*#@!()\[\]{}<>,"'`~^。、]+$/, '')
  return s.trim()
}

export function titleHasNoise(raw: string): boolean {
  return (
    /\bpresents?\b/i.test(raw) || /\bpre\./i.test(raw) || /\bpres\./i.test(raw) ||
    /\bvol\.\s*\d/i.test(raw) || /#\d/.test(raw) || /\brelease\b/i.test(raw) ||
    /\banniversary\b/i.test(raw) || /周年/.test(raw) || /記念/.test(raw) ||
    /\btour\b/i.test(raw) || /ツアー/.test(raw) || /\bfestival\b/i.test(raw) ||
    /\bfest\b/i.test(raw) || /生誕/.test(raw) ||
    /[の は を が で に へ と]/.test(raw) || /×/.test(raw) ||
    /\bjapan\s+tour\b/i.test(raw) || /\blive\s+in\s+japan\b/i.test(raw) ||
    /\s{2,}/.test(raw)
  )
}

export function looksLikeSingleAct(stripped: string): boolean {
  if (stripped.length < 3 || stripped.length > 35) return false
  if (/[,，]/.test(stripped)) return false
  if (/\s+[/／]\s+/.test(stripped)) return false
  if (/\bvs\.?\b/i.test(stripped)) return false
  if (/×/.test(stripped)) return false
  if (/\s{2,}/.test(stripped)) return false
  if (/[のはをがでにへと].+/.test(stripped)) return false
  return true
}

export function normaliseToken(raw: string): string {
  let t = raw.trim()
  t = t.replace(/^[•·▼▲▶◀→←↑↓↔⇒⇐※◎○●◆◇■□▪▫〜～〽♪♫✓✗✕①②③④⑤⑥⑦⑧⑨⑩]+\s*/g, '').trim()
  t = t.replace(/^[〜～]\s*/g, '').replace(/\s*[〜～]$/g, '').trim()
  const jpBracketIdx = t.search(/[「（『【〈《〔｢]/)
  if (jpBracketIdx > 2) t = t.slice(0, jpBracketIdx).trim()
  const unmatched = t.match(/^(.*?)\([^)]*$/)
  if (unmatched && unmatched[1].length > 2) t = unmatched[1].trim()
  t = t.replace(/[.,!?;:…。、！？\-~〜*#\s]+$/, '').trim()
  return t
}

// ── Scoring ────────────────────────────────────────────────────────────────

export function scoreToken(
  token: string,
  eventCount: number,
  existingArtists: Set<string>,
): { confidence: Confidence; reason: string } {
  const lower = token.toLowerCase().trim()
  if (existingArtists.has(lower)) return { confidence: 'high', reason: 'matches existing artist' }
  if (GENERIC_STANDALONE.has(token.toUpperCase().trim())) return { confidence: 'discard', reason: 'generic standalone word' }
  if (token.length < 3)  return { confidence: 'discard', reason: 'too short (<3 chars)' }
  if (token.length > 40) return { confidence: 'discard', reason: 'too long (>40 chars)' }
  if (eventCount >= 3)   return { confidence: 'high',   reason: `appears in ${eventCount} events` }
  if (eventCount === 2)  return { confidence: 'medium', reason: 'appears in 2 events' }
  if (/^[A-Z][A-Z0-9\s\-_.!?'&+*]{2,19}$/.test(token) && !/\s{2}/.test(token)) {
    return { confidence: 'medium', reason: `all-caps ASCII, ${token.length} chars` }
  }
  if (/^[A-Za-z][A-Za-z0-9\s\-_.!?'&+*]{2,24}$/.test(token)) {
    return { confidence: 'medium', reason: `mixed-case ASCII, ${token.length} chars` }
  }
  const isJapanese = /^[　-鿿豈-﫿＀-￯぀-ヿ][　-鿿豈-﫿＀-￯぀-ヿ\s]*$/.test(token.trim())
  if (isJapanese && token.trim().length >= 2 && token.trim().length <= 20) {
    if (!JP_PARTICLES_MID.test(token)) return { confidence: 'medium', reason: `Japanese text, ${token.trim().length} chars` }
    return { confidence: 'low', reason: 'Japanese with particles (likely phrase)' }
  }
  if (/[／/]/.test(token) && parseBilingualEntry(token) !== null) {
    return { confidence: 'medium', reason: 'bilingual JP/EN artist name' }
  }
  return { confidence: 'low', reason: 'single appearance or ambiguous' }
}

// ── Description token extraction ───────────────────────────────────────────

export function extractDescriptionTokens(description: string): string[] {
  const m = description.match(/\bWith\s+(.+?)(?:\.\s|\.\.\.|,\s*\.\.\.|$)/i)
  if (!m) return []
  let content = m[1].trim().replace(/^w\/\s*/i, '')
  const rawTokens: string[] = []
  for (const part of content.split(/\s*,\s*/)) {
    rawTokens.push(...part.split(/\s+\/\s+/))
  }
  return rawTokens
    .map(raw => {
      let t = raw.trim()
        .replace(/[.,!?;:…。、！？\-]+$/, '').trim()
        .replace(/^[.,!?;:…。、！？\-*]+/, '').trim()
        .replace(/^[「」『』【】()[\]""'']+|[「」『』【】()[\]""'']+$/g, '').trim()
      return t
    })
    .filter(t => t.length >= 2)
}

// ── Verdict mapping ────────────────────────────────────────────────────────

export function verdictToStatus(v: LlmVerdict): 'approved' | 'rejected' | 'pending' {
  if (v === 'artist')    return 'approved'
  if (v === 'not_artist') return 'rejected'
  return 'pending'
}

// ── LLM review prompt ──────────────────────────────────────────────────────

export function buildReviewPrompt(
  candidate: { name_display: string; event_count: number | null; sample_title: string | null; sample_description: string | null },
  venueList: string[],
): string {
  const title = (candidate.sample_title ?? '').slice(0, 120)
  const desc  = (candidate.sample_description ?? '').slice(0, 300)
  return `You are classifying strings extracted from Japanese live music event listings in Osaka.

Classify this string as ONE of: "artist", "not_artist", or "uncertain"

Rules:
- "artist": a performing band or solo artist name
- "not_artist": a show title, series name, genre label, venue name, promoter name, or pricing string
- "uncertain": genuinely ambiguous — could be either

Known Osaka live venues (these are NOT artists):
${venueList.join(', ')}

If the string matches or closely resembles any of the above venue names, classify as "not_artist".

String: "${candidate.name_display}"
Event title it appeared in: "${title}"
Event description: "${desc}"
Times seen across events: ${candidate.event_count ?? 1}

Respond with JSON only: {"verdict": "artist"|"not_artist"|"uncertain", "reason": "one concise sentence"}`
}

// ── Chain trigger helper ───────────────────────────────────────────────────

/**
 * Fire-and-forget trigger for the next cron step.
 * Uses Next.js `after()` semantics — call this BEFORE returning the response.
 * The caller is responsible for calling after() with this function.
 */
export async function triggerCronStep(path: string, secret: string | undefined): Promise<void> {
  if (!secret) {
    console.warn(`[pipeline] CRON_SECRET not set — cannot trigger ${path}`)
    return
  }
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(5_000),
    })
    console.log(`[pipeline] triggered ${path} → ${res.status}`)
  } catch (err) {
    console.warn(`[pipeline] failed to trigger ${path}:`, err)
  }
}
