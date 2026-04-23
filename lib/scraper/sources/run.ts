/**
 * Aggregator/promoter scrape runner.
 *
 * Orchestrates the four new sources (udiscover, punx, icegrills, unionway),
 * resolves venue_id per event via fuzzy name match against the `venues` table,
 * and upserts into `events` using the same slug strategy as the per-venue
 * scraper for dedup.
 *
 * Called from app/api/cron/scrape-events/route.ts after the existing venue
 * loop completes — aggregator results are appended to the cron run log.
 *
 *   import { runAggregatorCycle } from '@/lib/scraper/sources/run'
 *   const aggResults = await runAggregatorCycle()
 */

import { createClient } from '@supabase/supabase-js'
import type { AggregatorEvent, AggregatorResult } from './types'
import { udiscoverSource }  from './udiscover'
import { punxSource }       from './punx'
import { iceGrillsSource }  from './icegrills'
import { unionwaySource }   from './unionway'

// ── Supabase admin client ──────────────────────────────────────────────────────
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars for aggregator scraper')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── HTTP ───────────────────────────────────────────────────────────────────────
async function fetchHtml(url: string, timeoutMs = 15_000): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal:  ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OsakaLiveBot/1.0; +https://osaka-live.vercel.app)',
        'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.5',
      },
      redirect: 'follow',
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80)
}

// ── Venue resolution ───────────────────────────────────────────────────────────
// Load all venues once per cycle, build a lowercased alias map.
interface VenueRow { id: string; slug: string; name_en: string | null; name_ja: string | null }

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[・\s\-_\/]/g, '')
    .replace(/[（）()【】［］\[\]]/g, '')
    .trim()
}

function buildVenueIndex(venues: VenueRow[]): Map<string, VenueRow> {
  const map = new Map<string, VenueRow>()
  for (const v of venues) {
    map.set(normalise(v.slug), v)
    if (v.name_en) map.set(normalise(v.name_en), v)
    if (v.name_ja) map.set(normalise(v.name_ja), v)
  }
  return map
}

function resolveVenue(hint: string, index: Map<string, VenueRow>): VenueRow | null {
  const n = normalise(hint)
  // Exact match first
  if (index.has(n)) return index.get(n)!
  // Substring match — iterate map keys
  for (const [key, v] of index) {
    if (n.includes(key) || key.includes(n)) return v
  }
  return null
}

// ── Upsert ─────────────────────────────────────────────────────────────────────
async function upsertAggregatorEvents(
  supabase: ReturnType<typeof getAdminClient>,
  events: AggregatorEvent[],
  venueIndex: Map<string, VenueRow>,
): Promise<{ upserted: number; unresolved: number }> {
  const rows: Array<{
    venue_id: string; slug: string; title_en: string; event_date: string;
    ticket_url: string | null; description_en: string | null;
    availability: 'on_sale'; is_featured: boolean;
  }> = []

  let unresolved = 0
  for (const e of events) {
    const v = resolveVenue(e.venueHint, venueIndex)
    if (!v) { unresolved++; continue }
    rows.push({
      venue_id:       v.id,
      slug:           `${v.slug}-${e.eventDate}-${slugify(e.title).slice(0, 40)}`,
      title_en:       e.title,
      event_date:     e.eventDate,
      ticket_url:     e.ticketUrl ?? null,
      description_en: e.notes ? `Source: ${e.sourceSlug}. ${e.notes}` : `Source: ${e.sourceSlug}`,
      availability:   'on_sale',
      is_featured:    false,
    })
  }

  if (rows.length === 0) return { upserted: 0, unresolved }

  // Dedupe within batch by slug
  const unique = Array.from(new Map(rows.map((r) => [r.slug, r])).values())

  const { error, data } = await supabase.from('events').upsert(unique, {
    onConflict:       'slug',
    ignoreDuplicates: false,
  }).select('id')

  if (error) throw new Error(`Aggregator upsert: ${error.message}`)
  return { upserted: data?.length ?? 0, unresolved }
}

// ── Per-source runners ─────────────────────────────────────────────────────────
async function runFlatSource(
  supabase: ReturnType<typeof getAdminClient>,
  venueIndex: Map<string, VenueRow>,
  source: { slug: string; indexUrl: string; parseIndex: (html: string) => AggregatorEvent[] },
): Promise<AggregatorResult> {
  const start = Date.now()
  try {
    console.log(`[agg] → ${source.slug}: ${source.indexUrl}`)
    const html = await fetchHtml(source.indexUrl)
    if (!html) throw new Error(`fetch failed`)

    const events = source.parseIndex(html)
    console.log(`[agg]   ${source.slug}: ${events.length} Osaka event(s) parsed`)
    const { upserted, unresolved } = await upsertAggregatorEvents(supabase, events, venueIndex)
    console.log(`[agg]   ${source.slug}: ${upserted} upserted, ${unresolved} unresolved venue(s)`)

    return {
      sourceSlug:     source.slug,
      status:         'success',
      eventsFound:    events.length,
      eventsOsaka:    events.length,  // flat sources already filtered in parse
      eventsUpserted: upserted,
      durationMs:     Date.now() - start,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[agg] ✗ ${source.slug}: ${msg}`)
    return {
      sourceSlug: source.slug, status: 'failed',
      eventsFound: 0, eventsOsaka: 0, eventsUpserted: 0,
      errorMessage: msg, durationMs: Date.now() - start,
    }
  }
}

async function runTwoLevelSource(
  supabase: ReturnType<typeof getAdminClient>,
  venueIndex: Map<string, VenueRow>,
  source: {
    slug: string
    indexUrl: string
    parseIndex:      (html: string) => Array<{ url: string; title: string }> | string[]
    parsePagination?:(html: string) => string[]
    parseDetail:     (html: string, title: string, url: string) => AggregatorEvent[]
  },
  concurrency = 3,
): Promise<AggregatorResult> {
  const start = Date.now()
  const allEvents: AggregatorEvent[] = []

  try {
    console.log(`[agg] → ${source.slug}: ${source.indexUrl}`)
    const indexHtml = await fetchHtml(source.indexUrl)
    if (!indexHtml) throw new Error('index fetch failed')

    // Collect all index pages (page 1 + pagination)
    const indexPages = new Set<string>([source.indexUrl])
    if (source.parsePagination) {
      for (const p of source.parsePagination(indexHtml)) indexPages.add(p)
    }

    // Collect detail URLs across all index pages
    const detailLinks: Array<{ url: string; title: string }> = []
    const seenDetail = new Set<string>()

    for (const ipUrl of indexPages) {
      const html = ipUrl === source.indexUrl ? indexHtml : await fetchHtml(ipUrl)
      if (!html) continue
      const parsed = source.parseIndex(html)
      for (const p of parsed) {
        const entry = typeof p === 'string' ? { url: p, title: '' } : p
        if (seenDetail.has(entry.url)) continue
        seenDetail.add(entry.url)
        detailLinks.push(entry)
      }
    }
    console.log(`[agg]   ${source.slug}: ${detailLinks.length} detail page(s)`)

    // Fetch detail pages with bounded concurrency
    for (let i = 0; i < detailLinks.length; i += concurrency) {
      const batch = detailLinks.slice(i, i + concurrency)
      const htmls = await Promise.all(batch.map((d) => fetchHtml(d.url)))
      htmls.forEach((html, idx) => {
        if (!html) return
        const evs = source.parseDetail(html, batch[idx].title, batch[idx].url)
        allEvents.push(...evs)
      })
    }
    console.log(`[agg]   ${source.slug}: ${allEvents.length} Osaka event(s) across details`)

    const { upserted, unresolved } = await upsertAggregatorEvents(supabase, allEvents, venueIndex)
    console.log(`[agg]   ${source.slug}: ${upserted} upserted, ${unresolved} unresolved venue(s)`)

    return {
      sourceSlug:     source.slug,
      status:         'success',
      eventsFound:    allEvents.length,
      eventsOsaka:    allEvents.length,
      eventsUpserted: upserted,
      durationMs:     Date.now() - start,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[agg] ✗ ${source.slug}: ${msg}`)
    return {
      sourceSlug: source.slug, status: 'failed',
      eventsFound: 0, eventsOsaka: 0, eventsUpserted: 0,
      errorMessage: msg, durationMs: Date.now() - start,
    }
  }
}

// ── Public entry point ─────────────────────────────────────────────────────────
export async function runAggregatorCycle(): Promise<AggregatorResult[]> {
  const supabase = getAdminClient()
  const { data: venues, error } = await supabase
    .from('venues')
    .select('id, slug, name_en, name_ja')
  if (error) throw new Error(`venues load: ${error.message}`)
  const venueIndex = buildVenueIndex((venues ?? []) as VenueRow[])

  console.log(`[agg] Starting aggregator cycle — ${venueIndex.size} venue aliases indexed`)

  const results: AggregatorResult[] = []
  // Flat sources
  results.push(await runFlatSource(supabase, venueIndex, udiscoverSource))
  results.push(await runFlatSource(supabase, venueIndex, unionwaySource))
  // Two-level sources
  results.push(await runTwoLevelSource(supabase, venueIndex, punxSource))
  results.push(await runTwoLevelSource(supabase, venueIndex, iceGrillsSource))

  const totalUpserted = results.reduce((s, r) => s + r.eventsUpserted, 0)
  const totalOsaka    = results.reduce((s, r) => s + r.eventsOsaka, 0)
  console.log(`[agg] Done — ${totalOsaka} Osaka events, ${totalUpserted} upserted`)

  return results
}
