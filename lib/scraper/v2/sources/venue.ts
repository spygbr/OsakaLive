/**
 * Generic VenueSource — one instance per row in the `venues` table that has
 * scrape_enabled = true. The DB row supplies id / slug / scrape_url.
 *
 * Uses the shared parseVenueSchedule() helper so we don't have a per-venue
 * subclass per live house. If a venue eventually needs custom parsing (e.g.
 * JSON API), subclass VenueScheduleSource and override parse().
 */

import { VenueSource } from '../source'
import type { ParseResult } from '../types'
import { parseVenueSchedule } from '../parse-venue'

export class VenueScheduleSource extends VenueSource {
  readonly id: string
  readonly displayName: string
  readonly baseUrl: string
  readonly venueId: string

  constructor(args: { id: string; displayName: string; baseUrl: string; venueId: string }) {
    super()
    this.id = args.id
    this.displayName = args.displayName
    this.baseUrl = args.baseUrl
    this.venueId = args.venueId
  }

  protected override parse(html: string, url: string): ParseResult {
    return parseVenueSchedule(html, url)
  }
}
