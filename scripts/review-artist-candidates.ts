/**
 * scripts/review-artist-candidates.ts
 *
 * Phase 2 of the artist extraction pipeline.
 * Sends all unreviewed medium/low-confidence candidates to Claude Haiku for
 * classification, then writes llm_verdict + llm_reviewed back to the DB.
 *
 * Usage:
 *   npx tsx scripts/review-artist-candidates.ts [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run   Print what would be sent; do not call the API or update the DB
 *   --limit N   Only process the first N candidates (useful for sampling)
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *   ANTHROPIC_API_KEY=...
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

const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY
const DRY_RUN        = process.argv.includes('--dry-run')

const limitIdx = process.argv.indexOf('--limit')
const LIMIT: number | null = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : null

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    '❌  Missing Supabase env vars.\n' +
    '    Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}

if (!ANTHROPIC_KEY && !DRY_RUN) {
  console.error(
    '❌  Missing ANTHROPIC_API_KEY.\n' +
    '    Add it to .env.local — get a key from https://console.anthropic.com',
  )
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<any>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── Config ─────────────────────────────────────────────────────────────────────

const CLAUDE_MODEL  = 'claude-haiku-4-5-20251001'
const BATCH_SIZE    = 20
const BATCH_DELAY_MS = 500
const MAX_RETRIES   = 3

type LlmVerdict = 'artist' | 'not_artist' | 'uncertain'

interface Candidate {
  id:               string
  raw_name:         string
  source:           'title' | 'description'
  confidence:       string
  event_id:         string
  title_en:         string | null
  description_en:   string | null
}

interface ClassificationResult {
  id:      string
  verdict: LlmVerdict
  reason:  string
}

// ── Anthropic API call ─────────────────────────────────────────────────────────

async function classifyWithClaude(
  candidates: Candidate[],
): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = []

  for (const candidate of candidates) {
    const prompt = buildPrompt(candidate)
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type':         'application/json',
            'x-api-key':            ANTHROPIC_KEY!,
            'anthropic-version':    '2023-06-01',
          },
          body: JSON.stringify({
            model:      CLAUDE_MODEL,
            max_tokens: 150,
            messages: [
              { role: 'user', content: prompt },
            ],
          }),
        })

        if (!response.ok) {
          const body = await response.text()
          throw new Error(`HTTP ${response.status}: ${body}`)
        }

        const data = await response.json()
        const text: string = data.content?.[0]?.text ?? ''
        const parsed = parseVerdict(text)

        results.push({ id: candidate.id, ...parsed })
        break  // success — exit retry loop

      } catch (err) {
        lastError = err
        if (attempt < MAX_RETRIES) {
          const backoff = attempt * 1000
          process.stderr.write(`  ⚠  Retry ${attempt}/${MAX_RETRIES} for "${candidate.raw_name}" (${backoff}ms)...\n`)
          await sleep(backoff)
        }
      }
    }

    if (results[results.length - 1]?.id !== candidate.id) {
      // All retries exhausted — record as uncertain so it surfaces for manual review
      console.error(`  ✗  Failed to classify "${candidate.raw_name}" after ${MAX_RETRIES} retries:`, lastError)
      results.push({ id: candidate.id, verdict: 'uncertain', reason: 'API error — needs manual review' })
    }
  }

  return results
}

// ── Prompt construction ────────────────────────────────────────────────────────

function buildPrompt(c: Candidate): string {
  // Truncate event context to keep tokens low; Haiku charges per token
  const title = (c.title_en ?? '').slice(0, 120)
  const desc  = (c.description_en ?? '').slice(0, 300)

  return `You are classifying strings extracted from Japanese live music event listings.

Classify this string as ONE of: "artist", "not_artist", or "uncertain"

Rules:
- "artist": a performing band or solo artist name
- "not_artist": a show title, series name, genre label, venue name, or pricing string
- "uncertain": genuinely ambiguous — could be either

String: "${c.raw_name}"
Event title it appeared in: "${title}"
Event description: "${desc}"

Respond with JSON only: {"verdict": "artist"|"not_artist"|"uncertain", "reason": "one concise sentence"}`
}

// ── Response parsing ───────────────────────────────────────────────────────────

function parseVerdict(text: string): { verdict: LlmVerdict; reason: string } {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()

  let parsed: unknown
  try {
    // Try the full text first
    parsed = JSON.parse(cleaned)
  } catch {
    // Try to extract the first {...} block
    const match = cleaned.match(/\{[\s\S]*?\}/)
    if (match) {
      try {
        parsed = JSON.parse(match[0])
      } catch {
        // fall through to fallback
      }
    }
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    parsed !== null &&
    'verdict' in parsed &&
    typeof (parsed as Record<string, unknown>).verdict === 'string'
  ) {
    const obj    = parsed as Record<string, unknown>
    const v      = (obj.verdict as string).toLowerCase().trim()
    const reason = typeof obj.reason === 'string' ? obj.reason.trim() : 'no reason given'

    if (v === 'artist' || v === 'not_artist' || v === 'uncertain') {
      return { verdict: v as LlmVerdict, reason }
    }
  }

  // Could not parse a valid verdict — flag as uncertain
  return {
    verdict: 'uncertain',
    reason:  `parse error — raw response: ${text.slice(0, 80)}`,
  }
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function markReviewed(results: ClassificationResult[]): Promise<void> {
  // Update in batches to avoid hitting Supabase request size limits
  const CHUNK = 100
  for (let i = 0; i < results.length; i += CHUNK) {
    const chunk = results.slice(i, i + CHUNK)

    // Supabase JS doesn't support bulk UPDATE with per-row values natively,
    // so we use individual updates. For 100-row chunks this is fine via HTTP/2.
    await Promise.all(
      chunk.map(r =>
        supabase
          .from('artist_candidates')
          .update({ llm_reviewed: true, llm_verdict: r.verdict })
          .eq('id', r.id)
          .then(({ error }) => {
            if (error) throw new Error(`Update failed for ${r.id}: ${error.message}`)
          }),
      ),
    )

    process.stdout.write(`\r    Saved ${Math.min(i + CHUNK, results.length)} / ${results.length} results...`)
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function fmt(n: number, width = 4): string {
  return String(n).padStart(width)
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🤖  Artist candidate LLM reviewer${DRY_RUN ? '  [DRY RUN]' : ''}`)
  console.log(`    Model: ${CLAUDE_MODEL}\n`)

  // ── 1. Load unreviewed medium/low candidates with their event context ──────
  let query = supabase
    .from('artist_candidates')
    .select(`
      id,
      raw_name,
      source,
      confidence,
      event_id,
      events (
        title_en,
        description_en
      )
    `)
    .in('confidence', ['medium', 'low'])
    .eq('llm_reviewed', false)
    .order('confidence')   // process medium before low
    .order('raw_name')

  if (LIMIT !== null && !isNaN(LIMIT)) {
    query = query.limit(LIMIT)
  }

  const { data: rawRows, error } = await query

  if (error) {
    console.error('❌  Failed to load candidates:', error.message)
    process.exit(1)
  }

  if (!rawRows || rawRows.length === 0) {
    console.log('✅  No unreviewed medium/low candidates found. Phase 2 complete (or Phase 1 not yet run).\n')
    return
  }

  // Flatten the joined events data
  const candidates: Candidate[] = rawRows.map((row: Record<string, unknown>) => {
    const ev = row.events as { title_en?: string | null; description_en?: string | null } | null
    return {
      id:             row.id as string,
      raw_name:       row.raw_name as string,
      source:         row.source as 'title' | 'description',
      confidence:     row.confidence as string,
      event_id:       row.event_id as string,
      title_en:       ev?.title_en ?? null,
      description_en: ev?.description_en ?? null,
    }
  })

  const mediumCount = candidates.filter(c => c.confidence === 'medium').length
  const lowCount    = candidates.filter(c => c.confidence === 'low').length
  const totalBatches = Math.ceil(candidates.length / BATCH_SIZE)

  console.log(`📋  Candidates to review: ${candidates.length}`)
  console.log(`    medium: ${mediumCount}   low: ${lowCount}`)
  console.log(`    Batches: ${totalBatches} × ${BATCH_SIZE}\n`)

  if (DRY_RUN) {
    console.log('🔍  Sample prompts (first 3 candidates):\n')
    for (const c of candidates.slice(0, 3)) {
      console.log('─'.repeat(60))
      console.log(`  [${c.confidence}] "${c.raw_name}"  (source: ${c.source})`)
      console.log(buildPrompt(c))
      console.log()
    }
    console.log('✅  Dry run complete. Remove --dry-run to classify.\n')
    return
  }

  // ── 2. Process batches ────────────────────────────────────────────────────
  const allResults: ClassificationResult[] = []
  const verdictCounts: Record<LlmVerdict, number> = { artist: 0, not_artist: 0, uncertain: 0 }
  let errors = 0

  for (let b = 0; b < candidates.length; b += BATCH_SIZE) {
    const batch      = candidates.slice(b, b + BATCH_SIZE)
    const batchNum   = Math.floor(b / BATCH_SIZE) + 1
    const pct        = Math.round((b / candidates.length) * 100)

    process.stdout.write(
      `\r  Batch ${fmt(batchNum, 3)} / ${totalBatches}  (${fmt(b + batch.length)} processed, ${pct}% done)...`
    )

    const results = await classifyWithClaude(batch)
    allResults.push(...results)

    for (const r of results) {
      verdictCounts[r.verdict]++
      if (r.reason.startsWith('API error') || r.reason.startsWith('parse error')) errors++
    }

    // Persist after each batch so a crash doesn't lose work
    await markReviewed(results)

    // Polite delay between batches
    if (b + BATCH_SIZE < candidates.length) {
      await sleep(BATCH_DELAY_MS)
    }
  }

  // ── 3. Summary ────────────────────────────────────────────────────────────
  console.log(`\n\n✅  Phase 2 complete — ${allResults.length} candidates reviewed.\n`)

  console.log('📊  Verdict breakdown:')
  console.log(`    artist     : ${verdictCounts.artist}`)
  console.log(`    not_artist : ${verdictCounts.not_artist}`)
  console.log(`    uncertain  : ${verdictCounts.uncertain}`)
  if (errors > 0) {
    console.log(`    ⚠  errors  : ${errors}  (marked uncertain; review manually)`)
  }

  // Print a sample of artists found
  const artistResults = allResults.filter(r => r.verdict === 'artist')
  if (artistResults.length > 0) {
    console.log('\n🎤  Sample of confirmed artists (first 20):\n')
    for (const r of artistResults.slice(0, 20)) {
      const c = candidates.find(c => c.id === r.id)!
      const conf = c.confidence.padEnd(8)
      console.log(`  [${conf}] "${c.raw_name}"  — ${r.reason}`)
    }
    if (artistResults.length > 20) {
      console.log(`  … and ${artistResults.length - 20} more`)
    }
  }

  const uncertainResults = allResults.filter(r => r.verdict === 'uncertain')
  if (uncertainResults.length > 0) {
    console.log('\n❓  Uncertain — needs manual review:\n')
    for (const r of uncertainResults.slice(0, 10)) {
      const c = candidates.find(c => c.id === r.id)!
      console.log(`  "${c.raw_name}"  — ${r.reason}`)
    }
    if (uncertainResults.length > 10) {
      console.log(`  … and ${uncertainResults.length - 10} more`)
    }
  }

  console.log('\n🔍  Review the results:\n')
  console.log("    -- Artists ready to promote:")
  console.log("    SELECT raw_name, confidence, llm_verdict, event_count")
  console.log("    FROM artist_candidate_summary")
  console.log("    WHERE (confidence = 'high' OR llm_verdict = 'artist')")
  console.log("      AND NOT already_promoted")
  console.log("    ORDER BY event_count DESC;\n")
  console.log("    -- Uncertain / needs manual decision:")
  console.log("    SELECT raw_name, confidence, llm_verdict, event_count, confidence_reason")
  console.log("    FROM artist_candidate_summary")
  console.log("    WHERE llm_verdict = 'uncertain'")
  console.log("    ORDER BY event_count DESC;\n")
  console.log("    -- Override a verdict manually:")
  console.log("    UPDATE artist_candidates SET llm_verdict = 'artist' WHERE raw_name = 'BAND NAME';\n")
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
