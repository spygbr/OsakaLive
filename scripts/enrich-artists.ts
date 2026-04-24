/**
 * scripts/enrich-artists.ts  (v3 — multi-source rewrite)
 *
 * Single-pass artist enrichment. For each qualifying artist:
 *
 *   1. Runs all enabled music-database providers in parallel (Deezer, Bandcamp,
 *      Wikipedia, TheAudioDB, Discogs, Wikidata, MusicBrainz, iTunes,
 *      unavatar, Spotify) to gather image candidates, website URL, genre tags.
 *   2. Maps Spotify / TheAudioDB genre strings → artists.genre_id FK.
 *   3. Writes website_url from TheAudioDB / Discogs if currently null.
 *   4. Uploads winning image to Supabase Storage → writes image_url.
 *   5. Falls back to Claude Haiku for instagram_url only when APIs don't
 *      provide a website and instagram_url is null (APIs never return IG).
 *   6. Single atomic UPDATE per artist (only null columns are filled).
 *
 * This replaces the previous og:image strategy (enrich-artists v1/v2), which
 * was broken by Instagram login walls and websites returning logos as og:image.
 *
 * Usage:
 *   npx tsx scripts/enrich-artists.ts
 *   npx tsx scripts/enrich-artists.ts --dry-run
 *   npx tsx scripts/enrich-artists.ts --limit 20
 *   npx tsx scripts/enrich-artists.ts --slugs slug-a,slug-b
 *   npx tsx scripts/enrich-artists.ts --skip-llm      # skip instagram fallback
 *   npx tsx scripts/enrich-artists.ts --skip-image    # skip image enrichment
 *   npx tsx scripts/enrich-artists.ts --force         # re-enrich artists that
 *                                                     # already have image_url
 *   npx tsx scripts/enrich-artists.ts --sources deezer,spotify,wikipedia
 *   npx tsx scripts/enrich-artists.ts --threshold 0.65
 *   npx tsx scripts/enrich-artists.ts --no-upload     # write source URL directly
 *                                                     # (skip Storage upload)
 *
 * Env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL=...       (required)
 *   SUPABASE_SERVICE_ROLE_KEY=...      (required)
 *   ANTHROPIC_API_KEY=...              (optional; needed for instagram fallback)
 *   SPOTIFY_CLIENT_ID=...              (optional; enables spotify provider)
 *   SPOTIFY_CLIENT_SECRET=...          (optional)
 *   DISCOGS_TOKEN=...                  (optional; higher rate limit)
 */

import fs   from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { createHaikuClient, type HaikuClient } from '../lib/llm/haiku'

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
const DRY_RUN    = process.argv.includes('--dry-run')
const SKIP_LLM   = process.argv.includes('--skip-llm')
const SKIP_IMAGE = process.argv.includes('--skip-image')
const FORCE      = process.argv.includes('--force')
const NO_UPLOAD  = process.argv.includes('--no-upload')

const limitIdx = process.argv.indexOf('--limit')
const LIMIT: number | null =
  limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : null

const slugsIdx = process.argv.indexOf('--slugs')
const SLUGS: string[] | null =
  slugsIdx !== -1 && process.argv[slugsIdx + 1]
    ? process.argv[slugsIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : null

const threshIdx = process.argv.indexOf('--threshold')
const THRESHOLD: number = threshIdx !== -1 ? parseFloat(process.argv[threshIdx + 1]) : 0.7

type Source =
  | 'deezer' | 'bandcamp' | 'wikipedia' | 'theaudiodb' | 'discogs'
  | 'wikidata' | 'musicbrainz' | 'itunes' | 'unavatar' | 'spotify'

const ALL_SOURCES: Source[] = [
  'deezer', 'bandcamp', 'wikipedia', 'theaudiodb', 'discogs',
  'wikidata', 'musicbrainz', 'itunes', 'unavatar', 'spotify',
]
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
  id:            string
  slug:          string
  name_en:       string
  name_ja:       string | null
  instagram_url: string | null
  website_url:   string | null
  image_url:     string | null
  genre_id:      number | null
}

interface RawCandidate {
  sourceId:     string
  sourceUrl:    string
  imageUrl:     string
  width?:       number
  height?:      number
  matchName:    string
  notes?:       string
  // Side-channel data captured alongside the image
  websiteUrl?:  string   // from TheAudioDB.strWebsite / Discogs.urls
  genreTags?:   string[] // from Spotify.genres / TheAudioDB.strGenre
}

interface ScoredCandidate extends RawCandidate {
  source:     Source
  nameScore:  number
  finalScore: number
  crossVal:   boolean
}

// ── Genre mapping ──────────────────────────────────────────────────────────────
// Maps Spotify/TheAudioDB genre tag substrings → genres.id in priority order.
// More-specific tags are checked first; "rock" is last (everything is rock).
const GENRE_MAP: { pattern: RegExp; id: number }[] = [
  { pattern: /noise/i,                         id: 3  }, // Noise
  { pattern: /hardcore/i,                      id: 9  }, // Hardcore
  { pattern: /psychedel|psych\b/i,             id: 8  }, // Psychedelic
  { pattern: /metal|doom|sludge|drone/i,       id: 7  }, // Metal
  { pattern: /punk/i,                          id: 2  }, // Punk
  { pattern: /jazz/i,                          id: 5  }, // Jazz
  { pattern: /electro|techno|house|synth|edm/i, id: 6 }, // Electronic
  { pattern: /folk|country/i,                  id: 10 }, // Folk
  { pattern: /indie/i,                         id: 4  }, // Indie
  { pattern: /rock/i,                          id: 1  }, // Rock (catch-all)
]

function mapGenre(tags: string[]): number | null {
  for (const { pattern, id } of GENRE_MAP) {
    if (tags.some((t) => pattern.test(t))) return id
  }
  return null
}

// ── Provider weights ───────────────────────────────────────────────────────────
const PROVIDER_WEIGHT: Record<Source, number> = {
  wikipedia:   1.00,
  wikidata:    1.00,
  theaudiodb:  1.00,
  bandcamp:    1.00,
  spotify:     1.00,
  deezer:      0.95,
  unavatar:    0.95,
  discogs:     0.90,
  musicbrainz: 0.50,
  itunes:      0.50,
}

const PROVIDER_RANK: Record<Source, number> = {
  wikipedia:   10,
  wikidata:     9,
  theaudiodb:   8,
  bandcamp:     7,
  spotify:      6,
  deezer:       5,
  unavatar:     4,
  discogs:      3,
  musicbrainz:  2,
  itunes:       1,
}

// ── Utilities ──────────────────────────────────────────────────────────────────
const OL_UA = 'OsakaLive/0.1 (https://osaka.live; diku@genkanconsulting.com)'
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function norm(s: string): string {
  return s.toLowerCase().normalize('NFKC')
    .replace(/[\u3000\s]+/g, ' ')
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

function scoreName(artist: Artist, cand: string): number {
  const c  = norm(cand)
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

function extFromContentType(ct: string, url = ''): string {
  if (ct.includes('png'))  return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif'))  return 'gif'
  const m = url.match(/\.(\w{3,4})(?:\?|$)/)
  return m ? m[1].toLowerCase() : 'jpg'
}

// ── Cross-validation scoring ───────────────────────────────────────────────────
function crossValBonuses(pool: Map<Source, RawCandidate[]>): Map<string, number> {
  const nameToSources = new Map<string, Set<Source>>()
  for (const [src, cands] of pool) {
    for (const c of cands) {
      const key = norm(c.matchName)
      if (!nameToSources.has(key)) nameToSources.set(key, new Set())
      nameToSources.get(key)!.add(src)
    }
  }
  const bonuses = new Map<string, number>()
  for (const [name, srcs] of nameToSources) {
    if (srcs.size >= 2) bonuses.set(name, 0.10)
  }
  return bonuses
}

function scorePool(artist: Artist, pool: Map<Source, RawCandidate[]>): ScoredCandidate[] {
  const bonuses = crossValBonuses(pool)
  const scored: ScoredCandidate[] = []
  for (const [src, cands] of pool) {
    const weight = PROVIDER_WEIGHT[src] ?? 1.0
    for (const c of cands) {
      const nameScore  = scoreName(artist, c.matchName)
      const crossVal   = bonuses.has(norm(c.matchName))
      const crossBonus = crossVal ? 0.10 : 0
      const sizePenalty = (c.width !== undefined && c.width < 300) ? -0.20 : 0
      const finalScore = Math.min(1.0, nameScore * weight + crossBonus + sizePenalty)
      scored.push({ ...c, source: src, nameScore, finalScore, crossVal })
    }
  }
  return scored.sort((a, b) => {
    if (Math.abs(b.finalScore - a.finalScore) > 0.001) return b.finalScore - a.finalScore
    return PROVIDER_RANK[b.source] - PROVIDER_RANK[a.source]
  })
}

// ── Providers ──────────────────────────────────────────────────────────────────

async function searchDeezer(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []
  const seen = new Set<number>()
  for (const q of queryVariants(artist)) {
    try {
      const res = await fetch(
        `https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}`,
        { signal: AbortSignal.timeout(12_000) },
      )
      if (!res.ok) continue
      const json = await res.json() as {
        data?: { id: number; name: string; picture_xl?: string; link: string }[]
      }
      for (const r of json.data ?? []) {
        if (seen.has(r.id) || !r.picture_xl) continue
        seen.add(r.id)
        if (scoreName(artist, r.name) === 0) continue
        out.push({
          sourceId: String(r.id), sourceUrl: r.link,
          imageUrl: r.picture_xl, width: 1000, height: 1000,
          matchName: r.name,
        })
      }
    } catch { /* swallow */ }
    await sleep(200)
  }
  return out
}

async function searchBandcamp(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []
  for (const q of queryVariants(artist)) {
    try {
      const searchRes = await fetch(
        `https://bandcamp.com/search?q=${encodeURIComponent(q)}&item_type=b`,
        { headers: { 'User-Agent': OL_UA }, signal: AbortSignal.timeout(12_000), redirect: 'follow' },
      )
      if (!searchRes.ok) continue
      const html = await searchRes.text()
      const linkMatch =
        html.match(/<li[^>]*class="[^"]*searchresult[^"]*"[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+\.bandcamp\.com[^"]*)"/) ??
        html.match(/class="heading">\s*<a[^>]+href="(https?:\/\/[^"]+bandcamp\.com[^"]*)"/)
      const bandUrl = linkMatch?.[1]
      if (!bandUrl) continue
      await sleep(1000)
      const bandRes = await fetch(bandUrl, {
        headers: { 'User-Agent': OL_UA }, signal: AbortSignal.timeout(12_000), redirect: 'follow',
      })
      if (!bandRes.ok) continue
      const bandHtml = await bandRes.text()
      const titleMatch = bandHtml.match(/<title[^>]*>([^<]+)<\/title>/)
      const bandTitle  = titleMatch ? titleMatch[1].replace(/\s*\|.*$/, '').trim() : ''
      if (scoreName(artist, bandTitle) === 0) continue
      const ogMatch    = bandHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)
                      ?? bandHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/)
      const bioPicMatch = bandHtml.match(/<div[^>]*class="[^"]*bio-pic[^"]*"[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/)
      const imageUrl = bioPicMatch?.[1] ?? ogMatch?.[1]
      if (!imageUrl) continue
      out.push({ sourceId: bandUrl, sourceUrl: bandUrl, imageUrl, matchName: bandTitle, notes: 'Bandcamp band page' })
      break
    } catch { /* swallow */ }
    await sleep(1000)
  }
  return out
}

async function searchWikipedia(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []
  const queries = [
    { lang: 'en', name: artist.name_en },
    ...(stripParens(artist.name_en) !== artist.name_en ? [{ lang: 'en', name: stripParens(artist.name_en) }] : []),
    ...(artist.name_ja && artist.name_ja !== artist.name_en ? [{ lang: 'ja', name: artist.name_ja }] : []),
  ]
  for (const { lang, name } of queries) {
    try {
      const base = `https://${lang}.wikipedia.org/w/api.php`
      const imgRes = await fetch(
        `${base}?action=query&format=json&origin=*&prop=pageimages&piprop=original&titles=${encodeURIComponent(name)}`,
        { signal: AbortSignal.timeout(12_000) },
      )
      if (!imgRes.ok) continue
      const imgJson = await imgRes.json() as {
        query?: { pages?: Record<string, { title: string; original?: { source: string; width: number; height: number }; missing?: string }> }
      }
      for (const page of Object.values(imgJson.query?.pages ?? {})) {
        if ('missing' in page || !page.original) continue
        // Validate: musician keywords in extract
        try {
          const extRes = await fetch(
            `${base}?action=query&format=json&origin=*&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(page.title)}`,
            { signal: AbortSignal.timeout(10_000) },
          )
          if (extRes.ok) {
            const extJson = await extRes.json() as { query?: { pages?: Record<string, { extract?: string }> } }
            const extract = Object.values(extJson.query?.pages ?? {}).map((p) => p.extract ?? '').join(' ')
            if (!/musician|singer|band|composer|rapper|dj|group|musical group|rock|punk|metal|noise|indie|idol|歌手|ミュージシャン|バンド/i.test(extract)) continue
          }
        } catch { /* allow through */ }
        if (scoreName(artist, page.title) === 0) continue
        out.push({
          sourceId:  page.title,
          sourceUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
          imageUrl:  page.original.source,
          width: page.original.width, height: page.original.height,
          matchName: page.title, notes: `Wikipedia ${lang}`,
        })
      }
    } catch { /* swallow */ }
    await sleep(300)
  }
  return out
}

async function searchTheAudioDB(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []
  for (const q of queryVariants(artist)) {
    try {
      const res = await fetch(
        `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(q)}`,
        { signal: AbortSignal.timeout(12_000) },
      )
      if (!res.ok) continue
      const json = await res.json() as {
        artists?: {
          idArtist:        string
          strArtist:       string
          strArtistThumb?: string
          strArtistFanart?: string
          strWebsite?:     string
          strGenre?:       string
          strMood?:        string
          strStyle?:       string
          strCountry?:     string
        }[]
      }
      for (const a of json.artists ?? []) {
        const imageUrl = a.strArtistThumb ?? a.strArtistFanart
        if (!imageUrl) continue
        if (scoreName(artist, a.strArtist) === 0) continue
        // Collect genre tags from all three genre fields
        const genreTags = [a.strGenre, a.strMood, a.strStyle].filter(Boolean) as string[]
        // Normalise website — TheAudioDB stores bare domains like "boris-web.com"
        let websiteUrl: string | undefined
        if (a.strWebsite) {
          const raw = a.strWebsite.trim()
          websiteUrl = raw.startsWith('http') ? raw : `https://${raw}`
        }
        out.push({
          sourceId:  a.idArtist,
          sourceUrl: `https://www.theaudiodb.com/artist/${a.idArtist}`,
          imageUrl,
          matchName: a.strArtist,
          notes:     [a.strArtistThumb ? undefined : 'fanart', a.strCountry].filter(Boolean).join('; ') || undefined,
          websiteUrl,
          genreTags: genreTags.length ? genreTags : undefined,
        })
      }
    } catch { /* swallow */ }
    await sleep(250)
  }
  return out
}

async function searchDiscogs(artist: Artist): Promise<RawCandidate[]> {
  const token = process.env.DISCOGS_TOKEN
  const delay  = token ? 1100 : 2500
  const headers: Record<string, string> = { 'User-Agent': OL_UA, Accept: 'application/json' }
  if (token) headers['Authorization'] = `Discogs token=${token}`
  const out: RawCandidate[] = []
  const seen = new Set<number>()
  for (const q of queryVariants(artist)) {
    try {
      const searchRes = await fetch(
        `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=artist`,
        { headers, signal: AbortSignal.timeout(12_000) },
      )
      if (!searchRes.ok) { await sleep(delay); continue }
      const searchJson = await searchRes.json() as {
        results?: { id: number; title: string; type: string }[]
      }
      for (const r of (searchJson.results ?? []).filter((x) => x.type === 'artist')) {
        if (seen.has(r.id)) continue
        seen.add(r.id)
        if (scoreName(artist, r.title) === 0) continue
        await sleep(delay)
        try {
          const detailRes = await fetch(
            `https://api.discogs.com/artists/${r.id}`,
            { headers, signal: AbortSignal.timeout(12_000) },
          )
          if (!detailRes.ok) continue
          const detail = await detailRes.json() as {
            name: string
            images?: { uri: string; type: 'primary' | 'secondary'; width?: number; height?: number }[]
            urls?: string[]
          }
          const imgs = detail.images ?? []
          const primary = imgs.find((i) => i.type === 'primary') ?? imgs[0]
          if (!primary) continue
          // Pick first URL that looks like an official site (not social)
          const websiteUrl = detail.urls?.find(
            (u) => !/(facebook|twitter|instagram|myspace|last\.fm|allmusic)/i.test(u),
          )
          out.push({
            sourceId:  String(r.id),
            sourceUrl: `https://www.discogs.com/artist/${r.id}`,
            imageUrl:  primary.uri,
            width: primary.width, height: primary.height,
            matchName: detail.name ?? r.title,
            notes: primary.type === 'secondary' ? 'secondary image' : undefined,
            websiteUrl,
          })
        } catch { /* swallow detail */ }
      }
    } catch { /* swallow */ }
    await sleep(delay)
  }
  return out
}

async function searchWikidata(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []
  type Hit = { id: string; label: string; description?: string }
  const hits: Hit[] = []
  for (const n of queryVariants(artist)) {
    const lang = /[\u3000-\u9fff\uff00-\uffef]/.test(n) ? 'ja' : 'en'
    try {
      const res = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&language=${lang}&limit=5&search=${encodeURIComponent(n)}`,
        { signal: AbortSignal.timeout(12_000) },
      )
      if (!res.ok) continue
      const json = await res.json() as { search: Hit[] }
      for (const h of json.search ?? []) hits.push(h)
    } catch { /* ignore */ }
    await sleep(200)
  }
  if (!hits.length) return out
  const ids = [...new Set(hits.map((h) => h.id))].slice(0, 8)
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=claims|labels|descriptions&languages=en|ja&ids=${ids.join('|')}`,
      { signal: AbortSignal.timeout(15_000) },
    )
    if (!res.ok) return out
    const json = await res.json() as {
      entities: Record<string, {
        id: string
        labels: Record<string, { value: string }>
        descriptions?: Record<string, { value: string }>
        claims: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]>
      }>
    }
    for (const id of ids) {
      const e = json.entities[id]
      if (!e) continue
      const label = (e.labels.en ?? e.labels.ja)?.value ?? ''
      const desc  = (e.descriptions?.en ?? e.descriptions?.ja)?.value ?? ''
      if (!/musician|singer|band|composer|rapper|idol|dj|group|artist|歌手|ミュージシャン|バンド/i.test(desc)) continue
      const p18 = e.claims['P18']?.[0]?.mainsnak?.datavalue?.value as string | undefined
      if (!p18 || scoreName(artist, label) === 0) continue
      const fileName = p18.replace(/ /g, '_')
      out.push({
        sourceId:  id,
        sourceUrl: `https://www.wikidata.org/wiki/${id}`,
        imageUrl:  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=1200`,
        matchName: label, notes: desc,
      })
    }
  } catch { /* ignore */ }
  return out
}

async function searchMusicBrainz(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []
  for (const q of queryVariants(artist)) {
    try {
      const res = await fetch(
        `https://musicbrainz.org/ws/2/artist/?fmt=json&limit=5&query=${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': OL_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) },
      )
      if (!res.ok) { await sleep(1100); continue }
      const json = await res.json() as { artists?: { id: string; name: string; country?: string }[] }
      for (const a of json.artists ?? []) {
        if (scoreName(artist, a.name) === 0) continue
        const coverUrl = `https://coverartarchive.org/artist/${a.id}/front-500`
        try {
          const head = await fetch(coverUrl, { method: 'HEAD', headers: { 'User-Agent': OL_UA }, signal: AbortSignal.timeout(8_000) })
          if (head.ok) out.push({
            sourceId: a.id, sourceUrl: `https://musicbrainz.org/artist/${a.id}`,
            imageUrl: coverUrl, matchName: a.name, notes: a.country ?? undefined,
          })
        } catch { /* no cover art */ }
        await sleep(1100)
      }
    } catch { /* ignore */ }
    await sleep(1100)
  }
  return out
}

async function searchITunes(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []
  for (const q of queryVariants(artist)) {
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=5&country=JP`,
        { signal: AbortSignal.timeout(12_000) },
      )
      if (!res.ok) continue
      const json = await res.json() as {
        results: { artistName: string; collectionName: string; artworkUrl100?: string; artistId: number; collectionViewUrl: string }[]
      }
      for (const r of json.results ?? []) {
        if (!r.artworkUrl100 || scoreName(artist, r.artistName) === 0) continue
        out.push({
          sourceId: String(r.artistId), sourceUrl: r.collectionViewUrl,
          imageUrl: r.artworkUrl100.replace('/100x100bb.', '/1200x1200bb.'),
          width: 1200, height: 1200,
          matchName: r.artistName, notes: `album art: "${r.collectionName}"`,
        })
      }
    } catch { /* swallow */ }
    await sleep(250)
  }
  const byId = new Map<string, RawCandidate>()
  for (const c of out) {
    if (!byId.has(c.sourceId) || scoreName(artist, c.matchName) > scoreName(artist, byId.get(c.sourceId)!.matchName))
      byId.set(c.sourceId, c)
  }
  return [...byId.values()]
}

function extractInstagramHandle(url: string): string | null {
  try {
    const u = new URL(url)
    if (!u.hostname.includes('instagram.com')) return null
    const seg = u.pathname.split('/').filter(Boolean)[0]
    return seg && /^[\w.]+$/.test(seg) ? seg : null
  } catch { return null }
}

async function searchUnavatar(artist: Artist): Promise<RawCandidate[]> {
  if (!artist.instagram_url) return []
  const handle = extractInstagramHandle(artist.instagram_url)
  if (!handle) return []
  const imageUrl = `https://unavatar.io/instagram/${handle}?fallback=false`
  try {
    const res = await fetch(imageUrl, { method: 'HEAD', signal: AbortSignal.timeout(12_000), redirect: 'follow' })
    if (!res.ok) return []
    return [{ sourceId: handle, sourceUrl: artist.instagram_url, imageUrl, matchName: handle, notes: `IG avatar @${handle}` }]
  } catch { return [] }
}

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
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.log(`   [spotify] token fetch failed — HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`)
      return null
    }
    const json = await res.json() as { access_token?: string }
    _spotifyToken = json.access_token ?? null
    if (!_spotifyToken) console.log('   [spotify] token endpoint returned no access_token')
    else console.log('   [spotify] ✓ token acquired')
    return _spotifyToken
  } catch (err) {
    console.log(`   [spotify] token fetch threw: ${err}`)
    return null
  }
}

async function searchSpotify(artist: Artist): Promise<RawCandidate[]> {
  const token = await getSpotifyToken()
  if (!token) return []
  // Token is available — any silent failures after this point will be surfaced
  type SpotifyArtist = { id: string; name: string; images: { url: string; width?: number; height?: number }[]; genres: string[] }
  const seen = new Set<string>()
  const out: RawCandidate[] = []
  for (const q of queryVariants(artist)) {
    let foundInMarket = false
    for (const market of ['JP', ''] as const) {
      if (foundInMarket) break
      try {
        const params = new URLSearchParams({ q, type: 'artist', limit: '5', ...(market ? { market } : {}) })
        const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(12_000),
        })
        if (!res.ok) {
          process.stderr.write(`   [spotify] search HTTP ${res.status} (q="${q}" market="${market}")\n`)
          continue
        }
        const json = await res.json() as { artists?: { items: SpotifyArtist[] } }
        const hits = json.artists?.items ?? []
        if (!hits.length) process.stderr.write(`   [spotify] 0 results (q="${q}" market="${market || 'global'}")\n`)
        for (const a of hits) {
          if (seen.has(a.id) || !a.images.length) continue
          if (scoreName(artist, a.name) === 0) continue
          seen.add(a.id)
          foundInMarket = true
          const img = a.images[0]
          out.push({
            sourceId:  a.id,
            sourceUrl: `https://open.spotify.com/artist/${a.id}`,
            imageUrl:  img.url, width: img.width, height: img.height,
            matchName: a.name,
            genreTags: a.genres.length ? a.genres : undefined,
            notes:     market ? `market=${market}` : 'market=global',
          })
        }
      } catch (err) { process.stderr.write(`   [spotify] search threw (q="${q}" market="${market || 'global'}"): ${err}\n`) }
      await sleep(200)
    }
  }
  return out
}

// ── Run all providers ──────────────────────────────────────────────────────────
const PROVIDER_FNS: Record<Source, (a: Artist) => Promise<RawCandidate[]>> = {
  deezer:      searchDeezer,
  bandcamp:    searchBandcamp,
  wikipedia:   searchWikipedia,
  theaudiodb:  searchTheAudioDB,
  discogs:     searchDiscogs,
  wikidata:    searchWikidata,
  musicbrainz: searchMusicBrainz,
  itunes:      searchITunes,
  unavatar:    searchUnavatar,
  spotify:     searchSpotify,
}

async function runProviders(artist: Artist): Promise<{
  pool: Map<Source, RawCandidate[]>
  errors: { source: Source; error: string }[]
}> {
  const pool   = new Map<Source, RawCandidate[]>()
  const errors: { source: Source; error: string }[] = []
  const enabled = ALL_SOURCES.filter((s) => ENABLED_SOURCES.has(s))
  const results = await Promise.allSettled(
    enabled.map((s) => PROVIDER_FNS[s](artist).then((cands) => ({ s, cands }))),
  )
  results.forEach((r, i) => {
    const src = enabled[i]
    if (r.status === 'fulfilled') pool.set(src, r.value.cands)
    else { errors.push({ source: src, error: String(r.reason) }); pool.set(src, []) }
  })
  return { pool, errors }
}

// ── Image storage ──────────────────────────────────────────────────────────────
async function uploadImage(slug: string, imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, {
      headers: { 'User-Agent': OL_UA }, signal: AbortSignal.timeout(20_000), redirect: 'follow',
    })
    if (!res.ok) return null
    const ct  = res.headers.get('content-type') ?? ''
    if (!ct.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const ext = extFromContentType(ct, imageUrl)
    const storagePath = `${slug}.${ext}`
    const { error } = await supabase.storage
      .from('artist-images')
      .upload(storagePath, buf, { contentType: ct, upsert: true })
    if (error) { console.error(`   ❌  Storage upload: ${error.message}`); return null }
    const { data: { publicUrl } } = supabase.storage.from('artist-images').getPublicUrl(storagePath)
    return publicUrl
  } catch (e) {
    console.error(`   ❌  Image download/upload: ${e}`)
    return null
  }
}

// ── LLM instagram fallback ─────────────────────────────────────────────────────
let haiku: HaikuClient | null = null
function getHaiku(): HaikuClient {
  if (!haiku) haiku = createHaikuClient({ rateDelayMs: 600 })
  return haiku
}

async function findInstagramUrl(artist: Artist): Promise<string | null> {
  const nameJa = artist.name_ja ? ` (Japanese: ${artist.name_ja})` : ''
  const raw = await getHaiku().askJson<{ instagram_url: string | null; confidence: string; notes: string }>({
    prompt: `You are a music industry researcher specialising in Japanese live music.

Artist: "${artist.name_en}"${nameJa}

Do you know the OFFICIAL Instagram profile for this artist?
Only provide a URL you are confident about. If you are not sure, return null.

Return ONLY valid JSON — no markdown, no extra text:
{"instagram_url": "https://www.instagram.com/..." or null, "confidence": "high"|"medium"|"low"|"unknown", "notes": "one-line explanation"}`,
    maxTokens: 200,
    validate:  (x): x is { instagram_url: string | null; confidence: string; notes: string } =>
      typeof x === 'object' && x !== null && ['high', 'medium', 'low', 'unknown'].includes((x as Record<string, unknown>).confidence as string),
    label: 'instagram',
  })
  if (!raw?.instagram_url) return null
  // Normalise handle → URL
  const url = raw.instagram_url
  try {
    const u = new URL(url)
    return u.hostname.includes('instagram.com') ? url.replace(/\/$/, '') : null
  } catch {
    const user = url.replace(/^@/, '').trim()
    return /^[\w.]+$/.test(user) ? `https://www.instagram.com/${user}` : null
  }
}

// ── Report output ──────────────────────────────────────────────────────────────
const reportDir = path.resolve(process.cwd(), 'tmp', 'enrich-artists')

interface ReportRow {
  slug:     string
  name_en:  string
  name_ja:  string | null
  verdict:  'hit' | 'ambiguous' | 'miss'
  winner:   ScoredCandidate | null
  updates:  Record<string, string | number | null>
  candidates: ScoredCandidate[]
  errors:   { source: Source; error: string }[]
}

// ── Per-artist processing ──────────────────────────────────────────────────────
async function processArtist(artist: Artist): Promise<ReportRow> {
  const updates: Record<string, string | number | null> = {}

  console.log(`\n→  ${artist.name_en}${artist.name_ja ? ` / ${artist.name_ja}` : ''}  [${artist.slug}]`)

  // ── Step 1: Multi-source providers ──────────────────────────────────────────
  const { pool, errors } = await runProviders(artist)
  const scored = scorePool(artist, pool)

  // Show top candidates
  for (const c of scored.slice(0, 4)) {
    console.log(
      `   [${c.source}] "${c.matchName}" score=${c.finalScore.toFixed(2)}` +
      `${c.crossVal ? ' ✚cv' : ''}` +
      `${c.width ? ` ${c.width}px` : ''}` +
      `${c.websiteUrl ? ` 🌐` : ''}` +
      `${c.genreTags?.length ? ` 🎵${c.genreTags[0]}` : ''}`,
    )
  }
  if (errors.length) console.log(`   ⚠  provider errors: ${errors.map((e) => e.source).join(', ')}`)

  // ── Step 2: Genre mapping ────────────────────────────────────────────────────
  if (!artist.genre_id) {
    const allTags = scored.flatMap((c) => c.genreTags ?? [])
    const genreId = mapGenre(allTags)
    if (genreId) {
      updates.genre_id = genreId
      console.log(`   genre → id=${genreId} (from: ${allTags.slice(0, 3).join(', ')})`)
    }
  }

  // ── Step 3: Website URL from providers ──────────────────────────────────────
  if (!artist.website_url) {
    // Prefer website from highest-scored candidate that has one
    const withWebsite = scored.find((c) => c.finalScore >= THRESHOLD && c.websiteUrl)
    if (withWebsite?.websiteUrl) {
      updates.website_url = withWebsite.websiteUrl
      console.log(`   website → ${withWebsite.websiteUrl} (via ${withWebsite.source})`)
    }
  }

  // ── Step 4: Image ────────────────────────────────────────────────────────────
  let winner: ScoredCandidate | null = null
  let verdict: ReportRow['verdict'] = 'miss'

  if (!SKIP_IMAGE && !artist.image_url) {
    const qualified = scored.filter((c) => c.finalScore >= THRESHOLD)
    if (qualified.length) {
      winner = qualified[0]
      const ambiguous = qualified.some(
        (c) => c !== winner && c.finalScore >= winner!.finalScore - 0.05 && norm(c.matchName) !== norm(winner!.matchName),
      )
      verdict = ambiguous ? 'ambiguous' : 'hit'
      console.log(`   image ${verdict} → [${winner.source}] "${winner.matchName}" (${winner.finalScore.toFixed(2)})`)

      if (!DRY_RUN) {
        const finalUrl = NO_UPLOAD
          ? winner.imageUrl
          : await uploadImage(artist.slug, winner.imageUrl)
        if (finalUrl) {
          updates.image_url = finalUrl
          if (!NO_UPLOAD) console.log(`   ↑ stored → artist-images/${artist.slug}.*`)
        } else {
          // Try runner-up
          const next = qualified.find((c) => c !== winner)
          if (next) {
            const fallbackUrl = NO_UPLOAD ? next.imageUrl : await uploadImage(artist.slug, next.imageUrl)
            if (fallbackUrl) { updates.image_url = fallbackUrl; winner = next }
            else { winner = null; verdict = 'miss' }
          } else { winner = null; verdict = 'miss' }
        }
      }
    } else {
      console.log(`   image miss (best=${scored[0]?.finalScore.toFixed(2) ?? 'n/a'})`)
    }
  }

  // ── Step 5: LLM instagram fallback ──────────────────────────────────────────
  if (!SKIP_LLM && !artist.instagram_url && !updates.instagram_url) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (apiKey) {
      const igUrl = DRY_RUN
        ? null
        : await findInstagramUrl(artist)
      if (igUrl) {
        updates.instagram_url = igUrl
        console.log(`   instagram → ${igUrl} (LLM)`)
      }
    }
  }

  // ── Step 6: Atomic write ─────────────────────────────────────────────────────
  // Only fill columns that are currently null
  const filteredUpdates: typeof updates = {}
  if (updates.image_url     && !artist.image_url)     filteredUpdates.image_url     = updates.image_url
  if (updates.website_url   && !artist.website_url)   filteredUpdates.website_url   = updates.website_url
  if (updates.instagram_url && !artist.instagram_url) filteredUpdates.instagram_url = updates.instagram_url
  if (updates.genre_id      && !artist.genre_id)      filteredUpdates.genre_id      = updates.genre_id

  if (Object.keys(filteredUpdates).length === 0) {
    console.log('   ⏭  nothing to write')
  } else if (DRY_RUN) {
    console.log(`   [dry-run] would UPDATE: ${JSON.stringify(filteredUpdates)}`)
  } else {
    const { error } = await supabase.from('artists').update(filteredUpdates).eq('slug', artist.slug)
    if (error) console.error(`   ❌  DB UPDATE: ${error.message}`)
    else       console.log(`   ✅  wrote: ${Object.keys(filteredUpdates).join(', ')}`)
  }

  return { slug: artist.slug, name_en: artist.name_en, name_ja: artist.name_ja, verdict, winner, updates: filteredUpdates, candidates: scored, errors }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  let query = supabase
    .from('artists')
    .select('id, slug, name_en, name_ja, instagram_url, website_url, image_url, genre_id')
    .order('name_en')

  if (SLUGS?.length) {
    query = query.in('slug', SLUGS)
  } else if (!FORCE) {
    query = query.is('image_url', null)
  }

  const { data, error } = await query
  if (error) { console.error('❌ ', error.message); process.exit(1) }
  let artists = (data ?? []) as Artist[]
  if (!artists.length) { console.log('✅  Nothing to do.'); return }
  if (LIMIT) artists = artists.slice(0, LIMIT)

  console.log(
    `\n🎸  enrich-artists v3 — ${artists.length} artist(s)` +
    `  sources=[${[...ENABLED_SOURCES].join(',')}]` +
    `  threshold=${THRESHOLD}` +
    (DRY_RUN    ? ' [dry-run]'    : '') +
    (SKIP_LLM   ? ' [skip-llm]'  : '') +
    (SKIP_IMAGE ? ' [skip-image]' : '') +
    (NO_UPLOAD  ? ' [no-upload]'  : '') +
    '\n',
  )

  fs.mkdirSync(reportDir, { recursive: true })
  const rows: ReportRow[] = []

  for (const a of artists) {
    rows.push(await processArtist(a))
    await sleep(300)
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const hits      = rows.filter((r) => r.verdict === 'hit').length
  const ambig     = rows.filter((r) => r.verdict === 'ambiguous').length
  const misses    = rows.filter((r) => r.verdict === 'miss').length
  const wroteSite = rows.filter((r) => r.updates.website_url).length
  const wroteIG   = rows.filter((r) => r.updates.instagram_url).length
  const wroteGenre = rows.filter((r) => r.updates.genre_id).length
  const total     = rows.length
  const pct       = (n: number) => ((n / total) * 100).toFixed(0)

  console.log('\n─────────────────────────────────────────────────────')
  console.log(`  image HIT        ${hits.toString().padStart(3)}  (${pct(hits)}%)`)
  console.log(`  image AMBIGUOUS  ${ambig.toString().padStart(3)}  (${pct(ambig)}%)`)
  console.log(`  image MISS       ${misses.toString().padStart(3)}  (${pct(misses)}%)`)
  console.log(`  website_url      ${wroteSite.toString().padStart(3)}  written`)
  console.log(`  instagram_url    ${wroteIG.toString().padStart(3)}  written (LLM)`)
  console.log(`  genre_id         ${wroteGenre.toString().padStart(3)}  written`)
  console.log('─────────────────────────────────────────────────────')
  console.log('  Image wins by source:')
  const winsBySource = new Map<Source, number>()
  for (const r of rows) {
    if (r.verdict === 'hit' && r.winner) winsBySource.set(r.winner.source, (winsBySource.get(r.winner.source) ?? 0) + 1)
  }
  for (const [src, n] of [...winsBySource.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`    ${src.padEnd(14)} ${n}`)
  console.log('')

  // Save report + miss-list
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(rows, null, 2))
  const missList = rows.filter((r) => r.verdict !== 'hit')
  const csv = [
    'slug,name_en,name_ja,best_source,best_source_url,best_score,override_image_url',
    ...missList.map((r) => {
      const b = r.candidates[0]
      return [
        r.slug,
        `"${r.name_en.replace(/"/g, '""')}"`,
        `"${(r.name_ja ?? '').replace(/"/g, '""')}"`,
        b?.source ?? '',
        b?.sourceUrl ?? '',
        b?.finalScore?.toFixed(4) ?? '',
        '',
      ].join(',')
    }),
  ]
  fs.writeFileSync(path.join(reportDir, 'miss-list.csv'), csv.join('\n'))
  console.log(`📄  report.json + miss-list.csv → ${reportDir}/`)

  if (!DRY_RUN) haiku?.logCostSummary()
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
