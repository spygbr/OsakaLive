/**
 * GET /api/cron/images
 *
 * Attaches a single concert-flyer image to every upcoming event that is
 * still missing one. Sources: (1) venue event detail page, (2) artist IG.
 *
 * Gated by IMAGE_SCRAPE_ENABLED=true env var — set to false during initial
 * rollout so you can run manual tests before enabling the cron.
 *
 * Manual run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://osaka-live.net/api/cron/images
 *
 * Optional query params:
 *   ?limit=5   Process only first N pending events
 */

import { type NextRequest, NextResponse } from 'next/server'
import { runImageEnrichment } from '@/lib/scraper/v2/images/runner'

export const maxDuration = 60
export const preferredRegion = 'hnd1'

export async function GET(req: NextRequest) {
  // Auth — skipped during manual testing (re-enable before prod cron)
  // const secret = process.env.CRON_SECRET
  // if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
  //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // }

  // Feature flag
  if (process.env.IMAGE_SCRAPE_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'IMAGE_SCRAPE_ENABLED is not true' })
  }

  const limitParam = req.nextUrl.searchParams.get('limit')
  const limit = limitParam ? parseInt(limitParam, 10) : undefined

  try {
    const { results, durationMs } = await runImageEnrichment({ limit })

    const summary = {
      ok:       true,
      total:    results.length,
      applied:  results.filter((r) => r.status === 'applied').length,
      missed:   results.filter((r) => r.status === 'miss').length,
      errors:   results.filter((r) => r.status === 'error').length,
      durationMs,
      results,
    }

    console.log('[cron/images] done:', JSON.stringify(summary))
    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/images] fatal:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
