/**
 * scripts/scrape-artist-images.ts
 *
 * One-time artist image enrichment pipeline.
 *
 * For each artist with image_url = null:
 *   1. Try instagram_url first (og:image), then website_url
 *   2. Extract og:image meta tag from the HTML
 *   3. Download the image buffer
 *   4. Upload to Supabase Storage bucket 'artist-images'
 *   5. UPDATE artists SET image_url = <public CDN URL> WHERE slug = ...
 *
 * Usage:
 *   npx tsx scripts/scrape-artist-images.ts
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Before running, create a public bucket called 'artist-images' in the
 * Supabase dashboard: Storage → New bucket → Name: artist-images → Public ✓
 */

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../lib/supabase/types'

// ── Load .env.local ───────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (m) {
      const key = m[1].trim()
      const val = m[2].trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  }
}

// ── Supabase admin client (SERVICE_ROLE — server-side only) ───────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    '❌  Missing env vars.\n' +
    '   Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── og:image regex variants ───────────────────────────────────────────────────
// property before content
const OG_RE1 = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
// content before property
const OG_RE2 = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Returns true when Instagram is serving a login wall instead of real content. */
function isLoginWall(html: string): boolean {
  return (
    (html.includes('login') && html.includes('You must log in')) ||
    html.includes('"requiresLogin":true') ||
    (html.length < 8_000 && html.includes('/accounts/login'))
  )
}

/** Fetches a URL and returns the HTML string, or null on failure. */
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8',
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    })
    if (!res.ok) {
      console.warn(`  ⚠  HTTP ${res.status} for ${url}`)
      return null
    }
    return await res.text()
  } catch (err) {
    console.warn(`  ⚠  Fetch failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/** Extracts the og:image URL from an HTML string. */
function extractOgImage(html: string): string | null {
  return (OG_RE1.exec(html) ?? OG_RE2.exec(html))?.[1]?.trim() ?? null
}

/** Downloads an image and returns its Buffer + content-type. */
async function downloadImage(
  url: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      console.warn(`  ⚠  Image download HTTP ${res.status} for ${url}`)
      return null
    }
    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    const buffer = Buffer.from(await res.arrayBuffer())
    return { buffer, contentType }
  } catch (err) {
    console.warn(`  ⚠  Image download failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/** Maps a content-type header to a file extension. */
function extFromContentType(ct: string): string {
  if (ct.includes('png'))  return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif'))  return 'gif'
  return 'jpg'
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function main() {
  const { data: artists, error } = await supabase
    .from('artists')
    .select('id, slug, name_en, instagram_url, website_url, image_url')
    .is('image_url', null)
    .order('name_en')

  if (error) {
    console.error('❌  Supabase query failed:', error.message)
    process.exit(1)
  }

  if (!artists || artists.length === 0) {
    console.log('✅  All artists already have image_url set — nothing to do.')
    return
  }

  console.log(`\n🎸  Artist image scraper — ${artists.length} artist(s) with no image\n`)

  let succeeded = 0
  let skipped   = 0

  for (const artist of artists) {
    console.log(`→  ${artist.name_en}  [${artist.slug}]`)

    let ogImageUrl: string | null = null
    let sourceUsed = ''

    // ── 1. Try Instagram ──────────────────────────────────────────────────────
    if (artist.instagram_url) {
      console.log(`   Trying Instagram: ${artist.instagram_url}`)
      const html = await fetchHtml(artist.instagram_url)
      await sleep(2_000) // respect Instagram rate limits

      if (html && !isLoginWall(html)) {
        ogImageUrl = extractOgImage(html)
        if (ogImageUrl) {
          sourceUsed = 'instagram'
        } else {
          console.log('   No og:image on Instagram page')
        }
      } else {
        console.log('   Instagram login wall or fetch failed — falling back to website')
      }
    }

    // ── 2. Fallback to official website ───────────────────────────────────────
    if (!ogImageUrl && artist.website_url) {
      console.log(`   Trying website: ${artist.website_url}`)
      const html = await fetchHtml(artist.website_url)
      await sleep(1_000)

      if (html) {
        ogImageUrl = extractOgImage(html)
        if (ogImageUrl) {
          sourceUsed = 'website'
        } else {
          console.log('   No og:image on website')
        }
      }
    }

    // ── 3. Skip if no image found ─────────────────────────────────────────────
    if (!ogImageUrl) {
      console.log(`   ⏭  Skipping — no og:image found\n`)
      skipped++
      continue
    }

    // Resolve relative URLs (e.g. /images/cover.jpg → https://example.com/images/cover.jpg)
    if (ogImageUrl.startsWith('/')) {
      const base = artist.website_url ?? artist.instagram_url ?? ''
      try {
        ogImageUrl = new URL(ogImageUrl, base).href
      } catch {
        // leave as-is if URL construction fails
      }
    }

    console.log(`   og:image [${sourceUsed}]: ${ogImageUrl.slice(0, 80)}${ogImageUrl.length > 80 ? '…' : ''}`)

    // ── 4. Download image ─────────────────────────────────────────────────────
    const img = await downloadImage(ogImageUrl)
    if (!img) {
      console.log(`   ⏭  Skipping — image download failed\n`)
      skipped++
      continue
    }

    // ── 5. Upload to Supabase Storage ─────────────────────────────────────────
    const ext         = extFromContentType(img.contentType)
    const storagePath = `${artist.slug}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('artist-images')
      .upload(storagePath, img.buffer, {
        contentType: img.contentType,
        upsert: true,
      })

    if (uploadError) {
      console.error(`   ❌  Storage upload failed: ${uploadError.message}\n`)
      skipped++
      continue
    }

    // ── 6. Get public CDN URL ─────────────────────────────────────────────────
    const { data: { publicUrl } } = supabase.storage
      .from('artist-images')
      .getPublicUrl(storagePath)

    // ── 7. Write back to artists table ────────────────────────────────────────
    const { error: updateError } = await supabase
      .from('artists')
      .update({ image_url: publicUrl })
      .eq('slug', artist.slug)

    if (updateError) {
      console.error(`   ❌  DB update failed: ${updateError.message}\n`)
      skipped++
    } else {
      console.log(`   ✅  ${publicUrl}\n`)
      succeeded++
    }
  }

  console.log(`\n🏁  Done — ${succeeded} enriched, ${skipped} skipped.\n`)
  if (skipped > 0) {
    console.log(
      'ℹ️   For skipped artists, manually upload an image to the\n' +
      '    "artist-images" Supabase Storage bucket and run:\n\n' +
      '    UPDATE artists SET image_url = \'<CDN_URL>\' WHERE slug = \'<slug\';\n',
    )
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
