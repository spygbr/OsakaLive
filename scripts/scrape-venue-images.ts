/**
 * scripts/scrape-venue-images.ts
 *
 * Scrapes images for Osaka Live venues.
 * Sources tried (in order):
 *   1. Google Places Photos API  (best quality, requires GOOGLE_PLACES_API_KEY)
 *   2. og:image from venue website
 *   3. twitter:image from venue website
 *   4. First large <img> from venue website
 *
 * Usage:
 *   npx tsx scripts/scrape-venue-images.ts              # scan only (read-only)
 *   npx tsx scripts/scrape-venue-images.ts --apply      # upload + update DB
 *   npx tsx scripts/scrape-venue-images.ts --dry-run    # apply without writing
 *   npx tsx scripts/scrape-venue-images.ts --venue drop --apply
 *   npx tsx scripts/scrape-venue-images.ts --force      # re-process existing images
 *   npx tsx scripts/scrape-venue-images.ts --limit 5    # first N venues only
 *   npx tsx scripts/scrape-venue-images.ts --no-google  # skip Places API
 *
 * Env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL=...     (required)
 *   SUPABASE_SERVICE_ROLE_KEY=...    (required)
 *   GOOGLE_PLACES_API_KEY=...        (strongly recommended)
 */

import fs   from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

// ── .env.local ─────────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (m) {
      const key = m[1].trim()
      const val = m[2].trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  }
}

// ── Args ───────────────────────────────────────────────────────────────────────
const APPLY      = process.argv.includes('--apply')
const DRY_RUN    = process.argv.includes('--dry-run')
const FORCE      = process.argv.includes('--force')
const NO_GOOGLE  = process.argv.includes('--no-google')

const limitIdx = process.argv.indexOf('--limit')
const LIMIT: number | null =
  limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : null

const venueIdx = process.argv.indexOf('--venue')
const SINGLE_VENUE: string | null =
  venueIdx !== -1 ? process.argv[venueIdx + 1] : null

// ── Supabase ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing Supabase env vars in .env.local')
  process.exit(1)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Constants ──────────────────────────────────────────────────────────────────
const OL_UA         = 'OsakaLive/0.1 (https://osaka-live.net; diku@genkanconsulting.com)'
const MAX_BYTES     = 10 * 1024 * 1024
const TIMEOUT       = 20_000
const MIN_IMG_WIDTH = 300
const STORAGE_BUCKET = 'venue-images'
const SKIP_PATTERN  = /icon|logo|favicon|sprite|pixel|blank|loading|placeholder/i

// ── Types ──────────────────────────────────────────────────────────────────────
interface Venue {
  id:          string
  slug:        string
  name_en:     string
  name_ja:     string
  website_url: string | null
  image_url:   string | null
}

type ImageSource = 'google-places' | 'og:image' | 'twitter:image' | 'img-tag' | 'none'

interface ScanResult {
  slug:      string
  name_en:   string
  imageUrl:  string | null
  source:    ImageSource
  sourceUrl: string | null
  error:     string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function extFromContentType(ct: string, url: string): string {
  if (ct.includes('png'))  return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif'))  return 'gif'
  return url.match(/\.(\w{3,4})(?:\?|$)/)?.[1]?.toLowerCase() ?? 'jpg'
}

function resolveUrl(raw: string, base: string): string | null {
  try { return new URL(raw, base).href } catch { return null }
}

// ── Source 1: Google Places Photos ────────────────────────────────────────────
/**
 * Uses the Google Places API (New) to search for the venue and retrieve
 * the first Place Photo. Returns the direct CDN image URL via redirect.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/place-photos
 */
async function searchGooglePlaces(venue: Venue): Promise<string | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey || NO_GOOGLE) return null

  // Try Japanese name first (more precise for JP venues), fall back to English
  const queries = [
    venue.name_ja && venue.name_ja !== venue.name_en
      ? `${venue.name_ja} 大阪`
      : null,
    `${venue.name_en} Osaka live house`,
  ].filter(Boolean) as string[]

  for (const query of queries) {
    try {
      // Step 1: Text search to get place_id + photos
      const searchRes = await fetch(
        'https://places.googleapis.com/v1/places:searchText',
        {
          method: 'POST',
          headers: {
            'Content-Type':      'application/json',
            'X-Goog-Api-Key':    apiKey,
            'X-Goog-FieldMask':  'places.id,places.displayName,places.photos',
          },
          body: JSON.stringify({
            textQuery:    query,
            languageCode: 'ja',
            locationBias: {
              circle: {
                center: { latitude: 34.6937, longitude: 135.5023 }, // Osaka
                radius: 15000,
              },
            },
            maxResultCount: 1,
          }),
          signal: AbortSignal.timeout(TIMEOUT),
        },
      )

      if (!searchRes.ok) {
        const errText = await searchRes.text()
        console.log(`   [google-places] search error ${searchRes.status}: ${errText.slice(0, 120)}`)
        continue
      }

      const searchJson = await searchRes.json() as {
        places?: {
          id:          string
          displayName: { text: string }
          photos?:     { name: string; widthPx: number; heightPx: number }[]
        }[]
      }

      const place = searchJson.places?.[0]
      if (!place?.photos?.length) {
        console.log(`   [google-places] no photos for "${query}"`)
        continue
      }

      // Step 2: Fetch photo — resolves via redirect to CDN URL
      const photoName = place.photos[0].name
      const photoUrl  =
        `https://places.googleapis.com/v1/${photoName}/media` +
        `?maxHeightPx=1200&maxWidthPx=1600&key=${apiKey}`

      // Follow the redirect to get the real CDN URL
      const photoRes = await fetch(photoUrl, {
        redirect: 'follow',
        signal:   AbortSignal.timeout(TIMEOUT),
      })

      if (!photoRes.ok) {
        console.log(`   [google-places] photo fetch failed: ${photoRes.status}`)
        continue
      }

      const ct = photoRes.headers.get('content-type') ?? ''
      if (!ct.startsWith('image/')) {
        console.log(`   [google-places] unexpected content-type: ${ct}`)
        continue
      }

      // Return the final resolved URL
      console.log(`   [google-places] ✅ "${place.displayName.text}" — ${place.photos[0].widthPx}×${place.photos[0].heightPx}`)
      return photoRes.url  // final URL after redirect
    } catch (e) {
      console.log(`   [google-places] error: ${String(e).slice(0, 100)}`)
    }
    await sleep(300)
  }

  return null
}

// ── Source 2-4: Website scraping ───────────────────────────────────────────────
async function scrapeWebsite(venue: Venue): Promise<ScanResult> {
  const base: ScanResult = {
    slug:      venue.slug,
    name_en:   venue.name_en,
    imageUrl:  null,
    source:    'none',
    sourceUrl: null,
    error:     null,
  }

  if (!venue.website_url) {
    base.error = 'no website_url'
    return base
  }

  let html: string
  try {
    const res = await fetch(venue.website_url, {
      headers: {
        'User-Agent':      OL_UA,
        'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.5',
      },
      signal:   AbortSignal.timeout(TIMEOUT),
      redirect: 'follow',
    })
    if (!res.ok) { base.error = `HTTP ${res.status}`; return base }
    html = await res.text()
  } catch (e) {
    base.error = String(e).slice(0, 120)
    return base
  }

  const baseUrl = venue.website_url

  // og:image
  const og =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
  if (og) {
    const resolved = resolveUrl(og.trim(), baseUrl)
    if (resolved) return { ...base, imageUrl: resolved, source: 'og:image', sourceUrl: baseUrl }
  }

  // twitter:image
  const tw =
    html.match(/<meta[^>]+(?:name|property)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']twitter:image["']/i)?.[1]
  if (tw) {
    const resolved = resolveUrl(tw.trim(), baseUrl)
    if (resolved) return { ...base, imageUrl: resolved, source: 'twitter:image', sourceUrl: baseUrl }
  }

  // First large <img>
  for (const m of html.matchAll(/<img\b[^>]+>/gi)) {
    const tag = m[0]
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]?.trim()
    if (!src || src.startsWith('data:') || SKIP_PATTERN.test(src)) continue
    const w = tag.match(/\bwidth=["']?(\d+)/i)?.[1]
    if (w && parseInt(w, 10) < MIN_IMG_WIDTH) continue
    const resolved = resolveUrl(src, baseUrl)
    if (resolved) return { ...base, imageUrl: resolved, source: 'img-tag', sourceUrl: baseUrl }
  }

  return base
}

// ── Verify image URL ───────────────────────────────────────────────────────────
async function verifyImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method:   'HEAD',
      headers:  { 'User-Agent': OL_UA },
      signal:   AbortSignal.timeout(12_000),
      redirect: 'follow',
    })
    const ct = res.headers.get('content-type') ?? ''
    return res.ok && (ct.startsWith('image/') || ct.includes('octet-stream'))
  } catch {
    return false
  }
}

// ── Apply: download → Storage → DB ────────────────────────────────────────────
async function applyImage(venue: Venue, imageUrl: string): Promise<'ok' | 'skip' | 'error'> {
  if (DRY_RUN) {
    console.log(`   [dry-run] would upload → ${STORAGE_BUCKET}/${venue.slug}.*`)
    return 'skip'
  }

  let buf: Buffer
  let ext: string
  try {
    const res = await fetch(imageUrl, {
      headers: { 'User-Agent': OL_UA },
      signal:  AbortSignal.timeout(TIMEOUT),
      redirect: 'follow',
    })
    if (!res.ok) { console.error(`   ❌ Download HTTP ${res.status}`); return 'error' }
    const ct = res.headers.get('content-type') ?? 'image/jpeg'
    if (!ct.startsWith('image/') && !ct.includes('octet-stream')) {
      console.error(`   ❌ Not an image: ${ct}`); return 'error'
    }
    const arrBuf = await res.arrayBuffer()
    if (arrBuf.byteLength > MAX_BYTES) {
      console.error(`   ❌ Too large: ${(arrBuf.byteLength / 1024 / 1024).toFixed(1)} MB`); return 'error'
    }
    buf = Buffer.from(arrBuf)
    ext = extFromContentType(ct, imageUrl)
    console.log(`   ↓ ${(buf.byteLength / 1024).toFixed(0)} KB (${ext})`)
  } catch (e) {
    console.error(`   ❌ Download error: ${e}`); return 'error'
  }

  const storagePath = `${venue.slug}.${ext}`
  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buf, {
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      upsert: true,
    })

  if (uploadErr) {
    console.error(`   ❌ Storage upload: ${uploadErr.message}`); return 'error'
  }

  const { data: { publicUrl } } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath)

  console.log(`   ↑ ${publicUrl}`)

  const { error: dbErr } = await supabase
    .from('venues')
    .update({ image_url: publicUrl })
    .eq('slug', venue.slug)

  if (dbErr) {
    console.error(`   ❌ DB update: ${dbErr.message}`); return 'error'
  }

  console.log(`   ✅ venues.image_url updated`)
  return 'ok'
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const googleKey = process.env.GOOGLE_PLACES_API_KEY
  if (!googleKey || NO_GOOGLE) {
    console.warn('⚠️   GOOGLE_PLACES_API_KEY not set — Google Maps photos will be skipped.')
  }

  let query = supabase
    .from('venues')
    .select('id, slug, name_en, name_ja, website_url, image_url')
    .order('name_en')

  if (SINGLE_VENUE) {
    query = query.eq('slug', SINGLE_VENUE)
  } else if (!FORCE) {
    query = query.is('image_url', null)
  }

  const { data, error } = await query
  if (error) { console.error('❌  Supabase:', error.message); process.exit(1) }

  let venues = (data ?? []) as Venue[]
  if (venues.length === 0) {
    console.log('✅  No venues to process. Use --force to re-process.')
    return
  }
  if (LIMIT) venues = venues.slice(0, LIMIT)

  const outDir = path.resolve(process.cwd(), 'tmp', 'venue-images')
  fs.mkdirSync(outDir, { recursive: true })

  const mode = APPLY ? (DRY_RUN ? 'apply --dry-run' : 'apply') : 'scan'
  console.log(`\n🏛️   Venue image pipeline — ${venues.length} venue(s) [${mode}]\n`)

  const results: ScanResult[] = []
  let hits = 0, misses = 0, errors = 0, applied = 0, applyErrors = 0

  for (const venue of venues) {
    const suffix = venue.name_ja && venue.name_ja !== venue.name_en ? ` / ${venue.name_ja}` : ''
    console.log(`→  ${venue.name_en}${suffix}  [${venue.slug}]`)

    let result: ScanResult = {
      slug: venue.slug, name_en: venue.name_en,
      imageUrl: null, source: 'none', sourceUrl: null, error: null,
    }

    // 1. Google Places Photos
    const googleUrl = await searchGooglePlaces(venue)
    if (googleUrl) {
      result = { ...result, imageUrl: googleUrl, source: 'google-places', sourceUrl: googleUrl }
    }

    // 2-4. Website fallback
    if (!result.imageUrl) {
      result = await scrapeWebsite(venue)
    }

    // Verify
    if (result.imageUrl) {
      const ok = await verifyImage(result.imageUrl)
      if (!ok) {
        console.log(`   ⚠  URL invalid — skipping`)
        result.imageUrl = null
        result.source   = 'none'
        misses++
      } else {
        console.log(`   🖼  [${result.source}] ${result.imageUrl}`)
        hits++
        if (APPLY) {
          const r = await applyImage(venue, result.imageUrl)
          if (r === 'ok') applied++
          else if (r === 'error') applyErrors++
        }
      }
    } else {
      if (result.error) console.log(`   ⚠  ${result.error}`)
      misses++
      if (!result.error) errors++
    }

    results.push(result)
    console.log()
    await sleep(400)
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('─────────────────────────────────────────────────────')
  console.log(`  Found images:  ${hits}`)
  console.log(`  No image:      ${misses}`)
  console.log(`  Fetch errors:  ${errors}`)
  if (APPLY) {
    console.log(`  Applied:       ${applied}`)
    console.log(`  Apply errors:  ${applyErrors}`)
  }
  const bySource: Record<string, number> = {}
  for (const r of results) bySource[r.source] = (bySource[r.source] ?? 0) + 1
  console.log('  By source:')
  for (const [src, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1]))
    console.log(`    ${src.padEnd(16)} ${n}`)
  console.log('─────────────────────────────────────────────────────\n')

  // report.json
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2))
  console.log(`📄  report.json → ${outDir}/report.json`)

  // miss-list.csv
  const missList = results.filter((r) => !r.imageUrl)
  fs.writeFileSync(
    path.join(outDir, 'miss-list.csv'),
    ['slug,name_en,source,error,override_image_url',
      ...missList.map((r) =>
        [r.slug, `"${r.name_en.replace(/"/g, '""')}"`, r.source,
          `"${(r.error ?? '').replace(/"/g, '""')}"`, ''].join(','),
      ),
    ].join('\n'),
  )
  console.log(`📋  miss-list.csv → ${outDir}/miss-list.csv  (${missList.length} miss(es))`)

  if (!APPLY) console.log('\nRun with --apply to upload and update the DB.\n')
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
