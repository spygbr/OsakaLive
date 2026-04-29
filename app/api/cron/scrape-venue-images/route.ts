/**
 * GET /api/cron/scrape-venue-images
 *
 * Automated venue image enrichment.
 * Processes only venues where image_url IS NULL.
 * Sources (priority):
 *   1. Google Places Photos API  (requires GOOGLE_PLACES_API_KEY)
 *   2. og:image from venue website
 *   3. twitter:image from venue website
 *   4. First large <img> from venue website
 * Images are uploaded to Supabase Storage (venue-images bucket)
 * and the CDN URL is written back to venues.image_url.
 *
 * Runs weekly (see vercel.json). Safe to call manually:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://osaka-live.net/api/cron/scrape-venue-images
 */

import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60
// Tokyo region — JP venue WAFs accept connections from hnd1
export const preferredRegion = 'hnd1'

// ── Config ─────────────────────────────────────────────────────────────────────
const OL_UA          = 'OsakaLive/0.1 (https://osaka-live.net; diku@genkanconsulting.com)'
const MAX_BYTES      = 8 * 1024 * 1024   // 8 MB limit
const FETCH_TIMEOUT  = 15_000            // 15 s per network call
const MIN_IMG_WIDTH  = 300               // ignore images smaller than this
const STORAGE_BUCKET = 'venue-images'
const SKIP_PATTERN   = /icon|logo|favicon|sprite|pixel|blank|loading|placeholder/i

// Osaka centre for Places location bias
const OSAKA_LAT = 34.6937
const OSAKA_LNG = 135.5023

// ── Types ──────────────────────────────────────────────────────────────────────
interface Venue {
  id:          string
  slug:        string
  name_en:     string
  name_ja:     string
  website_url: string | null
}

interface VenueResult {
  slug:    string
  status:  'applied' | 'miss' | 'error'
  source?: string
  reason?: string
}

// ── Supabase admin client ──────────────────────────────────────────────────────
function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<any>(url, key, { auth: { persistSession: false } })
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function resolveUrl(raw: string, base: string): string | null {
  try { return new URL(raw, base).href } catch { return null }
}

function extFromContentType(ct: string, url: string): string {
  if (ct.includes('png'))  return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif'))  return 'gif'
  return url.match(/\.(\w{3,4})(?:\?|$)/)?.[1]?.toLowerCase() ?? 'jpg'
}

// ── Source 1: Google Places Photos ────────────────────────────────────────────
async function searchGooglePlaces(venue: Venue): Promise<{ imageUrl: string; source: string } | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return null

  const queries = [
    venue.name_ja && venue.name_ja !== venue.name_en
      ? `${venue.name_ja} 大阪`
      : null,
    `${venue.name_en} Osaka live house`,
  ].filter(Boolean) as string[]

  for (const query of queries) {
    try {
      const searchRes = await fetch(
        'https://places.googleapis.com/v1/places:searchText',
        {
          method: 'POST',
          headers: {
            'Content-Type':     'application/json',
            'X-Goog-Api-Key':   apiKey,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.photos',
          },
          body: JSON.stringify({
            textQuery:    query,
            languageCode: 'ja',
            locationBias: {
              circle: {
                center: { latitude: OSAKA_LAT, longitude: OSAKA_LNG },
                radius: 15000,
              },
            },
            maxResultCount: 1,
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        },
      )

      if (!searchRes.ok) continue

      const searchJson = await searchRes.json() as {
        places?: {
          id:          string
          displayName: { text: string }
          photos?:     { name: string }[]
        }[]
      }

      const place = searchJson.places?.[0]
      if (!place?.photos?.length) continue

      const photoName = place.photos[0].name
      const photoUrl  =
        `https://places.googleapis.com/v1/${photoName}/media` +
        `?maxHeightPx=1200&maxWidthPx=1600&key=${apiKey}`

      const photoRes = await fetch(photoUrl, {
        redirect: 'follow',
        headers:  { 'User-Agent': OL_UA },
        signal:   AbortSignal.timeout(FETCH_TIMEOUT),
      })

      if (!photoRes.ok) continue
      const ct = photoRes.headers.get('content-type') ?? ''
      if (!ct.startsWith('image/')) continue

      console.log(`[venue-images] google-places hit: ${venue.slug} — "${place.displayName.text}"`)
      return { imageUrl: photoRes.url, source: 'google-places' }
    } catch {
      // try next query
    }
  }

  return null
}

// ── Sources 2–4: Website scraping ─────────────────────────────────────────────
async function findImageFromWebsite(
  venue: Venue,
): Promise<{ imageUrl: string; source: string } | null> {
  if (!venue.website_url) return null

  let html: string
  try {
    const res = await fetch(venue.website_url, {
      headers: {
        'User-Agent': OL_UA,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.5',
      },
      signal:   AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: 'follow',
    })
    if (!res.ok) return null
    html = await res.text()
  } catch {
    return null
  }

  const base = venue.website_url

  // og:image
  const og =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
  if (og) {
    const resolved = resolveUrl(og.trim(), base)
    if (resolved) return { imageUrl: resolved, source: 'og:image' }
  }

  // twitter:image
  const tw =
    html.match(/<meta[^>]+(?:name|property)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']twitter:image["']/i)?.[1]
  if (tw) {
    const resolved = resolveUrl(tw.trim(), base)
    if (resolved) return { imageUrl: resolved, source: 'twitter:image' }
  }

  // First large <img>
  for (const m of html.matchAll(/<img\b[^>]+>/gi)) {
    const tag = m[0]
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]?.trim()
    if (!src || src.startsWith('data:') || SKIP_PATTERN.test(src)) continue
    const w = tag.match(/\bwidth=["']?(\d+)/i)?.[1]
    if (w && parseInt(w, 10) < MIN_IMG_WIDTH) continue
    const resolved = resolveUrl(src, base)
    if (resolved) return { imageUrl: resolved, source: 'img-tag' }
  }

  return null
}

// ── Combined: try all sources ──────────────────────────────────────────────────
async function findImageUrl(
  venue: Venue,
): Promise<{ imageUrl: string; source: string } | null> {
  // 1. Google Places (best quality, works even without a website)
  const placesResult = await searchGooglePlaces(venue)
  if (placesResult) return placesResult

  // 2–4. Website scraping fallback
  return findImageFromWebsite(venue)
}

// ── Image download + Storage upload ───────────────────────────────────────────
async function uploadAndSave(
  supabase: ReturnType<typeof getAdmin>,
  venue: Venue,
  imageUrl: string,
): Promise<'ok' | 'error'> {
  // Verify it's actually an image
  try {
    const head = await fetch(imageUrl, {
      method: 'HEAD', headers: { 'User-Agent': OL_UA },
      signal: AbortSignal.timeout(10_000), redirect: 'follow',
    })
    const ct = head.headers.get('content-type') ?? ''
    if (!head.ok || (!ct.startsWith('image/') && !ct.includes('octet-stream'))) return 'error'
  } catch {
    return 'error'
  }

  // Download
  let buf: Buffer
  let ext: string
  try {
    const res = await fetch(imageUrl, {
      headers:  { 'User-Agent': OL_UA },
      signal:   AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: 'follow',
    })
    if (!res.ok) return 'error'
    const ct = res.headers.get('content-type') ?? 'image/jpeg'
    const arrBuf = await res.arrayBuffer()
    if (arrBuf.byteLength > MAX_BYTES) return 'error'
    buf = Buffer.from(arrBuf)
    ext = extFromContentType(ct, imageUrl)
  } catch {
    return 'error'
  }

  // Upload to Storage
  const storagePath = `${venue.slug}.${ext}`
  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buf, {
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      upsert: true,
    })
  if (uploadErr) {
    console.error(`[venue-images] storage upload failed for ${venue.slug}:`, uploadErr.message)
    return 'error'
  }

  const { data: { publicUrl } } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath)

  // Update DB
  const { error: dbErr } = await supabase
    .from('venues')
    .update({ image_url: publicUrl })
    .eq('slug', venue.slug)
  if (dbErr) {
    console.error(`[venue-images] db update failed for ${venue.slug}:`, dbErr.message)
    return 'error'
  }

  return 'ok'
}

// ── Handler ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Auth
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getAdmin()

  // Fetch venues with no image
  const { data, error } = await supabase
    .from('venues')
    .select('id, slug, name_en, name_ja, website_url')
    .is('image_url', null)
    .order('name_en')

  if (error) {
    console.error('[venue-images] query failed:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const venues = (data ?? []) as Venue[]
  const results: VenueResult[] = []

  console.log(`[venue-images] processing ${venues.length} venue(s) with missing images`)

  for (const venue of venues) {
    try {
      const found = await findImageUrl(venue)

      if (!found) {
        results.push({
          slug:   venue.slug,
          status: 'miss',
          reason: venue.website_url ? 'no image found' : 'no website or places result',
        })
        continue
      }

      const uploadResult = await uploadAndSave(supabase, venue, found.imageUrl)
      if (uploadResult === 'ok') {
        console.log(`[venue-images] ✅ ${venue.slug} [${found.source}]`)
        results.push({ slug: venue.slug, status: 'applied', source: found.source })
      } else {
        results.push({ slug: venue.slug, status: 'error', reason: 'upload/db failed' })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[venue-images] unhandled error for ${venue.slug}:`, msg)
      results.push({ slug: venue.slug, status: 'error', reason: msg.slice(0, 100) })
    }
  }

  const summary = {
    ok:      true,
    total:   venues.length,
    applied: results.filter((r) => r.status === 'applied').length,
    missed:  results.filter((r) => r.status === 'miss').length,
    errors:  results.filter((r) => r.status === 'error').length,
    results,
  }

  console.log('[venue-images] done:', JSON.stringify(summary))
  return NextResponse.json(summary)
}
