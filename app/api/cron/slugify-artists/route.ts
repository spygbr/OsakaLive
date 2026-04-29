/**
 * GET /api/cron/slugify-artists
 *
 * Pipeline step 5 (terminal) — runs after enrich-artists completes.
 * Finds artists with auto-generated artist-XXXXXXXX slugs and attempts to
 * produce a readable romanised slug from name_ja using wanakana.
 *
 * This is a best-effort approximation (wanakana only, no kuromoji morphological
 * analysis). For high-quality romanisation of complex Japanese names, run
 * the manual `scripts/slugify-japanese-artists.ts` script which uses kuromoji.
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://osaka-live.vercel.app/api/cron/slugify-artists
 */

import { type NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/pipeline/artist-pipeline'
import * as wanakana from 'wanakana'

export const maxDuration = 30
export const preferredRegion = 'hnd1'

const HEX_SLUG_RE = /^artist-[0-9a-f]{8}$/

function wanakanaRomanise(japanese: string): string {
  try {
    // Convert kana to romaji
    const romaji = wanakana.toRomaji(japanese, { upcaseKatakana: false })
    return romaji
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
  } catch {
    return ''
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getAdminClient()

    // Load artists with hex-fallback slugs
    const { data: artists, error } = await supabase
      .from('artists')
      .select('id, name_en, name_ja, slug')
      .like('slug', 'artist-%')

    if (error) throw new Error(`load: ${error.message}`)

    const hexSlugArtists = ((artists ?? []) as Array<{ id: string; name_en: string; name_ja: string | null; slug: string }>)
      .filter(a => HEX_SLUG_RE.test(a.slug))

    if (hexSlugArtists.length === 0) {
      return NextResponse.json({ ok: true, updated: 0, message: 'No hex slugs found' })
    }

    // Load all existing slugs for collision avoidance
    const { data: allSlugs } = await supabase.from('artists').select('slug')
    const existingSlugs = new Set<string>((allSlugs ?? []).map((r: { slug: string }) => r.slug))

    let updated = 0
    let skipped = 0

    for (const artist of hexSlugArtists) {
      // Try name_ja first, fall back to name_en romanisation
      let newSlug = ''
      if (artist.name_ja) newSlug = wanakanaRomanise(artist.name_ja)
      if (!newSlug) newSlug = artist.name_en.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60)
      if (!newSlug || newSlug === artist.slug) { skipped++; continue }

      // Collision check
      let candidate = newSlug
      let suffix = 2
      while (existingSlugs.has(candidate) && candidate !== artist.slug) {
        candidate = `${newSlug.slice(0, 57)}-${suffix++}`
      }
      if (existingSlugs.has(candidate) && candidate !== artist.slug) { skipped++; continue }

      const { error: updateErr } = await supabase
        .from('artists')
        .update({ slug: candidate })
        .eq('id', artist.id)
      if (updateErr) {
        console.error(`[slugify] update ${artist.id}: ${updateErr.message}`)
        skipped++
      } else {
        existingSlugs.delete(artist.slug)
        existingSlugs.add(candidate)
        updated++
      }
    }

    const summary = { ok: true, found: hexSlugArtists.length, updated, skipped }
    console.log('[cron] slugify-artists:', JSON.stringify(summary))
    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron] slugify-artists failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
