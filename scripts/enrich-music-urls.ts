/**
 * scripts/enrich-music-urls.ts
 *
 * Finds and writes music_url for artists where it is NULL.
 * Searches Spotify, Bandcamp, Deezer, and Apple Music in parallel,
 * scores each hit by name similarity, then picks the best match
 * from the highest-priority platform.
 *
 * Platform priority (highest → lowest):
 *   1. Spotify      https://open.spotify.com/artist/{id}
 *   2. Bandcamp     https://{handle}.bandcamp.com
 *   3. Deezer       https://www.deezer.com/artist/{id}
 *   4. Apple Music  https://music.apple.com/... (iTunes artistLinkUrl)
 *
 * Usage:
 *   npx tsx scripts/enrich-music-urls.ts
 *   npx tsx scripts/enrich-music-urls.ts --dry-run
 *   npx tsx scripts/enrich-music-urls.ts --limit 20
 *   npx tsx scripts/enrich-music-urls.ts --slugs slug-a,slug-b
 *   npx tsx scripts/enrich-music-urls.ts --force        # overwrite existing music_url
 *   npx tsx scripts/enrich-music-urls.ts --sources spotify,bandcamp
 *   npx tsx scripts/enrich-music-urls.ts --threshold 0.65
 *
 * Env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL=...      (required)
 *   SUPABASE_SERVICE_ROLE_KEY=...     (required)
 *   SPOTIFY_CLIENT_ID=...             (optional; enables Spotify)
 *   SPOTIFY_CLIENT_SECRET=...         (optional)
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
const DRY_RUN = process.argv.includes('--dry-run')
const FORCE   = process.argv.includes('--force')

const limitIdx = process.argv.indexOf('--limit')
const LIMIT: number | null = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : null

const slugsIdx = process.argv.indexOf('--slugs')
const SLUGS: string[] | null =
  slugsIdx !== -1 && process.argv[slugsIdx + 1]
    ? process.argv[slugsIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : null

const threshIdx = process.argv.indexOf('--threshold')
const THRESHOLD: number = threshIdx !== -1 ? parseFloat(process.argv[threshIdx + 1]) : 0.70

type Source = 'spotify' | 'bandcamp' | 'deezer' | 'applemusic'
const ALL_SOURCES: Source[] = ['spotify', 'bandcamp', 'deezer', 'applemusic']

const srcIdx = process.argv.indexOf('--sources')
const ENABLED_SOURCES: Set<Source> = new Set<Source>(
  (srcIdx !== -1
    ? (process.argv[srcIdx + 1].split(',').map((s) => s.trim()) as Source[])
    : ALL_SOURCES
  ).filter(Boolean),
)

// ── Supabase ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Types ──────────────────────────────────────────────────────────────────────
interface Artist {
  id:        string
  slug:      string
  name_en:   string
  name_ja:   string | null
  music_url: string | null
}

interface MusicHit {
  source:    Source
  url:       string
  matchName: string
  nameScore: number
}

// ── Utilities ──────────────────────────────────────────────────────────────────
const OL_UA = 'OsakaLive/0.1 (https://osaka.live; diku@genkanconsulting.com)'
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function norm(s: string): string {
  return s.toLowerCase().normalize('NFKC')
    .replace(/[　\s]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
}

function stripParens(s: string): string {
  return s.replace(/\s*\(.*?\)\s*/g, '').trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const v0 = Array.from({ length: b.length + 1 }, (_, i) => i)
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

function scoreName(artist: Artist, candidate: string): number {
  const c  = norm(candidate)
  const en = norm(artist.name_en)
  const ja = artist.name_ja ? norm(artist.name_ja) : ''
  if (!c) return 0
  if (c === en || (ja && c === ja))             return 1
  if (c.includes(en) || en.includes(c))         return 0.85
  if (ja && (c.includes(ja) || ja.includes(c))) return 0.85
  const target = (!ja || en.length <= ja.length) ? en : ja
  if (!target) return 0
  const ratio = 1 - levenshtein(c, target) / Math.max(c.length, target.length)
  return ratio >= 0.7 ? ratio * 0.8 : 0
}

function queryVariants(artist: Artist): string[] {
  const variants = [artist.name_en]
  const stripped = stripParens(artist.name_en)
  if (stripped && stripped !== artist.name_en) variants.push(stripped)
  if (artist.name_ja && artist.name_ja !== artist.name_en) variants.push(artist.name_ja)
  return [...new Set(variants)]
}

// ── Platform priority (lower index = higher priority) ─────────────────────────
const SOURCE_PRIORITY: Source[] = ['spotify', 'bandcamp', 'deezer', 'applemusic']

// ── Spotify ────────────────────────────────────────────────────────────────────
let _spotifyToken: string | null = null
async function getSpotifyToken(): Promise<string | null> {
  if (_spotifyToken) return _spotifyToken
  const cid = process.env.SPOTIFY_CLIENT_ID
  const sec = process.env.SPOTIFY_CLIENT_SECRET
  if (!cid || !sec) {
    console.log('   [spotify] skipped — SPOTIFY_CLIENT_ID/SECRET not set in .env.local')
    return null
  }
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${cid}:${sec}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const json = await res.json() as { access_token?: string }
    _spotifyToken = json.access_token ?? null
    if (_spotifyToken) console.log('   [spotify] ✓ token acquired')
    return _spotifyToken
  } catch { return null }
}

async function searchSpotify(artist: Artist): Promise<MusicHit[]> {
  const token = await getSpotifyToken()
  if (!token) return []
  type SpotifyArtist = { id: string; name: string; popularity: number }
  const seen = new Set<string>()
  const hits: MusicHit[] = []
  for (const q of queryVariants(artist)) {
    for (const market of ['JP', ''] as const) {
      try {
        const params = new URLSearchParams({ q, type: 'artist', limit: '5', ...(market ? { market } : {}) })
        const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(12_000),
        })
        if (!res.ok) continue
        const json = await res.json() as { artists?: { items: SpotifyArtist[] } }
        for (const a of json.artists?.items ?? []) {
          if (seen.has(a.id)) continue
          const ns = scoreName(artist, a.name)
          if (ns === 0) continue
          seen.add(a.id)
          hits.push({
            source:    'spotify',
            url:       `https://open.spotify.com/artist/${a.id}`,
            matchName: a.name,
            nameScore: ns,
          })
        }
      } catch { /* swallow */ }
      await sleep(200)
    }
  }
  return hits
}

// ── Bandcamp ───────────────────────────────────────────────────────────────────
async function searchBandcamp(artist: Artist): Promise<MusicHit[]> {
  const hits: MusicHit[] = []
  for (const q of queryVariants(artist)) {
    try {
      const searchRes = await fetch(
        `https://bandcamp.com/search?q=${encodeURIComponent(q)}&item_type=b`,
        { headers: { 'User-Agent': OL_UA }, signal: AbortSignal.timeout(12_000), redirect: 'follow' },
      )
      if (!searchRes.ok) continue
      const html = await searchRes.text()
      // Extract first matching band result URL
      const linkMatch =
        html.match(/<li[^>]*class="[^"]*searchresult[^"]*"[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+\.bandcamp\.com[^"]*)"/) ??
        html.match(/class="heading">\s*<a[^>]+href="(https?:\/\/[^"]+bandcamp\.com[^"]*)"/)
      const bandUrl = linkMatch?.[1]
      if (!bandUrl) continue

      // Verify title matches
      await sleep(1000)
      const bandRes = await fetch(bandUrl, {
        headers: { 'User-Agent': OL_UA }, signal: AbortSignal.timeout(12_000), redirect: 'follow',
      })
      if (!bandRes.ok) continue
      const bandHtml = await bandRes.text()
      const titleMatch = bandHtml.match(/<title[^>]*>([^<]+)<\/title>/)
      const bandTitle  = titleMatch ? titleMatch[1].replace(/\s*\|.*$/, '').trim() : ''
      const ns = scoreName(artist, bandTitle)
      if (ns === 0) continue

      // Normalise to base artist URL (strip /album/... or /track/...)
      let cleanUrl = bandUrl
      try {
        const u = new URL(bandUrl)
        cleanUrl = `${u.protocol}//${u.host}`
      } catch { /* keep original */ }

      hits.push({ source: 'bandcamp', url: cleanUrl, matchName: bandTitle, nameScore: ns })
      break // first hit is enough
    } catch { /* swallow */ }
    await sleep(1000)
  }
  return hits
}

// ── Deezer ─────────────────────────────────────────────────────────────────────
async function searchDeezer(artist: Artist): Promise<MusicHit[]> {
  const hits: MusicHit[] = []
  const seen = new Set<number>()
  for (const q of queryVariants(artist)) {
    try {
      const res = await fetch(
        `https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}`,
        { signal: AbortSignal.timeout(12_000) },
      )
      if (!res.ok) continue
      const json = await res.json() as {
        data?: { id: number; name: string; link: string }[]
      }
      for (const r of json.data ?? []) {
        if (seen.has(r.id)) continue
        const ns = scoreName(artist, r.name)
        if (ns === 0) continue
        seen.add(r.id)
        hits.push({ source: 'deezer', url: r.link, matchName: r.name, nameScore: ns })
      }
    } catch { /* swallow */ }
    await sleep(200)
  }
  return hits
}

// ── Apple Music (iTunes Search API) ───────────────────────────────────────────
async function searchAppleMusic(artist: Artist): Promise<MusicHit[]> {
  const hits: MusicHit[] = []
  const seen = new Set<number>()
  for (const q of queryVariants(artist)) {
    try {
      // entity=musicArtist gives us artistLinkUrl — the Apple Music artist page
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=musicArtist&limit=5&country=JP`,
        { signal: AbortSignal.timeout(12_000) },
      )
      if (!res.ok) continue
      const json = await res.json() as {
        results: { artistId: number; artistName: string; artistLinkUrl?: string }[]
      }
      for (const r of json.results ?? []) {
        if (seen.has(r.artistId) || !r.artistLinkUrl) continue
        const ns = scoreName(artist, r.artistName)
        if (ns === 0) continue
        seen.add(r.artistId)
        hits.push({ source: 'applemusic', url: r.artistLinkUrl, matchName: r.artistName, nameScore: ns })
      }
    } catch { /* swallow */ }
    await sleep(250)
  }
  return hits
}

// ── Pick best URL from all hits ────────────────────────────────────────────────
function pickBest(hits: MusicHit[]): MusicHit | null {
  // Only keep hits above the name-score threshold
  const qualified = hits.filter((h) => h.nameScore >= THRESHOLD)
  if (!qualified.length) return null

  // Sort by platform priority first, then name score descending
  qualified.sort((a, b) => {
    const pa = SOURCE_PRIORITY.indexOf(a.source)
    const pb = SOURCE_PRIORITY.indexOf(b.source)
    if (pa !== pb) return pa - pb
    return b.nameScore - a.nameScore
  })
  return qualified[0]
}

// ── Per-artist processing ──────────────────────────────────────────────────────
interface ResultRow {
  slug:      string
  name_en:   string
  status:    'written' | 'dry-run' | 'miss' | 'skip'
  source:    Source | null
  url:       string | null
  nameScore: number | null
}

async function processArtist(artist: Artist): Promise<ResultRow> {
  console.log(`\n→  ${artist.name_en}${artist.name_ja ? ` / ${artist.name_ja}` : ''}  [${artist.slug}]`)

  // Run enabled sources in parallel
  const enabled = ALL_SOURCES.filter((s) => ENABLED_SOURCES.has(s))
  const providerFns: Record<Source, (a: Artist) => Promise<MusicHit[]>> = {
    spotify:    searchSpotify,
    bandcamp:   searchBandcamp,
    deezer:     searchDeezer,
    applemusic: searchAppleMusic,
  }
  const results = await Promise.allSettled(
    enabled.map((s) => providerFns[s](artist))
  )

  const allHits: MusicHit[] = []
  results.forEach((r, i) => {
    const src = enabled[i]
    if (r.status === 'fulfilled') {
      const hits = r.value
      if (hits.length) {
        console.log(`   [${src}] "${hits[0].matchName}" score=${hits[0].nameScore.toFixed(2)} → ${hits[0].url}`)
      } else {
        console.log(`   [${src}] no match`)
      }
      allHits.push(...hits)
    } else {
      console.log(`   [${src}] error: ${r.reason}`)
    }
  })

  const best = pickBest(allHits)

  if (!best) {
    console.log(`   ✗ miss (best score below ${THRESHOLD})`)
    return { slug: artist.slug, name_en: artist.name_en, status: 'miss', source: null, url: null, nameScore: null }
  }

  console.log(`   ✓ winner: [${best.source}] "${best.matchName}" (${best.nameScore.toFixed(2)}) → ${best.url}`)

  if (DRY_RUN) {
    console.log(`   [dry-run] would write music_url = ${best.url}`)
    return { slug: artist.slug, name_en: artist.name_en, status: 'dry-run', source: best.source, url: best.url, nameScore: best.nameScore }
  }

  const { error } = await supabase
    .from('artists')
    .update({ music_url: best.url })
    .eq('slug', artist.slug)

  if (error) {
    console.error(`   ❌  DB UPDATE: ${error.message}`)
    return { slug: artist.slug, name_en: artist.name_en, status: 'miss', source: null, url: null, nameScore: null }
  }

  console.log(`   ✅  written`)
  return { slug: artist.slug, name_en: artist.name_en, status: 'written', source: best.source, url: best.url, nameScore: best.nameScore }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  let query = supabase
    .from('artists')
    .select('id, slug, name_en, name_ja, music_url')
    .order('name_en')

  if (SLUGS?.length) {
    query = query.in('slug', SLUGS)
  } else if (!FORCE) {
    query = query.is('music_url', null)
  }

  const { data, error } = await query
  if (error) { console.error('❌ ', error.message); process.exit(1) }
  let artists = (data ?? []) as Artist[]
  if (!artists.length) { console.log('✅  Nothing to do — all artists already have music_url.'); return }
  if (LIMIT) artists = artists.slice(0, LIMIT)

  console.log(
    `\n🎵  enrich-music-urls — ${artists.length} artist(s)` +
    `  sources=[${[...ENABLED_SOURCES].join(',')}]` +
    `  threshold=${THRESHOLD}` +
    (DRY_RUN ? ' [dry-run]' : '') +
    (FORCE   ? ' [force]'   : '') +
    '\n',
  )

  const rows: ResultRow[] = []
  for (const a of artists) {
    rows.push(await processArtist(a))
    await sleep(300)
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const written = rows.filter((r) => r.status === 'written' || r.status === 'dry-run')
  const misses  = rows.filter((r) => r.status === 'miss')
  const bySource = new Map<Source, number>()
  for (const r of written) {
    if (r.source) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1)
  }

  console.log('\n─────────────────────────────────────────────────────')
  console.log(`  written   ${written.length.toString().padStart(3)}  / ${rows.length}`)
  console.log(`  miss      ${misses.length.toString().padStart(3)}  / ${rows.length}`)
  console.log('  wins by source:')
  for (const src of SOURCE_PRIORITY) {
    const n = bySource.get(src) ?? 0
    if (n) console.log(`    ${src.padEnd(12)} ${n}`)
  }
  console.log('─────────────────────────────────────────────────────')

  // Write JSON report
  const reportDir = path.resolve(process.cwd(), 'tmp', 'enrich-music-urls')
  fs.mkdirSync(reportDir, { recursive: true })
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(rows, null, 2))

  // CSV of misses for manual review
  const missRows = rows.filter((r) => r.status === 'miss')
  if (missRows.length) {
    const csv = [
      'slug,name_en,manual_music_url',
      ...missRows.map((r) => `${r.slug},"${r.name_en.replace(/"/g, '""')}",`),
    ]
    fs.writeFileSync(path.join(reportDir, 'miss-list.csv'), csv.join('\n'))
  }

  console.log(`📄  report → tmp/enrich-music-urls/report.json`)
  if (missRows.length) console.log(`📋  miss-list → tmp/enrich-music-urls/miss-list.csv  (${missRows.length} rows for manual review)`)
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
