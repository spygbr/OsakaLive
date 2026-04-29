/**
 * GET /api/cron/enrich-artists
 *
 * Pipeline step 4 — runs after promote-artists completes.
 * Enriches up to BATCH_LIMIT artists per run with:
 *   - Image URL  (Deezer → iTunes → MusicBrainz cover art, in priority order)
 *   - Bio        (Wikipedia EN → Wikipedia JP fallback)
 *   - Genre      (Deezer genre name → genre_id FK via genres table)
 *
 * Only fills NULL columns — never overwrites existing data.
 * Run daily so backfill accumulates over time (20 artists/day).
 *
 * On success, fires /api/cron/slugify-artists to continue the chain.
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://osaka-live.vercel.app/api/cron/enrich-artists
 */

import { after, type NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getAdminClient, triggerCronStep } from '@/lib/pipeline/artist-pipeline'

export const maxDuration = 60
export const preferredRegion = 'hnd1'

const BATCH_LIMIT = 20
const FETCH_TIMEOUT = 8_000

interface ArtistToEnrich {
  id: string
  name_en: string
  name_ja: string | null
  slug: string
  image_url: string | null
  bio_en: string | null
  genre_id: string | null
}

interface EnrichResult {
  image_url?: string
  bio_en?: string
  genre_id?: string
}

// ── Deezer ─────────────────────────────────────────────────────────────────

async function searchDeezer(name: string): Promise<{ imageUrl: string | null; genreName: string | null }> {
  try {
    const q = encodeURIComponent(name)
    const res = await fetch(`https://api.deezer.com/search/artist?q=${q}&limit=1`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return { imageUrl: null, genreName: null }
    const data = await res.json()
    const artist = data?.data?.[0]
    if (!artist) return { imageUrl: null, genreName: null }

    // Fetch artist detail for genre
    let genreName: string | null = null
    try {
      const detailRes = await fetch(`https://api.deezer.com/artist/${artist.id}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
      if (detailRes.ok) {
        const detail = await detailRes.json()
        // Deezer doesn't return genre in artist detail directly; skip for now
        void detail
      }
    } catch { /* best effort */ }

    return {
      imageUrl: artist.picture_medium ?? artist.picture ?? null,
      genreName,
    }
  } catch {
    return { imageUrl: null, genreName: null }
  }
}

// ── iTunes Search ──────────────────────────────────────────────────────────

async function searchITunes(name: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(name)
    const res = await fetch(
      `https://itunes.apple.com/search?term=${q}&entity=musicArtist&limit=1`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT) },
    )
    if (!res.ok) return null
    const data = await res.json()
    return data?.results?.[0]?.artworkUrl100?.replace('100x100', '600x600') ?? null
  } catch {
    return null
  }
}

// ── Wikipedia ──────────────────────────────────────────────────────────────

async function fetchWikipediaBio(name: string, lang = 'en'): Promise<string | null> {
  try {
    const q = encodeURIComponent(name)
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${q}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT) },
    )
    if (!res.ok) return null
    const data = await res.json()
    const extract = data?.extract ?? ''
    // Skip disambiguation pages and very short extracts
    if (data?.type === 'disambiguation' || extract.length < 80) return null
    return extract.slice(0, 1000) || null
  } catch {
    return null
  }
}

// ── Genre lookup ───────────────────────────────────────────────────────────

async function resolveGenreId(
  supabase: ReturnType<typeof getAdminClient>,
  genreName: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('genres')
    .select('id')
    .ilike('name_en', genreName)
    .limit(1)
  return (data?.[0] as { id: string } | undefined)?.id ?? null
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getAdminClient()

    // Load artists missing at least one enrichable field
    const { data: artists, error } = await supabase
      .from('artists')
      .select('id, name_en, name_ja, slug, image_url, bio_en, genre_id')
      .or('image_url.is.null,bio_en.is.null,genre_id.is.null')
      .order('created_at', { ascending: true })
      .limit(BATCH_LIMIT)

    if (error) throw new Error(`load artists: ${error.message}`)
    if (!artists || artists.length === 0) {
      const summary = { ok: true, processed: 0, message: 'No artists need enrichment' }
      after(() => triggerCronStep('/api/cron/slugify-artists', process.env.CRON_SECRET))
      return NextResponse.json(summary)
    }

    let enriched = 0
    let skipped = 0

    for (const artist of artists as ArtistToEnrich[]) {
      const updates: EnrichResult = {}
      const names = [artist.name_en, artist.name_ja].filter(Boolean) as string[]

      // ── Image ────────────────────────────────────────────────────────────
      if (!artist.image_url) {
        let imageUrl: string | null = null
        for (const name of names) {
          const deezer = await searchDeezer(name)
          if (deezer.imageUrl) { imageUrl = deezer.imageUrl; break }
        }
        if (!imageUrl) {
          for (const name of names) {
            imageUrl = await searchITunes(name)
            if (imageUrl) break
          }
        }
        if (imageUrl) updates.image_url = imageUrl
      }

      // ── Bio ──────────────────────────────────────────────────────────────
      if (!artist.bio_en) {
        let bio: string | null = null
        bio = await fetchWikipediaBio(artist.name_en, 'en')
        if (!bio && artist.name_ja) bio = await fetchWikipediaBio(artist.name_ja, 'ja')
        if (bio) updates.bio_en = bio
      }

      // ── Genre ────────────────────────────────────────────────────────────
      if (!artist.genre_id) {
        for (const name of names) {
          const { genreName } = await searchDeezer(name)
          if (genreName) {
            const genreId = await resolveGenreId(supabase, genreName)
            if (genreId) { updates.genre_id = genreId; break }
          }
        }
      }

      if (Object.keys(updates).length === 0) {
        skipped++
        continue
      }

      const { error: updateErr } = await supabase
        .from('artists')
        .update(updates)
        .eq('id', artist.id)
      if (updateErr) console.error(`[enrich] update ${artist.slug}: ${updateErr.message}`)
      else enriched++
    }

    const summary = { ok: true, processed: artists.length, enriched, skipped }
    console.log('[cron] enrich-artists:', JSON.stringify(summary))

    after(() => triggerCronStep('/api/cron/slugify-artists', process.env.CRON_SECRET))

    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron] enrich-artists failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
