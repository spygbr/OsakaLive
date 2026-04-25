/**
 * scripts/check-event-links.ts
 *
 * Live link-checker for upcoming events (Task 5 of TECH_BRIEF_link_integrity).
 *
 * For every event with event_date >= today, HEAD-fetches source_url and
 * ticket_url and flags:
 *   - HTTP errors (4xx, 5xx, network failure)
 *   - redirects to the venue's scrape_url / homepage (looks like a calendar
 *     fallback rather than a real per-event page)
 *
 * Outputs a markdown report. Does not write to the DB.
 *
 * Usage:
 *   npx tsx scripts/check-event-links.ts [--md path] [--concurrency 8]
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

// ── env ────────────────────────────────────────────────────────────────────
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

// ── args ───────────────────────────────────────────────────────────────────
function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const today = new Date().toISOString().slice(0, 10)
const MD_PATH = argVal('--md') ?? `audit/event-links-${today}.md`
const CONCURRENCY = parseInt(argVal('--concurrency') ?? '8', 10)
const TIMEOUT_MS = 10_000

// ── types ──────────────────────────────────────────────────────────────────
type EventRow = {
  id: string
  slug: string
  event_date: string
  venue_id: string | null
  source_url: string | null
  ticket_url: string | null
}
type VenueRow = {
  id: string
  slug: string
  name_en: string
  scrape_url: string | null
  website_url: string | null
}
type CheckResult = {
  ok: boolean
  status: number | null
  finalUrl: string | null
  flag: string | null
  error?: string
}

// ── HTTP probe ─────────────────────────────────────────────────────────────
async function probe(url: string): Promise<CheckResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': 'OsakaLiveLinkChecker/1.0' },
    })
    // Some servers don't support HEAD properly — retry as GET on 405/501
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'user-agent': 'OsakaLiveLinkChecker/1.0' },
      })
    }
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url,
      flag: null,
    }
  } catch (e) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      flag: 'network_error',
      error: (e as Error).message,
    }
  } finally {
    clearTimeout(timer)
  }
}

function classify(
  src: string,
  result: CheckResult,
  venue: VenueRow | undefined,
): string | null {
  if (!result.ok) {
    if (result.status && result.status >= 400) return `http_${result.status}`
    return result.flag ?? 'unknown_error'
  }
  if (!result.finalUrl) return null
  // Resolved to venue calendar / homepage → looks like calendar fallback
  if (venue?.scrape_url && stripTrailingSlash(result.finalUrl) === stripTrailingSlash(venue.scrape_url) &&
      stripTrailingSlash(src) !== stripTrailingSlash(venue.scrape_url)) {
    return 'redirected_to_scrape_url'
  }
  if (venue?.website_url && stripTrailingSlash(result.finalUrl) === stripTrailingSlash(venue.website_url) &&
      stripTrailingSlash(src) !== stripTrailingSlash(venue.website_url)) {
    return 'redirected_to_homepage'
  }
  return null
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

// ── pool runner ────────────────────────────────────────────────────────────
async function runPool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await worker(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  const { data: venues, error: vErr } = await supabase
    .from('venues')
    .select('id, slug, name_en, scrape_url, website_url')
  if (vErr) throw vErr
  const venueById = new Map<string, VenueRow>(
    (venues as VenueRow[]).map((v) => [v.id, v]),
  )

  const { data: events, error: eErr } = await supabase
    .from('events')
    .select('id, slug, event_date, venue_id, source_url, ticket_url')
    .gte('event_date', today)
    .order('event_date', { ascending: true })
  if (eErr) throw eErr

  const tasks: Array<{
    event: EventRow
    venue: VenueRow | undefined
    kind: 'source' | 'ticket'
    url: string
  }> = []
  for (const e of events as EventRow[]) {
    const venue = e.venue_id ? venueById.get(e.venue_id) : undefined
    if (e.source_url) tasks.push({ event: e, venue, kind: 'source', url: e.source_url })
    if (e.ticket_url) tasks.push({ event: e, venue, kind: 'ticket', url: e.ticket_url })
  }

  console.log(`Checking ${tasks.length} URLs across ${(events as EventRow[]).length} upcoming events…`)

  const results = await runPool(tasks, async (t) => {
    const r = await probe(t.url)
    const flag = classify(t.url, r, t.venue)
    return { task: t, result: r, flag }
  }, CONCURRENCY)

  const issues = results.filter((r) => r.flag)
  const okCount = results.length - issues.length

  // ── Markdown ──
  const lines: string[] = [
    `# Event link health — ${today}`,
    '',
    `Checked: **${results.length}** URLs across **${(events as EventRow[]).length}** upcoming events.`,
    `OK: **${okCount}** · Flagged: **${issues.length}**`,
    '',
  ]

  if (issues.length === 0) {
    lines.push('No issues. ✓')
  } else {
    lines.push('## Issues')
    lines.push('')
    lines.push('| Date | Event | Venue | Kind | Flag | Status | URL |')
    lines.push('|---|---|---|---|---|---:|---|')
    for (const i of issues) {
      const e = i.task.event
      const v = i.task.venue
      lines.push(
        `| ${e.event_date} | [${e.slug}](https://osaka.live/event/${e.slug}) | ${v?.slug ?? '?'} | ${i.task.kind} | \`${i.flag}\` | ${i.result.status ?? '—'} | ${i.task.url} |`,
      )
    }
  }

  fs.mkdirSync(path.dirname(MD_PATH), { recursive: true })
  fs.writeFileSync(MD_PATH, lines.join('\n') + '\n')
  console.log(`✓ Wrote ${MD_PATH}`)
  console.log(`OK: ${okCount} · Flagged: ${issues.length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
