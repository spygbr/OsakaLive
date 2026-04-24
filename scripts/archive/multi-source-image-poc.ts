/**
 * scripts/multi-source-image-poc.ts
 *
 * Zero-auth proof-of-concept for artist image enrichment — tries multiple free
 * public sources in order and reports which one wins for each artist.
 *
 * Sources (in order):
 *   1. iTunes Search API          — no auth; JP coverage is good; artwork is
 *                                   frequently just album art, but high-res.
 *   2. Wikidata (SPARQL + Commons) — no auth; authoritative for notable acts.
 *   3. MusicBrainz + Cover Art    — no auth; mostly band photos for larger acts.
 *   4. unavatar.io/instagram/...  — no auth; ONLY for artists that already have
 *                                   instagram_url set. Proxies the profile pic.
 *
 * READ-ONLY. Does not touch Supabase or Storage.
 *
 * Usage:
 *   npx tsx scripts/multi-source-image-poc.ts [--download] [--limit N]
 *        [--force] [--sources itunes,wikidata,musicbrainz,unavatar]
 *
 * Env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * No API keys required.
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
const DOWNLOAD = process.argv.includes('--download')
const FORCE    = process.argv.includes('--force')
const limitIdx = process.argv.indexOf('--limit')
const LIMIT: number | null =
  limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : null

type Source = 'itunes' | 'wikidata' | 'musicbrainz' | 'unavatar'

const srcIdx = process.argv.indexOf('--sources')
const ENABLED_SOURCES: Set<Source> = new Set<Source>(
  (srcIdx !== -1
    ? (process.argv[srcIdx + 1].split(',').map((s) => s.trim()) as Source[])
    : (['itunes', 'wikidata', 'musicbrainz', 'unavatar'] as Source[])
  ).filter(Boolean),
)

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

interface Candidate {
  source:     Source
  sourceId:   string           // platform-specific id/url
  sourceUrl:  string           // canonical page we matched
  imageUrl:   string
  width?:     number
  height?:    number
  matchName?: string
  matchScore: number           // 0..1
  notes?:     string
}

interface PocRow {
  slug:       string
  name_en:    string
  name_ja:    string | null
  winner:     Candidate | null
  candidates: Candidate[]
  verdict:    'hit' | 'ambiguous' | 'miss'
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u3000\s]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
}

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

/** 1.0 exact, 0.85 substring, 0..0.8 Levenshtein ratio (≥ 0.7 only). */
function scoreName(artist: Artist, cand: string): number {
  const c   = norm(cand)
  const en  = norm(artist.name_en)
  const ja  = artist.name_ja ? norm(artist.name_ja) : ''
  if (!c) return 0
  if (c === en || (ja && c === ja))            return 1
  if (c.includes(en) || en.includes(c))        return 0.85
  if (ja && (c.includes(ja) || ja.includes(c))) return 0.85
  const target = en.length <= (ja.length || Infinity) ? en : ja
  if (!target) return 0
  const ratio = 1 - levenshtein(c, target) / Math.max(c.length, target.length)
  return ratio >= 0.7 ? ratio * 0.8 : 0
}

// ── Source 1: iTunes Search API ────────────────────────────────────────────────
/**
 * iTunes returns album-level artwork for the artist's most recent releases.
 * We bump the size from 100×100 to 600×600 by URL-rewriting (undocumented but
 * has been stable for years).
 */
async function trySearchITunes(artist: Artist): Promise<Candidate[]> {
  const out: Candidate[] = []
  const queries = [artist.name_en]
  if (artist.name_ja && artist.name_ja !== artist.name_en) queries.push(artist.name_ja)

  for (const q of queries) {
    // entity=musicArtist returns artists (no image)
    // We actually want artwork → search entity=album limit=5 and derive from top album
    const url =
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}` +
      `&entity=album&limit=5&country=JP`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
      if (!res.ok) continue
      const json = await res.json() as {
        results: {
          artistName:        string
          collectionName:    string
          artworkUrl100?:    string
          artistId:          number
          collectionViewUrl: string
        }[]
      }
      for (const r of json.results ?? []) {
        if (!r.artworkUrl100) continue
        const score = scoreName(artist, r.artistName)
        if (score === 0) continue
        const hires = r.artworkUrl100.replace('/100x100bb.', '/1200x1200bb.')
        out.push({
          source:     'itunes',
          sourceId:   String(r.artistId),
          sourceUrl:  r.collectionViewUrl,
          imageUrl:   hires,
          width:      1200, height: 1200,
          matchName:  r.artistName,
          matchScore: score,
          notes:      `album artwork: "${r.collectionName}"`,
        })
      }
    } catch {
      // swallow, try next query
    }
    await sleep(250) // iTunes: ~20 req/min safe
  }

  // Keep best per artistId
  const byId = new Map<string, Candidate>()
  for (const c of out) {
    const ex = byId.get(c.sourceId)
    if (!ex || c.matchScore > ex.matchScore) byId.set(c.sourceId, c)
  }
  return [...byId.values()].sort((a, b) => b.matchScore - a.matchScore)
}

// ── Source 2: Wikidata (SPARQL) + Commons thumbnail ────────────────────────────
/**
 * We query Wikidata for entities with instance-of (P31) = human/musical group
 * and label equal to the artist name. Grab P18 (image), then resolve via
 * Wikimedia Commons thumbnail URL.
 */
async function trySearchWikidata(artist: Artist): Promise<Candidate[]> {
  const out: Candidate[] = []
  const names = [artist.name_en]
  if (artist.name_ja && artist.name_ja !== artist.name_en) names.push(artist.name_ja)

  // Step 1: wbsearchentities is much faster than a fat SPARQL query
  const endpoint = (q: string, lang: string) =>
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*` +
    `&language=${lang}&limit=5&search=${encodeURIComponent(q)}`

  type Hit = { id: string; label: string; description?: string }
  const hits: Hit[] = []
  for (const n of names) {
    const lang = /[\u3000-\u9fff\uff00-\uffef]/.test(n) ? 'ja' : 'en'
    try {
      const res = await fetch(endpoint(n, lang), { signal: AbortSignal.timeout(12_000) })
      if (!res.ok) continue
      const json = await res.json() as { search: Hit[] }
      for (const h of json.search ?? []) hits.push(h)
    } catch {
      // ignore
    }
    await sleep(200)
  }

  if (hits.length === 0) return out

  // Step 2: fetch P18 (image) for each hit; skip ones that are clearly not a musician
  const ids = [...new Set(hits.map((h) => h.id))].slice(0, 8) // cap
  const claimsUrl =
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*` +
    `&props=claims|labels|descriptions&languages=en|ja&ids=${ids.join('|')}`
  try {
    const res = await fetch(claimsUrl, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return out
    const json = await res.json() as {
      entities: Record<string, {
        id:     string
        labels: Record<string, { language: string; value: string }>
        descriptions?: Record<string, { language: string; value: string }>
        claims: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]>
      }>
    }

    for (const id of ids) {
      const e = json.entities[id]
      if (!e) continue

      const label = (e.labels.en ?? e.labels.ja)?.value ?? ''
      const desc  = (e.descriptions?.en ?? e.descriptions?.ja)?.value ?? ''

      // Reject obvious non-musician entities
      const isMusician =
        /musician|singer|band|composer|rapper|idol|dj|group|artist|歌手|ミュージシャン|バンド|作曲家/i
          .test(desc)
      if (!isMusician) continue

      const p18 = e.claims['P18']?.[0]?.mainsnak?.datavalue?.value as string | undefined
      if (!p18) continue

      const score = scoreName(artist, label)
      if (score === 0) continue

      // Wikimedia thumbnail — Special:FilePath auto-serves the latest version
      const fileName = p18.replace(/ /g, '_')
      const imageUrl =
        `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}` +
        `?width=1200`
      out.push({
        source:     'wikidata',
        sourceId:   id,
        sourceUrl:  `https://www.wikidata.org/wiki/${id}`,
        imageUrl,
        matchName:  label,
        matchScore: score,
        notes:      desc,
      })
    }
  } catch {
    // ignore
  }

  return out.sort((a, b) => b.matchScore - a.matchScore)
}

// ── Source 3: MusicBrainz + Cover Art Archive ──────────────────────────────────
/**
 * MusicBrainz requires a descriptive User-Agent by policy. Rate limit is
 * 1 req/sec — we sleep 1100ms between calls.
 * Artist-level images are at https://coverartarchive.org/artist/{mbid}/front
 * (returns 404 for most artists — coverage is album-centric).
 */
const MB_UA = 'OsakaLive/0.1 (https://osaka.live; diku@genkanconsulting.com)'

async function trySearchMusicBrainz(artist: Artist): Promise<Candidate[]> {
  const out: Candidate[] = []
  const queries = [artist.name_en]
  if (artist.name_ja && artist.name_ja !== artist.name_en) queries.push(artist.name_ja)

  for (const q of queries) {
    const url =
      `https://musicbrainz.org/ws/2/artist/?fmt=json&limit=5&query=${encodeURIComponent(q)}`
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': MB_UA, Accept: 'application/json' },
        signal:  AbortSignal.timeout(12_000),
      })
      if (!res.ok) { await sleep(1100); continue }
      const json = await res.json() as {
        artists?: { id: string; name: string; country?: string; score?: number }[]
      }
      for (const a of json.artists ?? []) {
        const score = scoreName(artist, a.name)
        if (score === 0) continue
        // Try artist-level cover art; most return 404 so we handle gracefully
        const coverUrl = `https://coverartarchive.org/artist/${a.id}/front-500`
        try {
          const head = await fetch(coverUrl, {
            method: 'HEAD',
            headers: { 'User-Agent': MB_UA },
            signal: AbortSignal.timeout(8_000),
          })
          if (head.ok) {
            out.push({
              source:     'musicbrainz',
              sourceId:   a.id,
              sourceUrl:  `https://musicbrainz.org/artist/${a.id}`,
              imageUrl:   coverUrl,
              matchName:  a.name,
              matchScore: score,
              notes:      `MBID ${a.id}${a.country ? ` (${a.country})` : ''}`,
            })
          }
        } catch {
          // no cover art — skip this artist hit, not fatal
        }
        await sleep(1100)
      }
    } catch {
      // ignore
    }
    await sleep(1100)
  }

  return out.sort((a, b) => b.matchScore - a.matchScore)
}

// ── Source 4: unavatar.io/instagram — only when we already know the handle ─────
function extractInstagramHandle(url: string): string | null {
  try {
    const u = new URL(url)
    if (!u.hostname.includes('instagram.com')) return null
    const seg = u.pathname.split('/').filter(Boolean)[0]
    return seg && /^[\w.]+$/.test(seg) ? seg : null
  } catch {
    return null
  }
}

async function tryUnavatar(artist: Artist): Promise<Candidate[]> {
  if (!artist.instagram_url) return []
  const handle = extractInstagramHandle(artist.instagram_url)
  if (!handle) return []

  // unavatar.io redirects to the real avatar. If the IG handle doesn't resolve,
  // it returns a default fallback image (same bytes every time) — we detect
  // that with the ?fallback=false param, which makes unavatar return 404 on miss.
  const imageUrl = `https://unavatar.io/instagram/${handle}?fallback=false`
  try {
    const res = await fetch(imageUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(12_000),
      redirect: 'follow',
    })
    if (!res.ok) return []
    return [{
      source:     'unavatar',
      sourceId:   handle,
      sourceUrl:  artist.instagram_url,
      imageUrl,
      matchName:  handle,
      matchScore: 1, // we know the handle came from our own DB — trusted
      notes:      `proxied IG avatar for @${handle}`,
    }]
  } catch {
    return []
  }
}

// ── Orchestrator ───────────────────────────────────────────────────────────────
async function runSources(artist: Artist): Promise<Candidate[]> {
  const all: Candidate[] = []

  if (ENABLED_SOURCES.has('itunes')) {
    try { all.push(...await trySearchITunes(artist)) } catch { /* ignore */ }
  }
  if (ENABLED_SOURCES.has('wikidata')) {
    try { all.push(...await trySearchWikidata(artist)) } catch { /* ignore */ }
  }
  if (ENABLED_SOURCES.has('musicbrainz')) {
    try { all.push(...await trySearchMusicBrainz(artist)) } catch { /* ignore */ }
  }
  if (ENABLED_SOURCES.has('unavatar')) {
    try { all.push(...await tryUnavatar(artist)) } catch { /* ignore */ }
  }

  return all
}

/**
 * Source priority — if multiple sources hit, prefer these for *artist photos*
 * specifically. Wikidata > unavatar > MusicBrainz > iTunes because iTunes
 * artwork is usually album art rather than a band photo.
 */
const SOURCE_RANK: Record<Source, number> = {
  wikidata:    4,
  unavatar:    3,
  musicbrainz: 2,
  itunes:      1,
}

function pickWinner(cands: Candidate[]): { winner: Candidate | null; ambiguous: boolean } {
  const scored = cands.filter((c) => c.matchScore >= 0.7)
  if (scored.length === 0) return { winner: null, ambiguous: false }

  scored.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore
    return SOURCE_RANK[b.source] - SOURCE_RANK[a.source]
  })

  const top = scored[0]
  // Ambiguous: two high-scoring matches from different artists (different names)
  const ambiguous = scored.some(
    (c) =>
      c !== top &&
      c.matchScore >= top.matchScore - 0.05 &&
      norm(c.matchName ?? '') !== norm(top.matchName ?? ''),
  )
  return { winner: top, ambiguous }
}

// ── Optional download for visual spot-check ────────────────────────────────────
async function downloadForSpotCheck(artist: Artist, c: Candidate): Promise<void> {
  const outDir = path.resolve(process.cwd(), 'tmp', 'multi-source-poc')
  fs.mkdirSync(outDir, { recursive: true })
  try {
    const res = await fetch(c.imageUrl, {
      signal: AbortSignal.timeout(20_000),
      redirect: 'follow',
      headers: { 'User-Agent': MB_UA },
    })
    if (!res.ok) return
    const ct  = res.headers.get('content-type') ?? 'image/jpeg'
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(path.join(outDir, `${artist.slug}.${c.source}.${ext}`), buf)
  } catch {
    // ignore
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  let query = supabase
    .from('artists')
    .select('id, slug, name_en, name_ja, instagram_url, website_url, image_url')
    .order('name_en')

  if (!FORCE) query = query.is('image_url', null)

  const { data, error } = await query
  if (error) {
    console.error('❌  Supabase query failed:', error.message)
    process.exit(1)
  }

  const artists = (data ?? []) as Artist[]
  if (artists.length === 0) {
    console.log('✅  No artists to test. Use --force to re-test ones that already have image_url.')
    return
  }

  const subset = LIMIT ? artists.slice(0, LIMIT) : artists
  console.log(
    `\n🎨  Multi-source image POC — ${subset.length} artist(s)` +
    (DOWNLOAD ? ' [will download]' : ' [read-only]') +
    (FORCE    ? ' [--force]'       : '') +
    `  sources=[${[...ENABLED_SOURCES].join(',')}]\n`,
  )

  const rows: PocRow[] = []
  const winCounts: Record<Source, number> = {
    itunes: 0, wikidata: 0, musicbrainz: 0, unavatar: 0,
  }

  for (const a of subset) {
    const jaSuffix = a.name_ja && a.name_ja !== a.name_en ? ` / ${a.name_ja}` : ''
    console.log(`→  ${a.name_en}${jaSuffix}  [${a.slug}]`)

    const cands = await runSources(a)
    const { winner, ambiguous } = pickWinner(cands)

    if (cands.length === 0) {
      console.log(`   MISS  (no candidates from any source)\n`)
      rows.push({ slug: a.slug, name_en: a.name_en, name_ja: a.name_ja,
                  winner: null, candidates: [], verdict: 'miss' })
      continue
    }

    // Show all candidates for visibility
    for (const c of cands.slice(0, 5)) {
      console.log(
        `     [${c.source}] "${c.matchName}" score=${c.matchScore.toFixed(2)}` +
        `${c.width ? ` ${c.width}x${c.height}` : ''}` +
        `${c.notes ? ` — ${c.notes}` : ''}`,
      )
    }

    if (!winner) {
      console.log(`   MISS  (no candidate passed score threshold)\n`)
      rows.push({ slug: a.slug, name_en: a.name_en, name_ja: a.name_ja,
                  winner: null, candidates: cands, verdict: 'miss' })
      continue
    }

    const verdict = ambiguous ? 'ambiguous' : 'hit'
    console.log(
      `   ${verdict === 'hit' ? 'HIT ' : 'AMBIG'}  → [${winner.source}] "${winner.matchName}"\n`,
    )
    if (verdict === 'hit') winCounts[winner.source]++

    rows.push({ slug: a.slug, name_en: a.name_en, name_ja: a.name_ja,
                winner, candidates: cands, verdict })

    if (DOWNLOAD && winner) await downloadForSpotCheck(a, winner)
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const hits   = rows.filter((r) => r.verdict === 'hit').length
  const ambig  = rows.filter((r) => r.verdict === 'ambiguous').length
  const misses = rows.filter((r) => r.verdict === 'miss').length
  const pct = (n: number) => ((n / rows.length) * 100).toFixed(0)

  console.log('─────────────────────────────────────────────────────')
  console.log(`  HIT        ${hits.toString().padStart(3)}  (${pct(hits)}%)`)
  console.log(`  AMBIGUOUS  ${ambig.toString().padStart(3)}  (${pct(ambig)}%)`)
  console.log(`  MISS       ${misses.toString().padStart(3)}  (${pct(misses)}%)`)
  console.log('─────────────────────────────────────────────────────')
  console.log('  Wins by source (hits only):')
  for (const [src, n] of Object.entries(winCounts)) {
    if (n > 0) console.log(`    ${src.padEnd(12)} ${n}`)
  }
  console.log('')

  const reportDir = path.resolve(process.cwd(), 'tmp', 'multi-source-poc')
  fs.mkdirSync(reportDir, { recursive: true })
  const reportPath = path.join(reportDir, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(rows, null, 2))
  console.log(`📄  Full report: ${reportPath}`)
  if (DOWNLOAD) {
    console.log(`🖼   Sample images: ${reportDir}/*.{jpg,png,webp}`)
    console.log(`    Filename format: {slug}.{source}.{ext} — spot-check before trusting.`)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
