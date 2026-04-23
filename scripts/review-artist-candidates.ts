/**
 * scripts/review-artist-candidates.ts
 *
 * Phase 2 of the artist extraction pipeline.
 *
 * For each unreviewed candidate (medium, low, AND high confidence):
 *   1. Venue pre-check  — instantly rejects candidates that match a known venue
 *      name or are a significant part of one. Free, no API call needed.
 *   2. LLM classification — sends remaining candidates to Claude Haiku with the
 *      full venue list injected into the prompt for context.
 *
 * Why include high-confidence candidates here?
 *   High-confidence means the string appears often or is all-caps ASCII — but
 *   venue names (e.g. "BEARS", "Zeela") can satisfy those criteria too. The
 *   venue pre-check catches them before promotion.
 *
 * Usage:
 *   npx tsx scripts/review-artist-candidates.ts [--dry-run] [--limit N] [--all-confidence]
 *
 * Options:
 *   --dry-run          Print what would be sent; do not call the API or update the DB
 *   --limit N          Only process the first N candidates (useful for sampling)
 *   --all-confidence   Also process high-confidence rows (default: medium + low only)
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
const ALL_CONFIDENCE = process.argv.includes('--all-confidence')

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

const CLAUDE_MODEL   = 'claude-haiku-4-5-20251001'
const BATCH_SIZE     = 20
const BATCH_DELAY_MS = 500
const MAX_RETRIES    = 3

// Minimum token length to consider a venue name fragment a meaningful match.
// Prevents "BIG" or "THE" from matching.
const MIN_VENUE_TOKEN_LEN = 4

type LlmVerdict = 'artist' | 'not_artist' | 'uncertain'

interface VenueRow {
  name_en: string
  name_ja: string | null
  slug:    string
}

interface Candidate {
  id:             string
  raw_name:       string
  source:         'title' | 'description'
  confidence:     string
  event_id:       string
  title_en:       string | null
  description_en: string | null
}

interface ClassificationResult {
  id:      string
  verdict: LlmVerdict
  reason:  string
  method:  'venue_check' | 'llm'
}

// ── Venue matching ─────────────────────────────────────────────────────────────

/**
 * Builds a lookup structure from the venues table for fast matching.
 *
 * Two sets are produced:
 *  - exactNames:  full venue names (lowercase), for direct equality checks
 *  - tokenSet:    individual words ≥ MIN_VENUE_TOKEN_LEN from every venue name,
 *                 for substring / partial matching
 *
 * Example:
 *   "Umeda Zeela" → exactNames: {"umeda zeela"}, tokenSet: {"umeda", "zeela"}
 *   "Namba BEARS" → exactNames: {"namba bears"}, tokenSet: {"namba", "bears"}
 */
function buildVenueLookup(venues: VenueRow[]): {
  exactNames: Set<string>
  tokenSet:   Set<string>
  venueList:  string[]   // formatted for prompt injection
} {
  const exactNames = new Set<string>()
  const tokenSet   = new Set<string>()
  const venueList: string[] = []

  for (const v of venues) {
    const names = [v.name_en, v.name_ja].filter(Boolean) as string[]

    for (const name of names) {
      const lower = name.toLowerCase().trim()
      exactNames.add(lower)

      // Tokenise on whitespace and common separators
      for (const token of lower.split(/[\s\-_/・]+/)) {
        if (token.length >= MIN_VENUE_TOKEN_LEN) {
          tokenSet.add(token)
        }
      }
    }

    venueList.push(v.name_ja ? `${v.name_en} (${v.name_ja})` : v.name_en)
  }

  return { exactNames, tokenSet, venueList }
}

/**
 * Returns a not_artist verdict if the candidate name matches a known venue,
 * or null if the check is inconclusive (let LLM decide).
 *
 * Match strategies (in order):
 *  1. Exact match against any venue name
 *  2. Candidate (lowercased) is a significant token found in a venue name
 *     e.g. "Zeela" → token "zeela" ∈ tokenSet from "Umeda Zeela"
 *  3. Any venue exact-name is a substring of the candidate
 *     e.g. candidate "Namba BEARS presents" contains venue "Namba BEARS"
 */
function checkAgainstVenues(
  candidate: string,
  lookup: ReturnType<typeof buildVenueLookup>,
): { verdict: LlmVerdict; reason: string } | null {
  const lower = candidate.toLowerCase().trim()

  // 1. Exact full-name match
  if (lookup.exactNames.has(lower)) {
    return { verdict: 'not_artist', reason: 'exact match to known venue name' }
  }

  // 2. Candidate is itself a significant venue token
  //    (handles "Zeela", "BEARS", "Quattro", "JANUS", etc.)
  if (lower.length >= MIN_VENUE_TOKEN_LEN && lookup.tokenSet.has(lower)) {
    return { verdict: 'not_artist', reason: `"${candidate}" is a token from a known venue name` }
  }

  // 3. Any full venue name is contained within the candidate string
  //    (handles "Namba BEARS presents", "Club Quattro Night" etc.)
  for (const venueName of lookup.exactNames) {
    if (lower.includes(venueName) && venueName.length >= MIN_VENUE_TOKEN_LEN) {
      return { verdict: 'not_artist', reason: `contains known venue name "${venueName}"` }
    }
  }

  return null  // inconclusive — send to LLM
}

// ── Prompt construction ────────────────────────────────────────────────────────

function buildPrompt(c: Candidate, venueList: string[]): string {
  const title = (c.title_en ?? '').slice(0, 120)
  const desc  = (c.description_en ?? '').slice(0, 300)
  const venues = venueList.join(', ')

  return `You are classifying strings extracted from Japanese live music event listings in Osaka.

Classify this string as ONE of: "artist", "not_artist", or "uncertain"

Rules:
- "artist": a performing band or solo artist name
- "not_artist": a show title, series name, genre label, venue name, promoter name, or pricing string
- "uncertain": genuinely ambiguous — could be either

Known Osaka live venues (these are NOT artists):
${venues}

If the string matches or closely resembles any of the above venue names, or is clearly a
venue abbreviation or nickname (e.g. "Bears" for "Namba BEARS"), classify as "not_artist".

String: "${c.raw_name}"
Event title it appeared in: "${title}"
Event description: "${desc}"

Respond with JSON only: {"verdict": "artist"|"not_artist"|"uncertain", "reason": "one concise sentence"}`
}

// ── Response parsing ───────────────────────────────────────────────────────────

function parseVerdict(text: string): { verdict: LlmVerdict; reason: string } {
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*?\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { /* fall through */ }
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

  return {
    verdict: 'uncertain',
    reason:  `parse error — raw response: ${text.slice(0, 80)}`,
  }
}

// ── Anthropic API ──────────────────────────────────────────────────────────────

async function classifyWithClaude(
  candidates: Candidate[],
  venueList: string[],
): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = []

  for (const candidate of candidates) {
    const prompt = buildPrompt(candidate, venueList)
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         ANTHROPIC_KEY!,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model:      CLAUDE_MODEL,
            max_tokens: 150,
            messages: [{ role: 'user', content: prompt }],
          }),
        })

        if (!response.ok) {
          const body = await response.text()
          throw new Error(`HTTP ${response.status}: ${body}`)
        }

        const data = await response.json()
        const text: string = data.content?.[0]?.text ?? ''
        const parsed = parseVerdict(text)
        results.push({ id: candidate.id, ...parsed, method: 'llm' })
        break

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
      console.error(`  ✗  Failed to classify "${candidate.raw_name}" after ${MAX_RETRIES} retries:`, lastError)
      results.push({ id: candidate.id, verdict: 'uncertain', reason: 'API error — needs manual review', method: 'llm' })
    }
  }

  return results
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function markReviewed(results: ClassificationResult[]): Promise<void> {
  const CHUNK = 100
  for (let i = 0; i < results.length; i += CHUNK) {
    const chunk = results.slice(i, i + CHUNK)
    await Promise.all(
      chunk.map(r =>
        supabase
          .from('artist_candidates')
          .update({ llm_reviewed: true, llm_verdict: r.verdict })
          .eq('id', r.id)
          .then(({ error }: { error: { message: string } | null }) => {
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
  console.log(`\n🤖  Artist candidate reviewer${DRY_RUN ? '  [DRY RUN]' : ''}`)
  console.log(`    Model: ${CLAUDE_MODEL}`)
  console.log(`    Confidence levels: ${ALL_CONFIDENCE ? 'high + medium + low' : 'medium + low'}\n`)

  // ── 1. Load venues ──────────────────────────────────────────────────────────
  const { data: venueRows, error: venueError } = await supabase
    .from('venues')
    .select('name_en, name_ja, slug')
    .order('name_en')

  if (venueError || !venueRows) {
    console.error('❌  Failed to load venues:', venueError?.message)
    process.exit(1)
  }

  const venues = venueRows as VenueRow[]
  const venueLookup = buildVenueLookup(venues)

  console.log(`🏛️   Loaded ${venues.length} venues for pre-flight check`)
  console.log(`    Venue tokens: ${venueLookup.tokenSet.size} unique tokens\n`)

  // ── 2. Load unreviewed candidates ───────────────────────────────────────────
  const confidenceLevels = ALL_CONFIDENCE
    ? ['high', 'medium', 'low']
    : ['medium', 'low']

  let query = supabase
    .from('artist_candidates')
    .select(`
      id,
      raw_name,
      source,
      confidence,
      event_id,
      events (
        title_raw,
        description
      )
    `)
    .in('confidence', confidenceLevels)
    .eq('llm_reviewed', false)
    .order('confidence')
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
    console.log('✅  No unreviewed candidates found.\n')
    return
  }

  const candidates: Candidate[] = rawRows.map((row: Record<string, unknown>) => {
    const ev = row.events as { title_raw?: string | null; description?: string | null } | null
    return {
      id:             row.id as string,
      raw_name:       row.raw_name as string,
      source:         row.source as 'title' | 'description',
      confidence:     row.confidence as string,
      event_id:       row.event_id as string,
      title_en:       ev?.title_raw ?? null,
      description_en: ev?.description ?? null,
    }
  })

  console.log(`📋  Candidates to review: ${candidates.length}`)

  // ── 3. Venue pre-flight check ───────────────────────────────────────────────
  const venueRejected: ClassificationResult[] = []
  const needsLlm:      Candidate[]            = []

  for (const c of candidates) {
    const venueMatch = checkAgainstVenues(c.raw_name, venueLookup)
    if (venueMatch) {
      venueRejected.push({ id: c.id, ...venueMatch, method: 'venue_check' })
      if (DRY_RUN) {
        console.log(`  🏛️  [venue] "${c.raw_name}" → ${venueMatch.reason}`)
      }
    } else {
      needsLlm.push(c)
    }
  }

  console.log(`\n🏛️   Venue pre-check: ${venueRejected.length} rejected as venues, ${needsLlm.length} sent to LLM\n`)

  if (DRY_RUN) {
    console.log('🔍  Sample LLM prompts (first 3 remaining candidates):\n')
    for (const c of needsLlm.slice(0, 3)) {
      console.log('─'.repeat(60))
      console.log(`  [${c.confidence}] "${c.raw_name}"  (source: ${c.source})`)
      console.log(buildPrompt(c, venueLookup.venueList))
      console.log()
    }
    console.log('✅  Dry run complete. Remove --dry-run to classify.\n')
    return
  }

  // Persist venue rejections immediately — no LLM cost
  if (venueRejected.length > 0) {
    process.stdout.write(`\n💾  Saving ${venueRejected.length} venue rejections...`)
    await markReviewed(venueRejected)
    console.log(' done.\n')
  }

  // ── 4. LLM classification for remaining candidates ──────────────────────────
  if (needsLlm.length === 0) {
    console.log('✅  All candidates handled by venue pre-check — no LLM calls needed.\n')
  } else {
    const totalBatches = Math.ceil(needsLlm.length / BATCH_SIZE)
    console.log(`🤖  LLM classification: ${needsLlm.length} candidates in ${totalBatches} batch(es)\n`)

    const llmResults: ClassificationResult[] = []
    const verdictCounts: Record<LlmVerdict, number> = { artist: 0, not_artist: 0, uncertain: 0 }
    let errors = 0

    for (let b = 0; b < needsLlm.length; b += BATCH_SIZE) {
      const batch    = needsLlm.slice(b, b + BATCH_SIZE)
      const batchNum = Math.floor(b / BATCH_SIZE) + 1
      const pct      = Math.round((b / needsLlm.length) * 100)

      process.stdout.write(
        `\r  Batch ${fmt(batchNum, 3)} / ${totalBatches}  (${fmt(b + batch.length)} processed, ${pct}% done)...`
      )

      const results = await classifyWithClaude(batch, venueLookup.venueList)
      llmResults.push(...results)

      for (const r of results) {
        verdictCounts[r.verdict]++
        if (r.reason.startsWith('API error') || r.reason.startsWith('parse error')) errors++
      }

      await markReviewed(results)

      if (b + BATCH_SIZE < needsLlm.length) {
        await sleep(BATCH_DELAY_MS)
      }
    }

    const allResults = [...venueRejected, ...llmResults]

    // ── 5. Summary ──────────────────────────────────────────────────────────
    console.log(`\n\n✅  Review complete — ${allResults.length} candidates processed.\n`)

    console.log('📊  Results breakdown:')
    console.log(`    venue pre-check rejections : ${venueRejected.length}`)
    console.log(`    LLM → artist               : ${verdictCounts.artist}`)
    console.log(`    LLM → not_artist           : ${verdictCounts.not_artist}`)
    console.log(`    LLM → uncertain            : ${verdictCounts.uncertain}`)
    if (errors > 0) {
      console.log(`    ⚠  LLM errors             : ${errors}  (marked uncertain; review manually)`)
    }

    const artistResults = llmResults.filter(r => r.verdict === 'artist')
    if (artistResults.length > 0) {
      console.log('\n🎤  Sample confirmed artists (first 20):\n')
      for (const r of artistResults.slice(0, 20)) {
        const c = needsLlm.find(c => c.id === r.id)!
        console.log(`  [${c.confidence.padEnd(8)}] "${c.raw_name}"  — ${r.reason}`)
      }
      if (artistResults.length > 20) console.log(`  … and ${artistResults.length - 20} more`)
    }

    const uncertainResults = llmResults.filter(r => r.verdict === 'uncertain')
    if (uncertainResults.length > 0) {
      console.log('\n❓  Uncertain — needs manual review:\n')
      for (const r of uncertainResults.slice(0, 10)) {
        const c = needsLlm.find(c => c.id === r.id)!
        console.log(`  "${c.raw_name}"  — ${r.reason}`)
      }
      if (uncertainResults.length > 10) console.log(`  … and ${uncertainResults.length - 10} more`)
    }
  }

  console.log('\n🔍  Review the results:\n')
  console.log("    SELECT raw_name, confidence, llm_verdict, event_count")
  console.log("    FROM artist_candidate_summary")
  console.log("    WHERE (confidence = 'high' OR llm_verdict = 'artist')")
  console.log("      AND NOT already_promoted")
  console.log("    ORDER BY event_count DESC;\n")
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
