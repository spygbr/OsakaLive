/**
 * scripts/clean-artist-names.ts
 *
 * One-time cleanup of dirty artist names that slipped through the extraction
 * pipeline before the improved noise filters were in place.
 *
 * Problems addressed:
 *   1. Unmatched brackets: "Yoonsung(韓国" → "Yoonsung"
 *      "cadode「SLICE OF SEKAI ROUTE 1" → "cadode"
 *   2. Leading symbols: "•WARHEAD" → "WARHEAD"
 *   3. Double-space event titles: "KOTOKO LIVE  喜怒哀楽 ~Fun Spring" → "KOTOKO"
 *   4. Tour descriptors: "ROSE CARLEO BAND JAPAN TOUR 2026 OSAKA" → delete
 *   5. Section markers: "1部(ライブ)： DIALOGUE＋" → delete (starts-with-digit)
 *   6. Member credits lists: "syn)、宮田あずみ(b)、ハラナツコ(sax" → delete
 *   7. Duplicates after clean: GODLAND × 2, Yoonsung × 2 → merge
 *
 * Usage:
 *   npx tsx scripts/clean-artist-names.ts [--dry-run]
 *
 * --dry-run  Show what would change; do not write to DB
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
  console.error('❌  Missing Supabase env vars in .env.local')
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── Types ──────────────────────────────────────────────────────────────────────
interface Artist {
  id:       string
  slug:     string
  name_en:  string
  name_ja:  string | null
  image_url: string | null
  website_url: string | null
  instagram_url: string | null
}

interface CleanResult {
  id:        string
  slug:      string
  original:  string
  cleaned:   string | null   // null = should be deleted
  reason:    string
}

// ── Slugify (same logic as promote-artists.ts) ─────────────────────────────────
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

  if (!base) {
    return 'artist-' + Math.random().toString(16).slice(2, 10)
  }
  return base
}

// ── Core normalisation (mirrors extract-artist-candidates.ts) ──────────────────

/**
 * Strips leading decorative symbols and truncates at unmatched opening brackets.
 * Returns null if the result is too short to be a valid artist name.
 */
function normaliseToken(raw: string): string | null {
  let t = raw.trim()

  // 1. Strip leading decorative symbols
  t = t.replace(/^[•·▼▲▶◀→←↑↓↔⇒⇐※◎○●◆◇■□▪▫〜～〽♪♫✓✗✕①②③④⑤⑥⑦⑧⑨⑩]+\s*/g, '').trim()

  // 2. Strip wrapping curly quotes or straight quotes that enclose event titles
  //    e.g. "竹原ピストル ライブ 〜バンド編〜" → 竹原ピストル ライブ 〜バンド編〜
  t = t.replace(/^[""''「」『』]+|[""''「」『』]+$/g, '').trim()

  // 3. Strip wrapping 〜...〜 decorators
  t = t.replace(/^[〜～]\s*/g, '').replace(/\s*[〜～]$/g, '').trim()

  // 4a. Strip "N部(something)：content" section prefix → keep content after colon
  //     e.g. "1部(ライブ)： DIALOGUE＋" → "DIALOGUE＋"
  t = t.replace(/^\d+[部章節](\([^)]*\))?\s*[：:]\s*/, '').trim()

  // 4b. Strip remaining generic "N部" / "N章" section markers at the start
  //     when they're followed only by whitespace / punctuation
  const sectionMatch = t.match(/^\d+[部章節][】)）\s]*[:：]?\s*(.+)$/)
  if (sectionMatch) {
    t = sectionMatch[1].trim()
  }

  // 5. Truncate at first unmatched Japanese full-width opening bracket
  //    Only when there's content before it (more than 2 chars)
  const jpBracketIdx = t.search(/[「（『【〈《〔｢]/)
  if (jpBracketIdx >= 3) {
    t = t.slice(0, jpBracketIdx).trim()
  }

  // 6. Truncate at first unmatched ASCII paren: "foo(bar" with no matching ")"
  const unmatched = t.match(/^(.{3,}?)\([^)]*$/)
  if (unmatched) {
    t = unmatched[1].trim()
  }

  // 7. Strip trailing noise punctuation
  t = t.replace(/[.,!?;:…。、！？\-~〜\s*#]+$/, '').trim()

  // 8. Strip LIVE / ライブ at the end when it's followed by event description
  //    Detect double-space as separator: "ARTIST  event description"
  const doubleSpaceMatch = t.match(/^(.+?)\s{2,}/)
  if (doubleSpaceMatch && doubleSpaceMatch[1].trim().length >= 2) {
    t = doubleSpaceMatch[1].trim()
  }

  // 9. Strip trailing event-suffix patterns
  t = t.replace(/\s+"[^"]*"?\s*$/g, '').trim()    // trailing quoted subtitle  "REAL TALK"
  t = t.replace(/\s+(LIVE|ライブ)(\s+.*)?$/i, '').trim()
  t = t.replace(/\s+one[\s-]*man(\s+live)?\s*$/i, '').trim()  // "ONE MAN", "ONE MAN LIVE"
  t = t.replace(/\s*〜[^〜]*〜?\s*$/g, '').trim()
  t = t.replace(/\s+20\d\d\s*$/, '').trim()        // trailing year e.g. "Canis Lupus 2026"

  // After all cleaning, check validity
  if (!t || t.length < 2) return null

  // Starts with a digit → likely a section marker or pricing (e.g. "1部", "2MAN")
  if (/^\d/.test(t)) return null

  // Still has tour-event indicators → delete
  if (
    (/\b(tour|ツアー)\b/i.test(t) && /\b20\d\d\b/.test(t)) ||
    /\bjapan\s+(tour|show|leg)\b/i.test(t) ||
    /\blive\s+in\s+japan\b/i.test(t) ||
    /定期公演/.test(t)   // "regular performance" series
  ) return null

  // Member-credits fragments: starts with closing paren, contains role markers
  if (t.startsWith(')') || /^[a-z]{1,3}[)）]/.test(t)) return null

  return t
}

// ── Normalise key for deduplication ───────────────────────────────────────────
function normKey(name: string): string {
  return name.toLowerCase().replace(/[\s\-_]+/g, '').replace(/[^\w\u3000-\u9fff]/g, '')
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`\n🧹  Artist name cleanup${DRY_RUN ? '  [DRY RUN]' : ''}\n`)

  // Load all artists
  const { data: artists, error } = await supabase
    .from('artists')
    .select('id, slug, name_en, name_ja, image_url, website_url, instagram_url')
    .order('name_en')

  if (error || !artists) {
    console.error('❌  Failed to load artists:', error?.message)
    process.exit(1)
  }

  console.log(`📋  Loaded ${artists.length} artists\n`)

  // ── Pass 1: determine clean name for each artist ───────────────────────────
  const results: CleanResult[] = []
  const unchanged: string[] = []

  for (const a of artists as Artist[]) {
    const cleaned = normaliseToken(a.name_en)
    if (!cleaned) {
      results.push({ id: a.id, slug: a.slug, original: a.name_en, cleaned: null, reason: 'invalid after cleaning' })
    } else if (cleaned === a.name_en) {
      unchanged.push(a.name_en)
    } else {
      results.push({ id: a.id, slug: a.slug, original: a.name_en, cleaned, reason: 'name cleaned' })
    }
  }

  const toClean  = results.filter(r => r.cleaned !== null)
  const toDelete = results.filter(r => r.cleaned === null)

  console.log(`📊  Summary:`)
  console.log(`    Unchanged : ${unchanged.length}`)
  console.log(`    To clean  : ${toClean.length}`)
  console.log(`    To delete : ${toDelete.length}`)

  if (toClean.length) {
    console.log('\n✏️   Names to clean:')
    for (const r of toClean) {
      console.log(`    "${r.original}"`)
      console.log(`  → "${r.cleaned}"  [${r.slug}]`)
    }
  }

  if (toDelete.length) {
    console.log('\n🗑️   Names to delete (not valid artist names):')
    for (const r of toDelete) {
      console.log(`    "${r.original}"  [${r.slug}]`)
    }
  }

  // ── Pass 2: detect post-clean duplicates ───────────────────────────────────
  // Build a map of normKey → artists that will share that key after cleaning
  const keyMap = new Map<string, Array<{ id: string; slug: string; name: string; eventCount?: number }>>()

  for (const a of artists as Artist[]) {
    const result = results.find(r => r.id === a.id)
    const finalName = result ? result.cleaned : a.name_en
    if (!finalName) continue  // will be deleted

    const key = normKey(finalName)
    if (!keyMap.has(key)) keyMap.set(key, [])
    keyMap.get(key)!.push({ id: a.id, slug: a.slug, name: finalName })
  }

  // Count event_artists for each artist to determine which to keep in a merge
  const duplicateSets = Array.from(keyMap.entries()).filter(([, group]) => group.length > 1)

  if (duplicateSets.length > 0) {
    console.log('\n⚠️   Duplicate artists detected after cleaning (will merge):')

    for (const [key, group] of duplicateSets) {
      console.log(`\n  Key: "${key}"`)
      for (const g of group) {
        const { count } = await supabase
          .from('event_artists')
          .select('*', { count: 'exact', head: true })
          .eq('artist_id', g.id)
        g.eventCount = count ?? 0
        console.log(`    [${g.slug}] "${g.name}"  (${g.eventCount} event links)`)
      }
    }
  }

  if (DRY_RUN) {
    console.log('\n✅  Dry run complete. Run without --dry-run to apply changes.\n')
    return
  }

  // ── Pass 3: apply deletions ────────────────────────────────────────────────
  let deleted = 0
  for (const r of toDelete) {
    // Remove event_artists links first
    await supabase.from('event_artists').delete().eq('artist_id', r.id)
    // Remove artist_candidates links
    await supabase.from('artist_candidates').update({ artist_id: null }).eq('artist_id', r.id)
    // Delete the artist
    const { error } = await supabase.from('artists').delete().eq('id', r.id)
    if (error) {
      console.error(`  ❌  Delete failed for "${r.original}": ${error.message}`)
    } else {
      console.log(`  🗑️  Deleted "${r.original}"`)
      deleted++
    }
  }

  // ── Pass 4: merge duplicates (before renaming, so we know which to keep) ───
  let merged = 0
  // Re-build keyMap with event counts populated
  const postCleanMap = new Map<string, Array<{ id: string; slug: string; name: string; eventCount: number }>>()

  for (const a of artists as Artist[]) {
    // Skip artists scheduled for deletion
    if (toDelete.find(r => r.id === a.id)) continue

    const result = results.find(r => r.id === a.id)
    const finalName = result?.cleaned ?? a.name_en
    if (!finalName) continue

    const key = normKey(finalName)
    if (!postCleanMap.has(key)) postCleanMap.set(key, [])

    const { count } = await supabase
      .from('event_artists')
      .select('*', { count: 'exact', head: true })
      .eq('artist_id', a.id)

    postCleanMap.get(key)!.push({ id: a.id, slug: a.slug, name: finalName, eventCount: count ?? 0 })
  }

  for (const [, group] of postCleanMap.entries()) {
    if (group.length <= 1) continue

    // Sort: keep the one with the most event links; tie-break: shorter slug
    group.sort((a, b) =>
      b.eventCount - a.eventCount || a.slug.length - b.slug.length,
    )
    const [keep, ...dupes] = group

    console.log(`\n  Merging → keep [${keep.slug}] "${keep.name}" (${keep.eventCount} events)`)

    for (const dupe of dupes) {
      console.log(`    Merging [${dupe.slug}] "${dupe.name}" (${dupe.eventCount} events)`)

      // Re-point event_artists from dupe → keep (skip conflicts)
      const { data: links } = await supabase
        .from('event_artists')
        .select('event_id, billing_order')
        .eq('artist_id', dupe.id)

      for (const link of links ?? []) {
        await supabase
          .from('event_artists')
          .upsert({ event_id: link.event_id, artist_id: keep.id, billing_order: link.billing_order })
      }

      // Update artist_candidates pointers
      await supabase
        .from('artist_candidates')
        .update({ artist_id: keep.id })
        .eq('artist_id', dupe.id)

      // Delete the duplicate
      await supabase.from('event_artists').delete().eq('artist_id', dupe.id)
      const { error } = await supabase.from('artists').delete().eq('id', dupe.id)
      if (error) {
        console.error(`    ❌  Merge delete failed: ${error.message}`)
      } else {
        merged++
      }
    }
  }

  // ── Pass 5: apply name + slug updates ─────────────────────────────────────
  let updated = 0
  const usedSlugs = new Set<string>(
    (artists as Artist[])
      .filter(a => !toDelete.find(r => r.id === a.id))
      .map(a => a.slug),
  )

  for (const r of toClean) {
    // Skip if this artist was deleted via merge
    const { data: stillExists } = await supabase
      .from('artists')
      .select('id')
      .eq('id', r.id)
      .maybeSingle()
    if (!stillExists) continue

    const newSlug = (() => {
      let candidate = slugify(r.cleaned!)
      if (candidate === r.slug) return r.slug  // no change needed
      let suffix = 2
      const base = candidate
      while (usedSlugs.has(candidate) && candidate !== r.slug) {
        candidate = `${base}-${suffix++}`
      }
      usedSlugs.add(candidate)
      return candidate
    })()

    const updates: Record<string, string> = { name_en: r.cleaned! }
    if (newSlug !== r.slug) updates.slug = newSlug

    const { error } = await supabase
      .from('artists')
      .update(updates)
      .eq('id', r.id)

    if (error) {
      console.error(`  ❌  Update failed for "${r.original}": ${error.message}`)
    } else {
      const slugNote = newSlug !== r.slug ? `  (slug: ${r.slug} → ${newSlug})` : ''
      console.log(`  ✏️  "${r.original}" → "${r.cleaned}"${slugNote}`)
      updated++
    }
  }

  // ── Final stats ────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────────')
  console.log('🏁  Done')
  console.log(`   Updated : ${updated}`)
  console.log(`   Deleted : ${deleted}`)
  console.log(`   Merged  : ${merged}`)
  console.log('')

  const { count: finalCount } = await supabase
    .from('artists')
    .select('*', { count: 'exact', head: true })
  console.log(`   Artists in DB now: ${finalCount}\n`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
