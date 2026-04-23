/**
 * Shared types for aggregator / promoter sources.
 *
 * Aggregators differ from venue scrapers in that a single source page lists
 * events across many venues nationwide. Each parsed event carries a raw
 * venue name (string) rather than a known venue_id — venue resolution happens
 * at the upsert stage against the `venues` table (fuzzy name match) after
 * Osaka filtering has already trimmed the set.
 */

export type AggregatorEvent = {
  /** Source identifier, e.g. 'udiscover', 'punx' */
  sourceSlug: string
  /** Raw title (artist or tour name) */
  title: string
  /** ISO YYYY-MM-DD in JST */
  eventDate: string
  /** Raw venue string as it appears on the page — may be JA or EN or mixed */
  venueHint: string
  /** Original detail-page URL where the event was scraped */
  sourceUrl: string
  /** Optional fields (best-effort) */
  startTime?: string | null
  ticketUrl?: string | null
  /** Extra artists / supporting acts if the source lists them */
  lineup?: string[]
  /** Freeform notes (genre labels, tour names) for the description_en field */
  notes?: string
}

export type AggregatorResult = {
  sourceSlug: string
  status: 'success' | 'partial' | 'failed'
  eventsFound: number     // raw events parsed
  eventsOsaka: number     // after Osaka filter
  eventsUpserted: number  // after venue resolution + DB upsert
  errorMessage?: string
  durationMs: number
}
