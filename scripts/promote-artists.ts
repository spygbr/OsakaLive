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
 *   status = 'approved' AND merged_into_artist_id IS NULL
 *
 * artist_candidates is a pre-aggregated table (one row per distinct normalised
 * name, no FK to events). For each promoted candidate, event_artists rows are
 * created by ILIKE-matching the candidate name against events.title_raw and
 * events.description (title match → billing_order 1, description match → 2).
 *
 * After promotion, the candidate row is marked:
 *   status = 'merged', merged_into_artist_id = <new artist id>
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
  id:           string
  name_display: string
  name_norm:    string
  confidence:   string
  event_count:  number | null
  llm_verdict:  string | null
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

// ── Bilingual name parsing ─────────────────────────────────────────────────────

/** True if the string contains at least one Japanese character */
function hasJapanese(s: string): boolean {
  return /[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(s)
}

/** True if the string is purely Roman/ASCII */
function isRoman(s: string): boolean {
  return /^[A-Za-z0-9\s\-_.!?'"&+*()[\]]+$/.test(s.trim())
}

/**
 * If displayName is a bilingual "JP名 / EN Name" (or "EN / JP") string,
 * returns { nameEn, nameJa }. Otherwise returns { nameEn: displayName, nameJa: null }.
 *
 * The English part is used for slug generation and as name_en.
 * The Japanese part is stored in name_ja.
 */
// Matches both full-width ／ (U+FF0F) and ASCII /, with optional surrounding spaces
const BILINGUAL_SEP = /\s*[／/]\s*/

function parseBilingualName(displayName: string): { nameEn: string; nameJa: string | null } {
  const parts = displayName.split(BILINGUAL_SEP)
  if (parts.length !== 2) return { nameEn: displayName, nameJa: null }

  const [a, b] = parts.map(p => p.trim())
  if (!a || !b) return { nameEn: displayName, nameJa: null }

  if (hasJapanese(a) && isRoman(b)) return { nameEn: b, nameJa: a }
  if (isRoman(a) && hasJapanese(b)) return { nameEn: a, nameJa: b }
  return { nameEn: displayName, nameJa: null }  // both same script
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

  // ── 1. Load unmerged candidates, then filter in JS ────────────────────────
  //
  // artist_candidates is pre-aggregated — one row per distinct name_norm.
  // Promote criteria:
  //   merged_into_artist_id IS NULL  (not already promoted)
  //   AND llm_verdict IS NULL OR llm_verdict != 'not_artist'
  //   AND (status = 'approved' OR confidence = 'high')
  const { data: allRows, error: candError } = await supabase
    .from('artist_candidates')
    .select('id, name_display, name_norm, confidence, event_count, llm_verdict, status')
    .is('merged_into_artist_id', null)
    .in('status', ['pending', 'approved'])

  if (candError || !allRows) {
    console.error('❌  Failed to load candidates:', candError?.message)
    process.exit(1)
  }

  const candidates = (allRows as Array<CandidateRow & { status: string }>).filter(c => {
    if (c.llm_verdict === 'not_artist') return false
    return c.status === 'approved' || c.confidence === 'high'
  })

  if (candidates.length === 0) {
    console.log('✅  No unpromoted approved candidates found — nothing to do.\n')
    return
  }

  console.log(`📋  ${candidates.length} candidate rows ready for promotion\n`)

  // Each candidate row IS already one-per-name; still key by name_norm for
  // collision safety if duplicates ever slip through.
  const nameMap = new Map<string, { displayName: string; row: CandidateRow }>()
  for (const c of candidates as CandidateRow[]) {
    if (!nameMap.has(c.name_norm)) {
      nameMap.set(c.name_norm, { displayName: c.name_display, row: c })
    }
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

  for (const [nameKey, { displayName, row }] of nameMap) {
    // ── 4a. Resolve artist_id ──────────────────────────────────────────────

    let artistId: string
    let isNew = false

    // Parse bilingual names ("JP名 / EN Name") into separate components
    const { nameEn, nameJa } = parseBilingualName(displayName)
    const enKey = nameEn.toLowerCase().trim()

    // Dedup: check by full normalised name first, then by English part alone
    const existingArtist = artistByName.get(nameKey) ?? artistByName.get(enKey)

    if (existingArtist) {
      artistId = existingArtist.id
      artistsReused++
      if (DRY_RUN) {
        dryRunLog.push(`  [EXISTS ] "${displayName}" → slug="${existingArtist.slug}" id=${artistId}`)
      }
    } else {
      // Slug is generated from the English name (or full name if no bilingual split)
      const slug = uniqueSlug(nameEn, existingSlugs)
      isNew = true

      if (DRY_RUN) {
        artistId = `<new-${slug}>`
        const jaNote = nameJa ? ` (ja: "${nameJa}")` : ''
        dryRunLog.push(`  [CREATE ] "${nameEn}"${jaNote} → slug="${slug}"`)
        existingSlugs.add(slug)
        artistByName.set(nameKey, { id: artistId, name_en: nameEn, slug })
      } else {
        const { data: newArtist, error: insertError } = await supabase
          .from('artists')
          .insert({
            name_en:   nameEn,
            name_ja:   nameJa,
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
        artistByName.set(enKey, newArtist as ArtistRow)  // also index by EN part for future dedup
        artistsCreated++
      }
    }

    // ── 4b. Find matching events via ILIKE on title_raw / description ──────
    //
    // artist_candidates has no direct event FK, so recover the mapping by
    // string-matching the name against events.title_raw (billing_order 1)
    // or events.description (billing_order 2). Event listings in Osaka go
    // back a few months; cap the window to keep matches relevant.
    //
    // Very short names (<3 chars) would match too much noise — skip.
    const eventBillingMap = new Map<string, number>()

    // Build search needles: for bilingual names, search for BOTH language parts
    // individually (events store one or the other, not the combined "JP / EN" string)
    const searchTerms: string[] = []
    if (nameJa && nameJa.length >= 2) searchTerms.push(nameJa)
    if (nameEn.length >= 3) searchTerms.push(nameEn)
    // Fallback: if not bilingual, searchTerms has just nameEn (= displayName)

    for (const term of searchTerms) {
      const needle = term.replace(/[\\%_]/g, (m) => `\\${m}`)

      // Title matches get billing_order 1
      const { data: titleHits, error: titleErr } = await supabase
        .from('events')
        .select('id')
        .ilike('title_raw', `%${needle}%`)
        .limit(200)
      if (titleErr) console.warn(`  ⚠  events title lookup for "${term}": ${titleErr.message}`)
      for (const ev of (titleHits ?? []) as Array<{ id: string }>) {
        if (!eventBillingMap.has(ev.id)) eventBillingMap.set(ev.id, 1)
      }

      // Description matches get billing_order 2 (don't overwrite a title hit)
      const { data: descHits, error: descErr } = await supabase
        .from('events')
        .select('id')
        .ilike('description', `%${needle}%`)
        .limit(200)
      if (descErr) console.warn(`  ⚠  events desc lookup for "${term}": ${descErr.message}`)
      for (const ev of (descHits ?? []) as Array<{ id: string }>) {
        if (!eventBillingMap.has(ev.id)) eventBillingMap.set(ev.id, 2)
      }
    }

    const linkRows = Array.from(eventBillingMap.entries()).map(([event_id, billing_order]) => ({
      event_id,
      artist_id: artistId,
      billing_order,
    }))

    if (DRY_RUN) {
      dryRunLog.push(
        `           └─ ${linkRows.length} event_artist link(s) would be created` +
        (linkRows.some(r => r.billing_order === 1) ? ' (some billing_order 1)' : ''),
      )
      linksCreated    += linkRows.length
      candidatesMarked += 1
      continue
    }

    if (linkRows.length > 0) {
      const { error: linkError } = await supabase
        .from('event_artists')
        .upsert(linkRows, { onConflict: 'event_id,artist_id', ignoreDuplicates: true })

      if (linkError) {
        console.error(`  ❌  Failed to insert event_artists for "${displayName}": ${linkError.message}`)
      } else {
        linksCreated += linkRows.length
      }
    }

    // ── 4c. Mark candidate as merged ───────────────────────────────────────

    const { error: updateError } = await supabase
      .from('artist_candidates')
      .update({ status: 'merged', merged_into_artist_id: artistId })
      .eq('id', row.id)

    if (updateError) {
      console.error(`  ❌  Failed to mark candidate merged for "${displayName}": ${updateError.message}`)
    } else {
      candidatesMarked += 1
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
    .eq('status', 'merged')

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
  console.log('    1. Run: npx tsx scripts/enrich-artists.ts  (socials + image)')
  console.log('    2. Manually fix any artist-XXXXXXXX slugs listed above')
  console.log('    3. Fill in name_ja for Japanese-named artists as needed\n')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
