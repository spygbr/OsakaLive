/**
 * scripts/audit-link-integrity.ts
 *
 * Read-only audit of event link health (Task 1 of TECH_BRIEF_link_integrity).
 *
 * Classifies every event's source_url and ticket_url and prints a per-venue
 * summary plus a CSV dump for follow-up.
 *
 * source_url buckets:
 *   - null              → no link (UI hides Source button — fine, but means we
 *                         never captured a per-event URL during scraping)
 *   - equals scrape_url → broken: points at the venue calendar, not the event
 *   - shared (≥2 events at same venue) → suspect: probably an index page
 *   - unique            → likely good
 *
 * ticket_url buckets:
 *   - null    → no ticket link
 *   - shared  → suspect: same URL on ≥2 events (different dates) at one venue
 *   - unique  → likely good
 *
 * Usage:
 *   npx tsx scripts/audit-link-integrity.ts [--csv path] [--md path]
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

// ── env ─────────────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (m) {
      const k = m[1].trim()
      const v = m[2].trim().replace(/^["']|["']$/g, '')
      if (!process.env[k]) process.env[k] = v
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing Supabase env vars in .env.local')
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── args ────────────────────────────────────────────────────────────────────
function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const today = new Date().toISOString().slice(0, 10)
const CSV_PATH = argVal('--csv') ?? `audit/link-integrity-${today}.csv`
const MD_PATH  = argVal('--md')  ?? `audit/link-integrity-${today}.md`

// ── types ───────────────────────────────────────────────────────────────────
type EventRow = {
  id: string
  slug: string | null
  event_date: string
  venue_id: string | null
  ticket_url: string | null
  // source_url isn't on `events` — it lives on the `event_sources` junction.
  // We pull the first non-null one (matches lib/supabase/queries normalizeEvent).
  event_sources: { source_url: string | null }[] | null
  source_url?: string | null
}
type VenueRow = {
  id: string
  slug: string
  name_en: string
  scrape_url: string | null
}
type SrcBucket = 'null' | 'equals_scrape' | 'shared' | 'unique'
type TktBucket = 'null' | 'shared' | 'unique'

type Classified = EventRow & {
  venue_slug: string
  venue_name: string
  scrape_url: string | null
  src_bucket: SrcBucket
  tkt_bucket: TktBucket
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  // Pull venues
  const { data: venues, error: vErr } = await supabase
    .from('venues')
    .select('id, slug, name_en, scrape_url')
  if (vErr) throw vErr
  const venueById = new Map<string, VenueRow>(
    (venues as VenueRow[]).map((v) => [v.id, v]),
  )

  // Pull events (paginate; supabase caps at 1000). source_url comes from the
  // event_sources junction table, so we join and flatten.
  const events: EventRow[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('events')
      .select('id, slug, event_date, venue_id, ticket_url, event_sources(source_url)')
      .order('event_date', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const r of data as EventRow[]) {
      r.source_url = r.event_sources?.find((s) => s.source_url)?.source_url ?? null
      events.push(r)
    }
    if (data.length < pageSize) break
  }

  // Build per-venue frequency maps for shared-link detection
  const srcFreqByVenue = new Map<string, Map<string, number>>()
  const tktFreqByVenue = new Map<string, Map<string, number>>()
  for (const e of events) {
    if (!e.venue_id) continue
    if (e.source_url) {
      const m = srcFreqByVenue.get(e.venue_id) ?? new Map()
      m.set(e.source_url, (m.get(e.source_url) ?? 0) + 1)
      srcFreqByVenue.set(e.venue_id, m)
    }
    if (e.ticket_url) {
      const m = tktFreqByVenue.get(e.venue_id) ?? new Map()
      m.set(e.ticket_url, (m.get(e.ticket_url) ?? 0) + 1)
      tktFreqByVenue.set(e.venue_id, m)
    }
  }

  const classified: Classified[] = events.map((e) => {
    const venue = e.venue_id ? venueById.get(e.venue_id) : undefined
    const scrape_url = venue?.scrape_url ?? null

    let src_bucket: SrcBucket
    if (!e.source_url) src_bucket = 'null'
    else if (scrape_url && e.source_url === scrape_url) src_bucket = 'equals_scrape'
    else {
      const c = e.venue_id ? srcFreqByVenue.get(e.venue_id)?.get(e.source_url) ?? 0 : 0
      src_bucket = c >= 2 ? 'shared' : 'unique'
    }

    let tkt_bucket: TktBucket
    if (!e.ticket_url) tkt_bucket = 'null'
    else {
      const c = e.venue_id ? tktFreqByVenue.get(e.venue_id)?.get(e.ticket_url) ?? 0 : 0
      tkt_bucket = c >= 2 ? 'shared' : 'unique'
    }

    return {
      ...e,
      venue_slug: venue?.slug ?? '(no-venue)',
      venue_name: venue?.name_en ?? '(no-venue)',
      scrape_url,
      src_bucket,
      tkt_bucket,
    }
  })

  // Per-venue rollup
  type Row = {
    venue: string
    total: number
    src_null: number
    src_equals_scrape: number
    src_shared: number
    src_unique: number
    tkt_null: number
    tkt_shared: number
    tkt_unique: number
  }
  const byVenue = new Map<string, Row>()
  for (const c of classified) {
    const key = `${c.venue_name} (${c.venue_slug})`
    const r = byVenue.get(key) ?? {
      venue: key, total: 0,
      src_null: 0, src_equals_scrape: 0, src_shared: 0, src_unique: 0,
      tkt_null: 0, tkt_shared: 0, tkt_unique: 0,
    }
    r.total++
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(r as any)[`src_${c.src_bucket}`]++
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(r as any)[`tkt_${c.tkt_bucket}`]++
    byVenue.set(key, r)
  }
  const rollup = [...byVenue.values()].sort((a, b) => b.total - a.total)

  // ── write CSV ──
  fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true })
  const csv = [
    'event_id,slug,event_date,venue_slug,src_bucket,tkt_bucket,source_url,ticket_url,scrape_url',
    ...classified.map((c) =>
      [c.id, c.slug, c.event_date, c.venue_slug, c.src_bucket, c.tkt_bucket,
       JSON.stringify(c.source_url ?? ''), JSON.stringify(c.ticket_url ?? ''),
       JSON.stringify(c.scrape_url ?? '')]
        .join(',')
    ),
  ].join('\n')
  fs.writeFileSync(CSV_PATH, csv)

  // ── write markdown ──
  const totals = classified.reduce(
    (a, c) => {
      a.total++
      a[`src_${c.src_bucket}`]++
      a[`tkt_${c.tkt_bucket}`]++
      return a
    },
    { total: 0, src_null: 0, src_equals_scrape: 0, src_shared: 0, src_unique: 0,
      tkt_null: 0, tkt_shared: 0, tkt_unique: 0 } as Record<string, number>,
  )

  const pct = (n: number) => totals.total ? `${((n / totals.total) * 100).toFixed(1)}%` : '0%'
  const md = [
    `# Link Integrity Audit — ${today}`,
    '',
    `Total events: **${totals.total}**`,
    '',
    '## Source URL health',
    '',
    `- null (no link): **${totals.src_null}** (${pct(totals.src_null)})`,
    `- equals venue scrape_url (BROKEN — points at calendar): **${totals.src_equals_scrape}** (${pct(totals.src_equals_scrape)})`,
    `- shared across ≥2 events at same venue (SUSPECT): **${totals.src_shared}** (${pct(totals.src_shared)})`,
    `- unique per event (likely good): **${totals.src_unique}** (${pct(totals.src_unique)})`,
    '',
    '## Ticket URL health',
    '',
    `- null: **${totals.tkt_null}** (${pct(totals.tkt_null)})`,
    `- shared across ≥2 events at same venue (SUSPECT — wrong-event risk): **${totals.tkt_shared}** (${pct(totals.tkt_shared)})`,
    `- unique (likely good): **${totals.tkt_unique}** (${pct(totals.tkt_unique)})`,
    '',
    '## By venue',
    '',
    '| Venue | Total | src null | src=scrape | src shared | src unique | tkt null | tkt shared | tkt unique |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rollup.map((r) =>
      `| ${r.venue} | ${r.total} | ${r.src_null} | ${r.src_equals_scrape} | ${r.src_shared} | ${r.src_unique} | ${r.tkt_null} | ${r.tkt_shared} | ${r.tkt_unique} |`,
    ),
    '',
    `Raw CSV: \`${CSV_PATH}\``,
    '',
  ].join('\n')

  fs.mkdirSync(path.dirname(MD_PATH), { recursive: true })
  fs.writeFileSync(MD_PATH, md)

  console.log(`✓ Wrote ${MD_PATH}`)
  console.log(`✓ Wrote ${CSV_PATH}`)
  console.log('')
  console.log(`Total: ${totals.total}`)
  console.log(`Source URL — null: ${totals.src_null}, =scrape: ${totals.src_equals_scrape}, shared: ${totals.src_shared}, unique: ${totals.src_unique}`)
  console.log(`Ticket URL — null: ${totals.tkt_null}, shared: ${totals.tkt_shared}, unique: ${totals.tkt_unique}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
