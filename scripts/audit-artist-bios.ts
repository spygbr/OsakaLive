/**
 * scripts/audit-artist-bios.ts
 *
 * Read-only QA audit of artist bio coverage.
 *
 * Prints:
 *   - Total artists / with bio_en / with bio_ja / both / neither
 *   - Average and median bio length per language
 *   - Provider breakdown via bio_source
 *   - 20 random sample bios for spot-checking
 *
 * Usage:
 *   npx tsx scripts/audit-artist-bios.ts
 *   npx tsx scripts/audit-artist-bios.ts --csv tmp/bio-audit.csv
 *   npx tsx scripts/audit-artist-bios.ts --sample 20
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import fs   from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

// ── env ────────────────────────────────────────────────────────────────────────
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
const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── args ───────────────────────────────────────────────────────────────────────
function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}
const CSV_PATH   = argVal('--csv')
const sampleArg  = argVal('--sample')
const SAMPLE_N   = sampleArg ? parseInt(sampleArg, 10) : 20

// ── helpers ────────────────────────────────────────────────────────────────────
function avg(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0
}
function median(nums: number[]): number {
  if (!nums.length) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── main ───────────────────────────────────────────────────────────────────────
interface ArtistRow {
  slug:       string
  name_en:    string
  name_ja:    string | null
  bio_en:     string | null
  bio_ja:     string | null
  bio_source: string | null
}

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from('artists')
    .select('slug, name_en, name_ja, bio_en, bio_ja, bio_source')
    .order('name_en')

  if (error) { console.error('❌', error.message); process.exit(1) }
  const rows = (data ?? []) as ArtistRow[]

  const hasBioEn  = rows.filter((r) => r.bio_en)
  const hasBioJa  = rows.filter((r) => r.bio_ja)
  const hasBoth   = rows.filter((r) => r.bio_en && r.bio_ja)
  const hasNeither = rows.filter((r) => !r.bio_en && !r.bio_ja)

  const enLengths = hasBioEn.map((r) => r.bio_en!.length)
  const jaLengths = hasBioJa.map((r) => r.bio_ja!.length)

  // Provider breakdown
  const sourceCount = new Map<string, number>()
  for (const r of rows) {
    if (!r.bio_source) continue
    sourceCount.set(r.bio_source, (sourceCount.get(r.bio_source) ?? 0) + 1)
  }

  const pct = (n: number) => rows.length ? `${((n / rows.length) * 100).toFixed(1)}%` : '—'

  console.log('\n📊  Artist Bio Audit')
  console.log('═══════════════════════════════════════════════')
  console.log(`  Total artists     ${rows.length}`)
  console.log(`  bio_en present    ${hasBioEn.length.toString().padStart(4)}  (${pct(hasBioEn.length)})`)
  console.log(`  bio_ja present    ${hasBioJa.length.toString().padStart(4)}  (${pct(hasBioJa.length)})`)
  console.log(`  both present      ${hasBoth.length.toString().padStart(4)}  (${pct(hasBoth.length)})`)
  console.log(`  neither           ${hasNeither.length.toString().padStart(4)}  (${pct(hasNeither.length)})`)
  console.log('')
  console.log(`  bio_en avg len    ${avg(enLengths).toFixed(0)} chars`)
  console.log(`  bio_en median     ${median(enLengths).toFixed(0)} chars`)
  console.log(`  bio_ja avg len    ${avg(jaLengths).toFixed(0)} chars`)
  console.log(`  bio_ja median     ${median(jaLengths).toFixed(0)} chars`)
  console.log('')
  console.log('  Provider breakdown (bio_source):')
  for (const [src, count] of [...sourceCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${src.padEnd(30)} ${count}`)
  }

  // Short bios (may need review)
  const shortEn = hasBioEn.filter((r) => r.bio_en!.length < 120)
  if (shortEn.length) {
    console.log(`\n  ⚠  ${shortEn.length} bio_en entries are shorter than 120 chars:`)
    for (const r of shortEn.slice(0, 10)) {
      console.log(`    [${r.slug}]  "${r.bio_en!.slice(0, 80)}…"`)
    }
  }

  // Random spot-check sample
  if (SAMPLE_N > 0) {
    const sample = shuffle(hasBioEn).slice(0, SAMPLE_N)
    console.log(`\n  🔎  ${SAMPLE_N} random bio_en spot-checks:`)
    console.log('─────────────────────────────────────────────────────────────────')
    for (const r of sample) {
      console.log(`\n  [${r.slug}] ${r.name_en}${r.name_ja ? ` / ${r.name_ja}` : ''}  (source: ${r.bio_source ?? '—'})`)
      console.log(`  EN: ${r.bio_en!.slice(0, 200)}${r.bio_en!.length > 200 ? '…' : ''}`)
      if (r.bio_ja) {
        console.log(`  JA: ${r.bio_ja.slice(0, 200)}${r.bio_ja.length > 200 ? '…' : ''}`)
      }
    }
  }

  // CSV output
  if (CSV_PATH) {
    const csvLines = [
      'slug,name_en,name_ja,bio_en_len,bio_ja_len,bio_source,bio_en_preview',
      ...rows.map((r) => [
        r.slug,
        `"${(r.name_en ?? '').replace(/"/g, '""')}"`,
        `"${(r.name_ja ?? '').replace(/"/g, '""')}"`,
        r.bio_en?.length ?? 0,
        r.bio_ja?.length ?? 0,
        r.bio_source ?? '',
        `"${(r.bio_en ?? '').slice(0, 120).replace(/"/g, '""')}"`,
      ].join(',')),
    ]
    const outPath = path.resolve(process.cwd(), CSV_PATH)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, csvLines.join('\n'))
    console.log(`\n📄  CSV → ${outPath}`)
  }

  console.log('')
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
