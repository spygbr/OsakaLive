export type RawEvent = {
  /** The venue slug this event was scraped from */
  venueSlug: string
  /** Raw event title (may be JP or EN or mixed) */
  title: string
  /** ISO date string YYYY-MM-DD */
  eventDate: string
  /** HH:MM or null */
  doorsTime: string | null
  startTime: string | null
  /** Yen amount or null */
  ticketPriceAdv: number | null
  ticketPriceDoor: number | null
  /** URL to buy tickets */
  ticketUrl: string | null
  /** Additional performer / act names scraped from lines after the title */
  lineup: string[]
  /** Source URL this event was parsed from */
  sourceUrl: string
  /** Nearby parsed text window used for validation/debugging */
  sourceContext: string | null
}

export type ScrapeResult = {
  venueSlug: string
  status: 'success' | 'partial' | 'failed' | 'skipped'
  eventsFound: number
  eventsUpserted: number
  errorMessage?: string
  durationMs: number
}
