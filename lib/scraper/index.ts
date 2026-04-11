/**
 * Venue event scraper engine.
 *
 * For each enabled venue:
 *   1. Fetch the schedule page (with a 10 s timeout + UA header)
 *   2. Parse raw events from HTML using the lightweight parser
 *   3. Upsert into the events table (keyed on venue_id + event_date + title slug)
 *   4. Record the run in scrape_logs
 */

import { createClient } from '@supabase/supabase-js'
import { parseEventsFromHtml } from './parse'
import type { RawEvent, ScrapeResult } from './types'

// ── Supabase admin client (uses SERVICE_ROLE key — server-side only) ─────────

function getAdminClient() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars for scraper')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── Slug helper ───────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
}

// ── HTTP fetch with timeout ───────────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs = 15_000): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; OsakaLiveBot/1.0; +https://osaka-live.vercel.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.5',
      },
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  } finally {
    clearTimeout(timer)
  }
}

// ── Description builder ──────────────────────────────────────────────────────

/** Build a human-readable description from scraped event data. */
function buildDescription(r: RawEvent): string | null {
  const parts: string[] = []

  // Times
  const timeParts: string[] = []
  if (r.doorsTime) timeParts.push(`Doors ${r.doorsTime}`)
  if (r.startTime) timeParts.push(`Start ${r.startTime}`)
  if (timeParts.length > 0) parts.push(timeParts.join(' / '))

  // Lineup (other acts besides the headliner title)
  if (r.lineup.length > 0) {
    const names = r.lineup.slice(0, 6) // cap at 6 acts
    const suffix = r.lineup.length > 6 ? ' and more' : ''
    parts.push(`With ${names.join(', ')}${suffix}`)
  }

  return parts.length > 0 ? parts.join('. ') + '.' : null
}

// ── Upsert scraped events ─────────────────────────────────────────────────────

async function upsertEvents(
  supabase: ReturnType<typeof getAdminClient>,
  venueId: string,
  raws: RawEvent[],
): Promise<number> {
  if (raws.length === 0) return 0

  const rows = raws.map((r) => ({
    venue_id:          venueId,
    slug:              `${r.venueSlug}-${r.eventDate}-${slugify(r.title).slice(0, 40)}`,
    title_en:          r.title,
    title_ja:          null,          // translator can fill later
    event_date:        r.eventDate,
    doors_time:        r.doorsTime,
    start_time:        r.startTime,
    ticket_price_adv:  r.ticketPriceAdv,
    ticket_price_door: r.ticketPriceDoor,
    ticket_url:        r.ticketUrl,
    availability:      'on_sale',
    is_featured:       false,
    description_en:    buildDescription(r),
    description_ja:    null,
  }))

  // Deduplicate rows by slug before upserting to avoid constraint violations
  // within the same batch (e.g. two events sharing a date + short title)
  const uniqueRows = Array.from(new Map(rows.map((r) => [r.slug, r])).values())

  const { error, data } = await supabase
    .from('events')
    .upsert(uniqueRows, {
      onConflict: 'slug',
      ignoreDuplicates: false,
    })
    .select('id')

  if (error) {
    console.error('[scraper:upsert]', error.message ?? JSON.stringify(error))
    throw new Error(error.message ?? JSON.stringify(error))
  }
  return data?.length ?? 0
}

// ── Per-venue scrape ──────────────────────────────────────────────────────────

async function scrapeVenue(
  supabase: ReturnType<typeof getAdminClient>,
  venue: { id: string; slug: string; scrape_url: string },
): Promise<ScrapeResult> {
  const start = Date.now()
  let eventsFound = 0
  let eventsUpserted = 0

  try {
    console.log(`[scraper] → ${venue.slug}: ${venue.scrape_url}`)
    const html = await fetchWithTimeout(venue.scrape_url)
    const raws = parseEventsFromHtml(html, venue.slug, venue.scrape_url)
    eventsFound = raws.length
    console.log(`[scraper]   found ${eventsFound} events`)

    if (eventsFound > 0) {
      eventsUpserted = await upsertEvents(supabase, venue.id, raws)
    }

    // Stamp last-scraped timestamp
    await supabase
      .from('venues')
      .update({ scrape_last_at: new Date().toISOString() })
      .eq('id', venue.id)

    const durationMs = Date.now() - start
    await logRun(supabase, venue.id, venue.slug, 'success', eventsFound, eventsUpserted, undefined, durationMs)
    return { venueSlug: venue.slug, status: 'success', eventsFound, eventsUpserted, durationMs }
  } catch (err) {
    const msg = err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err))
    console.error(`[scraper] ✗ ${venue.slug}:`, msg)
    const durationMs = Date.now() - start
    await logRun(supabase, venue.id, venue.slug, 'failed', eventsFound, eventsUpserted, msg, durationMs)
    return { venueSlug: venue.slug, status: 'failed', eventsFound: 0, eventsUpserted: 0, errorMessage: msg, durationMs }
  }
}

// ── Log writer ────────────────────────────────────────────────────────────────

async function logRun(
  supabase: ReturnType<typeof getAdminClient>,
  venueId: string,
  venueSlug: string,
  status: 'success' | 'partial' | 'failed' | 'skipped',
  eventsFound: number,
  eventsUpserted: number,
  errorMessage: string | undefined,
  durationMs: number,
) {
  await supabase.from('scrape_logs').insert({
    venue_id: venueId,
    venue_slug: venueSlug,
    status,
    events_found: eventsFound,
    events_upserted: eventsUpserted,
    error_message: errorMessage ?? null,
    duration_ms: durationMs,
  })
}

// ── Public entry point ────────────────────────────────────────────────────────

/** Run the full scrape cycle across all enabled venues. */
export async function runScrapeCycle(): Promise<ScrapeResult[]> {
  const supabase = getAdminClient()

  const { data: venues, error } = await supabase
    .from('venues')
    .select('id, slug, scrape_url')
    .eq('scrape_enabled', true)
    .not('scrape_url', 'is', null)

  if (error) throw new Error(`Failed to load venues: ${error.message}`)
  if (!venues || venues.length === 0) return []

  console.log(`[scraper] Starting cycle — ${venues.length} venues enabled`)

  // Run in parallel with a concurrency cap of 4
  const CONCURRENCY = 4
  const results: ScrapeResult[] = []

  for (let i = 0; i < venues.length; i += CONCURRENCY) {
    const batch = venues.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map((v) => scrapeVenue(supabase, v as { id: string; slug: string; scrape_url: string }))
    )
    results.push(...batchResults)
  }

  const succeeded = results.filter((r) => r.status === 'success').length
  const totalFound = results.reduce((s, r) => s + r.eventsFound, 0)
  const totalUpserted = results.reduce((s, r) => s + r.eventsUpserted, 0)
  console.log(`[scraper] Done — ${succeeded}/${venues.length} venues OK, ${totalFound} found, ${totalUpserted} upserted`)

  return results
}
