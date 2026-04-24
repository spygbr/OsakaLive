/**
 * scripts/spotify-image-poc.ts
 *
 * Proof-of-concept: replace og:image-based artist image enrichment with the
 * Spotify Web API. For every artist in the DB, search Spotify, pick the best
 * match, report back whether Spotify returned a usable artist photo.
 *
 * This script is READ-ONLY by default — it does NOT write to Supabase or
 * download any files. It just prints a hit-rate table so we can decide whether
 * Spotify is worth making the primary source.
 *
 * Pass --download to actually pull the images to ./tmp/spotify-poc/ for visual
 * spot-check (still does not touch Supabase Storage or the artists table).
 *
 * Usage:
 *   npx tsx scripts/spotify-image-poc.ts [--download] [--limit N] [--force]
 *
 * --force: also test artists that already have image_url set (useful to see
 *          whether Spotify would give a better photo than the current og:image).
 *
 * Env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *   SPOTIFY_CLIENT_ID=...
 *   SPOTIFY_CLIENT_SECRET=...
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

// ── Args & env ─────────────────────────────────────────────────────────────────
const DOWNLOAD = process.argv.includes('--download')
const FORCE    = process.argv.includes('--force')
const limitIdx = process.argv.indexOf('--limit')
const LIMIT: number | null =
  limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : null

const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY
const SPOTIFY_ID     = process.env.SPOTIFY_CLIENT_ID
const SPOTIFY_SECRET = process.env.SPOTIFY_CLIENT_SECRET

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
if (!SPOTIFY_ID || !SPOTIFY_SECRET) {
  console.error(
    '❌  Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in .env.local\n' +
    '    Create an app at https://developer.spotify.com/dashboard to get them.',
  )
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Types ──────────────────────────────────────────────────────────────────────
interface Artist {
  id:       string
  slug:     string
  name_en:  string
  name_ja:  string | null
  image_url: string | null
  genre_id: string | null
}

interface SpotifyArtist {
  id:          string
  name:        string
  genres:      string[]
  popularity:  number
  followers:   { total: number }
  images:      { url: string; width: number; height: number }[]
  external_urls: { spotify: string }
}

interface PocResult {
  slug:         string
  name_en:      string
  name_ja:      string | null
  verdict:      'hit' | 'ambiguous' | 'miss' | 'error'
  matchName?:   string
  matchScore?:  number
  imageUrl?:    string
  imageW?:      number
  imageH?:      number
  popularity?:  number
  followers?:   number
  spotifyUrl?:  string
  reason?:      string
  candidates?:  number
}

// ── Spotify OAuth (client-credentials flow) ────────────────────────────────────
let cachedToken: { value: string; expiresAt: number } | null = null

async function getSpotifyToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 10_000) {
    return cachedToken.value
  }

  const auth = Buffer.from(`${SPOTIFY_ID}:${SPOTIFY_SECRET}`).toString('base64')
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`Spotify token HTTP ${res.status}: ${await res.text()}`)

  const json = await res.json() as { access_token: string; expires_in: number }
  cachedToken = {
    value:     json.access_token,
    expiresAt: Date.now() + json.expires_in * 1_000,
  }
  return cachedToken.value
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Normalise an artist name for fuzzy comparison. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u3000\s]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
}

/** Classic Levenshtein distance (small-string, no perf concerns here). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const v0 = new Array(b.length + 1).fill(0).map((_, i) => i)
  const v1 = new Array(b.length + 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost)
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j]
  }
  return v1[b.length]
}

/**
 * Score a Spotify candidate against our artist record.
 * Returns 0..1 where ≥ 0.9 is confident, 0.7..0.9 is probably correct,
 * < 0.7 should be treated as a miss.
 */
function scoreMatch(artist: Artist, cand: SpotifyArtist): number {
  const candN  = norm(cand.name)
  const enN    = norm(artist.name_en)
  const jaN    = artist.name_ja ? norm(artist.name_ja) : ''

  // Exact match on either script → 1.0
  if (candN === enN || (jaN && candN === jaN)) return 1

  // Substring match → 0.85
  if (candN.includes(enN) || enN.includes(candN)) return 0.85
  if (jaN && (candN.includes(jaN) || jaN.includes(candN))) return 0.85

  // Levenshtein against the shorter of the two names
  const target = enN.length <= (jaN.length || Infinity) ? enN : jaN
  if (!target) return 0
  const dist = levenshtein(candN, target)
  const maxLen = Math.max(candN.length, target.length)
  const ratio = 1 - dist / maxLen

  // Below 0.7 similarity → not a match
  return ratio >= 0.7 ? ratio * 0.8 : 0 // cap fuzzy matches at 0.8
}

// ── Spotify search ─────────────────────────────────────────────────────────────
async function searchSpotify(query: string): Promise<SpotifyArtist[]> {
  const token = await getSpotifyToken()
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=10&market=JP`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal:  AbortSignal.timeout(15_000),
  })
  if (res.status === 429) {
    const retry = parseInt(res.headers.get('retry-after') ?? '2', 10)
    console.warn(`   ⏳  Spotify 429 — sleeping ${retry}s`)
    await sleep(retry * 1_000)
    return searchSpotify(query)
  }
  if (!res.ok) throw new Error(`Spotify search HTTP ${res.status}`)
  const json = await res.json() as { artists: { items: SpotifyArtist[] } }
  return json.artists?.items ?? []
}

/** Search by English name, then fall back to JP name if no good hit. */
async function findBestMatch(artist: Artist): Promise<{
  best: SpotifyArtist | null
  score: number
  totalCandidates: number
  ambiguous: boolean
}> {
  const queries = [artist.name_en]
  if (artist.name_ja && artist.name_ja !== artist.name_en) queries.push(artist.name_ja)

  const seen = new Map<string, SpotifyArtist>()
  for (const q of queries) {
    const results = await searchSpotify(q)
    for (const r of results) seen.set(r.id, r)
    await sleep(120) // stay well under 180 req/min
  }

  const all = [...seen.values()]
  if (all.length === 0) {
    return { best: null, score: 0, totalCandidates: 0, ambiguous: false }
  }

  // Score each candidate
  const scored = all
    .map((c) => ({ cand: c, score: scoreMatch(artist, c) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // Tiebreaker: popularity (real artists beat namesake amateurs)
      return b.cand.popularity - a.cand.popularity
    })

  if (scored.length === 0) {
    return { best: null, score: 0, totalCandidates: all.length, ambiguous: false }
  }

  const top = scored[0]
  // Ambiguous if multiple candidates tied at top score AND similar popularity
  const ambiguous =
    scored.length > 1 &&
    scored[1].score >= top.score - 0.05 &&
    Math.abs(scored[1].cand.popularity - top.cand.popularity) < 10

  return {
    best:            top.cand,
    score:           top.score,
    totalCandidates: all.length,
    ambiguous,
  }
}

// ── Optional download ──────────────────────────────────────────────────────────
async function downloadForSpotCheck(artist: Artist, cand: SpotifyArtist): Promise<void> {
  const img = cand.images[0]
  if (!img) return
  const outDir = path.resolve(process.cwd(), 'tmp', 'spotify-poc')
  fs.mkdirSync(outDir, { recursive: true })
  try {
    const res = await fetch(img.url, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(path.join(outDir, `${artist.slug}.jpg`), buf)
  } catch {
    // Non-fatal for a POC
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  let query = supabase
    .from('artists')
    .select('id, slug, name_en, name_ja, image_url, genre_id')
    .order('name_en')

  if (!FORCE) query = query.is('image_url', null)

  const { data, error } = await query
  if (error) {
    console.error('❌  Supabase query failed:', error.message)
    process.exit(1)
  }

  const artists = (data ?? []) as Artist[]
  if (artists.length === 0) {
    console.log('✅  No artists to test (all have image_url, or DB is empty).')
    console.log('    Pass --force to re-test artists that already have image_url.')
    return
  }

  const subset = LIMIT ? artists.slice(0, LIMIT) : artists
  console.log(
    `\n🎧  Spotify image POC — ${subset.length} artist(s)` +
    (DOWNLOAD ? ' [will download]' : ' [read-only]') +
    (FORCE    ? ' [--force]'       : '') +
    '\n',
  )

  const results: PocResult[] = []

  for (const a of subset) {
    const jaSuffix = a.name_ja && a.name_ja !== a.name_en ? ` / ${a.name_ja}` : ''
    process.stdout.write(`→  ${a.name_en}${jaSuffix}  [${a.slug}]  `)

    try {
      const { best, score, totalCandidates, ambiguous } = await findBestMatch(a)

      if (!best) {
        console.log('MISS  (no candidates)')
        results.push({
          slug: a.slug, name_en: a.name_en, name_ja: a.name_ja,
          verdict: 'miss', reason: 'no search results', candidates: totalCandidates,
        })
        continue
      }

      const hasImage = best.images.length > 0 && best.images[0].width >= 200
      if (!hasImage) {
        console.log(`MISS  (matched "${best.name}" score=${score.toFixed(2)} but no usable image)`)
        results.push({
          slug: a.slug, name_en: a.name_en, name_ja: a.name_ja,
          verdict:    'miss',
          matchName:  best.name,
          matchScore: score,
          reason:     'no image on Spotify artist',
          candidates: totalCandidates,
        })
        continue
      }

      if (ambiguous || score < 0.7) {
        console.log(
          `AMBIG  "${best.name}" score=${score.toFixed(2)} pop=${best.popularity} ` +
          `(${totalCandidates} candidates, tied at top)`,
        )
        results.push({
          slug: a.slug, name_en: a.name_en, name_ja: a.name_ja,
          verdict:     'ambiguous',
          matchName:   best.name,
          matchScore:  score,
          imageUrl:    best.images[0].url,
          imageW:      best.images[0].width,
          imageH:      best.images[0].height,
          popularity:  best.popularity,
          followers:   best.followers.total,
          spotifyUrl:  best.external_urls.spotify,
          candidates:  totalCandidates,
        })
        continue
      }

      const img = best.images[0]
      console.log(
        `HIT   "${best.name}" score=${score.toFixed(2)} pop=${best.popularity} ` +
        `img=${img.width}x${img.height}`,
      )
      results.push({
        slug: a.slug, name_en: a.name_en, name_ja: a.name_ja,
        verdict:    'hit',
        matchName:  best.name,
        matchScore: score,
        imageUrl:   img.url,
        imageW:     img.width,
        imageH:     img.height,
        popularity: best.popularity,
        followers:  best.followers.total,
        spotifyUrl: best.external_urls.spotify,
        candidates: totalCandidates,
      })

      if (DOWNLOAD) await downloadForSpotCheck(a, best)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`ERROR (${msg})`)
      results.push({
        slug: a.slug, name_en: a.name_en, name_ja: a.name_ja,
        verdict: 'error', reason: msg,
      })
    }

    await sleep(150)
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const hits       = results.filter((r) => r.verdict === 'hit').length
  const ambig      = results.filter((r) => r.verdict === 'ambiguous').length
  const misses     = results.filter((r) => r.verdict === 'miss').length
  const errors     = results.filter((r) => r.verdict === 'error').length
  const pct = (n: number) => ((n / results.length) * 100).toFixed(0)

  console.log('\n─────────────────────────────────────────────────────')
  console.log(`  HIT        ${hits.toString().padStart(3)}  (${pct(hits)}%)`)
  console.log(`  AMBIGUOUS  ${ambig.toString().padStart(3)}  (${pct(ambig)}%) — needs manual review`)
  console.log(`  MISS       ${misses.toString().padStart(3)}  (${pct(misses)}%)`)
  console.log(`  ERROR      ${errors.toString().padStart(3)}  (${pct(errors)}%)`)
  console.log('─────────────────────────────────────────────────────')

  // Dump full JSON report for later inspection
  const reportDir = path.resolve(process.cwd(), 'tmp', 'spotify-poc')
  fs.mkdirSync(reportDir, { recursive: true })
  const reportPath = path.join(reportDir, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`\n📄  Full report: ${reportPath}`)
  if (DOWNLOAD) {
    console.log(`🖼   Sample images: ${reportDir}/*.jpg — spot-check visually before trusting.`)
  }

  // Guidance
  const highConfRate = hits / results.length
  console.log('')
  if (highConfRate >= 0.7) {
    console.log('✅  Spotify hit rate is strong — promote it to primary source in the real enrichment script.')
  } else if (highConfRate >= 0.4) {
    console.log('🟡  Moderate hit rate — Spotify is worth using as tier 1, but add Apple Music + Wikidata as tier 2/3.')
  } else {
    console.log('🔴  Low hit rate — most artists are too underground for Spotify. Prioritise Bandcamp + unavatar instead.')
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
