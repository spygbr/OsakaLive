/**
 * scripts/extract-artist-candidates.ts
 *
 * Phase 1 of the artist extraction pipeline.
 * Extracts artist name candidates from events.title_raw, event_sources.lineup,
 * and events.description, and populates the pre-aggregated artist_candidates
 * staging table (one row per distinct name_norm).
 *
 * Usage:
 *   npx tsx scripts/extract-artist-candidates.ts [--dry-run]
 *
 * Options:
 *   --dry-run  Print candidates to stdout without writing to the DB
 *
 * Re-runnable: clears all unreviewed/unpromoted rows before re-inserting.
 * Safe to run multiple times before Phase 2 (LLM review) begins.
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 */

import fs   from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

// ── Load .env.local ────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (m) {
      const key = m[1].trim()
      const val = m[2].trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN      = process.argv.includes('--dry-run')

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    '❌  Missing env vars.\n' +
    '    Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}

// Note: artist_candidates is not yet in the generated Database types.
// Using untyped client is fine for a script-only operation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── Types ──────────────────────────────────────────────────────────────────────

type Confidence = 'high' | 'medium' | 'low' | 'discard'

interface CandidateRow {
  raw_name:          string
  // 'title_fallback': stripped title used as lineup fallback (no lineup found, single-act title)
  source:            'title' | 'description' | 'title_fallback'
  confidence:        Confidence
  confidence_reason: string
  event_id:          string
}

// ── Noise constants ────────────────────────────────────────────────────────────

/** Genre labels — discard token, not the whole description */
const GENRE_BLOCKLIST = new Set([
  'HARDCORE', 'METAL', 'POWERVIOLENCE', 'ALTERNATIVE', 'PUNK', 'NOISE',
  'ROCK', 'POP', 'JAZZ', 'HIPHOP', 'HIP-HOP', 'ELECTRONIC', 'TECHNO',
  'HOUSE', 'INDIE', 'EMO', 'CORE', 'HEAVYMETAL', 'DEATH METAL',
  'BLACK METAL', 'GRINDCORE', 'POST-ROCK', 'POST ROCK', 'SHOEGAZE',
  'THRASH METAL', 'THRASH', 'DOOM', 'SLUDGE', 'PSYCH', 'PSYCHEDELIC',
  'FOLK', 'COUNTRY', 'AMBIENT', 'EXPERIMENTAL', 'MATH ROCK',
  'POST PUNK', 'POST-PUNK', 'CROSSOVER', 'GRUNGE', 'DRONE', 'NOISE ROCK',
])

/** Boilerplate token patterns — discard token */
const BOILERPLATE_PATTERNS: RegExp[] = [
  /^live\s*info$/i,
  /^live[：:]/i,          // "LIVE：Merry Ghosts" fragment prefix
  /^\.\.\.more\s*schedule/i,
  /公演に関する注意事項はこちら/,
  /^ワンマン$/,
  /^access\s*map$/i,
  /^pick\s*up\s*event$/i,
  /^read\s*more\s*news$/i,
  /^続きを読む/,
  /^過去のイベント/,
  /^お楽しみに/,
  /\bpresents$/i,     // "HOKAGE presents"
  /\bpre\.$/i,        // "X pre."
  /\bpres\.$/i,       // "X pres."
  /^presents$/i,
  /debut\s+\d+\w+\s+anniversary/i,
  // Copyright / legal boilerplate
  /copyright/i,
  /©|®|℗/,
  /all\s+right[s]?\s+reserved/i,
  // Venue anniversary strings (not artist names)
  /\d+th\s+anniversary/i,
  /anniversary/i,
  // Date-range strings like "2011年以前"
  /\d{4}年/,
  // Generic section headers / role prefixes
  /^act[：:]/i,
  /^talk[：:]/i,
  /^dj[：:]/i,
  /^host[：:]/i,
  /^vj[：:]/i,
  /^mc[：:]/i,
  /^support[：:]/i,
  /^open[：:]/i,
  /^guest[：:]/i,
  // Fragments ending in a colon (role/section prefix stripped of value)
  /[：:]$/,
  // Japanese note/disclaimer markers — always boilerplate, never artist names
  /^※/,               // "※写真・動画撮影禁止", "※FC会員限定公演"
  /^→/,               // directional venue/access note
  /^▼/,               // Japanese section header arrow
  // Tour / "in Japan" descriptors (apply to description tokens too)
  /\bjapan\s+(tour|show|leg)\b/i,
  /\blive\s+in\s+japan\b/i,
  /\bin\s+japan\b/i,
  // Contact / URL fragments
  /@[\w.]+\.[a-z]{2,}/,   // email addresses
  /https?:\/\//,           // URLs
  // Instrument role prefix + interpunct (e.g. "G・山田", "Dr・田中", "B・佐藤")
  /^(vo|gt?|ba?|dr?|key|kb|vio?|perc|sax|cho|tr|mc)\s*[・.]\s+/i,
  // Japanese event series suffixes — recurring nights/events at a venue, never artist names
  /ダービー/,         // "ブロンズダービー" = Bronze Derby (event series at BRONZE venue)
  /まつり$|祭り?$/,   // festival suffix
  /nights?$/i,
  /session$/i,
]

/** Pricing / ticket garbage — discard token */
const PRICING_PATTERNS: RegExp[] = [
  /円/,
  /D代/,
  /\b1D\b/,
  /1ドリンク/,
  /前方/,
  /一般/,
  /優先/,
  /チケット/,
  /入場時/,
  /別途/,
  /前売/,
  /当日/,
  /当券/,
  /ENTRANCE\s*FREE/i,
  /-\s*\/\s*-/,       // ticket tier dashes "前方 - / 一般 -"
  /\+\d+D/,           // "+1D", "+2D"
  /¥\s*\d/,
  /￥\s*\d/,
  /^\d{1,3},\d{3}/,   // price like "3,000"
  /^-\s/,             // leading dash (price tier fragment)
  /\(\d+\)/,          // pricing in parens
  /\+\s*\d*\s*drink/i,  // "+1drink", "+ 1drink", "+drink"
  /\bdrink\s+\d{2,}/i,  // "drink 600" (drink + price number)
]

/** Japanese particles in the middle of a string → phrase, not a name */
const JP_PARTICLES_MID = /[のはをがでにへと].+/

// ── Bilingual name detection ───────────────────────────────────────────────────

/** True if the string contains at least one Japanese character (Hiragana/Katakana/Kanji) */
function hasJapaneseChars(s: string): boolean {
  return /[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(s)
}

/** True if the string is purely Roman/ASCII — letters, digits, common punctuation */
function isRomanScript(s: string): boolean {
  return /^[A-Za-z0-9\s\-_.!?'"&+*()[\]]+$/.test(s.trim())
}

/**
 * Splits on bilingual separators: ASCII " / " or full-width "／" (U+FF0F),
 * with or without surrounding spaces.
 */
const BILINGUAL_SEP = /\s*[／/]\s*/

/**
 * Detect a bilingual entry like "バンド名／Band Name", "エリック・マーティン／Eric Martin",
 * or "Band Name / バンド名". Handles both full-width ／ and ASCII /.
 * Returns { nameJa, nameEn } when one side is Japanese and the other is Roman.
 * Returns null when both sides are the same script (= two separate acts to split normally).
 */
function parseBilingualEntry(entry: string): { nameJa: string; nameEn: string } | null {
  const parts = entry.split(BILINGUAL_SEP)
  if (parts.length !== 2) return null
  const [a, b] = parts.map(p => p.trim())
  if (!a || !b) return null
  if (hasJapaneseChars(a) && isRomanScript(b)) return { nameJa: a, nameEn: b }
  if (isRomanScript(a) && hasJapaneseChars(b)) return { nameJa: b, nameEn: a }
  return null  // both same script → two separate acts
}

// ── Venue lookup ───────────────────────────────────────────────────────────────

const MIN_VENUE_TOKEN_LEN = 3

interface VenueLookup {
  exactNames: Set<string>
  tokenSet:   Set<string>
}

function buildVenueLookup(venues: { name_en: string; name_ja: string | null }[]): VenueLookup {
  const exactNames = new Set<string>()
  const tokenSet   = new Set<string>()

  for (const v of venues) {
    const names = [v.name_en, v.name_ja].filter(Boolean) as string[]
    for (const name of names) {
      const lower = name.toLowerCase().trim()
      exactNames.add(lower)
      // Tokenise on whitespace and common separators
      for (const token of lower.split(/[\s\-_/・]+/)) {
        if (token.length >= MIN_VENUE_TOKEN_LEN) tokenSet.add(token)
      }
    }
  }

  return { exactNames, tokenSet }
}

function isVenueName(candidate: string, lookup: VenueLookup): boolean {
  const lower = candidate.toLowerCase().trim()
  // Exact match
  if (lookup.exactNames.has(lower)) return true
  // Candidate is itself a significant venue token (e.g. "Zeela", "BEARS", "ブロンズ")
  if (lower.length >= MIN_VENUE_TOKEN_LEN && lookup.tokenSet.has(lower)) return true
  // Candidate contains a full venue name (e.g. "Namba BEARS presents")
  for (const venueName of lookup.exactNames) {
    if (venueName.length >= MIN_VENUE_TOKEN_LEN && lower.includes(venueName)) return true
  }
  return false
}

/** Standalone generic tokens too vague to be an artist */
const GENERIC_STANDALONE = new Set([
  'NIGHT', 'DAY', 'MORNING', 'LIVE', 'EVENT', 'SHOW', 'TOUR', 'PRESENTS',
  'SPECIAL', 'SESSION', 'PARTY', 'CONCERT', 'GIG', 'PERFORMANCE', 'STAGE',
  'OPEN', 'START', 'DOORS', 'SCHEDULE', 'INFO', 'NEWS',
])

// ── Title noise strip ──────────────────────────────────────────────────────────

/**
 * Strip known non-artist suffixes/prefixes from a title so we can judge
 * whether what remains looks like a real band name.
 */
function stripTitleNoise(raw: string): string {
  let s = raw.trim()

  // Strip leading section markers like "2部】"
  s = s.replace(/^\d+[部章節][】]?\s*/, '')

  // Strip wrapping/decorative brackets if they enclose the whole string
  s = s.replace(/^[『【〈《「（(]+|[』】〉》」）)]+$/g, '').trim()
  s = s.replace(/^["'「」]+|["'「」]+$/g, '').trim()

  const noiseSegments: RegExp[] = [
    // Presenter suffix: "X presents ...", "X pre. ...", "X pres. ..."
    /\s+(presents?|pre\.|pres\.)(\s+.*)?$/i,
    // Vol / # / Day / Part markers
    /\s*[-–—]?\s*(vol\.?\s*\d+|#\d+|day\s*\.?\s*\d+|part\s+\d+)\s*/gi,
    // Release/Birthday/Anniversary event markers
    /\s*(release\s+(event|party|live)|birthday\s+(live|party)|生誕祭?|周年)\s*/gi,
    // Tour / Festival (including JAPAN TOUR / IN JAPAN variants)
    /\s*(tour|ツアー|festival|fest)\b/gi,
    /\s*\bjapan\s+(tour|show|leg)\b/gi,
    /\s*\blive\s+in\s+japan\b/gi,
    /\s*\bin\s+japan\b/gi,
    // "ONEMAN LIVE", "LIVE TOUR", standalone "LIVE" / "ライブ" at end, ワンマン
    /\s+oneman(\s+live)?\s*/gi,
    /ワンマン/g,
    /\s+live(\s+tour)?\s*$/i,
    /\s+ライブ(\s+tour)?\s*$/gi,  // Japanese "live"
    // Trailing year
    /\s+20\d\d\s*$/,
    // Japanese anniversary / commemoration
    /\d+周年/,
    /\d+記念/,
    /記念/,
  ]

  for (const re of noiseSegments) {
    s = s.replace(re, ' ')
  }

  // Strip leading/trailing punctuation & whitespace
  s = s.replace(/^[\s\-–—_/\\*#@!()\[\]{}<>,"'`~^。、]+/, '')
  s = s.replace(/[\s\-–—_/\\*#@!()\[\]{}<>,"'`~^。、]+$/, '')
  return s.trim()
}

/**
 * True if the RAW (unstripped) title contains noise signals that suggest
 * it's a show title rather than an artist name.
 */
function titleHasNoise(raw: string): boolean {
  return (
    /\bpresents?\b/i.test(raw) ||
    /\bpre\./i.test(raw) ||
    /\bpres\./i.test(raw) ||
    /\bvol\.\s*\d/i.test(raw) ||
    /#\d/.test(raw) ||
    /\brelease\b/i.test(raw) ||
    /\banniversary\b/i.test(raw) ||
    /周年/.test(raw) ||
    /記念/.test(raw) ||
    /\btour\b/i.test(raw) ||
    /ツアー/.test(raw) ||
    /\bfestival\b/i.test(raw) ||
    /\bfest\b/i.test(raw) ||
    /生誕/.test(raw) ||
    /[の は を が で に へ と]/.test(raw) ||  // Japanese particles
    /×/.test(raw) ||               // combination/collab marker, not a single artist
    /\bjapan\s+tour\b/i.test(raw) ||
    /\blive\s+in\s+japan\b/i.test(raw) ||
    /\s{2,}/.test(raw)             // double space = likely "ARTIST  event description" fragment
  )
}

// ── Confidence scoring ─────────────────────────────────────────────────────────

function scoreToken(
  token: string,
  eventCount: number,
  existingArtists: Set<string>,
): { confidence: Confidence; reason: string } {
  const lower = token.toLowerCase().trim()

  // Exact match to seeded artists (highest priority)
  if (existingArtists.has(lower)) {
    return { confidence: 'high', reason: 'matches existing artist' }
  }

  // Generic standalone words are always discarded, regardless of frequency
  if (GENERIC_STANDALONE.has(token.toUpperCase().trim())) {
    return { confidence: 'discard', reason: 'generic standalone word' }
  }

  // Length gates
  if (token.length < 3)  return { confidence: 'discard', reason: 'too short (<3 chars)' }
  if (token.length > 40) return { confidence: 'discard', reason: 'too long (>40 chars)' }

  // Frequency-based boosts (after length/generic checks)
  if (eventCount >= 3) {
    return { confidence: 'high', reason: `appears in ${eventCount} events` }
  }
  if (eventCount === 2) {
    return { confidence: 'medium', reason: 'appears in 2 events' }
  }

  // All-caps ASCII 3–20 chars (e.g. "SLUG", "ENDON", "SOLMANIA")
  if (/^[A-Z][A-Z0-9\s\-_.!?'&+*]{2,19}$/.test(token) && !/\s{2}/.test(token)) {
    return { confidence: 'medium', reason: `all-caps ASCII, ${token.length} chars` }
  }

  // Mixed-case ASCII 3–25 chars
  if (/^[A-Za-z][A-Za-z0-9\s\-_.!?'&+*]{2,24}$/.test(token)) {
    return { confidence: 'medium', reason: `mixed-case ASCII, ${token.length} chars` }
  }

  // Japanese text (with optional spaces between characters), 2–20 chars, no particles
  // Allows names like "東京 事変" or "エレファント カシマシ" where spaces appear between kanji/kana
  const isJapanese = /^[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3040-\u30FF][\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3040-\u30FF\s]*$/.test(token.trim())
  if (isJapanese && token.trim().length >= 2 && token.trim().length <= 20) {
    if (!JP_PARTICLES_MID.test(token)) {
      return { confidence: 'medium', reason: `Japanese text, ${token.trim().length} chars` }
    }
    return { confidence: 'low', reason: 'Japanese with particles (likely phrase)' }
  }

  // Bilingual artist name: "JP名／EN Name", "エリック・マーティン／Eric Martin", etc.
  // Handles both full-width ／ and ASCII /. One side Japanese, other Roman.
  if (/[／/]/.test(token) && parseBilingualEntry(token) !== null) {
    return { confidence: 'medium', reason: 'bilingual JP/EN artist name' }
  }

  // Mixed script or unrecognised pattern
  return { confidence: 'low', reason: 'single appearance or ambiguous' }
}

// ── Filter helpers ─────────────────────────────────────────────────────────────

function isPricingGarbage(token: string): boolean {
  return PRICING_PATTERNS.some(p => p.test(token))
}

function isGenreLabel(token: string): boolean {
  return GENRE_BLOCKLIST.has(token.trim().toUpperCase())
}

function isBoilerplate(token: string): boolean {
  return BOILERPLATE_PATTERNS.some(p => p.test(token.trim()))
}

/**
 * True if the token looks like a tour/event descriptor rather than an artist name.
 * Applied to both title and description candidates.
 */
function isEventTourDescriptor(token: string): boolean {
  return (
    // Tour name + year  ("GRANDRAY TOUR 2026", "sadd tour 2026 Vaporlamp")
    (/\b(tour|ツアー)\b/i.test(token) && /\b20\d\d\b/.test(token)) ||
    // "SVDESTADA JAPAN TOUR 2026" — already caught above, but explicit for clarity
    /\bjapan\s+(tour|show|leg)\b/i.test(token) ||
    /\blive\s+in\s+japan\b/i.test(token) ||
    /\bin\s+japan\b/i.test(token)
  )
}

/**
 * Normalise a raw candidate token:
 *  1. Strip leading decorative symbols (bullets •, arrows ▼→, note markers ※)
 *  2. Strip wrapping 〜...〜 decorators
 *  3. Truncate at the first unmatched Japanese opening bracket in the middle
 *     e.g. "cadode「SLICE OF SEKAI ROUTE 1" → "cadode"
 *     e.g. "Yoonsung(韓国)" is not truncated (balanced parens are preserved)
 *     e.g. "DOJOSQUEEZ(ONI+サブちゃん" → "DOJOSQUEEZ"
 *  4. Strip trailing noise punctuation after truncation
 *
 * Returns the cleaned string. If the cleaned result is too short (< 3 chars),
 * the caller should discard the token.
 */
function normaliseToken(raw: string): string {
  let t = raw.trim()

  // 1. Strip leading decorative / non-alphanumeric symbols
  t = t.replace(/^[•·▼▲▶◀→←↑↓↔⇒⇐※◎○●◆◇■□▪▫〜～〽♪♫✓✗✕①②③④⑤⑥⑦⑧⑨⑩]+\s*/g, '').trim()

  // 2. Strip wrapping 〜...〜 and ～...～ decorators (Japanese tilde wrappers)
  t = t.replace(/^[〜～]\s*/g, '').replace(/\s*[〜～]$/g, '').trim()

  // 3. Truncate at first unmatched Japanese full-width opening bracket
  //    Only truncate when there's meaningful content before the bracket (> 2 chars)
  const jpBracketIdx = t.search(/[「（『【〈《〔｢]/)
  if (jpBracketIdx > 2) {
    t = t.slice(0, jpBracketIdx).trim()
  }

  // 4. Truncate at first unmatched ASCII paren: "foo(bar" with no closing ")"
  //    Regex: greedily capture everything before a "(" that has no matching ")"
  const unmatched = t.match(/^(.*?)\([^)]*$/)
  if (unmatched && unmatched[1].length > 2) {
    t = unmatched[1].trim()
  }

  // 5. Strip trailing noise punctuation that may be left after truncation
  t = t.replace(/[.,!?;:…。、！？\-~〜*#\s]+$/, '').trim()

  return t
}

/**
 * True if the stripped title could be a single artist name.
 * Rejects: commas, spaced slashes (act separators), ×, vs, double-spaces,
 * Japanese particles in the middle, and anything too short or too long.
 */
function looksLikeSingleAct(stripped: string): boolean {
  if (stripped.length < 3 || stripped.length > 35)   return false
  if (/[,，]/.test(stripped))                         return false
  if (/\s+[/／]\s+/.test(stripped))                  return false
  if (/\bvs\.?\b/i.test(stripped))                   return false
  if (/×/.test(stripped))                             return false
  if (/\s{2,}/.test(stripped))                       return false
  if (/[のはをがでにへと].+/.test(stripped))          return false
  return true
}

// ── Description extraction ─────────────────────────────────────────────────────

/**
 * Extracts raw tokens from the "With X, Y, Z." clause of a description.
 *
 * Observed patterns:
 *   "Doors 18:30 / Start 19:00. With A, B, C."
 *   "With w/ A / B / C, D"
 *   "Doors 19:30 / Start 20:00. With w/ SLUG / SOLMANIA, ..."
 *   "With HOKAGE presents, BAND NAME, GENRE LABEL."
 */
function extractDescriptionTokens(description: string): string[] {
  // Pull everything after the first "With " up to ". " or "..." or end
  const m = description.match(/\bWith\s+(.+?)(?:\.\s|\.\.\.|,\s*\.\.\.|$)/i)
  if (!m) return []

  let content = m[1].trim()
  // Strip leading "w/" secondary marker
  content = content.replace(/^w\/\s*/i, '')

  // Split on comma first
  const rawTokens: string[] = []
  for (const part of content.split(/\s*,\s*/)) {
    // Within each comma-segment, split on " / " (spaced slashes = act separator)
    // Plain "/" without spaces is kept (e.g. "AC/DC")
    const slashParts = part.split(/\s+\/\s+/)
    rawTokens.push(...slashParts)
  }

  // Clean each token
  const cleaned: string[] = []
  for (const raw of rawTokens) {
    let t = raw.trim()
    // Strip trailing punctuation
    t = t.replace(/[.,!?;:…。、！？\-]+$/, '').trim()
    // Strip leading punctuation
    t = t.replace(/^[.,!?;:…。、！？\-*]+/, '').trim()
    // Strip wrapping brackets/quotes
    t = t.replace(/^[「」『』【】()[\]""'']+|[「」『』【】()[\]""'']+$/g, '').trim()
    if (t.length >= 2) cleaned.push(t)
  }

  return cleaned
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🎸  Artist candidate extractor${DRY_RUN ? '  [DRY RUN]' : ''}\n`)

  // ── 1. Load events + lineup data from v2 event_sources ────────────────────
  // Primary source for description candidates: raw_payload.lineup (clean string[])
  // Fallback: parse events.description as "With X, Y, Z." for events without sources
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select(`
      id,
      title_raw,
      description,
      event_sources (
        raw_payload
      )
    `)
    .order('event_date')

  if (eventsError || !events) {
    console.error('❌  Failed to load events:', eventsError?.message)
    process.exit(1)
  }
  console.log(`📅  Loaded ${events.length} events`)

  // ── 2. Load venues for pre-flight venue check ──────────────────────────────
  const { data: venueRows, error: venueError } = await supabase
    .from('venues')
    .select('name_en, name_ja')

  if (venueError) {
    console.error('❌  Failed to load venues:', venueError?.message)
    process.exit(1)
  }
  const venueLookup = buildVenueLookup(venueRows ?? [])
  console.log(`🏛️   Loaded ${(venueRows ?? []).length} venues for name filtering`)

  // ── 3. Load existing artists ───────────────────────────────────────────────
  const { data: artists, error: artistsError } = await supabase
    .from('artists')
    .select('name_en')

  if (artistsError) {
    console.error('❌  Failed to load artists:', artistsError?.message)
    process.exit(1)
  }
  const existingArtists = new Set<string>(
    (artists ?? []).map((a: { name_en: string }) => a.name_en.toLowerCase()),
  )
  console.log(`🎤  ${existingArtists.size} seeded artists loaded for matching\n`)

  // ── 3. First pass: collect all raw candidates (before frequency counting) ──
  interface RawCandidate {
    raw_name: string
    source:   'title' | 'description' | 'title_fallback'
    event_id: string
  }
  const rawCandidates: RawCandidate[] = []

  for (const event of events) {
    // A. Title — v2 uses title_raw
    const title = (event.title_raw as string | null)?.trim() ?? ''
    if (title) {
      const stripped = stripTitleNoise(title)
      if (stripped.length >= 4) {
        rawCandidates.push({ raw_name: stripped, source: 'title', event_id: event.id })
      }
    }

    // B. Lineup candidates — prefer the clean lineup[] array from event_sources.raw_payload
    //    (v2 scraper stores pre-parsed performers there). Fall back to parsing
    //    the description string for events not yet migrated to v2 sources.
    const sources = (event.event_sources as Array<{ raw_payload: Record<string, unknown> | null }> | null) ?? []
    const lineupArrays = sources
      .map(s => s.raw_payload?.lineup)
      .filter(Array.isArray) as string[][]

    let descTokens: string[] = []

    if (lineupArrays.length > 0) {
      // Flatten all lineup arrays. Within each entry, split on " / " — but first
      // check if it's a bilingual "JP名 / EN Name" pair. If so, keep as one token
      // (the promoter will parse it into name_en + name_ja). Only split when BOTH
      // parts are the same script (= genuinely two separate acts).
      for (const lineup of lineupArrays) {
        for (const entry of lineup) {
          const raw = (entry as string).trim()
          const bilingual = parseBilingualEntry(raw)
          if (bilingual) {
            // Keep the full bilingual string as a single candidate token
            descTokens.push(raw)
          } else {
            const parts = raw.split(BILINGUAL_SEP).map((p: string) => p.trim()).filter(Boolean)
            descTokens.push(...parts)
          }
        }
      }
    } else {
      // Fallback: parse "With X, Y, Z." from description for pre-v2 events
      const desc = (event.description as string | null) ?? ''
      if (desc) descTokens = extractDescriptionTokens(desc)
    }

    for (const token of descTokens) {
      if (token.length >= 2) {
        rawCandidates.push({ raw_name: token, source: 'description', event_id: event.id })
      }
    }
  }

  // ── 3b. Title fallback for events with no description/lineup candidates ──────
  // When the scraper found no performers in lineup/description, and the stripped
  // title looks like a single act, emit it as a 'title_fallback' candidate.
  // This covers category (b) from the audit: one-act events whose title IS the artist.
  const eventsWithDescCandidates = new Set(
    rawCandidates.filter(c => c.source === 'description').map(c => c.event_id),
  )
  let titleFallbackCount = 0
  for (const event of events) {
    if (eventsWithDescCandidates.has(event.id)) continue
    const title = (event.title_raw as string | null)?.trim() ?? ''
    if (!title) continue
    const stripped = stripTitleNoise(title)
    if (!looksLikeSingleAct(stripped)) continue
    // Also skip if the stripped title still shows noise (tour, release, etc.)
    if (titleHasNoise(stripped)) continue
    rawCandidates.push({ raw_name: stripped, source: 'title_fallback', event_id: event.id })
    titleFallbackCount++
  }
  if (titleFallbackCount) console.log(`🎯  Title fallback: ${titleFallbackCount} single-act events with no lineup data`)

  // ── 4. Count distinct events per normalised name ───────────────────────────
  // normalise: lowercase + collapse whitespace
  const nameEventSets = new Map<string, Set<string>>()
  for (const c of rawCandidates) {
    const key = c.raw_name.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!nameEventSets.has(key)) nameEventSets.set(key, new Set())
    nameEventSets.get(key)!.add(c.event_id)
  }

  // ── 5. Score candidates and deduplicate ────────────────────────────────────
  const seen        = new Set<string>()  // (event_id, source, normKey)
  const finalRows: CandidateRow[] = []

  for (const rawC of rawCandidates) {
    const normKey  = rawC.raw_name.toLowerCase().replace(/\s+/g, ' ').trim()
    const dedupeKey = `${rawC.event_id}|${rawC.source}|${normKey}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    // ── Normalise the token first (strip bullets, truncate at unmatched brackets)
    const normalisedName = normaliseToken(rawC.raw_name)
    // Allow the normalised form through (update raw_name but keep other fields)
    // Typed as RawCandidate here — confidence/confidence_reason are added below when pushing to finalRows
    const c: RawCandidate = normalisedName !== rawC.raw_name
      ? { ...rawC, raw_name: normalisedName }
      : rawC

    const eventCount = nameEventSets.get(normKey)?.size ?? 1

    // Apply ordered discard filters (insert discards for auditability)
    if (c.raw_name.length > 40) {
      finalRows.push({ ...c, confidence: 'discard', confidence_reason: 'too long (>40 chars)' })
      continue
    }
    if (c.raw_name.length < 3) {
      finalRows.push({ ...c, confidence: 'discard', confidence_reason: 'too short (<3 chars)' })
      continue
    }
    // Discard tokens that start with a digit (section markers, pricing, event codes)
    if (/^\d/.test(c.raw_name)) {
      finalRows.push({ ...c, confidence: 'discard', confidence_reason: 'starts with digit' })
      continue
    }
    if (isPricingGarbage(c.raw_name)) {
      finalRows.push({ ...c, confidence: 'discard', confidence_reason: 'pricing/ticket garbage' })
      continue
    }
    if (isGenreLabel(c.raw_name)) {
      finalRows.push({ ...c, confidence: 'discard', confidence_reason: 'genre label' })
      continue
    }
    if (isBoilerplate(c.raw_name)) {
      finalRows.push({ ...c, confidence: 'discard', confidence_reason: 'boilerplate text' })
      continue
    }
    // Venue name check — catches venue names and venue-prefixed event series
    // (e.g. "Zeela", "BEARS", "ブロンズダービー" → BRONZE venue)
    if (isVenueName(c.raw_name, venueLookup)) {
      finalRows.push({ ...c, confidence: 'discard', confidence_reason: 'matches known venue name' })
      continue
    }
    // Tour/event descriptor check — applies to BOTH title and description sources
    if (isEventTourDescriptor(c.raw_name)) {
      finalRows.push({ ...c, confidence: 'discard', confidence_reason: 'tour/event descriptor' })
      continue
    }
    if (c.source === 'title_fallback') {
      // Title used as lineup fallback — already validated as single-act, skip noise check.
      // Floor confidence at 'medium' (we know there's no competing lineup data).
      const scored = scoreToken(c.raw_name, eventCount, existingArtists)
      const confidence: Confidence = scored.confidence === 'high' ? 'high'
        : scored.confidence === 'discard' ? 'low'
        : 'medium'
      finalRows.push({ ...c, confidence, confidence_reason: `title fallback (no lineup); ${scored.reason}` })
      continue
    }

    if (c.source === 'title' && titleHasNoise(c.raw_name)) {
      // Title still has noise in the ORIGINAL (not stripped) form — low confidence
      const scored = scoreToken(c.raw_name, eventCount, existingArtists)
      finalRows.push({
        ...c,
        confidence:        scored.confidence === 'discard' ? 'discard' : 'low',
        confidence_reason: `title noise present; ${scored.reason}`,
      })
      continue
    }

    const scored = scoreToken(c.raw_name, eventCount, existingArtists)
    finalRows.push({ ...c, confidence: scored.confidence, confidence_reason: scored.reason })
  }

  // ── 6. Stats & preview ────────────────────────────────────────────────────
  const stats: Record<Confidence, number> = { high: 0, medium: 0, low: 0, discard: 0 }
  for (const r of finalRows) stats[r.confidence]++

  console.log('📊  Extraction results:')
  console.log(`    Total rows  : ${finalRows.length}`)
  console.log(`    high        : ${stats.high}`)
  console.log(`    medium      : ${stats.medium}`)
  console.log(`    low         : ${stats.low}`)
  console.log(`    discard     : ${stats.discard}`)

  if (DRY_RUN) {
    console.log('\n🔍  Top candidates by confidence (deduplicated by name):\n')

    // Deduplicate for display: one row per (normalised_name, source), keep highest confidence
    const confOrder: Record<Confidence, number> = { high: 0, medium: 1, low: 2, discard: 3 }
    const displayMap = new Map<string, CandidateRow & { eventCount: number }>()
    for (const r of finalRows) {
      if (r.confidence === 'discard') continue
      const key  = `${r.raw_name.toLowerCase().replace(/\s+/g, ' ')}|${r.source}`
      const norm = r.raw_name.toLowerCase().replace(/\s+/g, ' ')
      const cnt  = nameEventSets.get(norm)?.size ?? 1
      const cur  = displayMap.get(key)
      if (!cur || confOrder[r.confidence] < confOrder[cur.confidence]) {
        displayMap.set(key, { ...r, eventCount: cnt })
      }
    }

    const preview = Array.from(displayMap.values())
      .sort((a, b) => {
        if (confOrder[a.confidence] !== confOrder[b.confidence]) {
          return confOrder[a.confidence] - confOrder[b.confidence]
        }
        return b.eventCount - a.eventCount
      })
      .slice(0, 60)

    for (const r of preview) {
      const pad = r.confidence.padEnd(8)
      const src = r.source.padEnd(12)
      console.log(`  [${pad}] [${src}] (${String(r.eventCount).padStart(2)} events) "${r.raw_name}"  — ${r.confidence_reason}`)
    }

    console.log('\n✅  Dry run complete. Run without --dry-run to write to DB.\n')
    return
  }

  // ── 7. Aggregate to one row per distinct name_norm ────────────────────────
  //
  // The staging table is pre-aggregated: UNIQUE (name_norm), no event FK,
  // one row per artist candidate with event_count. Collapse the per-event
  // finalRows here into per-name records. Non-discard rows only.
  const CONF_ORDER: Record<Confidence, number> = { high: 0, medium: 1, low: 2, discard: 3 }
  const bestConfBetween = (a: Confidence, b: Confidence): Confidence =>
    CONF_ORDER[a] < CONF_ORDER[b] ? a : b

  interface AggRow {
    name_norm:    string
    name_display: string
    event_count:  number
    confidence:   'high' | 'medium' | 'low'
  }
  const byName = new Map<string, AggRow>()

  for (const r of finalRows) {
    if (r.confidence === 'discard') continue
    const key = r.raw_name.toLowerCase().replace(/\s+/g, ' ').trim()
    const eventCount = nameEventSets.get(key)?.size ?? 1
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, {
        name_norm:    key,
        name_display: r.raw_name,
        event_count:  eventCount,
        confidence:   r.confidence,
      })
    } else {
      // Keep best confidence; bump event_count if the per-name counter grew
      existing.confidence  = bestConfBetween(existing.confidence, r.confidence) as 'high' | 'medium' | 'low'
      existing.event_count = Math.max(existing.event_count, eventCount)
      // Prefer the non-all-lowercase display form if current one is all lowercase
      if (existing.name_display === existing.name_display.toLowerCase() && r.raw_name !== r.raw_name.toLowerCase()) {
        existing.name_display = r.raw_name
      }
    }
  }

  const aggRows = Array.from(byName.values())
  console.log(`\n🧮  Aggregated: ${aggRows.length} distinct candidates (from ${finalRows.length} raw rows)`)

  // ── 8. Write to DB ─────────────────────────────────────────────────────────
  console.log('\n💾  Clearing unreviewed candidates...')

  // Safe re-run: only remove rows that haven't been reviewed or merged yet.
  // Approved/rejected/merged rows are preserved so human curation survives.
  const { error: deleteError } = await supabase
    .from('artist_candidates')
    .delete()
    .eq('status', 'pending')
    .is('merged_into_artist_id', null)

  if (deleteError) {
    console.error('❌  Failed to clear existing candidates:', deleteError.message)
    process.exit(1)
  }

  console.log('💾  Upserting candidates...')
  const CHUNK_SIZE = 500
  let   inserted  = 0

  for (let i = 0; i < aggRows.length; i += CHUNK_SIZE) {
    const chunk = aggRows.slice(i, i + CHUNK_SIZE)

    const { error: upsertError } = await supabase
      .from('artist_candidates')
      .upsert(
        chunk.map(r => ({
          name_norm:    r.name_norm,
          name_display: r.name_display,
          event_count:  r.event_count,
          confidence:   r.confidence,
          last_seen_at: new Date().toISOString(),
        })),
        { onConflict: 'name_norm', ignoreDuplicates: false },
      )

    if (upsertError) {
      console.error(`❌  Upsert failed at chunk ${i / CHUNK_SIZE + 1}:`, upsertError.message)
      process.exit(1)
    }

    inserted += chunk.length
    process.stdout.write(`\r    ${inserted} / ${aggRows.length} rows...`)
  }

  console.log(`\n\n✅  Done — ${aggRows.length} aggregated rows written to artist_candidates.\n`)

  // ── 8. Post-run summary ────────────────────────────────────────────────────
  console.log('📋  Top high-confidence candidates:\n')

  // Aggregate by normalised name → keep most-common casing
  const highMap = new Map<string, { displayName: string; count: number }>()
  for (const r of finalRows) {
    if (r.confidence !== 'high') continue
    const key = r.raw_name.toLowerCase()
    const cnt = nameEventSets.get(key.replace(/\s+/g, ' '))?.size ?? 1
    const cur = highMap.get(key)
    if (!cur || cnt > cur.count) highMap.set(key, { displayName: r.raw_name, count: cnt })
  }

  Array.from(highMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 30)
    .forEach(({ displayName, count }) =>
      console.log(`    ${String(count).padStart(3)}×  ${displayName}`),
    )

  console.log('\n🔍  Review the staging table:\n')
  console.log('    SELECT name_display, confidence, event_count, status, llm_verdict')
  console.log('    FROM artist_candidates')
  console.log('    ORDER BY event_count DESC')
  console.log('    LIMIT 50;\n')
  console.log('    -- Ready to promote (high conf or LLM-confirmed):')
  console.log('    SELECT name_display, confidence, llm_verdict, event_count')
  console.log('    FROM artist_candidates')
  console.log("    WHERE merged_into_artist_id IS NULL")
  console.log("      AND (status = 'approved' OR confidence = 'high')")
  console.log('    ORDER BY event_count DESC;\n')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
