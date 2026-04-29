/**
 * GET /api/cron/promote-artists
 *
 * Pipeline step 3 — runs after review-artists completes.
 * Promotes approved artist_candidates → artists table + event_artists junction.
 *
 * Promotion criteria: status = 'approved' AND merged_into_artist_id IS NULL
 * Non-destructive: skips already-promoted candidates.
 *
 * On success, fires /api/cron/enrich-artists to continue the chain.
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://osaka-live.vercel.app/api/cron/promote-artists
 */

import { after, type NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  getAdminClient,
  parseBilingualName,
  uniqueSlug,
  triggerCronStep,
} from '@/lib/pipeline/artist-pipeline'

export const maxDuration = 60
export const preferredRegion = 'hnd1'

interface CandidateRow {
  id: string
  name_display: string
  name_norm: string
  confidence: string
  event_count: number | null
  llm_verdict: string | null
  status: string
}

interface ArtistRow { id: string; name_en: string; slug: string }

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getAdminClient()

    // ── Load approved, unmerged candidates ────────────────────────────────
    const { data: allRows, error: candErr } = await supabase
      .from('artist_candidates')
      .select('id, name_display, name_norm, confidence, event_count, llm_verdict, status')
      .is('merged_into_artist_id', null)
      .in('status', ['pending', 'approved'])
    if (candErr) throw new Error(`candidates: ${candErr.message}`)

    const candidates = ((allRows ?? []) as CandidateRow[]).filter(c => {
      if (c.llm_verdict === 'not_artist') return false
      return c.status === 'approved' || c.confidence === 'high'
    })

    if (candidates.length === 0) {
      const summary = { ok: true, created: 0, reused: 0, links: 0, message: 'No candidates to promote' }
      after(() => triggerCronStep('/api/cron/enrich-artists', process.env.CRON_SECRET))
      return NextResponse.json(summary)
    }

    // Deduplicate by name_norm
    const nameMap = new Map<string, CandidateRow>()
    for (const c of candidates) {
      if (!nameMap.has(c.name_norm)) nameMap.set(c.name_norm, c)
    }

    // ── Load existing artists ──────────────────────────────────────────────
    const { data: existingArtists, error: artistErr } = await supabase
      .from('artists').select('id, name_en, slug')
    if (artistErr) throw new Error(`artists: ${artistErr.message}`)

    const artistByName = new Map<string, ArtistRow>()
    const existingSlugs = new Set<string>()
    for (const a of (existingArtists ?? []) as ArtistRow[]) {
      artistByName.set(a.name_en.toLowerCase().trim(), a)
      existingSlugs.add(a.slug)
    }

    let artistsCreated = 0
    let artistsReused = 0
    let linksCreated = 0
    let candidatesMarked = 0

    for (const [nameKey, candidate] of nameMap) {
      const { nameEn, nameJa } = parseBilingualName(candidate.name_display)
      const enKey = nameEn.toLowerCase().trim()
      const existingArtist = artistByName.get(nameKey) ?? artistByName.get(enKey)

      let artistId: string

      if (existingArtist) {
        artistId = existingArtist.id
        artistsReused++
      } else {
        const slug = uniqueSlug(nameEn, existingSlugs)
        const { data: newArtist, error: insertErr } = await supabase
          .from('artists')
          .insert({ name_en: nameEn, name_ja: nameJa, slug, bio_en: null, genre_id: null, image_url: null })
          .select('id, name_en, slug')
          .single()
        if (insertErr || !newArtist) {
          console.error(`[promote] insert artist "${candidate.name_display}": ${insertErr?.message}`)
          continue
        }
        artistId = newArtist.id
        existingSlugs.add(slug)
        artistByName.set(nameKey, newArtist as ArtistRow)
        artistByName.set(enKey, newArtist as ArtistRow)
        artistsCreated++
      }

      // ── Find matching events via ILIKE ─────────────────────────────────
      const { nameEn: en, nameJa: ja } = parseBilingualName(candidate.name_display)
      const searchTerms: string[] = []
      if (ja && ja.length >= 2) searchTerms.push(ja)
      if (en.length >= 3) searchTerms.push(en)

      const eventBillingMap = new Map<string, number>()
      for (const term of searchTerms) {
        const needle = term.replace(/[\\%_]/g, m => `\\${m}`)
        const [{ data: titleHits }, { data: descHits }] = await Promise.all([
          supabase.from('events').select('id').ilike('title_raw', `%${needle}%`).limit(200),
          supabase.from('events').select('id').ilike('description', `%${needle}%`).limit(200),
        ])
        for (const ev of (titleHits ?? []) as Array<{ id: string }>) {
          if (!eventBillingMap.has(ev.id)) eventBillingMap.set(ev.id, 1)
        }
        for (const ev of (descHits ?? []) as Array<{ id: string }>) {
          if (!eventBillingMap.has(ev.id)) eventBillingMap.set(ev.id, 2)
        }
      }

      const linkRows = Array.from(eventBillingMap.entries()).map(([event_id, billing_order]) => ({
        event_id, artist_id: artistId, billing_order,
      }))

      if (linkRows.length > 0) {
        const { error: linkErr } = await supabase
          .from('event_artists')
          .upsert(linkRows, { onConflict: 'event_id,artist_id', ignoreDuplicates: true })
        if (linkErr) console.error(`[promote] event_artists "${candidate.name_display}": ${linkErr.message}`)
        else linksCreated += linkRows.length
      }

      // ── Mark candidate merged ──────────────────────────────────────────
      const { error: updateErr } = await supabase
        .from('artist_candidates')
        .update({ status: 'merged', merged_into_artist_id: artistId })
        .eq('id', candidate.id)
      if (updateErr) console.error(`[promote] mark merged "${candidate.name_display}": ${updateErr.message}`)
      else candidatesMarked++
    }

    const summary = {
      ok: true,
      created: artistsCreated,
      reused: artistsReused,
      links: linksCreated,
      marked: candidatesMarked,
    }
    console.log('[cron] promote-artists:', JSON.stringify(summary))

    after(() => triggerCronStep('/api/cron/enrich-artists', process.env.CRON_SECRET))

    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron] promote-artists failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
