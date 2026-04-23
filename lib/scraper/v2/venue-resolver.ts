/**
 * Venue resolver — turns a free-form venue hint into a venues.id.
 *
 * Lookup order:
 *   1. Exact match on normalised slug / name_en / name_ja
 *   2. Substring match (hint contains a known name OR a known name contains hint)
 *
 * Aliases are not yet first-class (no DB table); add later if substring
 * matching produces too many false hits.
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

export function resolveVenue(hint: string, idx: VenueIndex): VenueRow | null {
  if (!hint) return null
  const n = normaliseVenueName(hint)
  if (!n) return null
  if (idx.byKey.has(n)) return idx.byKey.get(n)!
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
