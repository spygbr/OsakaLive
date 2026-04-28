/**
 * Osaka venue filter — used by aggregator/promoter scrapers that return events
 * across all of Japan. Returns true if the given text mentions an Osaka venue.
 *
 * The venue list is intentionally broad: major halls, Zepp family, club
 * circuit, and live houses that regularly host touring acts. Matching is
 * case-insensitive and works on both English and Japanese variants.
 *
 * Add new venues here as we encounter them in scrapes.
 */

export const OSAKA_VENUE_PATTERNS: RegExp[] = [
  // Major halls
  /フェスティバルホール/,
  /festival\s*hall/i,
  /大阪城ホール/,
  /osaka[-\s]*jo\s*hall/i,
  /グランキューブ大阪/,
  /大阪国際会議場/,
  /大阪市中央体育館/,
  /大阪府立体育会館/,
  /エディオンアリーナ/i,
  /edion\s*arena/i,

  // Zepp family
  /zepp\s*osaka(?:\s*bayside)?/i,
  /zepp\s*namba/i,
  /zepp\s*難波/,

  // Club circuit
  /(?:umeda|梅田)\s*(?:club\s*)?quattro/i,
  /梅田クアトロ/,
  /namba\s*hatch/i,
  /なんばhatch/i,
  /big\s*cat/i,
  /ビッグキャット/,
  /shangri[-\s]*la/i,
  /シャングリラ/,
  /(?:holiday|ホリデイ).*(?:shinsaibashi|心斎橋)/i,

  // Live houses — punk / hardcore / indie
  /(?:shinsaibashi|心斎橋).*(?:club\s*drop|janus|fanj)/i,
  /namba\s*bears/i,
  /なんばベアーズ/,
  /hokage/i,
  /ホカゲ/,
  /conpass/i,
  /コンパス/,
  /pangea/i,
  /パンゲア/,
  /socore\s*factory/i,
  /ソコラファクトリー/,
  /king\s*cobra/i,
  /キングコブラ/,

  // Generic "Osaka" fallback — last resort, only triggers when nothing else matches
  // Kept intentionally after specific venues so we prefer the precise match.
  /大阪[^府県]/,    // Osaka city (exclude "大阪府" / "大阪県" which can appear in addresses)
  /\bosaka\b/i,
]

/** Common noise-venue patterns that would false-match generic "osaka" — subtract these first. */
const NON_OSAKA_NOISE = [
  /新大阪/,    // Shin-Osaka is a station, often in addresses of non-Osaka listings
  /大阪出身/,  // "from Osaka" — biographical, not a venue
]

export function mentionsOsakaVenue(text: string): boolean {
  if (!text) return false

  // Strip noise first so they don't false-trigger the generic "osaka" pattern
  let hay = text
  for (const re of NON_OSAKA_NOISE) hay = hay.replace(re, '')

  for (const re of OSAKA_VENUE_PATTERNS) {
    if (re.test(hay)) return true
  }
  return false
}

/**
 * Attempt to extract a venue name from free-form text. Returns the matched
 * substring (e.g. "Zepp Osaka Bayside", "フェスティバルホール") or null.
 * Useful for populating `events.venue_hint` before venue_id resolution.
 */
export function extractOsakaVenueName(text: string): string | null {
  if (!text) return null
  let hay = text
  for (const re of NON_OSAKA_NOISE) hay = hay.replace(re, '')
  for (const re of OSAKA_VENUE_PATTERNS) {
    const m = re.exec(hay)
    if (m) return m[0].trim()
  }
  return null
}
