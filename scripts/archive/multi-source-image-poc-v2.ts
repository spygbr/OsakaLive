/**
 * scripts/multi-source-image-poc-v2.ts
 *
 * v2 of the zero-auth artist image enrichment PoC.
 * Adds: deezer, bandcamp, wikipedia, theaudiodb, discogs, spotify (optional)
 * plus cross-validation scoring and LLM fallback.
 *
 * READ-ONLY. Does not touch Supabase or Storage.
 *
 * Usage:
 *   npx tsx scripts/multi-source-image-poc-v2.ts [options]
 *
 *   --limit N              Process only first N artists
 *   --force                Re-test artists that already have image_url
 *   --sources a,b,c        Comma-separated provider names
 *   --llm                  Enable Claude fallback for misses
 *   --download             Save winner image to tmp/multi-source-poc-v2/
 *   --download-all         Save ALL candidates for visual review
 *   --artist <slug>        Run against a single artist
 *   --threshold N          Override winner score threshold (default 0.7)
 *
 * Env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL=...         (required)
 *   SUPABASE_SERVICE_ROLE_KEY=...        (required)
 *   SPOTIFY_CLIENT_ID=...               (optional)
 *   SPOTIFY_CLIENT_SECRET=...           (optional)
 *   DISCOGS_TOKEN=...                   (optional)
 *   ANTHROPIC_API_KEY=...               (optional; needed for --llm)
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
const DOWNLOAD     = process.argv.includes('--download')
const DOWNLOAD_ALL = process.argv.includes('--download-all')
const FORCE        = process.argv.includes('--force')
const LLM_ENABLED  = process.argv.includes('--llm')

const limitIdx = process.argv.indexOf('--limit')
const LIMIT: number | null =
  limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : null

const threshIdx = process.argv.indexOf('--threshold')
const THRESHOLD: number =
  threshIdx !== -1 ? parseFloat(process.argv[threshIdx + 1]) : 0.7

const artistIdx = process.argv.indexOf('--artist')
const SINGLE_ARTIST: string | null =
  artistIdx !== -1 ? process.argv[artistIdx + 1] : null

type Source =
  | 'deezer' | 'bandcamp' | 'wikipedia' | 'theaudiodb' | 'discogs'
  | 'wikidata' | 'musicbrainz' | 'itunes' | 'unavatar' | 'spotify'
  | 'llm-fallback'

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

// ── Provider weights ───────────────────────────────────────────────────────────
const PROVIDER_WEIGHT: Record<Source, number> = {
  wikipedia:     1.00,
  wikidata:      1.00,
  theaudiodb:    1.00,
  bandcamp:      1.00,
  spotify:       1.00,
  deezer:        0.95,
  unavatar:      0.95,
  discogs:       0.90,
  musicbrainz:   0.50,
  itunes:        0.50,
  'llm-fallback': 0.85,
}

// Provider priority for tie-breaking (higher = preferred)
const PROVIDER_RANK: Record<Source, number> = {
  wikipedia:     10,
  wikidata:       9,
  theaudiodb:     8,
  bandcamp:       7,
  spotify:        6,
  deezer:         5,
  unavatar:       4,
  discogs:        3,
  musicbrainz:    2,
  itunes:         1,
  'llm-fallback': 5,
}

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

interface RawCandidate {
  sourceId:     string
  sourceUrl:    string
  imageUrl:     string
  width?:       number
  height?:      number
  matchName:    string
  notes?:       string
  externalIds?: Record<string, string>
}

interface ScoredCandidate extends RawCandidate {
  source:      Source
  nameScore:   number
  finalScore:  number
  crossVal:    boolean
}

interface ProviderError {
  source: Source
  error:  string
}

interface ReportRow {
  slug:           string
  name_en:        string
  name_ja:        string | null
  winner:         (ScoredCandidate & { source: Source; finalScore: number }) | null
  verdict:        'hit' | 'ambiguous' | 'miss'
  candidates:     ScoredCandidate[]
  providerErrors: ProviderError[]
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

const OL_UA = 'OsakaLive/0.1 (https://osaka.live; diku@genkanconsulting.com)'

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
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

/** 1.0 exact, 0.85 substring, 0..0.8 Levenshtein ratio (≥ 0.7 only). */
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

/** Build a list of query strings to try for a provider (with fallbacks). */
function queryVariants(artist: Artist): string[] {
  const variants: string[] = [artist.name_en]
  const stripped = stripParens(artist.name_en)
  if (stripped && stripped !== artist.name_en) variants.push(stripped)
  if (artist.name_ja && artist.name_ja !== artist.name_en) variants.push(artist.name_ja)
  return [...new Set(variants)]
}

// ── Cross-validation scoring ───────────────────────────────────────────────────
function applyCrossValidation(
  pool: Map<Source, RawCandidate[]>,
): Map<string, number> {
  // Group candidates by norm(matchName) → which sources found that name
  const nameToSources = new Map<string, Set<Source>>()
  for (const [src, cands] of pool) {
    for (const c of cands) {
      const key = norm(c.matchName)
      if (!nameToSources.has(key)) nameToSources.set(key, new Set())
      nameToSources.get(key)!.add(src)
    }
  }
  // Emit +0.10 bonus for names seen by ≥2 different sources
  const bonuses = new Map<string, number>()
  for (const [name, srcs] of nameToSources) {
    if (srcs.size >= 2) bonuses.set(name, 0.10)
  }
  return bonuses
}

// ── Provider: deezer ───────────────────────────────────────────────────────────
async function searchDeezer(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []
  const seen = new Set<number>()

  for (const q of queryVariants(artist)) {
    try {
      const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
      if (!res.ok) continue
      const json = await res.json() as {
        data?: { id: number; name: string; picture_xl?: string; link: string }[]
      }
      for (const r of json.data ?? []) {
        if (seen.has(r.id) || !r.picture_xl) continue
        seen.add(r.id)
        const score = scoreName(artist, r.name)
        if (score === 0) continue
        out.push({
          sourceId:  String(r.id),
          sourceUrl: r.link,
          imageUrl:  r.picture_xl,
          width:     1000, height: 1000,
          matchName: r.name,
        })
      }
    } catch {
      // swallow
    }
    await sleep(200)
  }
  return out
}

// ── Provider: bandcamp ─────────────────────────────────────────────────────────
async function searchBandcamp(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []

  for (const q of queryVariants(artist)) {
    try {
      const searchUrl = `https://bandcamp.com/search?q=${encodeURIComponent(q)}&item_type=b`
      const searchRes = await fetch(searchUrl, {
        headers: { 'User-Agent': OL_UA },
        signal: AbortSignal.timeout(12_000),
        redirect: 'follow',
      })
      if (!searchRes.ok) continue
      const html = await searchRes.text()

      // Extract the first band-page link from search results
      const linkMatch =
        html.match(/<li[^>]*class="[^"]*searchresult[^"]*"[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+\.bandcamp\.com[^"]*)"/) ??
        html.match(/class="heading">\s*<a[^>]+href="(https?:\/\/[^"]+bandcamp\.com[^"]*)"/)

      const bandUrl = linkMatch?.[1]
      if (!bandUrl) continue

      await sleep(1000)

      const bandRes = await fetch(bandUrl, {
        headers: { 'User-Agent': OL_UA },
        signal: AbortSignal.timeout(12_000),
        redirect: 'follow',
      })
      if (!bandRes.ok) continue
      const bandHtml = await bandRes.text()

      // Extract band name from title
      const titleMatch = bandHtml.match(/<title[^>]*>([^<]+)<\/title>/)
      const bandTitle = titleMatch ? titleMatch[1].replace(/\s*\|.*$/, '').trim() : ''
      const nameScore = scoreName(artist, bandTitle)
      if (nameScore === 0) continue

      // og:image is reliable on Bandcamp band pages
      const ogMatch = bandHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)
        ?? bandHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/)
      // Also check bio-pic img
      const bioPicMatch = bandHtml.match(/<div[^>]*class="[^"]*bio-pic[^"]*"[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/)

      const imageUrl = bioPicMatch?.[1] ?? ogMatch?.[1]
      if (!imageUrl) continue

      out.push({
        sourceId:  bandUrl,
        sourceUrl: bandUrl,
        imageUrl,
        matchName: bandTitle,
        notes:     `Bandcamp band page`,
      })
      break // one result per query attempt is enough
    } catch {
      // swallow
    }
    await sleep(1000)
  }
  return out
}

// ── Provider: wikipedia ────────────────────────────────────────────────────────
async function searchWikipedia(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []

  interface WikiQuery { lang: string; name: string }
  const queries: WikiQuery[] = [{ lang: 'en', name: artist.name_en }]
  const stripped = stripParens(artist.name_en)
  if (stripped !== artist.name_en) queries.push({ lang: 'en', name: stripped })
  if (artist.name_ja && artist.name_ja !== artist.name_en)
    queries.push({ lang: 'ja', name: artist.name_ja })

  for (const { lang, name } of queries) {
    try {
      const apiBase = `https://${lang}.wikipedia.org/w/api.php`
      const imgUrl =
        `${apiBase}?action=query&format=json&origin=*` +
        `&prop=pageimages&piprop=original&titles=${encodeURIComponent(name)}`
      const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(12_000) })
      if (!imgRes.ok) continue
      const imgJson = await imgRes.json() as {
        query?: {
          pages?: Record<string, {
            title:    string
            original?: { source: string; width: number; height: number }
            missing?: string
          }>
        }
      }
      const pages = imgJson.query?.pages ?? {}
      for (const page of Object.values(pages)) {
        if ('missing' in page || !page.original) continue

        // Validate: fetch first paragraph to check musician keywords
        const extractUrl =
          `${apiBase}?action=query&format=json&origin=*` +
          `&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(page.title)}`
        try {
          const extractRes = await fetch(extractUrl, { signal: AbortSignal.timeout(10_000) })
          if (extractRes.ok) {
            const extractJson = await extractRes.json() as {
              query?: { pages?: Record<string, { extract?: string }> }
            }
            const extract = Object.values(extractJson.query?.pages ?? {})
              .map((p) => p.extract ?? '').join(' ')
            const isMusician =
              /musician|singer|band|composer|rapper|dj|group|musical group|rock band|punk|metal|noise|indie|idol|歌手|ミュージシャン|バンド/i
                .test(extract)
            if (!isMusician) continue
          }
        } catch {
          // If validation fails, allow it through (benefit of the doubt)
        }

        const score = scoreName(artist, page.title)
        if (score === 0) continue

        out.push({
          sourceId:  page.title,
          sourceUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
          imageUrl:  page.original.source,
          width:     page.original.width,
          height:    page.original.height,
          matchName: page.title,
          notes:     `Wikipedia ${lang} infobox image`,
        })
      }
    } catch {
      // swallow
    }
    await sleep(300)
  }
  return out
}

// ── Provider: theaudiodb ───────────────────────────────────────────────────────
async function searchTheAudioDB(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []

  for (const q of queryVariants(artist)) {
    try {
      const url = `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(q)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
      if (!res.ok) continue
      const json = await res.json() as {
        artists?: {
          idArtist:        string
          strArtist:       string
          strArtistThumb?: string
          strArtistFanart?: string
          strCountry?:     string
          strBiographyEN?: string
        }[]
      }
      for (const a of json.artists ?? []) {
        const imageUrl = a.strArtistThumb ?? a.strArtistFanart
        if (!imageUrl) continue
        const score = scoreName(artist, a.strArtist)
        if (score === 0) continue
        out.push({
          sourceId:  a.idArtist,
          sourceUrl: `https://www.theaudiodb.com/artist/${a.idArtist}`,
          imageUrl,
          matchName: a.strArtist,
          notes:     [
            a.strArtistThumb ? undefined : 'fanart (no thumb)',
            a.strCountry,
          ].filter(Boolean).join('; ') || undefined,
        })
      }
    } catch {
      // swallow
    }
    await sleep(250)
  }
  return out
}

// ── Provider: discogs ──────────────────────────────────────────────────────────
async function searchDiscogs(artist: Artist): Promise<RawCandidate[]> {
  const token = process.env.DISCOGS_TOKEN
  const delay  = token ? 1100 : 2500
  const out: RawCandidate[] = []
  const seen = new Set<number>()

  const headers: Record<string, string> = {
    'User-Agent': OL_UA,
    Accept: 'application/json',
  }
  if (token) headers['Authorization'] = `Discogs token=${token}`

  for (const q of queryVariants(artist)) {
    try {
      const searchUrl =
        `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=artist`
      const searchRes = await fetch(searchUrl, {
        headers,
        signal: AbortSignal.timeout(12_000),
      })
      if (!searchRes.ok) { await sleep(delay); continue }
      const searchJson = await searchRes.json() as {
        results?: { id: number; title: string; cover_image?: string; type: string }[]
      }

      for (const r of (searchJson.results ?? []).filter((x) => x.type === 'artist')) {
        if (seen.has(r.id)) continue
        seen.add(r.id)
        const nameScore = scoreName(artist, r.title)
        if (nameScore === 0) continue

        await sleep(delay)
        // Fetch detailed artist page for primary image
        try {
          const detailRes = await fetch(
            `https://api.discogs.com/artists/${r.id}`,
            { headers, signal: AbortSignal.timeout(12_000) },
          )
          if (!detailRes.ok) continue
          const detail = await detailRes.json() as {
            name:    string
            images?: { uri: string; type: 'primary' | 'secondary'; width?: number; height?: number }[]
          }
          const imgs = detail.images ?? []
          const primary = imgs.find((i) => i.type === 'primary') ?? imgs[0]
          if (!primary) continue

          out.push({
            sourceId:  String(r.id),
            sourceUrl: `https://www.discogs.com/artist/${r.id}`,
            imageUrl:  primary.uri,
            width:     primary.width,
            height:    primary.height,
            matchName: detail.name ?? r.title,
            notes:     primary.type === 'secondary' ? 'secondary image (no primary)' : undefined,
          })
        } catch {
          // swallow detail fetch error
        }
      }
    } catch {
      // swallow
    }
    await sleep(delay)
  }
  return out
}

// ── Provider: wikidata (from v1) ───────────────────────────────────────────────
async function searchWikidata(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []
  const names = queryVariants(artist)

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

  const ids = [...new Set(hits.map((h) => h.id))].slice(0, 8)
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
      const isMusician =
        /musician|singer|band|composer|rapper|idol|dj|group|artist|歌手|ミュージシャン|バンド|作曲家/i
          .test(desc)
      if (!isMusician) continue
      const p18 = e.claims['P18']?.[0]?.mainsnak?.datavalue?.value as string | undefined
      if (!p18) continue
      const score = scoreName(artist, label)
      if (score === 0) continue
      const fileName = p18.replace(/ /g, '_')
      const imageUrl =
        `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=1200`
      out.push({
        sourceId:  id,
        sourceUrl: `https://www.wikidata.org/wiki/${id}`,
        imageUrl,
        matchName: label,
        notes:     desc,
      })
    }
  } catch {
    // ignore
  }
  return out.sort((a, b) => scoreName(artist, b.matchName) - scoreName(artist, a.matchName))
}

// ── Provider: musicbrainz (from v1) ───────────────────────────────────────────
async function searchMusicBrainz(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []
  for (const q of queryVariants(artist)) {
    const url =
      `https://musicbrainz.org/ws/2/artist/?fmt=json&limit=5&query=${encodeURIComponent(q)}`
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': OL_UA, Accept: 'application/json' },
        signal:  AbortSignal.timeout(12_000),
      })
      if (!res.ok) { await sleep(1100); continue }
      const json = await res.json() as {
        artists?: { id: string; name: string; country?: string }[]
      }
      for (const a of json.artists ?? []) {
        const score = scoreName(artist, a.name)
        if (score === 0) continue
        const coverUrl = `https://coverartarchive.org/artist/${a.id}/front-500`
        try {
          const head = await fetch(coverUrl, {
            method: 'HEAD',
            headers: { 'User-Agent': OL_UA },
            signal: AbortSignal.timeout(8_000),
          })
          if (head.ok) {
            out.push({
              sourceId:  a.id,
              sourceUrl: `https://musicbrainz.org/artist/${a.id}`,
              imageUrl:  coverUrl,
              matchName: a.name,
              notes:     `MBID ${a.id}${a.country ? ` (${a.country})` : ''}`,
            })
          }
        } catch {
          // no cover art
        }
        await sleep(1100)
      }
    } catch {
      // ignore
    }
    await sleep(1100)
  }
  return out
}

// ── Provider: itunes (from v1) ─────────────────────────────────────────────────
async function searchITunes(artist: Artist): Promise<RawCandidate[]> {
  const out: RawCandidate[] = []
  for (const q of queryVariants(artist)) {
    const url =
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=5&country=JP`
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
          sourceId:  String(r.artistId),
          sourceUrl: r.collectionViewUrl,
          imageUrl:  hires,
          width:     1200, height: 1200,
          matchName: r.artistName,
          notes:     `album artwork: "${r.collectionName}"`,
        })
      }
    } catch {
      // swallow
    }
    await sleep(250)
  }
  // Dedupe by artistId, keep highest score
  const byId = new Map<string, RawCandidate>()
  for (const c of out) {
    const ex = byId.get(c.sourceId)
    if (!ex || scoreName(artist, c.matchName) > scoreName(artist, ex.matchName))
      byId.set(c.sourceId, c)
  }
  return [...byId.values()]
}

// ── Provider: unavatar ─────────────────────────────────────────────────────────
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

async function searchUnavatar(artist: Artist): Promise<RawCandidate[]> {
  if (!artist.instagram_url) return []
  const handle = extractInstagramHandle(artist.instagram_url)
  if (!handle) return []
  const imageUrl = `https://unavatar.io/instagram/${handle}?fallback=false`
  try {
    const res = await fetch(imageUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(12_000),
      redirect: 'follow',
    })
    if (!res.ok) return []
    return [{
      sourceId:  handle,
      sourceUrl: artist.instagram_url,
      imageUrl,
      matchName: handle,
      notes:     `proxied IG avatar for @${handle}`,
    }]
  } catch {
    return []
  }
}

// ── Provider: spotify ──────────────────────────────────────────────────────────
let _spotifyToken: string | null = null

async function getSpotifyToken(): Promise<string | null> {
  if (_spotifyToken) return _spotifyToken
  const cid = process.env.SPOTIFY_CLIENT_ID
  const sec = process.env.SPOTIFY_CLIENT_SECRET
  if (!cid || !sec) return null
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
    if (!res.ok) return null // 403 = Premium not yet propagated
    const json = await res.json() as { access_token?: string }
    _spotifyToken = json.access_token ?? null
    return _spotifyToken
  } catch {
    return null
  }
}

async function searchSpotify(artist: Artist): Promise<RawCandidate[]> {
  const token = await getSpotifyToken()
  if (!token) return []

  type SpotifyResponse = {
    artists?: {
      items: {
        id:     string
        name:   string
        images: { url: string; width?: number; height?: number }[]
      }[]
    }
  }

  const seen = new Set<string>()
  const out: RawCandidate[] = []

  // Try market=JP first (better disambiguation), fall back to global if empty.
  // Some JP artists are catalogued globally but not explicitly filed under JP market.
  const marketVariants = ['JP', ''] as const

  for (const q of queryVariants(artist)) {
    let foundInMarket = false
    for (const market of marketVariants) {
      if (foundInMarket) break // JP search found something — skip global
      try {
        const params = new URLSearchParams({
          q, type: 'artist', limit: '5',
          ...(market ? { market } : {}),
        })
        const url = `https://api.spotify.com/v1/search?${params}`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal:  AbortSignal.timeout(12_000),
        })
        if (!res.ok) continue
        const json = await res.json() as SpotifyResponse
        const items = json.artists?.items ?? []
        for (const a of items) {
          if (seen.has(a.id) || !a.images.length) continue
          const score = scoreName(artist, a.name)
          if (score === 0) continue
          seen.add(a.id)
          foundInMarket = true
          const img = a.images[0]
          out.push({
            sourceId:  a.id,
            sourceUrl: `https://open.spotify.com/artist/${a.id}`,
            imageUrl:  img.url,
            width:     img.width,
            height:    img.height,
            matchName: a.name,
            notes:     market ? `market=${market}` : 'market=global',
          })
        }
      } catch {
        // swallow
      }
      await sleep(200)
    }
  }
  return out
}

// ── Provider: LLM fallback ─────────────────────────────────────────────────────
async function searchLLMFallback(artist: Artist): Promise<RawCandidate[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return []

  try {
    const prompt = `You are helping find an image URL for a music artist. Given the artist details below, return a single JSON object with the best publicly accessible image URL that shows a photo of this specific artist (band or solo musician).

Artist: ${artist.name_en}${artist.name_ja ? ` (${artist.name_ja})` : ''}

Respond ONLY with this JSON schema (no markdown, no explanation):
{"image_url": "<url or null>", "source_page": "<page url or null>", "confidence": "high|medium|low", "reason": "<brief reason>"}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return []
    const json = await res.json() as {
      content?: { type: string; text: string }[]
    }
    const text = json.content?.find((c) => c.type === 'text')?.text ?? ''
    const parsed = JSON.parse(text) as {
      image_url: string | null
      source_page: string | null
      confidence: string
      reason: string
    }
    if (!parsed.image_url) return []

    // Verify the URL resolves to an image
    const head = await fetch(parsed.image_url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    })
    if (!head.ok) return []
    const ct = head.headers.get('content-type') ?? ''
    if (!ct.startsWith('image/')) return []

    return [{
      sourceId:  parsed.source_page ?? parsed.image_url,
      sourceUrl: parsed.source_page ?? parsed.image_url,
      imageUrl:  parsed.image_url,
      matchName: artist.name_en,
      notes:     `LLM (${parsed.confidence}): ${parsed.reason}`,
    }]
  } catch {
    return []
  }
}

// ── Orchestrator ───────────────────────────────────────────────────────────────
interface ProviderDef {
  name:   Source
  fn:     (artist: Artist) => Promise<RawCandidate[]>
  weight: number
}

const PROVIDERS: ProviderDef[] = [
  { name: 'deezer',      fn: searchDeezer,      weight: PROVIDER_WEIGHT.deezer },
  { name: 'bandcamp',    fn: searchBandcamp,    weight: PROVIDER_WEIGHT.bandcamp },
  { name: 'wikipedia',   fn: searchWikipedia,   weight: PROVIDER_WEIGHT.wikipedia },
  { name: 'theaudiodb',  fn: searchTheAudioDB,  weight: PROVIDER_WEIGHT.theaudiodb },
  { name: 'discogs',     fn: searchDiscogs,      weight: PROVIDER_WEIGHT.discogs },
  { name: 'wikidata',    fn: searchWikidata,    weight: PROVIDER_WEIGHT.wikidata },
  { name: 'musicbrainz', fn: searchMusicBrainz, weight: PROVIDER_WEIGHT.musicbrainz },
  { name: 'itunes',      fn: searchITunes,      weight: PROVIDER_WEIGHT.itunes },
  { name: 'unavatar',    fn: searchUnavatar,    weight: PROVIDER_WEIGHT.unavatar },
  { name: 'spotify',     fn: searchSpotify,     weight: PROVIDER_WEIGHT.spotify },
]

async function runAllProviders(
  artist: Artist,
): Promise<{ pool: Map<Source, RawCandidate[]>; errors: ProviderError[] }> {
  const enabled = PROVIDERS.filter((p) => ENABLED_SOURCES.has(p.name))
  const pool = new Map<Source, RawCandidate[]>()
  const errors: ProviderError[] = []

  const results = await Promise.allSettled(
    enabled.map(async (p) => {
      const cands = await p.fn(artist)
      return { name: p.name, cands }
    }),
  )

  for (const [i, r] of results.entries()) {
    const name = enabled[i].name
    if (r.status === 'fulfilled') {
      pool.set(name, r.value.cands)
    } else {
      errors.push({ source: name, error: String(r.reason) })
      pool.set(name, [])
    }
  }
  return { pool, errors }
}

function scorePool(
  artist: Artist,
  pool: Map<Source, RawCandidate[]>,
): ScoredCandidate[] {
  const crossBonuses = applyCrossValidation(pool)
  const scored: ScoredCandidate[] = []

  for (const [src, cands] of pool) {
    const weight = PROVIDER_WEIGHT[src] ?? 1.0
    for (const c of cands) {
      const nameScore = scoreName(artist, c.matchName)
      const normName  = norm(c.matchName)
      const crossVal  = crossBonuses.has(normName)
      const crossBonus = crossVal ? 0.10 : 0
      const sizePenalty = (c.width !== undefined && c.width < 300) ? -0.20 : 0
      const finalScore = Math.min(1.0, nameScore * weight + crossBonus + sizePenalty)
      scored.push({ ...c, source: src, nameScore, finalScore, crossVal })
    }
  }

  scored.sort((a, b) => {
    if (Math.abs(b.finalScore - a.finalScore) > 0.001) return b.finalScore - a.finalScore
    return PROVIDER_RANK[b.source] - PROVIDER_RANK[a.source]
  })
  return scored
}

async function verifyImageUrl(imageUrl: string): Promise<boolean> {
  try {
    const res = await fetch(imageUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
      headers: { 'User-Agent': OL_UA },
    })
    return res.ok
  } catch {
    return false
  }
}

function pickWinner(scored: ScoredCandidate[], threshold: number): {
  winner: ScoredCandidate | null
  ambiguous: boolean
} {
  const qualified = scored.filter((c) => c.finalScore >= threshold)
  if (qualified.length === 0) return { winner: null, ambiguous: false }

  const top = qualified[0]
  const ambiguous = qualified.some(
    (c) =>
      c !== top &&
      c.finalScore >= top.finalScore - 0.05 &&
      norm(c.matchName) !== norm(top.matchName),
  )
  return { winner: top, ambiguous }
}

// ── Download helper ────────────────────────────────────────────────────────────
async function downloadImage(
  slug: string,
  source: Source,
  imageUrl: string,
  outDir: string,
): Promise<void> {
  try {
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(20_000),
      redirect: 'follow',
      headers: { 'User-Agent': OL_UA },
    })
    if (!res.ok) return
    const ct  = res.headers.get('content-type') ?? 'image/jpeg'
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(path.join(outDir, `${slug}.${source}.${ext}`), buf)
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

  if (SINGLE_ARTIST) {
    query = query.eq('slug', SINGLE_ARTIST)
  } else if (!FORCE) {
    query = query.is('image_url', null)
  }

  const { data, error } = await query
  if (error) {
    console.error('❌  Supabase query failed:', error.message)
    process.exit(1)
  }

  let artists = (data ?? []) as Artist[]
  if (artists.length === 0) {
    console.log('✅  No artists to test. Use --force to re-test ones with image_url.')
    return
  }
  if (LIMIT) artists = artists.slice(0, LIMIT)

  const outDir = path.resolve(process.cwd(), 'tmp', 'multi-source-poc-v2')
  fs.mkdirSync(outDir, { recursive: true })

  console.log(
    `\n🎨  Multi-source image PoC v2 — ${artists.length} artist(s)` +
    `  sources=[${[...ENABLED_SOURCES].join(',')}]` +
    `  threshold=${THRESHOLD}` +
    (LLM_ENABLED ? ' [--llm]' : '') +
    (DOWNLOAD || DOWNLOAD_ALL ? ' [download]' : '') +
    '\n',
  )

  const rows: ReportRow[] = []
  const winsBySource = new Map<Source, number>()
  const providerHits = new Map<Source, number>()  // non-empty responses
  const providerTried = new Map<Source, number>() // artists tried

  for (const a of artists) {
    const jaSuffix = a.name_ja && a.name_ja !== a.name_en ? ` / ${a.name_ja}` : ''
    console.log(`→  ${a.name_en}${jaSuffix}  [${a.slug}]`)

    // Track which providers were tried
    for (const p of PROVIDERS) {
      if (ENABLED_SOURCES.has(p.name)) {
        providerTried.set(p.name, (providerTried.get(p.name) ?? 0) + 1)
      }
    }

    const { pool, errors } = await runAllProviders(a)

    // Track non-empty responses
    for (const [src, cands] of pool) {
      if (cands.length > 0) {
        providerHits.set(src, (providerHits.get(src) ?? 0) + 1)
      }
    }

    let scored = scorePool(a, pool)

    // LLM fallback if no qualifying candidates
    const topScore = scored[0]?.finalScore ?? 0
    if (LLM_ENABLED && topScore < THRESHOLD) {
      console.log(`   [llm-fallback] triggering...`)
      try {
        const llmCands = await searchLLMFallback(a)
        if (llmCands.length > 0) {
          const llmWeight = PROVIDER_WEIGHT['llm-fallback']
          const llmScored: ScoredCandidate[] = llmCands.map((c) => ({
            ...c,
            source:     'llm-fallback' as Source,
            nameScore:  scoreName(a, c.matchName),
            finalScore: Math.min(1.0, scoreName(a, c.matchName) * llmWeight),
            crossVal:   false,
          }))
          scored = [...scored, ...llmScored].sort(
            (x, y) => y.finalScore - x.finalScore,
          )
          pool.set('llm-fallback', llmCands)
          providerTried.set('llm-fallback', (providerTried.get('llm-fallback') ?? 0) + 1)
          providerHits.set('llm-fallback', (providerHits.get('llm-fallback') ?? 0) + 1)
        }
      } catch {
        // ignore
      }
    }

    // Show top candidates
    for (const c of scored.slice(0, 5)) {
      console.log(
        `     [${c.source}] "${c.matchName}" ` +
        `nameScore=${c.nameScore.toFixed(2)} finalScore=${c.finalScore.toFixed(2)}` +
        `${c.crossVal ? ' ✚cv' : ''}` +
        `${c.width ? ` ${c.width}x${c.height}` : ''}` +
        `${c.notes ? ` — ${c.notes}` : ''}`,
      )
    }

    let { winner, ambiguous } = pickWinner(scored, THRESHOLD)

    // HEAD-verify winner; fall through to next if 404
    if (winner) {
      const ok = await verifyImageUrl(winner.imageUrl)
      if (!ok) {
        console.log(`     ⚠  winner URL returned non-2xx, trying runner-up...`)
        const next = scored.find((c) => c !== winner && c.finalScore >= THRESHOLD)
        winner = next ?? null
        if (winner) {
          const ok2 = await verifyImageUrl(winner.imageUrl)
          if (!ok2) winner = null
        }
      }
    }

    const verdict = !winner ? 'miss' : ambiguous ? 'ambiguous' : 'hit'
    console.log(
      winner
        ? `   ${verdict === 'hit' ? 'HIT ' : 'AMBIG'}  → [${winner.source}] "${winner.matchName}" (${winner.finalScore.toFixed(2)})\n`
        : `   MISS  (${scored.length} candidates, best=${scored[0]?.finalScore.toFixed(2) ?? 'n/a'})\n`,
    )

    if (winner && verdict === 'hit') {
      winsBySource.set(winner.source, (winsBySource.get(winner.source) ?? 0) + 1)
    }

    rows.push({
      slug:      a.slug,
      name_en:   a.name_en,
      name_ja:   a.name_ja,
      winner:    winner ?? null,
      verdict,
      candidates: scored,
      providerErrors: errors,
    })

    if ((DOWNLOAD || DOWNLOAD_ALL) && winner) {
      await downloadImage(a.slug, winner.source, winner.imageUrl, outDir)
    }
    if (DOWNLOAD_ALL) {
      for (const c of scored.slice(0, 10)) {
        await downloadImage(`${a.slug}.ALL`, c.source, c.imageUrl, outDir)
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const hits   = rows.filter((r) => r.verdict === 'hit').length
  const ambig  = rows.filter((r) => r.verdict === 'ambiguous').length
  const misses = rows.filter((r) => r.verdict === 'miss').length
  const total  = rows.length
  const pct    = (n: number) => ((n / total) * 100).toFixed(0)

  console.log('─────────────────────────────────────────────────────')
  console.log(`  HIT        ${hits.toString().padStart(3)}  (${pct(hits)}%)`)
  console.log(`  AMBIGUOUS  ${ambig.toString().padStart(3)}  (${pct(ambig)}%)`)
  console.log(`  MISS       ${misses.toString().padStart(3)}  (${pct(misses)}%)`)
  console.log('─────────────────────────────────────────────────────')
  console.log('  Wins by source (hits only):')
  for (const [src, n] of [...winsBySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${src.padEnd(14)} ${n}`)
  }
  console.log('  Provider reliability (non-empty / tried):')
  for (const p of PROVIDERS) {
    if (!ENABLED_SOURCES.has(p.name)) continue
    const tried = providerTried.get(p.name) ?? 0
    const hit   = providerHits.get(p.name) ?? 0
    console.log(`    ${p.name.padEnd(14)} ${hit}/${tried}`)
  }
  if (LLM_ENABLED) {
    const llmTried = providerTried.get('llm-fallback') ?? 0
    const llmHit   = providerHits.get('llm-fallback') ?? 0
    if (llmTried > 0)
      console.log(`    ${'llm-fallback'.padEnd(14)} ${llmHit}/${llmTried} (triggered for ${llmTried} artist(s))`)
  }
  console.log('─────────────────────────────────────────────────────\n')

  // ── report.json ───────────────────────────────────────────────────────────────
  const reportPath = path.join(outDir, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(rows, null, 2))
  console.log(`📄  report.json → ${reportPath}`)

  // ── miss-list.csv ─────────────────────────────────────────────────────────────
  const missPath = path.join(outDir, 'miss-list.csv')
  const missRows = rows.filter((r) => r.verdict !== 'hit')
  const csvLines = [
    'slug,name_en,name_ja,best_source,best_source_url,best_match_name,best_final_score,override_image_url',
    ...missRows.map((r) => {
      const best = r.candidates[0]
      return [
        r.slug,
        `"${r.name_en.replace(/"/g, '""')}"`,
        `"${(r.name_ja ?? '').replace(/"/g, '""')}"`,
        best?.source ?? '',
        best?.sourceUrl ?? '',
        `"${(best?.matchName ?? '').replace(/"/g, '""')}"`,
        best?.finalScore?.toFixed(4) ?? '',
        '',  // override_image_url — human fills in
      ].join(',')
    }),
  ]
  fs.writeFileSync(missPath, csvLines.join('\n'))
  console.log(`📋  miss-list.csv → ${missPath}  (${missRows.length} row(s))`)
  if (DOWNLOAD || DOWNLOAD_ALL)
    console.log(`🖼   Images → ${outDir}/*.{jpg,png,webp}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
