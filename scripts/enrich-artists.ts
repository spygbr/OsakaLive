/**
 * scripts/enrich-artists.ts
 *
 * Merged replacement for `enrich-artist-socials.ts` + `scrape-artist-images.ts`.
 * For each qualifying artist, in a single pass:
 *
 *   1. Ask Claude Haiku for official Instagram / website URLs (if missing)
 *   2. Validate each URL with a real HTTP request
 *   3. Reuse the same HTML fetch to extract og:image (Instagram first, website
 *      fallback)
 *   4. Download the image, upload to the `artist-images` Supabase Storage bucket
 *   5. Single UPDATE per artist — writes instagram_url, website_url, image_url
 *      atomically, only filling columns that are currently null
 *
 * Compared to the split scripts this roughly halves runtime and DB round-trips
 * and removes the "forgot to run step 6" failure mode.
 *
 * Usage:
 *   npx tsx scripts/enrich-artists.ts
 *   npx tsx scripts/enrich-artists.ts --dry-run
 *   npx tsx scripts/enrich-artists.ts --limit 20
 *   npx tsx scripts/enrich-artists.ts --slugs slug-a,slug-b   # (used by promote --enrich)
 *   npx tsx scripts/enrich-artists.ts --skip-llm              # only image-scrape existing socials
 *   npx tsx scripts/enrich-artists.ts --skip-image            # only socials
 *
 * Target set (default):
 *   Any artist with image_url = null. If socials are also null, Claude fills
 *   them first; if socials already exist, we skip straight to og:image.
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *   ANTHROPIC_API_KEY=...   (unless --skip-llm)
 */

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { createHaikuClient, type HaikuClient } from '../lib/llm/haiku'

// ── Load .env.local ────────────────────────────────────────────────────────────
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

// ── Env + args ─────────────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

const DRY_RUN    = process.argv.includes('--dry-run')
const SKIP_LLM   = process.argv.includes('--skip-llm')
const SKIP_IMAGE = process.argv.includes('--skip-image')

const limitIdx = process.argv.indexOf('--limit')
const LIMIT: number | null =
  limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : null

const slugsIdx = process.argv.indexOf('--slugs')
const SLUGS: string[] | null =
  slugsIdx !== -1 && process.argv[slugsIdx + 1]
    ? process.argv[slugsIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : null

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
if (!SKIP_LLM && !ANTHROPIC_KEY && !DRY_RUN) {
  console.error('❌  Missing ANTHROPIC_API_KEY (or pass --skip-llm to only scrape existing socials)')
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Config ─────────────────────────────────────────────────────────────────────
const REQUEST_DELAY_MS = 600
const FETCH_TIMEOUT_MS = 15_000
const IG_RATE_DELAY_MS = 2_000
const WEB_RATE_DELAY_MS = 1_000

// Shared Haiku client — lazily instantiated so --dry-run / --skip-llm work without key
let haiku: HaikuClient | null = null
function getHaiku(): HaikuClient {
  if (!haiku) haiku = createHaikuClient({ rateDelayMs: 600 })
  return haiku
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface Artist {
  id:            string
  slug:          string
  name_en:       string
  name_ja:       string | null
  instagram_url: string | null
  website_url:   string | null
  image_url:     string | null
}

interface SocialLinks {
  instagram_url: string | null
  website_url:   string | null
  confidence:    'high' | 'medium' | 'low' | 'unknown'
  notes:         string
}

// ── Utilities ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** Minimal cache: one fetch per URL across the run (IG/website often reused) */
const htmlCache = new Map<string, string | null>()

async function fetchHtml(url: string): Promise<string | null> {
  if (htmlCache.has(url)) return htmlCache.get(url) ?? null
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    })
    if (!res.ok) {
      console.warn(`   ⚠  HTTP ${res.status} for ${url}`)
      htmlCache.set(url, null)
      return null
    }
    const html = await res.text()
    htmlCache.set(url, html)
    return html
  } catch (err) {
    console.warn(`   ⚠  Fetch failed (${url}): ${err instanceof Error ? err.message : err}`)
    htmlCache.set(url, null)
    return null
  }
}

function isLoginWall(html: string): boolean {
  return (
    (html.includes('login') && html.includes('You must log in')) ||
    html.includes('"requiresLogin":true') ||
    (html.length < 8_000 && html.includes('/accounts/login'))
  )
}

const OG_RE1 = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
const OG_RE2 = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
function extractOgImage(html: string): string | null {
  return (OG_RE1.exec(html) ?? OG_RE2.exec(html))?.[1]?.trim() ?? null
}

function normaliseInstagram(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (!u.hostname.includes('instagram.com')) return null
    return raw.replace(/\/$/, '')
  } catch {
    const user = raw.replace(/^@/, '').trim()
    if (/^[\w.]+$/.test(user)) return `https://www.instagram.com/${user}/`
    return null
  }
}

function extFromContentType(ct: string): string {
  if (ct.includes('png'))  return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif'))  return 'gif'
  return 'jpg'
}

async function downloadImage(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      console.warn(`   ⚠  Image HTTP ${res.status}`)
      return null
    }
    return {
      buffer:      Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? 'image/jpeg',
    }
  } catch (err) {
    console.warn(`   ⚠  Image download failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/**
 * Lightweight URL validator — does a HEAD (falls back to GET).
 * For URLs we're about to fetchHtml on anyway, use fetchHtml instead to save
 * a round-trip and let the HTML content be cached for og:image extraction.
 */
async function validateUrl(url: string): Promise<boolean> {
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (res.status < 400) return true
      if (method === 'HEAD' && res.status === 405) continue
      return false
    } catch {
      if (method === 'HEAD') continue
      return false
    }
  }
  return false
}

// ── Claude API ─────────────────────────────────────────────────────────────────
function buildSocialsPrompt(artist: Artist): string {
  const nameJa = artist.name_ja ? ` (Japanese: ${artist.name_ja})` : ''
  return `You are a music industry researcher specialising in Japanese live music.

Artist: "${artist.name_en}"${nameJa}

Do you know the OFFICIAL Instagram profile and/or official website for this artist?
Only provide URLs you are confident about. If you are not sure, return null.

Return ONLY valid JSON — no markdown, no extra text:
{
  "instagram_url": "https://www.instagram.com/..." or null,
  "website_url": "https://..." or null,
  "confidence": "high" | "medium" | "low" | "unknown",
  "notes": "one-line explanation"
}`
}

const isSocialLinks = (x: unknown): x is SocialLinks => {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  const conf = typeof o.confidence === 'string' ? o.confidence : ''
  if (!['high', 'medium', 'low', 'unknown'].includes(conf)) return false
  // instagram_url / website_url can be string or null; notes can be any string
  return true
}

async function lookUpSocials(artist: Artist): Promise<SocialLinks | null> {
  const raw = await getHaiku().askJson<Record<string, unknown>>({
    prompt:    buildSocialsPrompt(artist),
    maxTokens: 300,
    validate:  isSocialLinks,
    label:     'socials',
  })
  if (!raw) return null

  // Normalise — the validator only checks confidence; coerce the rest here
  return {
    instagram_url: typeof raw.instagram_url === 'string' ? raw.instagram_url : null,
    website_url:   typeof raw.website_url   === 'string' ? raw.website_url   : null,
    confidence:    raw.confidence as SocialLinks['confidence'],
    notes:         typeof raw.notes === 'string' ? raw.notes : '',
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────────
const stats = { total: 0, socialsAdded: 0, imagesAdded: 0, noResult: 0, skipped: 0 }

// ── Per-artist ─────────────────────────────────────────────────────────────────
async function processArtist(artist: Artist): Promise<void> {
  console.log(`\n→  ${artist.name_en}  [${artist.slug}]`)

  const updates: { instagram_url?: string; website_url?: string; image_url?: string } = {}

  // ── Phase 1: Social links (LLM) ──────────────────────────────────────────────
  let instagramUrl: string | null = artist.instagram_url
  let websiteUrl:   string | null = artist.website_url

  const needSocials = !instagramUrl && !websiteUrl && !SKIP_LLM
  if (needSocials) {
    if (DRY_RUN) {
      console.log('   [dry-run] would call Claude Haiku for socials')
    } else {
      const socials = await lookUpSocials(artist)
      if (!socials) {
        console.log('   ⏭  No parseable JSON from Claude')
      } else {
        console.log(`   Claude [${socials.confidence}]: ${socials.notes}`)

        // Instagram: normalise, then we'll validate via fetchHtml in phase 2
        if (socials.instagram_url) {
          const norm = normaliseInstagram(socials.instagram_url)
          if (norm) {
            instagramUrl = norm
            updates.instagram_url = norm
          } else {
            console.log(`   ✗ Could not parse IG: ${socials.instagram_url}`)
          }
        }

        // Website: validate with a HEAD now (we'll also fetchHtml later if
        // Instagram fails; the cache ensures we don't double-fetch)
        if (socials.website_url) {
          const ok = await validateUrl(socials.website_url)
          if (ok) {
            websiteUrl = socials.website_url
            updates.website_url = socials.website_url
          } else {
            console.log(`   ✗ Website unreachable: ${socials.website_url}`)
          }
          await sleep(WEB_RATE_DELAY_MS / 2)
        }
      }
    }
  } else if (SKIP_LLM) {
    // noop — just use existing socials
  } else {
    // Already have at least one social — just log
    const which = instagramUrl ? 'IG' : 'web'
    console.log(`   socials already present (${which})`)
  }

  // ── Phase 2: og:image ────────────────────────────────────────────────────────
  // Reuse htmlCache: if we fetched the website above for validation, we won't
  // fetch it again here. If LLM is enabled and returned an IG, this is its
  // first fetch (validation is rolled in — a successful fetch == a live URL).
  if (!SKIP_IMAGE && !artist.image_url) {
    let ogImageUrl: string | null = null
    let sourceUsed = ''

    // Try Instagram first
    if (instagramUrl && !DRY_RUN) {
      console.log(`   IG fetch: ${instagramUrl}`)
      const html = await fetchHtml(instagramUrl)
      await sleep(IG_RATE_DELAY_MS)
      if (html && !isLoginWall(html)) {
        ogImageUrl = extractOgImage(html)
        if (ogImageUrl) sourceUsed = 'instagram'
        else console.log('   no og:image on IG')
      } else if (html && isLoginWall(html)) {
        console.log('   IG login wall — falling back')
      }
      // If the IG URL came from LLM and the fetch succeeded (html !== null),
      // we've now implicitly validated it.
      if (updates.instagram_url && html === null) {
        console.log('   ✗ IG URL from LLM didn\'t respond — dropping from update')
        delete updates.instagram_url
      }
    }

    // Fallback to website
    if (!ogImageUrl && websiteUrl && !DRY_RUN) {
      console.log(`   Web fetch: ${websiteUrl}`)
      const html = await fetchHtml(websiteUrl)
      await sleep(WEB_RATE_DELAY_MS)
      if (html) {
        ogImageUrl = extractOgImage(html)
        if (ogImageUrl) sourceUsed = 'website'
        else console.log('   no og:image on website')
      }
    }

    // Download + upload
    if (ogImageUrl) {
      if (ogImageUrl.startsWith('/')) {
        const base = websiteUrl ?? instagramUrl ?? ''
        try { ogImageUrl = new URL(ogImageUrl, base).href } catch { /* leave */ }
      }
      console.log(`   og:image [${sourceUsed}]`)

      if (!DRY_RUN) {
        const img = await downloadImage(ogImageUrl)
        if (img) {
          const ext = extFromContentType(img.contentType)
          const storagePath = `${artist.slug}.${ext}`
          const { error: upErr } = await supabase.storage
            .from('artist-images')
            .upload(storagePath, img.buffer, { contentType: img.contentType, upsert: true })
          if (upErr) {
            console.error(`   ❌  Storage upload: ${upErr.message}`)
          } else {
            const { data: { publicUrl } } = supabase.storage.from('artist-images').getPublicUrl(storagePath)
            updates.image_url = publicUrl
          }
        }
      }
    }
  }

  // ── Phase 3: Single atomic UPDATE ────────────────────────────────────────────
  // Only write columns that are currently null in DB (don't overwrite)
  const filteredUpdates: typeof updates = {}
  if (updates.instagram_url && !artist.instagram_url) filteredUpdates.instagram_url = updates.instagram_url
  if (updates.website_url   && !artist.website_url)   filteredUpdates.website_url   = updates.website_url
  if (updates.image_url     && !artist.image_url)     filteredUpdates.image_url     = updates.image_url

  if (Object.keys(filteredUpdates).length === 0) {
    console.log('   ⏭  nothing to write')
    stats.noResult++
    return
  }

  if (DRY_RUN) {
    console.log(`   [dry-run] would UPDATE: ${JSON.stringify(filteredUpdates)}`)
    stats.skipped++
    return
  }

  const { error } = await supabase.from('artists').update(filteredUpdates).eq('slug', artist.slug)
  if (error) {
    console.error(`   ❌  DB UPDATE failed: ${error.message}`)
    stats.noResult++
    return
  }

  const summary: string[] = []
  if (filteredUpdates.instagram_url) { summary.push('IG'); stats.socialsAdded++ }
  if (filteredUpdates.website_url)   { summary.push('web'); stats.socialsAdded++ }
  if (filteredUpdates.image_url)     { summary.push('img'); stats.imagesAdded++ }
  console.log(`   ✅  wrote: ${summary.join(', ')}`)
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  let query = supabase
    .from('artists')
    .select('id, slug, name_en, name_ja, instagram_url, website_url, image_url')
    .order('name_en')

  if (SLUGS && SLUGS.length > 0) {
    query = query.in('slug', SLUGS)
  } else {
    // Default target: anyone missing an image (image is the whole point of enrichment)
    query = query.is('image_url', null)
  }

  const { data: artists, error } = await query
  if (error) { console.error('❌  ', error.message); process.exit(1) }
  if (!artists || artists.length === 0) {
    console.log('✅  Nothing to do — no matching artists.')
    return
  }

  const list = (LIMIT ? (artists as Artist[]).slice(0, LIMIT) : artists) as Artist[]
  stats.total = list.length

  console.log(
    `\n🎸  enrich-artists — ${stats.total} artist(s)` +
    (DRY_RUN    ? ' [DRY]'       : '') +
    (SKIP_LLM   ? ' [skip-llm]'  : '') +
    (SKIP_IMAGE ? ' [skip-img]'  : '') +
    (SLUGS      ? ` [slugs=${SLUGS.length}]` : '') +
    '\n',
  )

  for (const a of list) {
    await processArtist(a)
    await sleep(REQUEST_DELAY_MS)
  }

  console.log('\n─────────────────────────────────────────────────────')
  console.log(`🏁  Done — ${stats.socialsAdded} socials, ${stats.imagesAdded} images, ` +
              `${stats.noResult} no-data, ${stats.skipped} skipped`)

  if (!DRY_RUN) haiku?.logCostSummary()
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
