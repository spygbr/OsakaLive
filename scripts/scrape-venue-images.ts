/**
 * scripts/scrape-venue-images.ts
 *
 * Scrapes images for Osaka Live venues from their websites.
 * Sources tried (in order): og:image → twitter:image → first large <img>
 *
 * Usage:
 *   npx tsx scripts/scrape-venue-images.ts              # scan only (read-only)
 *   npx tsx scripts/scrape-venue-images.ts --apply      # upload + update DB
 *   npx tsx scripts/scrape-venue-images.ts --dry-run    # apply without writing
 *   npx tsx scripts/scrape-venue-images.ts --venue drop --apply
 *   npx tsx scripts/scrape-venue-images.ts --force      # re-process existing images
 *   npx tsx scripts/scrape-venue-images.ts --limit 5    # first N venues only
 *
 * Env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL=...     (required)
 *   SUPABASE_SERVICE_ROLE_KEY=...    (required)
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
const APPLY   = process.argv.includes('--apply')
const DRY_RUN = process.argv.includes('--dry-run')
const FORCE   = process.argv.includes('--force')

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
const OL_UA    = 'OsakaLive/0.1 (https://osaka-live.net; diku@genkanconsulting.com)'
const MAX_BYTES = 10 * 1024 * 1024   // 10 MB
const TIMEOUT   = 20_000             // 20 s per fetch
const MIN_IMG_WIDTH = 300            // pixels — ignore tiny images / icons
const STORAGE_BUCKET = 'venue-images'
const STORAGE_PREFIX = ''

// ── Types ──────────────────────────────────────────────────────────────────────
interface Venue {
  id:          string
  slug:        string
  name_en:     string
  name_ja:     string
  website_url: string | null
  image_url:   string | null
}

interface ScanResult {
  slug:       string
  name_en:    string
  imageUrl:   string | null
  source:     'og:image' | 'twitter:image' | 'img-tag' | 'none'
  sourceUrl:  string | null
  error:      string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function extFromContentType(ct: string, url: string): string {
  if (ct.includes('png'))  return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif'))  return 'gif'
  const m = url.match(/\.(\w{3,4})(?:\?|$)/)
  if (m) return m[1].toLowerCase()
  return 'jpg'
}

/** Resolve a potentially relative URL against a base. */
function resolveUrl(raw: string, base: string): string | null {
  try {
    return new URL(raw, base).href
  } catch {
    return null
  }
}

/** Strip HTML tags for cleaner text extraction. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

// ── Website scraper ────────────────────────────────────────────────────────────
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
        'User-Agent': OL_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.5',
      },
      signal:   AbortSignal.timeout(TIMEOUT),
      redirect: 'follow',
    })
    if (!res.ok) {
      base.error = `HTTP ${res.status}`
      return base
    }
    html = await res.text()
  } catch (e) {
    base.error = String(e).slice(0, 120)
    return base
  }

  const finalUrl = venue.website_url  // after redirects; simplification

  // 1. og:image
  const ogMatch =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)

  if (ogMatch?.[1]) {
    const resolved = resolveUrl(ogMatch[1].trim(), finalUrl)
    if (resolved) {
      base.imageUrl  = resolved
      base.source    = 'og:image'
      base.sourceUrl = finalUrl
      return base
    }
  }

  // 2. twitter:image
  const twMatch =
    html.match(/<meta[^>]+(?:name|property)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']twitter:image["']/i)

  if (twMatch?.[1]) {
    const resolved = resolveUrl(twMatch[1].trim(), finalUrl)
    if (resolved) {
      base.imageUrl  = resolved
      base.source    = 'twitter:image'
      base.sourceUrl = finalUrl
      return base
    }
  }

  // 3. First <img> with a width hint ≥ MIN_IMG_WIDTH or no width (assume large)
  //    Skip images whose src contains: icon, logo, favicon, sprite, pixel, blank
  const SKIP_PATTERN = /icon|logo|favicon|sprite|pixel|blank|loading|placeholder/i
  const imgMatches = [...html.matchAll(/<img\b[^>]+>/gi)]

  for (const m of imgMatches) {
    const tag = m[0]

    // Extract src
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i)
    if (!srcMatch) continue
    const src = srcMatch[1].trim()
    if (!src || src.startsWith('data:')) continue
    if (SKIP_PATTERN.test(src)) continue

    // Try width attribute/style hint — only skip if explicitly small
    const widthAttr = tag.match(/\bwidth=["']?(\d+)/i)?.[1]
    if (widthAttr && parseInt(widthAttr, 10) < MIN_IMG_WIDTH) continue

    const resolved = resolveUrl(src, finalUrl)
    if (!resolved) continue

    base.imageUrl  = resolved
    base.source    = 'img-tag'
    base.sourceUrl = finalUrl
    return base
  }

  return base
}

// ── Verify image URL actually returns an image ─────────────────────────────────
async function verifyImage(url: string): Promise<{ ok: boolean; ct: string; size: number }> {
  try {
    const res = await fetch(url, {
      method:  'HEAD',
      headers: { 'User-Agent': OL_UA },
      signal:  AbortSignal.timeout(12_000),
      redirect: 'follow',
    })
    if (!res.ok) return { ok: false, ct: '', size: 0 }
    const ct   = res.headers.get('content-type') ?? ''
    const size = parseInt(res.headers.get('content-length') ?? '0', 10)
    return { ok: ct.startsWith('image/') || ct.includes('octet-stream'), ct, size }
  } catch {
    return { ok: false, ct: '', size: 0 }
  }
}

// ── Apply: download → Storage → DB ────────────────────────────────────────────
async function applyImage(venue: Venue, imageUrl: string): Promise<'ok' | 'skip' | 'error'> {
  if (DRY_RUN) {
    console.log(`   [dry-run] would upload ${imageUrl} → ${STORAGE_BUCKET}/${venue.slug}.*`)
    return 'skip'
  }

  // Download
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
      console.error(`   ❌ Not an image: ${ct}`)
      return 'error'
    }
    const arrBuf = await res.arrayBuffer()
    if (arrBuf.byteLength > MAX_BYTES) {
      console.error(`   ❌ Too large: ${(arrBuf.byteLength / 1024 / 1024).toFixed(1)} MB`)
      return 'error'
    }
    buf = Buffer.from(arrBuf)
    ext = extFromContentType(ct, imageUrl)
    console.log(`   ↓ ${(buf.byteLength / 1024).toFixed(0)} KB (${ext})`)
  } catch (e) {
    console.error(`   ❌ Download error: ${e}`)
    return 'error'
  }

  // Upload to Supabase Storage
  const storagePath = STORAGE_PREFIX ? `${STORAGE_PREFIX}/${venue.slug}.${ext}` : `${venue.slug}.${ext}`
  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buf, {
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      upsert: true,
    })

  if (uploadErr) {
    console.error(`   ❌ Storage upload: ${uploadErr.message}`)
    return 'error'
  }

  const { data: { publicUrl } } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath)

  console.log(`   ↑ Storage: ${publicUrl}`)

  // Update DB
  const { error: dbErr } = await supabase
    .from('venues')
    .update({ image_url: publicUrl })
    .eq('slug', venue.slug)

  if (dbErr) {
    console.error(`   ❌ DB update: ${dbErr.message}`)
    return 'error'
  }

  console.log(`   ✅ venues.image_url updated`)
  return 'ok'
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
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
  if (error) {
    console.error('❌  Supabase query failed:', error.message)
    process.exit(1)
  }

  let venues = (data ?? []) as Venue[]
  if (venues.length === 0) {
    console.log('✅  No venues to process. Use --force to re-process existing images.')
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
    if (venue.website_url) console.log(`   🌐 ${venue.website_url}`)

    const result = await scrapeWebsite(venue)

    if (result.error && !result.imageUrl) {
      console.log(`   ⚠  ${result.error}`)
      errors++
    }

    if (result.imageUrl) {
      // Verify it's actually an image
      const { ok, ct } = await verifyImage(result.imageUrl)
      if (!ok) {
        console.log(`   ⚠  URL not a valid image (${ct || 'no content-type'}) — skipping`)
        result.imageUrl = null
        result.source   = 'none'
        misses++
      } else {
        console.log(`   🖼  [${result.source}] ${result.imageUrl}`)
        hits++

        if (APPLY) {
          const applyResult = await applyImage(venue, result.imageUrl)
          if (applyResult === 'ok') applied++
          else if (applyResult === 'error') applyErrors++
        }
      }
    } else {
      misses++
    }

    results.push(result)
    console.log()
    await sleep(500)  // polite delay between sites
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
  console.log('─────────────────────────────────────────────────────')

  // Source breakdown
  const bySource: Record<string, number> = {}
  for (const r of results) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1
  }
  console.log('  By source:')
  for (const [src, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${src.padEnd(16)} ${n}`)
  }
  console.log('─────────────────────────────────────────────────────\n')

  // ── report.json ───────────────────────────────────────────────────────────
  const reportPath = path.join(outDir, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`📄  report.json → ${reportPath}`)

  // ── miss-list.csv — fill in override_image_url and run with --apply ───────
  const missPath = path.join(outDir, 'miss-list.csv')
  const missList = results.filter((r) => !r.imageUrl)
  const csvLines = [
    'slug,name_en,source,error,override_image_url',
    ...missList.map((r) =>
      [
        r.slug,
        `"${r.name_en.replace(/"/g, '""')}"`,
        r.source,
        `"${(r.error ?? '').replace(/"/g, '""')}"`,
        '',
      ].join(','),
    ),
  ]
  fs.writeFileSync(missPath, csvLines.join('\n'))
  console.log(`📋  miss-list.csv → ${missPath}  (${missList.length} miss(es))`)

  if (!APPLY) {
    console.log('\nRun with --apply to upload images to Supabase Storage and update the DB.\n')
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
