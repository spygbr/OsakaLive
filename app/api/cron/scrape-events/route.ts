/**
 * GET /api/cron/scrape-events
 *
 * Called by Vercel Cron daily at 02:00 JST (17:00 UTC prev day).
 * Can also be triggered manually from the Vercel dashboard or via curl:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://osaka-live.vercel.app/api/cron/scrape-events
 *
 * Required env vars:
 *   CRON_SECRET             — shared secret, set in Vercel project settings
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (never exposed to the client)
 *   NEXT_PUBLIC_SUPABASE_URL — already set
 */

import { NextRequest, NextResponse } from 'next/server'
import { runScrapeCycle } from '@/lib/scraper'

// Vercel sets the max duration for cron functions; 60 s is fine for 12 venues
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // ── Auth check ─────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  const secret     = process.env.CRON_SECRET

  if (secret) {
    // When CRON_SECRET is set, require it (protects against accidental public calls)
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  // If CRON_SECRET is not set in env, allow the call (Vercel calls are already
  // protected by the cron framework — only set the secret for extra safety)

  try {
    const results = await runScrapeCycle()

    const summary = {
      ok: true,
      totalVenues: results.length,
      succeeded:   results.filter((r) => r.status === 'success').length,
      failed:      results.filter((r) => r.status === 'failed').length,
      eventsFound: results.reduce((s, r) => s + r.eventsFound, 0),
      eventsUpserted: results.reduce((s, r) => s + r.eventsUpserted, 0),
      results,
    }

    console.log('[cron] scrape-events completed:', JSON.stringify(summary))
    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron] scrape-events failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
