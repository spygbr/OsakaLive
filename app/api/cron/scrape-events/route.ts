/**
 * GET /api/cron/scrape-events
 *
 * Vercel Cron entrypoint. Drives the v2 pipeline:
 *   1. loadSources()  — materialise enabled sources (venues + aggregators) from DB
 *   2. runSources()   — fetch → validate → resolve venue → upsert → scrape_logs
 *
 * The runner handles HTTP caching (ETag / hash), validation, quarantine to
 * events_rejected, and dedup via the (venue_id, event_date, title_norm) unique
 * constraint. There is no separate "aggregator cycle" anymore — the registry
 * decides which kind each source is.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://osaka-live.vercel.app/api/cron/scrape-events
 */

import { after, type NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getAdminClient, runSources } from '@/lib/scraper/v2/runner'
import { loadSources } from '@/lib/scraper/v2/sources'
import { loadVenueIndex } from '@/lib/scraper/v2/venue-resolver'
import { triggerCronStep } from '@/lib/pipeline/artist-pipeline'

export const maxDuration = 60
// Pin cron egress to Tokyo. Several JP venues (sunhall.jp) silently drop
// connections from US-East datacenter IPs — connect times out at ~10s every
// run. Running from hnd1 puts us on a JP-routed egress, which the WAFs accept.
// This only affects this route; user-facing pages stay on the default region.
export const preferredRegion = 'hnd1'

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase    = getAdminClient()
    const sources     = await loadSources(supabase)
    const venueIndex  = await loadVenueIndex(supabase)

    if (sources.length === 0) {
      return NextResponse.json({ ok: true, message: 'No enabled sources', results: [] })
    }

    const results = await runSources(sources, 4, { supabase, venueIndex })

    const summary = {
      ok: true,
      totalSources: results.length,
      succeeded:    results.filter((r) => r.status === 'success').length,
      skipped:      results.filter((r) => r.status === 'skipped').length,
      failed:       results.filter((r) => r.status === 'failed').length,
      parsed:       results.reduce((s, r) => s + r.parsed,   0),
      rejected:     results.reduce((s, r) => s + r.rejected, 0),
      unresolved:   results.reduce((s, r) => s + r.unresolved, 0),
      upserted:     results.reduce((s, r) => s + r.upserted, 0),
      results,
    }

    console.log('[cron] scrape-events:', JSON.stringify(summary))

    // ── Chain: kick off artist pipeline after a successful scrape ──────────
    if (summary.ok && summary.succeeded > 0) {
      after(() => triggerCronStep('/api/cron/extract-artists', process.env.CRON_SECRET))
    }

    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron] scrape-events failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
