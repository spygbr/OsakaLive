/**
 * Shared Claude Haiku client for OsakaLive pipeline scripts.
 *
 * Consolidates the ad-hoc fetch()/retry/JSON-parse blocks that used to live in:
 *   - scripts/review-artist-candidates.ts   (Step 2: artist classification)
 *   - scripts/enrich-artist-socials.ts      (Step 5: social link lookup)
 *   - scripts/enrich-artists.ts             (merged Step 5+6)
 *
 * Features:
 *   - Retry with exponential backoff on network errors and 5xx responses
 *   - Honour `retry-after` header on 429
 *   - Pluggable JSON validator — caller supplies a type guard
 *   - Token-usage accumulator → cost logging at the end of a run
 *   - Configurable rate-limit delay between requests
 *   - Timeout per request
 *
 * Usage:
 *   import { createHaikuClient } from '@/lib/llm/haiku'
 *
 *   const haiku = createHaikuClient()   // reads ANTHROPIC_API_KEY from env
 *
 *   type Verdict = { verdict: 'artist'|'not_artist'|'uncertain'; reason: string }
 *   const isVerdict = (x: unknown): x is Verdict =>
 *     typeof x === 'object' && x !== null &&
 *     ['artist','not_artist','uncertain'].includes((x as {verdict:unknown}).verdict as string)
 *
 *   const result = await haiku.askJson<Verdict>({
 *     prompt:     'Classify "BAND NAME"...',
 *     maxTokens:  150,
 *     validate:   isVerdict,
 *     label:      'classify',   // shows up in logs + cost accounting
 *   })
 *
 *   // At end of run:
 *   haiku.logCostSummary()
 */

// ── Pricing (Claude Haiku 4.5 — USD per million tokens) ────────────────────────
// Update here if the model changes. As of 2025-10, Haiku 4.5 = $1 in / $5 out.
const PRICING = {
  inputPerMillion:   1.00,
  outputPerMillion:  5.00,
} as const

const DEFAULT_MODEL     = 'claude-haiku-4-5-20251001'
const DEFAULT_TIMEOUT   = 30_000
const DEFAULT_RATE_MS   = 250    // polite delay between successive requests
const DEFAULT_RETRIES   = 3

// ── Types ──────────────────────────────────────────────────────────────────────
export interface AskJsonOptions<T> {
  /** The user-content string */
  prompt:       string
  /** max_tokens for Claude's reply (default 300) */
  maxTokens?:   number
  /**
   * Type-guard validator. Return true if the parsed JSON matches your type.
   * If false, the call is treated as a parse failure (null is returned).
   */
  validate:     (x: unknown) => x is T
  /** Optional human label used in logs + cost breakdown (e.g. 'classify', 'socials') */
  label?:       string
  /** Override client default (ms between requests) */
  rateDelayMs?: number
}

export interface HaikuUsageStats {
  calls:         number
  inputTokens:   number
  outputTokens:  number
  errors:        number
  parseFailures: number
  /** Accumulated USD cost (rounded to 4 decimals on read) */
  costUsd:       number
}

export interface HaikuClientOptions {
  apiKey?:     string
  model?:      string
  timeoutMs?:  number
  maxRetries?: number
  /** Default rate-limit delay between successive calls (can be overridden per-call) */
  rateDelayMs?: number
}

// ── Implementation ─────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Strip ```json fences and extract the first JSON object from a string. */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
  try { return JSON.parse(cleaned) } catch { /* fall through */ }
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

export function createHaikuClient(opts: HaikuClientOptions = {}) {
  const apiKey     = opts.apiKey     ?? process.env.ANTHROPIC_API_KEY
  const model      = opts.model      ?? DEFAULT_MODEL
  const timeoutMs  = opts.timeoutMs  ?? DEFAULT_TIMEOUT
  const maxRetries = opts.maxRetries ?? DEFAULT_RETRIES
  const rateDelay  = opts.rateDelayMs ?? DEFAULT_RATE_MS

  if (!apiKey) throw new Error('createHaikuClient: ANTHROPIC_API_KEY missing')

  // Usage totals, indexed by label (+ '_total' rollup)
  const usageByLabel = new Map<string, HaikuUsageStats>()
  function bump(label: string, patch: Partial<HaikuUsageStats>) {
    const key = label || 'default'
    const prev = usageByLabel.get(key) ?? {
      calls: 0, inputTokens: 0, outputTokens: 0, errors: 0, parseFailures: 0, costUsd: 0,
    }
    usageByLabel.set(key, {
      calls:         prev.calls         + (patch.calls         ?? 0),
      inputTokens:   prev.inputTokens   + (patch.inputTokens   ?? 0),
      outputTokens:  prev.outputTokens  + (patch.outputTokens  ?? 0),
      errors:        prev.errors        + (patch.errors        ?? 0),
      parseFailures: prev.parseFailures + (patch.parseFailures ?? 0),
      costUsd:       prev.costUsd       + (patch.costUsd       ?? 0),
    })
  }

  let lastCallAt = 0

  async function callRaw(prompt: string, maxTokens: number): Promise<{
    text: string
    inputTokens: number
    outputTokens: number
  } | null> {
    let lastErr: unknown
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         apiKey!,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })

        if (res.status === 429 || res.status >= 500) {
          const retryAfterRaw = res.headers.get('retry-after')
          const retryAfterMs = retryAfterRaw ? parseInt(retryAfterRaw, 10) * 1_000 : attempt * 1_500
          if (attempt < maxRetries) {
            await sleep(retryAfterMs)
            continue
          }
          throw new Error(`HTTP ${res.status}${retryAfterRaw ? ` (retry-after ${retryAfterRaw})` : ''}`)
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)

        const data = await res.json()
        return {
          text:         data.content?.[0]?.text ?? '',
          inputTokens:  data.usage?.input_tokens  ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
        }
      } catch (err) {
        lastErr = err
        if (attempt < maxRetries) await sleep(attempt * 1_200)
      }
    }
    process.stderr.write(`   ❌  Haiku call failed after ${maxRetries} attempts: ${lastErr}\n`)
    return null
  }

  /** Ask Haiku for a JSON response, validated against a caller-supplied guard. */
  async function askJson<T>(options: AskJsonOptions<T>): Promise<T | null> {
    const { prompt, maxTokens = 300, validate, label = 'default', rateDelayMs = rateDelay } = options

    // Rate-limit: wait before firing a new request (global to this client)
    const elapsed = Date.now() - lastCallAt
    if (elapsed < rateDelayMs) await sleep(rateDelayMs - elapsed)
    lastCallAt = Date.now()

    const raw = await callRaw(prompt, maxTokens)
    if (!raw) {
      bump(label, { calls: 1, errors: 1 })
      return null
    }

    const costUsd =
      (raw.inputTokens  * PRICING.inputPerMillion  / 1_000_000) +
      (raw.outputTokens * PRICING.outputPerMillion / 1_000_000)

    bump(label, {
      calls:        1,
      inputTokens:  raw.inputTokens,
      outputTokens: raw.outputTokens,
      costUsd,
    })

    const parsed = extractJson(raw.text)
    if (parsed === null || !validate(parsed)) {
      bump(label, { parseFailures: 1 })
      return null
    }
    return parsed
  }

  /** Return a snapshot of usage stats, plus a rollup across all labels. */
  function getUsage(): Record<string, HaikuUsageStats> & { _total: HaikuUsageStats } {
    const out: Record<string, HaikuUsageStats> = {}
    const total: HaikuUsageStats = {
      calls: 0, inputTokens: 0, outputTokens: 0, errors: 0, parseFailures: 0, costUsd: 0,
    }
    for (const [label, stats] of usageByLabel) {
      out[label] = { ...stats, costUsd: Number(stats.costUsd.toFixed(4)) }
      total.calls         += stats.calls
      total.inputTokens   += stats.inputTokens
      total.outputTokens  += stats.outputTokens
      total.errors        += stats.errors
      total.parseFailures += stats.parseFailures
      total.costUsd       += stats.costUsd
    }
    total.costUsd = Number(total.costUsd.toFixed(4))
    return { ...out, _total: total }
  }

  /** Pretty-print usage to stdout. */
  function logCostSummary(): void {
    const usage = getUsage()
    const labels = Object.keys(usage).filter((k) => k !== '_total')
    if (labels.length === 0) return
    console.log('\n─────────────────────────────────────────────────────')
    console.log(`🤖  Haiku usage (${model})`)
    for (const label of labels) {
      const s = usage[label]
      console.log(
        `   ${label.padEnd(12)}  ${String(s.calls).padStart(4)} calls  ` +
        `${String(s.inputTokens).padStart(7)} in / ${String(s.outputTokens).padStart(6)} out  ` +
        `$${s.costUsd.toFixed(4)}` +
        (s.errors        ? `  (${s.errors} errors)`         : '') +
        (s.parseFailures ? `  (${s.parseFailures} parseFail)` : ''),
      )
    }
    console.log(`   ${'TOTAL'.padEnd(12)}  $${usage._total.costUsd.toFixed(4)}`)
  }

  return { askJson, getUsage, logCostSummary }
}

export type HaikuClient = ReturnType<typeof createHaikuClient>
