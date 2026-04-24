/**
 * scripts/apply-manual-image-overrides.ts
 *
 * Consumes tmp/multi-source-poc-v2/miss-list.csv.
 * For each row where override_image_url is filled in:
 *   1. Downloads the image (≤ 10 MB, 20s timeout)
 *   2. Uploads to Supabase Storage at artist-images/{slug}.{ext}
 *   3. UPDATE artists SET image_url = '<CDN URL>' WHERE slug = <slug>
 *   4. Reports success/failure per row
 *
 * Usage:
 *   npx tsx scripts/apply-manual-image-overrides.ts [--dry-run] [--csv <path>]
 *
 * Env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL=...    (required)
 *   SUPABASE_SERVICE_ROLE_KEY=...   (required)
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
const DRY_RUN = process.argv.includes('--dry-run')

const csvIdx = process.argv.indexOf('--csv')
const CSV_PATH: string =
  csvIdx !== -1
    ? process.argv[csvIdx + 1]
    : path.resolve(process.cwd(), 'tmp', 'multi-source-poc-v2', 'miss-list.csv')

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

const OL_UA = 'OsakaLive/0.1 (https://osaka.live; diku@genkanconsulting.com)'
const MAX_BYTES = 10 * 1024 * 1024  // 10 MB

// ── CSV parser (simple, handles quoted fields) ─────────────────────────────────
interface CsvRow {
  slug:               string
  name_en:            string
  name_ja:            string
  best_source:        string
  best_source_url:    string
  best_match_name:    string
  best_final_score:   string
  override_image_url: string
}

function parseCsv(content: string): CsvRow[] {
  const lines = content.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = splitCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const vals = splitCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h.trim()] = vals[i] ?? '' })
    return row as unknown as CsvRow
  })
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      let val = ''
      i++
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2 }
        else if (line[i] === '"') { i++; break }
        else { val += line[i++] }
      }
      fields.push(val)
      if (line[i] === ',') i++
    } else {
      const end = line.indexOf(',', i)
      if (end === -1) { fields.push(line.slice(i)); break }
      fields.push(line.slice(i, end))
      i = end + 1
    }
  }
  return fields
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function extFromContentType(ct: string, url: string): string {
  if (ct.includes('png'))  return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif'))  return 'gif'
  // Fall back to URL extension
  const match = url.match(/\.(\w{3,4})(?:\?|$)/)
  if (match) return match[1].toLowerCase()
  return 'jpg'
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌  CSV not found: ${CSV_PATH}`)
    console.error(`    Run multi-source-image-poc-v2.ts first to generate miss-list.csv`)
    process.exit(1)
  }

  const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'))
  const overrides = rows.filter((r) => r.override_image_url?.trim())

  if (overrides.length === 0) {
    console.log('ℹ️   No override_image_url values found in CSV. Nothing to do.')
    console.log(`    Edit ${CSV_PATH} and fill in the override_image_url column.`)
    return
  }

  console.log(
    `\n🖼   Applying ${overrides.length} manual image override(s)` +
    (DRY_RUN ? ' [--dry-run]' : '') +
    '\n',
  )

  let succeeded = 0
  let failed    = 0

  for (const row of overrides) {
    const { slug, name_en, override_image_url } = row
    const url = override_image_url.trim()
    console.log(`→  ${name_en} [${slug}]  ${url}`)

    if (DRY_RUN) {
      console.log(`   [dry-run] would download + upload + update DB\n`)
      continue
    }

    // 1. Download image
    let imageBuffer: Buffer
    let ext: string
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': OL_UA },
        signal:  AbortSignal.timeout(20_000),
        redirect: 'follow',
      })
      if (!res.ok) {
        console.error(`   ❌ Download failed: HTTP ${res.status}\n`)
        failed++
        continue
      }
      const ct = res.headers.get('content-type') ?? 'image/jpeg'
      if (!ct.startsWith('image/')) {
        console.error(`   ❌ Not an image: content-type=${ct}\n`)
        failed++
        continue
      }
      ext = extFromContentType(ct, url)
      const buf = await res.arrayBuffer()
      if (buf.byteLength > MAX_BYTES) {
        console.error(`   ❌ File too large: ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB > 10 MB\n`)
        failed++
        continue
      }
      imageBuffer = Buffer.from(buf)
      console.log(`   ↓ Downloaded ${(imageBuffer.byteLength / 1024).toFixed(0)} KB (${ext})`)
    } catch (e) {
      console.error(`   ❌ Download error: ${e}\n`)
      failed++
      continue
    }

    // 2. Upload to Supabase Storage
    const storagePath = `artist-images/${slug}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('public')
      .upload(storagePath, imageBuffer, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        upsert: true,
      })

    if (uploadError) {
      console.error(`   ❌ Storage upload failed: ${uploadError.message}\n`)
      failed++
      continue
    }

    // Get the public URL
    const { data: { publicUrl } } = supabase.storage
      .from('public')
      .getPublicUrl(storagePath)

    console.log(`   ↑ Uploaded → ${publicUrl}`)

    // 3. Update artists table
    const { error: dbError } = await supabase
      .from('artists')
      .update({ image_url: publicUrl })
      .eq('slug', slug)

    if (dbError) {
      console.error(`   ❌ DB update failed: ${dbError.message}\n`)
      failed++
      continue
    }

    console.log(`   ✅ artists.image_url updated\n`)
    succeeded++
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('─────────────────────────────────────────────────────')
  if (DRY_RUN) {
    console.log(`  DRY RUN — ${overrides.length} override(s) would be applied`)
  } else {
    console.log(`  ✅ Success: ${succeeded}`)
    console.log(`  ❌ Failed:  ${failed}`)
  }
  console.log('─────────────────────────────────────────────────────')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
