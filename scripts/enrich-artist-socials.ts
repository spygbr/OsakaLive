/**
 * scripts/enrich-artist-socials.ts
 *
 * Social link enrichment for artists that have no instagram_url and no website_url.
 * Run this BEFORE scrape-artist-images.ts — it populates the URLs the image
 * scraper needs to find a profile photo.
 *
 * For each qualifying artist:
 *   1. Ask Claude Haiku if it knows official Instagram / website URLs
 *   2. Validate each returned URL with a real HTTP request
 *   3. UPDATE artists SET instagram_url, website_url WHERE slug = ...
 *
 * Usage:
 *   npx tsx scripts/enrich-artist-socials.ts [--dry-run] [--limit N] [--all]
 *
 * Options:
 *   --dry-run   Print what would be updated; do not write to DB
 *   --limit N   Process only first N artists
 *   --all       Also include artists that have at least one social link already
 *               (default: only targets artists with BOTH instagram_url and
 *               website_url null)
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *   ANTHROPIC_API_KEY=...
 */

import fs   from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

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

// ── Env validation ─────────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const DRY_RUN       = process.argv.includes('--dry-run')
const INCLUDE_ALL   = process.argv.includes('--all')

const limitIdx = process.argv.indexOf('--limit')
const LIMIT: number | null =
  limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : null

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    '❌  Missing Supabase env vars.\n' +
    '    Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}

if (!ANTHROPIC_KEY && !DRY_RUN) {
  console.error(
    '❌  Missing ANTHROPIC_API_KEY.\n' +
    '    Add it to .env.local — get a key from https://console.anthropic.com',
  )
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Config ─────────────────────────────────────────────────────────────────────
const CLAUDE_MODEL    = 'claude-haiku-4-5-20251001'
const REQUEST_DELAY_MS = 600   // stay within rate limits
const MAX_RETRIES     = 3
const FETCH_TIMEOUT_MS = 12_000

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

// ── Helpers ────────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Validates a URL by making a HEAD request (falls back to GET if HEAD fails).
 * Returns true if the server responds with a non-error status.
 */
async function validateUrl(url: string): Promise<boolean> {
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        redirect:  'follow',
        signal:    AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (res.status < 400) return true
      if (method === 'HEAD' && res.status === 405) continue // server rejects HEAD; try GET
      console.log(`   URL validation failed (HTTP ${res.status}): ${url}`)
      return false
    } catch {
      if (method === 'HEAD') continue
      console.log(`   URL validation failed (network error): ${url}`)
      return false
    }
  }
  return false
}

/** Normalise an Instagram URL to the canonical profile form. */
function normaliseInstagram(raw: string): string | null {
  // Accept bare usernames too ("@someband" or "someband")
  try {
    const u = new URL(raw)
    if (!u.hostname.includes('instagram.com')) return null
    return raw.replace(/\/$/, '')    // strip trailing slash
  } catch {
    // Not a full URL — could be a bare username
    const user = raw.replace(/^@/, '').trim()
    if (/^[\w.]+$/.test(user)) return `https://www.instagram.com/${user}/`
    return null
  }
}

// ── Claude API ─────────────────────────────────────────────────────────────────
function buildPrompt(artist: Artist): string {
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
  "notes": "one-line explanation of your confidence and sources"
}`
}

function parseSocialLinks(text: string): SocialLinks | null {
  // Strip any markdown code fences if present
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  // Find the JSON object
  const start = cleaned.indexOf('{')
  const end   = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return null

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    return {
      instagram_url: typeof parsed.instagram_url === 'string' ? parsed.instagram_url : null,
      website_url:   typeof parsed.website_url   === 'string' ? parsed.website_url   : null,
      confidence:    ['high', 'medium', 'low', 'unknown'].includes(parsed.confidence)
        ? parsed.confidence
        : 'unknown',
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    }
  } catch {
    return null
  }
}

async function lookUpSocials(artist: Artist): Promise<SocialLinks | null> {
  const prompt = buildPrompt(artist)
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         ANTHROPIC_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      CLAUDE_MODEL,
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(30_000),
      })

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`HTTP ${response.status}: ${body}`)
      }

      const data = await response.json()
      const text: string = data.content?.[0]?.text ?? ''
      return parseSocialLinks(text)

    } catch (err) {
      lastError = err
      if (attempt < MAX_RETRIES) {
        const backoff = attempt * 1_200
        process.stderr.write(
          `   ⚠  Retry ${attempt}/${MAX_RETRIES} for "${artist.name_en}" (${backoff}ms)...\n`,
        )
        await sleep(backoff)
      }
    }
  }

  console.error(`   ❌  Claude API failed for "${artist.name_en}": ${lastError}`)
  return null
}

// ── Stats ──────────────────────────────────────────────────────────────────────
let total     = 0
let skipped   = 0
let updated   = 0
let noResult  = 0

// ── Per-artist enrichment ──────────────────────────────────────────────────────
async function processArtist(artist: Artist): Promise<void> {
  console.log(`\n→  ${artist.name_en}  [${artist.slug}]`)
  if (artist.name_ja) console.log(`   ja: ${artist.name_ja}`)

  // ── 1. Ask Claude for social links ─────────────────────────────────────────
  if (DRY_RUN) {
    console.log('   [dry-run] would call Claude Haiku')
    skipped++
    return
  }

  const socials = await lookUpSocials(artist)

  if (!socials) {
    console.log('   ⏭  Claude returned no parseable JSON — skipping')
    noResult++
    return
  }

  console.log(`   Claude [${socials.confidence}]: ${socials.notes}`)

  if (socials.confidence === 'unknown' && !socials.instagram_url && !socials.website_url) {
    console.log('   ⏭  Not in Claude training data — skipping')
    noResult++
    return
  }

  // ── 2. Normalise + validate each URL ────────────────────────────────────────
  let instagramValid: string | null = null
  let websiteValid:   string | null = null

  if (socials.instagram_url) {
    const normalised = normaliseInstagram(socials.instagram_url)
    if (normalised) {
      console.log(`   Validating Instagram: ${normalised}`)
      const ok = await validateUrl(normalised)
      if (ok) {
        instagramValid = normalised
        console.log(`   ✓ Instagram confirmed`)
      } else {
        console.log(`   ✗ Instagram URL did not respond — discarding`)
      }
    } else {
      console.log(`   ✗ Could not parse Instagram URL: "${socials.instagram_url}"`)
    }
    await sleep(800)
  }

  if (socials.website_url) {
    console.log(`   Validating website: ${socials.website_url}`)
    const ok = await validateUrl(socials.website_url)
    if (ok) {
      websiteValid = socials.website_url
      console.log(`   ✓ Website confirmed`)
    } else {
      console.log(`   ✗ Website URL did not respond — discarding`)
    }
    await sleep(500)
  }

  // ── 3. Only update if at least one URL was validated ─────────────────────────
  if (!instagramValid && !websiteValid) {
    console.log('   ⏭  No valid URLs to write — skipping')
    noResult++
    return
  }

  const updates: { instagram_url?: string; website_url?: string } = {}
  // Only update columns that are currently null (don't overwrite existing data)
  if (instagramValid && !artist.instagram_url) updates.instagram_url = instagramValid
  if (websiteValid   && !artist.website_url)   updates.website_url   = websiteValid

  if (Object.keys(updates).length === 0) {
    console.log('   ⏭  All found URLs already set in DB — skipping')
    skipped++
    return
  }

  const { error } = await supabase
    .from('artists')
    .update(updates)
    .eq('slug', artist.slug)

  if (error) {
    console.error(`   ❌  DB update failed: ${error.message}`)
    noResult++
    return
  }

  const lines: string[] = []
  if (updates.instagram_url) lines.push(`instagram=${updates.instagram_url}`)
  if (updates.website_url)   lines.push(`website=${updates.website_url}`)
  console.log(`   ✅  Updated: ${lines.join(', ')}`)
  updated++
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Fetch target artists
  let query = supabase
    .from('artists')
    .select('id, slug, name_en, name_ja, instagram_url, website_url, image_url')
    .order('name_en')

  if (!INCLUDE_ALL) {
    // Default: only artists with BOTH social links missing (image scraper would skip them entirely)
    query = query.is('instagram_url', null).is('website_url', null)
  } else {
    // --all: any artist missing at least one social link and no image yet
    query = query.is('image_url', null)
  }

  const { data: artists, error } = await query

  if (error) {
    console.error('❌  Supabase query failed:', error.message)
    process.exit(1)
  }

  if (!artists || artists.length === 0) {
    console.log(
      INCLUDE_ALL
        ? '✅  All artists with missing images already have at least one social link — nothing to do.'
        : '✅  No artists with both instagram_url and website_url missing — nothing to do.\n' +
          '    (Run with --all to also check artists that have one social link but no image)',
    )
    return
  }

  total = LIMIT ? Math.min(artists.length, LIMIT) : artists.length
  const subset = LIMIT ? (artists as Artist[]).slice(0, LIMIT) : (artists as Artist[])

  console.log(
    `\n🔍  Social link enrichment — ${total} artist(s) to process` +
    (DRY_RUN  ? ' [DRY RUN]'  : '') +
    (INCLUDE_ALL ? ' [--all]' : '') +
    '\n',
  )

  for (const artist of subset) {
    await processArtist(artist)
    await sleep(REQUEST_DELAY_MS)
  }

  console.log('\n─────────────────────────────────────────────────────')
  console.log(`🏁  Done`)
  console.log(`   Updated : ${updated}`)
  console.log(`   No data : ${noResult}`)
  console.log(`   Skipped : ${skipped}`)
  console.log('')

  if (updated > 0) {
    console.log(
      '💡  Next step: run the image scraper to fetch profile photos for enriched artists:\n' +
      '    npx tsx scripts/scrape-artist-images.ts\n',
    )
  }

  if (noResult > 0) {
    console.log(
      'ℹ️   For artists with no web presence found, manually set social links:\n' +
      '    UPDATE artists SET instagram_url = \'...\' WHERE slug = \'...\';\n' +
      '    UPDATE artists SET website_url   = \'...\' WHERE slug = \'...\';\n',
    )
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
