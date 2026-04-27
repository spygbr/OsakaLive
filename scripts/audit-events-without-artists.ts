/**
 * scripts/audit-events-without-artists.ts
 *
 * Triages upcoming events that have no rows in event_artists.
 * Classifies each event into:
 *
 *   (a) NO_LINEUP     — genuinely no lineup data in raw_payload and title looks
 *                       like a show/series name (not a single act)
 *   (b) TITLE_IS_ACT  — raw_payload has no lineup, but stripped title looks like
 *                       a single artist name (no commas/slashes/× after stripping).
 *                       These should be picked up by extract-artist-candidates title fallback.
 *   (c) HAS_LINEUP    — raw_payload.lineup is non-empty — candidates existed but
 *                       were never promoted (silent extraction failure or pending review).
 *
 * Outputs:
 *   - Console summary with per-venue breakdown
 *   - tmp/audit-no-artists/report.csv  (full list, machine-readable)
 *
 * Usage:
 *   npx tsx scripts/audit-events-without-artists.ts
 *   npx tsx scripts/audit-events-without-artists.ts --all   # include past events too
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const INCLUDE_PAST = process.argv.includes('--all')

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

/** JST today as YYYY-MM-DD */
function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// ── Reuse noise-stripping logic from extract-artist-candidates ─────────────────

function stripTitleNoise(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^\d+[部章節][】]?\s*/, '')
  s = s.replace(/^[『【〈《「（(]+|[』】〉》」）)]+$/g, '').trim()
  s = s.replace(/^["'「」]+|["'「」]+$/g, '').trim()
  const noiseSegments: RegExp[] = [
    /\s+(presents?|pre\.|pres\.)(\s+.*)?$/i,
    /\s*[-–—]?\s*(vol\.?\s*\d+|#\d+|day\s*\.?\s*\d+|part\s+\d+)\s*/gi,
    /\s*(release\s+(event|party|live)|birthday\s+(live|party)|生誕祭?|周年)\s*/gi,
    /\s*(tour|ツアー|festival|fest)\b/gi,
    /\s*\bjapan\s+(tour|show|leg)\b/gi,
    /\s*\blive\s+in\s+japan\b/i,
    /\s*\bin\s+japan\b/i,
    /\s+oneman(\s+live)?\s*/gi,
    /ワンマン/g,
    /\s+live(\s+tour)?\s*$/i,
    /\s+ライブ(\s+tour)?\s*$/gi,
    /\s+20\d\d\s*$/,
    /\d+周年/,
    /\d+記念/,
    /記念/,
  ]
  for (const re of noiseSegments) s = s.replace(re, ' ')
  s = s.replace(/^[\s\-–—_/\\*#@!()\[\]{}<>,"'`~^。、]+/, '')
  s = s.replace(/[\s\-–—_/\\*#@!()\[\]{}<>,"'`~^。、]+$/, '')
  return s.trim()
}

/** True if stripped title looks like a single artist (no multi-act separators) */
function looksLikeSingleAct(stripped: string): boolean {
  if (stripped.length < 3 || stripped.length > 35) return false
  if (/[,，]/.test(stripped))                       return false  // comma = multiple acts
  if (/\s+[/／]\s+/.test(stripped))                return false  // spaced slash = multiple acts
  if (/\bvs\.?\b/i.test(stripped))                 return false
  if (/×/.test(stripped))                           return false  // collab marker
  if (/\s{2,}/.test(stripped))                     return false  // double space = descriptor
  // Japanese particles in the middle → phrase, not a name
  if (/[のはをがでにへと].+/.test(stripped))        return false
  return true
}

type Category = 'TITLE_IS_ACT' | 'HAS_LINEUP' | 'NO_LINEUP'

interface EventRow {
  id:         string
  title_raw:  string | null
  title_en:   string
  event_date: string
  venue:      string
  source_url: string | null
  lineup:     string[]
  category:   Category
  stripped_title: string
}

async function main() {
  const today = todayJST()
  console.log(`\n🔍  Auditing events with no artists${INCLUDE_PAST ? ' (all time)' : ` (upcoming ≥ ${today})`}\n`)

  // Load events with no event_artists
  const eventsQuery = supabase
    .from('events')
    .select(`
      id, title_raw, title_en, event_date,
      venue:venues(name_en),
      event_artists(id),
      event_sources(source_url, raw_payload)
    `)
    .order('event_date', { ascending: true })

  if (!INCLUDE_PAST) eventsQuery.gte('event_date', today)

  const { data: allEvents, error } = await eventsQuery
  if (error) { console.error('❌', error.message); process.exit(1) }

  // Filter to events with no artists
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noArtistEvents = (allEvents ?? []).filter((e: any) =>
    !e.event_artists || e.event_artists.length === 0,
  )

  console.log(`📅  Total events loaded       : ${(allEvents ?? []).length}`)
  console.log(`🚫  Events with no artists    : ${noArtistEvents.length}\n`)

  // Categorise
  const rows: EventRow[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const e of noArtistEvents as any[]) {
    const sources = (e.event_sources ?? []) as { source_url: string | null; raw_payload: Record<string, unknown> | null }[]
    const lineup: string[] = sources
      .flatMap(s => s.raw_payload?.lineup ?? [])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)

    const source_url = sources[0]?.source_url ?? null
    const title_raw: string = (e.title_raw ?? e.title_en ?? '').trim()
    const stripped  = stripTitleNoise(title_raw)

    let category: Category
    if (lineup.length > 0) {
      category = 'HAS_LINEUP'
    } else if (looksLikeSingleAct(stripped)) {
      category = 'TITLE_IS_ACT'
    } else {
      category = 'NO_LINEUP'
    }

    rows.push({
      id:          e.id,
      title_raw,
      title_en:    e.title_en ?? '',
      event_date:  e.event_date,
      venue:       e.venue?.name_en ?? '—',
      source_url,
      lineup,
      category,
      stripped_title: stripped,
    })
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const byCategory: Record<Category, EventRow[]> = {
    TITLE_IS_ACT: rows.filter(r => r.category === 'TITLE_IS_ACT'),
    HAS_LINEUP:   rows.filter(r => r.category === 'HAS_LINEUP'),
    NO_LINEUP:    rows.filter(r => r.category === 'NO_LINEUP'),
  }

  console.log('── Category breakdown ─────────────────────────────────────────')
  console.log(`  (b) TITLE_IS_ACT  ${byCategory.TITLE_IS_ACT.length.toString().padStart(3)}  — title looks like a single artist; title-fallback should catch these`)
  console.log(`  (c) HAS_LINEUP    ${byCategory.HAS_LINEUP.length.toString().padStart(3)}  — lineup data exists but wasn't promoted; re-run extract + promote`)
  console.log(`  (a) NO_LINEUP     ${byCategory.NO_LINEUP.length.toString().padStart(3)}  — genuinely unknown lineup\n`)

  // Per-venue breakdown for NO_LINEUP
  if (byCategory.NO_LINEUP.length) {
    const venueCounts = new Map<string, number>()
    for (const r of byCategory.NO_LINEUP) venueCounts.set(r.venue, (venueCounts.get(r.venue) ?? 0) + 1)
    console.log('── NO_LINEUP by venue ─────────────────────────────────────────')
    for (const [venue, cnt] of [...venueCounts.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`  ${cnt.toString().padStart(3)}  ${venue}`)
    console.log()
  }

  // TITLE_IS_ACT preview
  if (byCategory.TITLE_IS_ACT.length) {
    console.log('── TITLE_IS_ACT sample (first 20) ────────────────────────────')
    for (const r of byCategory.TITLE_IS_ACT.slice(0, 20))
      console.log(`  ${r.event_date}  ${r.venue.padEnd(24)}  "${r.stripped_title}"`)
    console.log()
  }

  // HAS_LINEUP preview
  if (byCategory.HAS_LINEUP.length) {
    console.log('── HAS_LINEUP sample (first 20) ───────────────────────────────')
    for (const r of byCategory.HAS_LINEUP.slice(0, 20))
      console.log(`  ${r.event_date}  ${r.venue.padEnd(24)}  "${r.title_en}"  lineup=[${r.lineup.slice(0, 3).join(', ')}${r.lineup.length > 3 ? '…' : ''}]`)
    console.log()
  }

  // ── Write CSV ─────────────────────────────────────────────────────────────────
  const outDir = path.resolve(process.cwd(), 'tmp', 'audit-no-artists')
  fs.mkdirSync(outDir, { recursive: true })
  const csvPath = path.join(outDir, 'report.csv')

  const csvHeader = 'category,event_date,venue,title_en,stripped_title,lineup_count,source_url,event_id'
  const csvRows = rows.map(r => [
    r.category,
    r.event_date,
    `"${r.venue.replace(/"/g, '""')}"`,
    `"${r.title_en.replace(/"/g, '""')}"`,
    `"${r.stripped_title.replace(/"/g, '""')}"`,
    r.lineup.length,
    r.source_url ?? '',
    r.id,
  ].join(','))

  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'))
  console.log(`📄  Full report → ${csvPath}\n`)

  // ── Recommended next steps ────────────────────────────────────────────────────
  console.log('── Next steps ─────────────────────────────────────────────────')
  if (byCategory.TITLE_IS_ACT.length)
    console.log(`  • Run extract-artist-candidates.ts — title fallback will capture ${byCategory.TITLE_IS_ACT.length} TITLE_IS_ACT events`)
  if (byCategory.HAS_LINEUP.length)
    console.log(`  • ${byCategory.HAS_LINEUP.length} HAS_LINEUP events have lineup data — re-run extract then promote`)
  if (byCategory.NO_LINEUP.length)
    console.log(`  • ${byCategory.NO_LINEUP.length} NO_LINEUP events need manual check or venue-genre fallback (Task 2 step 4)`)
  console.log()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
