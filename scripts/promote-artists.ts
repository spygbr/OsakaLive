/**
 * scripts/promote-artists.ts
 *
 * Phase 4 of the artist extraction pipeline.
 * Promotes approved artist_candidates to the `artists` table and links them
 * to events via the `event_artists` junction table.
 *
 * Run ONLY after Diku has reviewed the staging table and is satisfied with
 * the candidate set. Non-destructive: skips candidates that have already
 * been promoted, and uses ON CONFLICT DO NOTHING for event_artists.
 *
 * Usage:
 *   npx tsx scripts/promote-artists.ts [--dry-run]
 *
 * Options:
 *   --dry-run  Preview what would be inserted/updated without touching the DB
 *
 * Promotes candidates WHERE:
 *   (confidence = 'high' OR llm_verdict = 'artist') AND promoted = false
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN      = process.argv.includes('--dry-run')

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    '❌  Missing env vars.\n' +
    '    Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── Types ──────────────────────────────────────────────────────────────────────

interface CandidateRow {
  id:         string
  raw_name:   string
  source:     'title' | 'description'
  confidence: string
  event_id:   string
}

interface ArtistRow {
  id:       string
  name_en:  string
  slug:     string
}

// ── Slug helpers ───────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // strip special chars
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')   // trim leading/trailing dashes
    .slice(0, 60)
}

function randomHex(bytes = 4): string {
  return [...Array(bytes * 2)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('')
}

/**
 * Returns a slug for `name` that doesn't collide with any existing slug.
 * If slugify() produces an empty string (Japanese-only names), falls back to
 * `artist-{randomHex}` which will need manual cleanup later.
 */
function uniqueSlug(name: string, existingSlugs: Set<string>): string {
  let base = slugify(name)

  if (!base) {
    // Japanese-only or fully stripped — use random hex fallback
    base = `artist-${randomHex(4)}`
    // Ensure even the random one doesn't collide (astronomically unlikely, but safe)
    while (existingSlugs.has(base)) {
      base = `artist-${randomHex(4)}`
    }
    return base
  }

  if (!existingSlugs.has(base)) return base

  // Try numeric suffixes: slug-2, slug-3, …
  for (let i = 2; i <= 999; i++) {
    const candidate = `${base.slice(0, 57)}-${i}`
    if (!existingSlugs.has(candidate)) return candidate
  }

  // Should never reach here in practice
  return `${base.slice(0, 51)}-${randomHex(4)}`
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀  Artist promoter${DRY_RUN ? '  [DRY RUN]' : ''}\n`)

  // ── 1. Load unpromoted approved candidates ────────────────────────────────
  //
  // We need all individual rows (not distinct names yet) so we have the
  // event_id → raw_name → source mapping for event_artists.
  const { data: candidates, error: candError } = await supabase
    .from('artist_candidates')
    .select('id, raw_name, source, confidence, event_id')
    .eq('promoted', false)
    .or('confidence.eq.high,llm_verdict.eq.artist')

  if (candError || !candidates) {
    console.error('❌  Failed to load candidates:', candError?.message)
    process.exit(1)
  }

  if (candidates.length === 0) {
    console.log('✅  No unpromoted approved candidates found — nothing to do.\n')
    return
  }

  console.log(`📋  ${candidates.length} candidate rows ready for promotion\n`)

  // ── 2. Group by normalised name ───────────────────────────────────────────
  //
  // Key: lowercase raw_name (for matching)
  // Value: { displayName (most common casing), rows[] }
  const nameMap = new Map<string, { displayName: string; rows: CandidateRow[] }>()

  for (const c of candidates as CandidateRow[]) {
    const key = c.raw_name.toLowerCase().trim()
    if (!nameMap.has(key)) {
      nameMap.set(key, { displayName: c.raw_name, rows: [] })
    }
    nameMap.get(key)!.rows.push(c)
  }

  console.log(`🎤  ${nameMap.size} distinct artist names to process\n`)

  // ── 3. Load existing artists (for dedup + slug collision check) ───────────
  const { data: existingArtists, error: artistError } = await supabase
    .from('artists')
    .select('id, name_en, slug')

  if (artistError) {
    console.error('❌  Failed to load existing artists:', artistError?.message)
    process.exit(1)
  }

  const artistByName = new Map<string, ArtistRow>()
  const existingSlugs = new Set<string>()

  for (const a of (existingArtists ?? []) as ArtistRow[]) {
    artistByName.set(a.name_en.toLowerCase().trim(), a)
    existingSlugs.add(a.slug)
  }

  console.log(`📚  ${artistByName.size} existing artists loaded\n`)

  // ── 4. Process each distinct name ─────────────────────────────────────────

  let artistsCreated  = 0
  let artistsReused   = 0
  let linksCreated    = 0
  let candidatesMarked = 0

  const dryRunLog: string[] = []

  for (const [nameKey, { displayName, rows }] of nameMap) {
    // ── 4a. Resolve artist_id ──────────────────────────────────────────────

    let artistId: string
    let isNew = false

    const existingArtist = artistByName.get(nameKey)

    if (existingArtist) {
      artistId = existingArtist.id
      artistsReused++
      if (DRY_RUN) {
        dryRunLog.push(`  [EXISTS ] "${displayName}" → slug="${existingArtist.slug}" id=${artistId}`)
      }
    } else {
      // Need to create a new artist row
      const slug = uniqueSlug(displayName, existingSlugs)
      isNew = true

      if (DRY_RUN) {
        // Simulate an ID for dry-run event_artists preview
        artistId = `<new-${slug}>`
        dryRunLog.push(`  [CREATE ] "${displayName}" → slug="${slug}"`)
        existingSlugs.add(slug)  // prevent collisions within this dry run
        artistByName.set(nameKey, { id: artistId, name_en: displayName, slug })
      } else {
        const { data: newArtist, error: insertError } = await supabase
          .from('artists')
          .insert({
            name_en:   displayName,
            name_ja:   null,
            slug,
            bio_en:    null,
            genre_id:  null,
            image_url: null,
          })
          .select('id, name_en, slug')
          .single()

        if (insertError || !newArtist) {
          console.error(`  ❌  Failed to insert artist "${displayName}": ${insertError?.message}`)
          continue
        }

        artistId = newArtist.id
        existingSlugs.add(slug)
        artistByName.set(nameKey, newArtist as ArtistRow)
        artistsCreated++
      }
    }

    if (DRY_RUN) {
      // Show which events would be linked
      const uniqueEventIds = [...new Set(rows.map(r => r.event_id))]
      dryRunLog.push(
        `           └─ ${uniqueEventIds.length} event_artist link(s) would be created` +
        (rows.some(r => r.source === 'title') ? ' (billing_order 1 for title)' : ''),
      )
      linksCreated    += uniqueEventIds.length
      candidatesMarked += rows.length
      continue
    }

    // ── 4b. Insert event_artists links ─────────────────────────────────────

    // Build unique (event_id, billing_order) pairs. Title source = order 1, description = 2.
    // If the same event has both title and description candidates for this artist,
    // prefer billing_order 1 (title).
    const eventBillingMap = new Map<string, number>()
    for (const row of rows) {
      const order = row.source === 'title' ? 1 : 2
      const existing = eventBillingMap.get(row.event_id)
      if (existing === undefined || order < existing) {
        eventBillingMap.set(row.event_id, order)
      }
    }

    const linkRows = Array.from(eventBillingMap.entries()).map(([event_id, billing_order]) => ({
      event_id,
      artist_id: artistId,
      billing_order,
    }))

    if (linkRows.length > 0) {
      // Supabase doesn't support ON CONFLICT DO NOTHING directly in the JS client,
      // but the underlying PostgREST upsert with ignoreDuplicates achieves the same.
      const { error: linkError } = await supabase
        .from('event_artists')
        .upsert(linkRows, { onConflict: 'event_id,artist_id', ignoreDuplicates: true })

      if (linkError) {
        console.error(`  ❌  Failed to insert event_artists for "${displayName}": ${linkError.message}`)
        // Don't skip — still mark candidates so we don't retry on next run
      } else {
        linksCreated += linkRows.length
      }
    }

    // ── 4c. Mark candidates as promoted ────────────────────────────────────

    const candidateIds = rows.map(r => r.id)

    const { error: updateError } = await supabase
      .from('artist_candidates')
      .update({ promoted: true, artist_id: artistId })
      .in('id', candidateIds)

    if (updateError) {
      console.error(`  ❌  Failed to mark candidates promoted for "${displayName}": ${updateError.message}`)
    } else {
      candidatesMarked += candidateIds.length
    }

    const action = isNew ? '✨ created' : '♻️  reused'
    console.log(`  ${action}  "${displayName}"  (${linkRows.length} event link${linkRows.length !== 1 ? 's' : ''})`)
  }

  // ── 5. Results ─────────────────────────────────────────────────────────────

  if (DRY_RUN) {
    console.log('🔍  Preview (dry run):\n')
    for (const line of dryRunLog) console.log(line)
    console.log('\n📊  Summary (would be):')
    console.log(`    New artists      : ${nameMap.size - artistsReused}`)
    console.log(`    Reused artists   : ${artistsReused}`)
    console.log(`    event_artist rows: ${linksCreated}`)
    console.log(`    Candidates marked: ${candidatesMarked}`)
    console.log('\n✅  Dry run complete. Run without --dry-run to commit.\n')
    return
  }

  console.log('\n📊  Promotion complete:')
  console.log(`    New artists created  : ${artistsCreated}`)
  console.log(`    Existing artists used: ${artistsReused}`)
  console.log(`    event_artists links  : ${linksCreated}`)
  console.log(`    Candidates marked    : ${candidatesMarked}`)

  // ── 6. Verification queries ─────────────────────────────────────────────

  console.log('\n🔍  Verification:\n')

  const { count: artistCount } = await supabase
    .from('artists')
    .select('*', { count: 'exact', head: true })

  const { count: eventArtistCount } = await supabase
    .from('event_artists')
    .select('*', { count: 'exact', head: true })

  const { count: promotedCount } = await supabase
    .from('artist_candidates')
    .select('*', { count: 'exact', head: true })
    .eq('promoted', true)

  console.log(`    artists table total  : ${artistCount}`)
  console.log(`    event_artists total  : ${eventArtistCount}`)
  console.log(`    candidates promoted  : ${promotedCount}`)

  // Spot-check: any null/empty slugs?
  const { data: badSlugs } = await supabase
    .from('artists')
    .select('name_en, slug')
    .like('slug', 'artist-%')   // Japanese fallback slugs that need manual review
    .order('name_en')

  if (badSlugs && badSlugs.length > 0) {
    console.log('\n⚠️   Artists with auto-generated slugs (need manual review):')
    for (const a of badSlugs) {
      console.log(`    "${a.name_en}"  →  ${a.slug}`)
    }
  }

  console.log('\n✅  Done.\n')
  console.log('💡  Next steps:')
  console.log('    1. Run: npx tsx scripts/scrape-artist-images.ts')
  console.log('    2. Manually fix any artist-XXXXXXXX slugs listed above')
  console.log('    3. Fill in name_ja for Japanese-named artists as needed\n')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
