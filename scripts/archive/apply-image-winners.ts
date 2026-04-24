/**
 * scripts/apply-image-winners.ts
 *
 * Reads tmp/multi-source-poc-v2/report.json and applies winning image URLs
 * to the artists table.
 *
 * Default mode: downloads each winner image and re-uploads to Supabase Storage
 * at artist-images/{slug}.{ext}, then sets artists.image_url to the CDN URL.
 * Use --no-upload to skip Storage and write the source URL directly (faster,
 * but CDN URLs from Spotify/Deezer/etc. can rotate).
 *
 * Usage:
 *   npx tsx scripts/apply-image-winners.ts [options]
 *
 *   --dry-run          Print what would happen, no writes
 *   --no-upload        Write source imageUrl directly (skip Storage upload)
 *   --force            Also update artists that already have image_url set
 *   --only <slugs>     Comma-separated slugs to apply (subset of hits)
 *   --report <path>    Path to report.json (default: tmp/multi-source-poc-v2/report.json)
 *
 * Env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
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
const DRY_RUN   = process.argv.includes('--dry-run')
const NO_UPLOAD = process.argv.includes('--no-upload')
const FORCE     = process.argv.includes('--force')

const reportIdx = process.argv.indexOf('--report')
const REPORT_PATH: string =
  reportIdx !== -1
    ? process.argv[reportIdx + 1]
    : path.resolve(process.cwd(), 'tmp', 'multi-source-poc-v2', 'report.json')

const onlyIdx = process.argv.indexOf('--only')
const ONLY_SLUGS: Set<string> | null =
  onlyIdx !== -1
    ? new Set(process.argv[onlyIdx + 1].split(',').map((s) => s.trim()))
    : null

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

const OL_UA    = 'OsakaLive/0.1 (https://osaka.live; diku@genkanconsulting.com)'
const MAX_BYTES = 10 * 1024 * 1024

// ── Types ──────────────────────────────────────────────────────────────────────
interface ReportRow {
  slug:    string
  name_en: string
  name_ja: string | null
  verdict: 'hit' | 'ambiguous' | 'miss'
  winner: {
    source:     string
    imageUrl:   string
    matchName:  string
    finalScore: number
    width?:     number
    height?:    number
  } | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function extFromContentType(ct: string, url: string): string {
  if (ct.includes('png'))  return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif'))  return 'gif'
  const m = url.match(/\.(\w{3,4})(?:\?|$)/)
  return m ? m[1].toLowerCase() : 'jpg'
}

async function downloadImage(imageUrl: string): Promise<{ buf: Buffer; ext: string } | null> {
  try {
    const res = await fetch(imageUrl, {
      headers:  { 'User-Agent': OL_UA },
      signal:   AbortSignal.timeout(20_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return null
    const ext = extFromContentType(ct, imageUrl)
    return { buf, ext }
  } catch {
    return null
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (!fs.existsSync(REPORT_PATH)) {
    console.error(`❌  report.json not found: ${REPORT_PATH}`)
    console.error(`    Run multi-source-image-poc-v2.ts first.`)
    process.exit(1)
  }

  const report: ReportRow[] = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'))
  let hits = report.filter((r) => r.verdict === 'hit' && r.winner)

  if (ONLY_SLUGS) hits = hits.filter((r) => ONLY_SLUGS.has(r.slug))

  if (!FORCE) {
    // Check which slugs already have image_url set
    const slugs = hits.map((r) => r.slug)
    const { data } = await supabase
      .from('artists')
      .select('slug, image_url')
      .in('slug', slugs)
    const alreadySet = new Set(
      (data ?? []).filter((r: { image_url: string | null }) => r.image_url).map((r: { slug: string }) => r.slug),
    )
    const skipped = hits.filter((r) => alreadySet.has(r.slug))
    hits = hits.filter((r) => !alreadySet.has(r.slug))
    if (skipped.length > 0) {
      console.log(
        `ℹ️   Skipping ${skipped.length} artist(s) that already have image_url ` +
        `(use --force to override): ${skipped.map((r) => r.slug).join(', ')}\n`,
      )
    }
  }

  if (hits.length === 0) {
    console.log('✅  Nothing to apply.')
    return
  }

  console.log(
    `\n🖼   Applying ${hits.length} winner(s)` +
    (NO_UPLOAD ? ' [direct URL, no Storage upload]' : ' [download + Storage upload]') +
    (DRY_RUN   ? ' [--dry-run]' : '') +
    '\n',
  )

  let succeeded = 0
  let failed    = 0

  for (const row of hits) {
    const { slug, name_en, winner } = row
    if (!winner) continue
    console.log(
      `→  ${name_en} [${slug}]  source=${winner.source}` +
      `  score=${winner.finalScore.toFixed(2)}  "${winner.matchName}"`,
    )

    if (DRY_RUN) {
      console.log(
        NO_UPLOAD
          ? `   [dry-run] would set image_url = ${winner.imageUrl}\n`
          : `   [dry-run] would download, upload to artist-images/${slug}.{ext}, set image_url\n`,
      )
      continue
    }

    let finalUrl: string

    if (NO_UPLOAD) {
      finalUrl = winner.imageUrl
    } else {
      // Download
      const dl = await downloadImage(winner.imageUrl)
      if (!dl) {
        console.error(`   ❌ Download failed or bad content-type\n`)
        failed++
        continue
      }
      console.log(`   ↓ Downloaded ${(dl.buf.byteLength / 1024).toFixed(0)} KB (${dl.ext})`)

      // Upload to Supabase Storage
      const storagePath = `artist-images/${slug}.${dl.ext}`
      const { error: uploadErr } = await supabase.storage
        .from('public')
        .upload(storagePath, dl.buf, {
          contentType: `image/${dl.ext === 'jpg' ? 'jpeg' : dl.ext}`,
          upsert: true,
        })
      if (uploadErr) {
        console.error(`   ❌ Storage upload failed: ${uploadErr.message}\n`)
        failed++
        continue
      }
      const { data: { publicUrl } } = supabase.storage
        .from('public')
        .getPublicUrl(storagePath)
      finalUrl = publicUrl
      console.log(`   ↑ Uploaded → ${finalUrl}`)
    }

    // Write to artists table
    const { error: dbErr } = await supabase
      .from('artists')
      .update({ image_url: finalUrl })
      .eq('slug', slug)

    if (dbErr) {
      console.error(`   ❌ DB update failed: ${dbErr.message}\n`)
      failed++
      continue
    }

    console.log(`   ✅ artists.image_url updated\n`)
    succeeded++
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('─────────────────────────────────────────────────────')
  if (DRY_RUN) {
    console.log(`  DRY RUN — ${hits.length} winner(s) would be applied`)
  } else {
    console.log(`  ✅ Applied: ${succeeded}`)
    console.log(`  ❌ Failed:  ${failed}`)
  }
  console.log('─────────────────────────────────────────────────────')

  // Spot-check SQL hint
  if (!DRY_RUN && succeeded > 0) {
    console.log('\n  Verify with:')
    console.log(`  SELECT slug, image_url FROM artists WHERE image_url IS NOT NULL ORDER BY name_en;\n`)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
