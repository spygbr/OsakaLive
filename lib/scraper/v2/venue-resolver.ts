/**
 * Venue resolver — turns a free-form venue hint into a venues.id.
 *
 * Lookup order:
 *   1. Exact match on normalised slug / name_en / name_ja
 *   2. Static alias map (STATIC_ALIASES) for mixed-script / abbreviated hints
 *   3. Substring match (hint contains a known name OR a known name contains hint)
 *
 * To add an alias: normalise both sides with normaliseVenueName() and add an
 * entry to STATIC_ALIASES below.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface VenueRow {
  id: string
  slug: string
  name_en: string | null
  name_ja: string | null
}

/** Strip whitespace + common separators so "Zepp Namba" matches "zeppnamba". */
export function normaliseVenueName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[・\s\-_\/]/g, '')
    .replace(/[（）()【】［］\[\]]/g, '')
    .trim()
}

export type VenueIndex = {
  byKey: Map<string, VenueRow>
  /** Sorted longest-first so substring matching prefers more specific names. */
  keys: string[]
}

export function buildVenueIndex(venues: VenueRow[]): VenueIndex {
  const byKey = new Map<string, VenueRow>()
  for (const v of venues) {
    byKey.set(normaliseVenueName(v.slug), v)
    if (v.name_en) byKey.set(normaliseVenueName(v.name_en), v)
    if (v.name_ja) byKey.set(normaliseVenueName(v.name_ja), v)
  }
  const keys = Array.from(byKey.keys()).filter((k) => k.length >= 3).sort((a, b) => b.length - a.length)
  return { byKey, keys }
}

/**
 * Static alias map: normalised(hint) → normalised(slug).
 *
 * Use when a hint uses a mixed-script or abbreviated form that the substring
 * matcher can't bridge. Both sides must be the output of normaliseVenueName().
 */
const STATIC_ALIASES: Record<string, string> = {
  // "梅田 CLUB QUATTRO" (Latin + kanji) doesn't substring-match "梅田クラブクアトロ"
  // (katakana). Explicit alias → club-quattro-umeda slug.
  '梅田clubquattro': 'clubquattroumeda',
}

export function resolveVenue(hint: string, idx: VenueIndex): VenueRow | null {
  if (!hint) return null
  const n = normaliseVenueName(hint)
  if (!n) return null
  if (idx.byKey.has(n)) return idx.byKey.get(n)!
  const aliasKey = STATIC_ALIASES[n]
  if (aliasKey !== undefined && idx.byKey.has(aliasKey)) return idx.byKey.get(aliasKey)!
  for (const k of idx.keys) {
    if (n.includes(k) || k.includes(n)) return idx.byKey.get(k)!
  }
  return null
}

/** Load all venues once per cycle. */
export async function loadVenueIndex(supabase: SupabaseClient): Promise<VenueIndex> {
  const { data, error } = await supabase
    .from('venues')
    .select('id, slug, name_en, name_ja')
  if (error) throw new Error(`venue load: ${error.message}`)
  return buildVenueIndex((data ?? []) as VenueRow[])
}
