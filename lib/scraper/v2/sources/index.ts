/**
 * Source registry.
 *
 * loadSources() reads the `sources` table and builds Source instances:
 *   - kind='aggregator' → look up by id in AGGREGATOR_REGISTRY
 *   - kind='venue'      → instantiate VenueScheduleSource from the DB row
 *
 * Adding a new aggregator: write the class, register it here. That's it.
 * Adding a new venue: just insert a row in `sources` and `venues` — no code.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Source } from '../source'
import { PunxSource } from './punx'
import { IceGrillsSource } from './icegrills'
import { UDiscoverSource } from './udiscover'
import { UnionwaySource } from './unionway'
import { VenueScheduleSource } from './venue'
import { ClubJouleSource } from './club-joule'
import { DropSource } from './drop'

/** id → constructor for hand-coded aggregator sources. */
const AGGREGATOR_REGISTRY: Record<string, () => Source> = {
  punx:      () => new PunxSource(),
  icegrills: () => new IceGrillsSource(),
  udiscover: () => new UDiscoverSource(),
  unionway:  () => new UnionwaySource(),
}

/**
 * id → constructor for venue sources that need custom parsing instead of the
 * generic VenueScheduleSource. The DB row still drives baseUrl + venueId; the
 * override just swaps the parser. Add a venue here when its HTML structure
 * defeats parseVenueSchedule().
 */
const VENUE_OVERRIDES: Record<
  string,
  (args: { baseUrl: string; venueId: string }) => Source
> = {
  'venue:club-joule': (a) => new ClubJouleSource(a),
  'venue:drop':       (a) => new DropSource(a),
}

type SourceRowDb = {
  id: string
  kind: 'venue' | 'aggregator'
  display_name: string
  venue_id: string | null
  base_url: string
  enabled: boolean
}

export async function loadSources(supabase: SupabaseClient): Promise<Source[]> {
  const { data, error } = await supabase
    .from('sources')
    .select('id, kind, display_name, venue_id, base_url, enabled')
    .eq('enabled', true)
  if (error) throw new Error(`load sources: ${error.message}`)

  const out: Source[] = []
  for (const row of (data ?? []) as SourceRowDb[]) {
    if (row.kind === 'aggregator') {
      const ctor = AGGREGATOR_REGISTRY[row.id]
      if (!ctor) {
        console.warn(`[v2] unknown aggregator id "${row.id}" — skipping`)
        continue
      }
      out.push(ctor())
    } else if (row.kind === 'venue') {
      if (!row.venue_id) {
        console.warn(`[v2] venue source ${row.id} missing venue_id — skipping`)
        continue
      }
      const override = VENUE_OVERRIDES[row.id]
      if (override) {
        out.push(override({ baseUrl: row.base_url, venueId: row.venue_id }))
      } else {
        out.push(new VenueScheduleSource({
          id: row.id,
          displayName: row.display_name,
          baseUrl: row.base_url,
          venueId: row.venue_id,
        }))
      }
    }
  }
  return out
}

export { PunxSource, IceGrillsSource, UDiscoverSource, UnionwaySource, VenueScheduleSource }
