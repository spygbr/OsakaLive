/**
 * Core types for the v2 event pipeline.
 *
 * One Source contract for both venue scrapers and aggregators. The pipeline
 * runner doesn't care which kind it is — only the result shape matters.
 */

/** A single event as emitted by a Source's parse step. */
export type RawEvent = {
  /** ISO YYYY-MM-DD in JST */
  eventDate: string
  /** Untouched title string from the page (may be JP / EN / mixed). */
  titleRaw: string
  /** Optional extracted fields (best-effort). */
  startTime?: string | null
  doorsTime?: string | null
  ticketPriceAdv?: number | null
  ticketPriceDoor?: number | null
  ticketUrl?: string | null
  description?: string | null
  /** Other performer / act names parsed from the listing. */
  lineup?: string[]
  /**
   * Venue identification.
   *
   * Venue sources know their venue up-front and set `venueId`.
   * Aggregator sources don't — they emit `venueHint` and let the runner
   * resolve it via venue-resolver.ts. Exactly one of the two must be set.
   */
  venueId?: string
  venueHint?: string
  /**
   * The detail-page URL this event came from.
   * Null when the source only has an index/schedule page (no per-event URLs).
   * UI: hide the "Source" button when null.
   */
  sourceUrl: string | null
  /** Anything else the source wants to keep around (stored on event_sources.raw_payload). */
  payload?: Record<string, unknown>
}

/** A line the validator killed. Goes to events_rejected. */
export type RejectedEvent = {
  rawLine: string
  reason: string
  sourceUrl?: string
  payload?: Record<string, unknown>
}

/** What every Source.parse() call returns. */
export type ParseResult = {
  events: RawEvent[]
  rejected: RejectedEvent[]
}

/** Per-run outcome reported back to scrape_logs. */
export type SourceRunResult = {
  sourceId: string
  status: 'success' | 'partial' | 'failed' | 'skipped'
  fetched: number
  parsed: number
  rejected: number
  unresolved: number
  upserted: number
  durationMs: number
  errorMessage?: string
}

/** Describes a Source row loaded from DB. */
export type SourceRow = {
  id: string
  kind: 'venue' | 'aggregator'
  displayName: string
  venueId: string | null
  baseUrl: string
  enabled: boolean
  lastEtag: string | null
  lastModified: string | null
  lastContentHash: string | null
}

/** Metadata returned by a fetch — drives ETag/hash skip logic. */
export type FetchedPage = {
  url: string
  body: string
  etag: string | null
  lastModified: string | null
  contentHash: string
  /** True when the server returned 304 Not Modified. body will be ''. */
  notModified: boolean
}
