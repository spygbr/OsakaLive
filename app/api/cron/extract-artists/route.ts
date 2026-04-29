/**
 * GET /api/cron/extract-artists
 *
 * Pipeline step 1 — runs after scrape-events completes.
 * Mines events.title_raw / event_sources.raw_payload.lineup / events.description
 * for artist name candidates and upserts them into the artist_candidates staging table.
 *
 * On success, fires /api/cron/review-artists to continue the chain.
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://osaka-live.vercel.app/api/cron/extract-artists
 */

import { after, type NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  getAdminClient,
  buildVenueLookupSimple,
  isVenueName,
  isPricingGarbage,
  isGenreLabel,
  isBoilerplate,
  isEventTourDescriptor,
  stripTitleNoise,
  titleHasNoise,
  looksLikeSingleAct,
  normaliseToken,
  scoreToken,
  parseBilingualEntry,
  extractDescriptionTokens,
  triggerCronStep,
  type Confidence,
  type AggRow,
} from '@/lib/pipeline/artist-pipeline'

export const maxDuration = 60
export const preferredRegion = 'hnd1'

const BILINGUAL_SEP = /\s*[／/]\s*/
const CONF_ORDER: Record<Confidence, number> = { high: 0, medium: 1, low: 2, discard: 3 }

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getAdminClient()

    // ── Load data ──────────────────────────────────────────────────────────
    const [eventsRes, venuesRes, artistsRes] = await Promise.all([
      supabase.from('events').select('id, title_raw, description, event_sources(raw_payload)').order('event_date'),
      supabase.from('venues').select('name_en, name_ja'),
      supabase.from('artists').select('name_en'),
    ])

    if (eventsRes.error) throw new Error(`events: ${eventsRes.error.message}`)
    if (venuesRes.error) throw new Error(`venues: ${venuesRes.error.message}`)
    if (artistsRes.error) throw new Error(`artists: ${artistsRes.error.message}`)

    const events = eventsRes.data ?? []
    const venueLookup = buildVenueLookupSimple(venuesRes.data ?? [])
    const existingArtists = new Set<string>((artistsRes.data ?? []).map((a: { name_en: string }) => a.name_en.toLowerCase()))

    // ── First pass: collect raw candidates ────────────────────────────────
    interface RawCandidate { raw_name: string; source: 'title' | 'description' | 'title_fallback'; event_id: string }
    const rawCandidates: RawCandidate[] = []

    for (const event of events) {
      // A. Title
      const title = (event.title_raw as string | null)?.trim() ?? ''
      if (title) {
        const stripped = stripTitleNoise(title)
        if (stripped.length >= 4) rawCandidates.push({ raw_name: stripped, source: 'title', event_id: event.id })
      }

      // B. Lineup from event_sources or description fallback
      const sources = (event.event_sources as Array<{ raw_payload: Record<string, unknown> | null }> | null) ?? []
      const lineupArrays = sources.map(s => s.raw_payload?.lineup).filter(Array.isArray) as string[][]
      let descTokens: string[] = []

      if (lineupArrays.length > 0) {
        for (const lineup of lineupArrays) {
          for (const entry of lineup) {
            const raw = (entry as string).trim()
            const bilingual = parseBilingualEntry(raw)
            if (bilingual) {
              descTokens.push(raw)
            } else {
              descTokens.push(...raw.split(BILINGUAL_SEP).map((p: string) => p.trim()).filter(Boolean))
            }
          }
        }
      } else {
        const desc = (event.description as string | null) ?? ''
        if (desc) descTokens = extractDescriptionTokens(desc)
      }

      for (const token of descTokens) {
        if (token.length >= 2) rawCandidates.push({ raw_name: token, source: 'description', event_id: event.id })
      }
    }

    // ── Title fallback: single-act events with no lineup ──────────────────
    const eventsWithDesc = new Set(rawCandidates.filter(c => c.source === 'description').map(c => c.event_id))
    for (const event of events) {
      if (eventsWithDesc.has(event.id)) continue
      const title = (event.title_raw as string | null)?.trim() ?? ''
      if (!title) continue
      const stripped = stripTitleNoise(title)
      if (!looksLikeSingleAct(stripped) || titleHasNoise(stripped)) continue
      rawCandidates.push({ raw_name: stripped, source: 'title_fallback', event_id: event.id })
    }

    // ── Count events per normalised name ──────────────────────────────────
    const nameEventSets = new Map<string, Set<string>>()
    for (const c of rawCandidates) {
      const key = c.raw_name.toLowerCase().replace(/\s+/g, ' ').trim()
      if (!nameEventSets.has(key)) nameEventSets.set(key, new Set())
      nameEventSets.get(key)!.add(c.event_id)
    }

    // ── Score and deduplicate ─────────────────────────────────────────────
    const seen = new Set<string>()
    const byName = new Map<string, AggRow>()

    for (const rawC of rawCandidates) {
      const normKey = rawC.raw_name.toLowerCase().replace(/\s+/g, ' ').trim()
      const dedupeKey = `${rawC.event_id}|${rawC.source}|${normKey}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      const normalisedName = normaliseToken(rawC.raw_name)
      const c = normalisedName !== rawC.raw_name ? { ...rawC, raw_name: normalisedName } : rawC
      const eventCount = nameEventSets.get(normKey)?.size ?? 1

      // Discard filters
      if (c.raw_name.length > 40 || c.raw_name.length < 3) continue
      if (/^\d/.test(c.raw_name)) continue
      if (isPricingGarbage(c.raw_name) || isGenreLabel(c.raw_name) || isBoilerplate(c.raw_name)) continue
      if (isVenueName(c.raw_name, venueLookup)) continue
      if (isEventTourDescriptor(c.raw_name)) continue

      const scored = (() => {
        if (c.source === 'title_fallback') {
          const s = scoreToken(c.raw_name, eventCount, existingArtists)
          const confidence: Confidence = s.confidence === 'high' ? 'high' : s.confidence === 'discard' ? 'low' : 'medium'
          return { confidence, reason: `title fallback; ${s.reason}` }
        }
        if (c.source === 'title' && titleHasNoise(c.raw_name)) {
          const s = scoreToken(c.raw_name, eventCount, existingArtists)
          return { confidence: (s.confidence === 'discard' ? 'discard' : 'low') as Confidence, reason: `title noise; ${s.reason}` }
        }
        return scoreToken(c.raw_name, eventCount, existingArtists)
      })()

      if (scored.confidence === 'discard') continue

      const key = c.raw_name.toLowerCase().replace(/\s+/g, ' ').trim()
      const existing = byName.get(key)
      if (!existing) {
        byName.set(key, { name_norm: key, name_display: c.raw_name, event_count: eventCount, confidence: scored.confidence as 'high' | 'medium' | 'low' })
      } else {
        if (CONF_ORDER[scored.confidence] < CONF_ORDER[existing.confidence]) existing.confidence = scored.confidence as 'high' | 'medium' | 'low'
        existing.event_count = Math.max(existing.event_count, eventCount)
        if (existing.name_display === existing.name_display.toLowerCase() && c.raw_name !== c.raw_name.toLowerCase()) {
          existing.name_display = c.raw_name
        }
      }
    }

    const aggRows = Array.from(byName.values())

    // ── Clear pending, upsert fresh candidates ─────────────────────────────
    const { error: deleteError } = await supabase
      .from('artist_candidates')
      .delete()
      .eq('status', 'pending')
      .is('merged_into_artist_id', null)
    if (deleteError) throw new Error(`delete pending: ${deleteError.message}`)

    const CHUNK = 500
    let inserted = 0
    for (let i = 0; i < aggRows.length; i += CHUNK) {
      const chunk = aggRows.slice(i, i + CHUNK)
      const { error } = await supabase.from('artist_candidates').upsert(
        chunk.map(r => ({
          name_norm: r.name_norm,
          name_display: r.name_display,
          event_count: r.event_count,
          confidence: r.confidence,
          last_seen_at: new Date().toISOString(),
        })),
        { onConflict: 'name_norm', ignoreDuplicates: false },
      )
      if (error) throw new Error(`upsert chunk ${i / CHUNK}: ${error.message}`)
      inserted += chunk.length
    }

    const summary = {
      ok: true,
      events: events.length,
      rawCandidates: rawCandidates.length,
      inserted,
    }
    console.log('[cron] extract-artists:', JSON.stringify(summary))

    // ── Chain: trigger review step ─────────────────────────────────────────
    after(() => triggerCronStep('/api/cron/review-artists', process.env.CRON_SECRET))

    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron] extract-artists failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
