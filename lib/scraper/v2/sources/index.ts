/**
 * Source registry.
 *
 * loadSources() reads the `sources` table and builds Source instances via
 * SOURCE_REGISTRY. Lookup order:
 *   1. Registry hit (handles both aggregators and custom-parser venues)
 *   2. kind='venue' with no registry entry → VenueScheduleSource default
 *   3. Otherwise → warn and skip
 *
 * Adding a new aggregator: write the class, add an entry here. That's it.
 * Adding a new venue with default parsing: insert a row in `sources` and
 *   `venues` — no code needed.
 * Adding a venue with custom parsing: write the class, add an entry here.
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
import { NambaBearesSource } from './namba-bears'

type SourceRowDb = {
  id: string
  kind: 'venue' | 'aggregator'
  display_name: string
  venue_id: string | null
  base_url: string
  enabled: boolean
}

/**
 * Unified registry keyed by DB source id. Each factory receives the full DB
 * row so both aggregators (no row data needed) and custom-parser venues (need
 * baseUrl + venueId) can be handled in the same map.
 */
const SOURCE_REGISTRY: Record<string, (row: SourceRowDb) => Source> = {
  // Aggregators
  punx:             (_row) => new PunxSource(),
  icegrills:        (_row) => new IceGrillsSource(),
  udiscover:        (_row) => new UDiscoverSource(),
  unionway:         (_row) => new UnionwaySource(),
  // Custom-parser venue overrides
  'venue:club-joule':   (row) => new ClubJouleSource({ baseUrl: row.base_url, venueId: row.venue_id! }),
  'venue:drop':         (row) => new DropSource({ baseUrl: row.base_url, venueId: row.venue_id! }),
  'venue:namba-bears':  (row) => new NambaBearesSource({ baseUrl: row.base_url, venueId: row.venue_id! }),
}

export async function loadSources(supabase: SupabaseClient): Promise<Source[]> {
  const { data, error } = await supabase
    .from('sources')
    .select('id, kind, display_name, venue_id, base_url, enabled')
    .eq('enabled', true)
  if (error) throw new Error(`load sources: ${error.message}`)

  const out: Source[] = []
  for (const row of (data ?? []) as SourceRowDb[]) {
    const factory = SOURCE_REGISTRY[row.id]
    if (factory) {
      out.push(factory(row))
    } else if (row.kind === 'venue') {
      if (!row.venue_id) {
        console.warn(`[v2] venue source ${row.id} missing venue_id — skipping`)
        continue
      }
      out.push(new VenueScheduleSource({
        id: row.id,
        displayName: row.display_name,
        baseUrl: row.base_url,
        venueId: row.venue_id,
      }))
    } else {
      console.warn(`[v2] unknown source id "${row.id}" (kind=${row.kind}) — skipping`)
    }
  }
  return out
}

export { PunxSource, IceGrillsSource, UDiscoverSource, UnionwaySource, VenueScheduleSource }
