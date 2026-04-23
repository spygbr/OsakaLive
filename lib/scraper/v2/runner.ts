/**
 * Pipeline runner — drives a single Source through the v2 schema.
 *
 * Stages (per source):
 *   1. Load source row (cache markers, enabled flag) from `sources` table
 *   2. Source.run(ctx) → RawEvent[] + RejectedEvent[]
 *   3. Validate every RawEvent — failures move to rejected
 *   4. Resolve venueHint → venue_id for aggregator events
 *   5. Upsert events on (venue_id, event_date, title_norm)
 *   6. Upsert event_sources row(s)
 *   7. Insert events_rejected rows
 *   8. Persist HTTP cache markers back to sources row
 *   9. Write scrape_logs row
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchPage } from './fetcher'
import type { Source, RunContext } from './source'
import type { RawEvent, RejectedEvent, SourceRow, SourceRunResult } from './types'
import { validateEvent } from './validators'
import { loadVenueIndex, resolveVenue, type VenueIndex } from './venue-resolver'

// ── Supabase admin client ─────────────────────────────────────────────────

export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars for v2 runner')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── Source row ────────────────────────────────────────────────────────────

async function loadSourceRow(
  supabase: SupabaseClient,
  id: string,
): Promise<SourceRow | null> {
  const { data, error } = await supabase
    .from('sources')
    .select('id, kind, display_name, venue_id, base_url, enabled, last_etag, last_modified, last_content_hash')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`source load: ${error.message}`)
  if (!data) return null
  return {
    id: data.id,
    kind: data.kind,
    displayName: data.display_name,
    venueId: data.venue_id,
    baseUrl: data.base_url,
    enabled: data.enabled,
    lastEtag: data.last_etag,
    lastModified: data.last_modified,
    lastContentHash: data.last_content_hash,
  }
}

async function persistCacheMarkers(
  supabase: SupabaseClient,
  id: string,
  etag: string | null,
  lastModified: string | null,
  contentHash: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('sources')
    .update({
      last_etag: etag,
      last_modified: lastModified,
      last_content_hash: contentHash,
      last_fetched_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) console.warn(`[runner] persist cache for ${id}: ${error.message}`)
}

// ── DB writes ─────────────────────────────────────────────────────────────

type EventInsert = {
  venue_id: string
  event_date: string
  title_raw: string
  description: string | null
  start_time: string | null
  doors_time: string | null
  ticket_price_adv: number | null
  ticket_price_door: number | null
  ticket_url: string | null
  primary_source_id: string
}

async function upsertEvents(
  supabase: SupabaseClient,
  sourceId: string,
  rows: EventInsert[],
): Promise<{ ids: Map<string, string>; upserted: number }> {
  if (rows.length === 0) return { ids: new Map(), upserted: 0 }

  // Dedupe within batch on (venue_id, event_date, title_raw) — title_norm is
  // computed by the DB but we approximate here with title_raw for batch dedup.
  const key = (r: EventInsert) => `${r.venue_id}|${r.event_date}|${r.title_raw}`
  const unique = Array.from(new Map(rows.map((r) => [key(r), r])).values())

  const { data, error } = await supabase
    .from('events')
    .upsert(unique, { onConflict: 'venue_id,event_date,title_norm', ignoreDuplicates: false })
    .select('id, venue_id, event_date, title_raw')
  if (error) throw new Error(`event upsert (${sourceId}): ${error.message}`)

  const ids = new Map<string, string>()
  for (const r of data ?? []) {
    ids.set(`${r.venue_id}|${r.event_date}|${r.title_raw}`, r.id as string)
  }
  return { ids, upserted: data?.length ?? 0 }
}

async function upsertEventSources(
  supabase: SupabaseClient,
  sourceId: string,
  records: Array<{ event_id: string; source_url: string; raw_payload: unknown }>,
): Promise<void> {
  if (records.length === 0) return
  const rows = records.map((r) => ({
    event_id: r.event_id,
    source_id: sourceId,
    source_url: r.source_url,
    raw_payload: r.raw_payload ?? null,
  }))
  const { error } = await supabase
    .from('event_sources')
    .upsert(rows, { onConflict: 'event_id,source_id', ignoreDuplicates: false })
  if (error) throw new Error(`event_sources upsert (${sourceId}): ${error.message}`)
}

async function insertRejected(
  supabase: SupabaseClient,
  sourceId: string,
  rejects: RejectedEvent[],
): Promise<void> {
  if (rejects.length === 0) return
  const rows = rejects.map((r) => ({
    source_id: sourceId,
    source_url: r.sourceUrl ?? null,
    raw_line: r.rawLine.slice(0, 2000),
    reason: r.reason,
    payload: r.payload ?? null,
  }))
  const { error } = await supabase.from('events_rejected').insert(rows)
  if (error) console.warn(`[runner] insert rejected (${sourceId}): ${error.message}`)
}

async function writeScrapeLog(
  supabase: SupabaseClient,
  result: SourceRunResult,
): Promise<void> {
  const { error } = await supabase.from('scrape_logs').insert({
    source_id: result.sourceId,
    status: result.status,
    fetched: result.fetched,
    parsed: result.parsed,
    rejected: result.rejected,
    unresolved: result.unresolved,
    upserted: result.upserted,
    duration_ms: result.durationMs,
    error_message: result.errorMessage ?? null,
  })
  if (error) console.warn(`[runner] write scrape_log: ${error.message}`)
}

// ── Main entry point ──────────────────────────────────────────────────────

export type RunOptions = {
  /** Provide a pre-loaded venue index to avoid re-fetching across sources. */
  venueIndex?: VenueIndex
  /** Override Supabase client (testing). */
  supabase?: SupabaseClient
}

/**
 * Run a single Source end-to-end: fetch → parse → validate → resolve →
 * upsert → log. Returns a SourceRunResult suitable for cron aggregation.
 */
export async function runSource(
  source: Source,
  opts: RunOptions = {},
): Promise<SourceRunResult> {
  const supabase = opts.supabase ?? getAdminClient()
  const t0 = Date.now()
  const result: SourceRunResult = {
    sourceId: source.id,
    status: 'success',
    fetched: 0,
    parsed: 0,
    rejected: 0,
    unresolved: 0,
    upserted: 0,
    durationMs: 0,
  }

  try {
    const row = await loadSourceRow(supabase, source.id)
    if (row && !row.enabled) {
      result.status = 'skipped'
      return result
    }

    // ── Fetch + parse ──────────────────────────────────────────────────
    const ctx: RunContext = {
      http: async (url, o) => {
        result.fetched++
        return fetchPage(url, o)
      },
      prevEtag:         row?.lastEtag         ?? null,
      prevLastModified: row?.lastModified     ?? null,
      prevHash:         row?.lastContentHash  ?? null,
    }

    const out = await source.run(ctx)
    result.parsed = out.events.length

    // Persist cache markers regardless of whether we parsed anything.
    await persistCacheMarkers(supabase, source.id, out.entryEtag, out.entryLastModified, out.entryHash)

    if (out.notModified) {
      result.status = 'skipped'
      return result
    }

    // ── Validate ───────────────────────────────────────────────────────
    const valid: RawEvent[] = []
    const rejects: RejectedEvent[] = [...out.rejected]
    for (const e of out.events) {
      const v = validateEvent({ titleRaw: e.titleRaw, eventDate: e.eventDate })
      if (v.ok) valid.push(e)
      else rejects.push({ rawLine: e.titleRaw, reason: v.reason, sourceUrl: e.sourceUrl, payload: e.payload })
    }

    // ── Resolve venues ─────────────────────────────────────────────────
    const venueIndex = opts.venueIndex ?? (await loadVenueIndex(supabase))
    const resolved: Array<{ event: RawEvent; venueId: string }> = []
    for (const e of valid) {
      let venueId = e.venueId ?? null
      if (!venueId && e.venueHint) {
        const v = resolveVenue(e.venueHint, venueIndex)
        if (v) venueId = v.id
      }
      if (venueId) {
        resolved.push({ event: e, venueId })
      } else {
        result.unresolved++
        rejects.push({ rawLine: e.venueHint ?? e.titleRaw, reason: 'venue_unresolved', sourceUrl: e.sourceUrl, payload: e.payload })
      }
    }

    // ── Upsert events ──────────────────────────────────────────────────
    const eventRows: EventInsert[] = resolved.map(({ event, venueId }) => ({
      venue_id: venueId,
      event_date: event.eventDate,
      title_raw: event.titleRaw,
      description: event.description ?? null,
      start_time: event.startTime ?? null,
      doors_time: event.doorsTime ?? null,
      ticket_price_adv: event.ticketPriceAdv ?? null,
      ticket_price_door: event.ticketPriceDoor ?? null,
      ticket_url: event.ticketUrl ?? null,
      primary_source_id: source.id,
    }))

    const { ids, upserted } = await upsertEvents(supabase, source.id, eventRows)
    result.upserted = upserted

    // ── Upsert event_sources ───────────────────────────────────────────
    type SourceRecord = { event_id: string; source_url: string; raw_payload: unknown }
    const sourceRecords: SourceRecord[] = []
    for (const { event, venueId } of resolved) {
      const id = ids.get(`${venueId}|${event.eventDate}|${event.titleRaw}`)
      if (!id) continue
      sourceRecords.push({ event_id: id, source_url: event.sourceUrl, raw_payload: event.payload ?? null })
    }
    await upsertEventSources(supabase, source.id, sourceRecords)

    // ── Quarantine ─────────────────────────────────────────────────────
    result.rejected = rejects.length
    await insertRejected(supabase, source.id, rejects)
  } catch (e) {
    result.status = 'failed'
    result.errorMessage = (e as Error).message
    console.error(`[runner] ${source.id} failed:`, e)
  } finally {
    result.durationMs = Date.now() - t0
    await writeScrapeLog(supabase, result)
  }

  return result
}

/** Run a list of sources in parallel with a concurrency cap. */
export async function runSources(
  sources: Source[],
  concurrency = 4,
  opts: RunOptions = {},
): Promise<SourceRunResult[]> {
  const supabase = opts.supabase ?? getAdminClient()
  const venueIndex = opts.venueIndex ?? (await loadVenueIndex(supabase))
  const results: SourceRunResult[] = []
  let i = 0
  async function worker() {
    while (i < sources.length) {
      const idx = i++
      results[idx] = await runSource(sources[idx], { supabase, venueIndex })
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker))
  return results
}
