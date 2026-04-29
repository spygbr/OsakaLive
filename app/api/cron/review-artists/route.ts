/**
 * GET /api/cron/review-artists
 *
 * Pipeline step 2 — runs after extract-artists completes.
 * Classifies unreviewed artist_candidates (confidence: medium + low) using:
 *   1. Venue pre-check (free, instant)
 *   2. Claude Haiku LLM classification
 *
 * High-confidence rows are auto-approved without LLM (they passed venue check
 * during extraction already; Haiku would almost certainly confirm them).
 *
 * On success, fires /api/cron/promote-artists to continue the chain.
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://osaka-live.vercel.app/api/cron/review-artists
 */

import { after, type NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  getAdminClient,
  buildVenueLookup,
  checkAgainstVenues,
  buildReviewPrompt,
  verdictToStatus,
  triggerCronStep,
  type LlmVerdict,
} from '@/lib/pipeline/artist-pipeline'
import { createHaikuClient } from '@/lib/llm/haiku'

export const maxDuration = 60
export const preferredRegion = 'hnd1'

const BATCH_SIZE = 20

interface Candidate {
  id: string
  name_display: string
  name_norm: string
  confidence: string
  event_count: number | null
  sample_title: string | null
  sample_description: string | null
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getAdminClient()

    // ── Load venues ────────────────────────────────────────────────────────
    const { data: venueRows, error: venueErr } = await supabase
      .from('venues').select('name_en, name_ja, slug').order('name_en')
    if (venueErr) throw new Error(`venues: ${venueErr.message}`)
    const venueLookup = buildVenueLookup(venueRows ?? [])

    // ── Load unreviewed candidates (medium + low) ──────────────────────────
    const { data: rawRows, error: rowErr } = await supabase
      .from('artist_candidates')
      .select('id, name_display, name_norm, confidence, event_count')
      .in('confidence', ['medium', 'low'])
      .eq('status', 'pending')
      .order('event_count', { ascending: false })
      .limit(200)
    if (rowErr) throw new Error(`candidates: ${rowErr.message}`)

    // Auto-approve high-confidence pending rows (no LLM needed)
    const { data: highRows } = await supabase
      .from('artist_candidates')
      .select('id')
      .eq('confidence', 'high')
      .eq('status', 'pending')
    if (highRows && highRows.length > 0) {
      const ids = (highRows as Array<{ id: string }>).map(r => r.id)
      await supabase.from('artist_candidates').update({ status: 'approved', llm_verdict: 'artist', llm_reason: 'high confidence — auto-approved' }).in('id', ids)
    }

    if (!rawRows || rawRows.length === 0) {
      const summary = { ok: true, processed: 0, autoApproved: highRows?.length ?? 0, message: 'No unreviewed candidates' }
      after(() => triggerCronStep('/api/cron/promote-artists', process.env.CRON_SECRET))
      return NextResponse.json(summary)
    }

    // ── Fetch event context for LLM prompts ───────────────────────────────
    const candidates: Candidate[] = (rawRows as Array<Record<string, unknown>>).map(row => ({
      id: row.id as string,
      name_display: row.name_display as string,
      name_norm: row.name_norm as string,
      confidence: row.confidence as string,
      event_count: (row.event_count as number | null) ?? null,
      sample_title: null,
      sample_description: null,
    }))

    for (const c of candidates) {
      if (c.name_display.length < 3) continue
      const needle = c.name_display.replace(/[\\%_]/g, m => `\\${m}`)
      const { data: evRows } = await supabase
        .from('events').select('title_raw, description').ilike('title_raw', `%${needle}%`).limit(1)
      if (evRows && evRows.length > 0) {
        c.sample_title = evRows[0].title_raw ?? null
        c.sample_description = evRows[0].description ?? null
      }
    }

    // ── Venue pre-check ────────────────────────────────────────────────────
    interface ClassResult { id: string; verdict: LlmVerdict; reason: string }
    const venueResults: ClassResult[] = []
    const needsLlm: Candidate[] = []

    for (const c of candidates) {
      const match = checkAgainstVenues(c.name_display, venueLookup)
      if (match) venueResults.push({ id: c.id, verdict: match.verdict, reason: match.reason })
      else needsLlm.push(c)
    }

    // Save venue rejections
    if (venueResults.length > 0) {
      await Promise.all(
        venueResults.map(r =>
          supabase.from('artist_candidates').update({ llm_verdict: r.verdict, llm_reason: r.reason, status: verdictToStatus(r.verdict) }).eq('id', r.id)
        )
      )
    }

    // ── LLM classification ─────────────────────────────────────────────────
    const llmResults: ClassResult[] = []
    const verdictCounts: Record<LlmVerdict, number> = { artist: 0, not_artist: 0, uncertain: 0 }

    if (needsLlm.length > 0 && process.env.ANTHROPIC_API_KEY) {
      const haiku = createHaikuClient({ rateDelayMs: 100 })

      type Payload = { verdict: LlmVerdict; reason: string }
      const isPayload = (x: unknown): x is Payload => {
        if (typeof x !== 'object' || x === null) return false
        const v = ((x as Record<string, unknown>).verdict as string | undefined)?.toLowerCase().trim() ?? ''
        return ['artist', 'not_artist', 'uncertain'].includes(v)
      }

      for (let b = 0; b < needsLlm.length; b += BATCH_SIZE) {
        const batch = needsLlm.slice(b, b + BATCH_SIZE)
        const batchResults = await Promise.all(
          batch.map(async c => {
            const payload = await haiku.askJson<Payload>({
              prompt: buildReviewPrompt(c, venueLookup.venueList),
              maxTokens: 150,
              validate: isPayload,
              label: 'classify',
            })
            return payload
              ? { id: c.id, verdict: payload.verdict, reason: payload.reason }
              : { id: c.id, verdict: 'uncertain' as LlmVerdict, reason: 'API error — needs manual review' }
          })
        )

        llmResults.push(...batchResults)

        // Persist batch
        await Promise.all(
          batchResults.map(r =>
            supabase.from('artist_candidates').update({ llm_verdict: r.verdict, llm_reason: r.reason, status: verdictToStatus(r.verdict) }).eq('id', r.id)
          )
        )

        for (const r of batchResults) verdictCounts[r.verdict]++
      }
    }

    const summary = {
      ok: true,
      autoApproved: highRows?.length ?? 0,
      venueRejected: venueResults.length,
      llmArtist: verdictCounts.artist,
      llmNotArtist: verdictCounts.not_artist,
      llmUncertain: verdictCounts.uncertain,
      llmSkipped: needsLlm.length - llmResults.length,
    }
    console.log('[cron] review-artists:', JSON.stringify(summary))

    after(() => triggerCronStep('/api/cron/promote-artists', process.env.CRON_SECRET))

    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron] review-artists failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
