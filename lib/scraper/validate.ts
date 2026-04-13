import type { RawEvent } from './types'

export type SuspectEvent = {
  title: string
  eventDate: string
  sourceUrl: string
  sourceContext: string | null
  reason: string
}

export type VenueValidationMetrics = {
  venueSlug: string
  totalEvents: number
  pctWithAdvPrice: number
  pctWithDoorsOrStart: number
  suspectRows: number
  suspectEvents: SuspectEvent[]
}

const PRICE_LIKE_RE =
  /(?:[¥￥]\s*\d|\d[\d,]*\s*円|\badv\b|\bdoor\b|前売|当日|ticket|1d\b|2d\b)/i

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Number(((numerator / denominator) * 100).toFixed(1))
}

export function validateVenueEvents(
  venueSlug: string,
  events: RawEvent[],
  topN = 5,
): VenueValidationMetrics {
  const withAdvPrice = events.filter((e) => e.ticketPriceAdv !== null).length
  const withDoorsOrStart = events.filter((e) => e.doorsTime !== null || e.startTime !== null).length

  const suspectEvents = events
    .filter((e) => e.ticketPriceAdv === null && PRICE_LIKE_RE.test(e.sourceContext ?? ''))
    .map((e) => ({
      title: e.title,
      eventDate: e.eventDate,
      sourceUrl: e.sourceUrl,
      sourceContext: e.sourceContext ?? null,
      reason: 'ADV price is null but source context appears to contain price-like text.',
    }))

  return {
    venueSlug,
    totalEvents: events.length,
    pctWithAdvPrice: pct(withAdvPrice, events.length),
    pctWithDoorsOrStart: pct(withDoorsOrStart, events.length),
    suspectRows: suspectEvents.length,
    suspectEvents: suspectEvents.slice(0, topN),
  }
}
