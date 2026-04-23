/**
 * Source — abstract base class implemented by every scraper.
 *
 * Two implementations expected:
 *   - VenueSource:      one venue's schedule page. venueId is fixed.
 *   - AggregatorSource: a multi-venue tour list. Emits venueHint and lets
 *                       the runner resolve via venue-resolver.
 *
 * The runner's contract:
 *   1. await source.run({ http, prevEtag, prevLastModified, prevHash })
 *   2. Apply validators to result.events  → quarantine rejects
 *   3. Resolve venues for entries that have venueHint
 *   4. Upsert into events + event_sources
 *   5. Persist HTTP cache markers back to sources row
 */

import { fetchPage, type FetchOptions } from './fetcher'
import type { ParseResult, RawEvent, RejectedEvent, FetchedPage } from './types'

/** Context the runner passes into Source.run(). */
export type RunContext = {
  /** HTTP fetcher with caching headers pre-populated. */
  http: (url: string, opts?: FetchOptions) => Promise<FetchedPage>
  /** Previous values, so the source can short-circuit on the entry page. */
  prevEtag: string | null
  prevLastModified: string | null
  prevHash: string | null
}

/** Output of Source.run(). */
export type RunOutput = ParseResult & {
  /** True when the source detected nothing changed and skipped parsing. */
  notModified: boolean
  /** Cache markers from the entry page, persisted back to sources row. */
  entryEtag: string | null
  entryLastModified: string | null
  entryHash: string | null
}

export abstract class Source {
  abstract readonly id: string
  abstract readonly kind: 'venue' | 'aggregator'
  abstract readonly displayName: string
  abstract readonly baseUrl: string

  /**
   * Default implementation:
   *   1. Fetch baseUrl with cache headers
   *   2. If 304 / unchanged hash → skip parsing entirely
   *   3. Otherwise call parse(html, ctx)
   *
   * Sources that need multi-page crawls (index → details) override run()
   * directly and call ctx.http() themselves.
   */
  async run(ctx: RunContext): Promise<RunOutput> {
    const page = await ctx.http(this.baseUrl, {
      etag: ctx.prevEtag,
      lastModified: ctx.prevLastModified,
    })

    const cacheHit =
      page.notModified ||
      (ctx.prevHash != null && ctx.prevHash === page.contentHash)

    if (cacheHit) {
      return {
        events: [],
        rejected: [],
        notModified: true,
        entryEtag: page.etag ?? ctx.prevEtag,
        entryLastModified: page.lastModified ?? ctx.prevLastModified,
        entryHash: page.contentHash || ctx.prevHash,
      }
    }

    const parsed = await this.parse(page.body, page.url, ctx)
    return {
      ...parsed,
      notModified: false,
      entryEtag: page.etag,
      entryLastModified: page.lastModified,
      entryHash: page.contentHash,
    }
  }

  /**
   * Parse a single fetched page into events + rejects. Subclasses override.
   *
   * Sources that crawl multiple pages should override run() instead and
   * leave parse() unimplemented (or use it as an internal helper).
   */
  protected parse(
    _html: string,
    _url: string,
    _ctx: RunContext,
  ): ParseResult | Promise<ParseResult> {
    throw new Error(
      `${this.id}: must implement either parse() or override run()`,
    )
  }
}

// ── Convenience subclasses ─────────────────────────────────────────────────

/**
 * VenueSource — pins every emitted event to a known venue_id.
 *
 * Subclasses just implement parse(). The base class fills venueId on every
 * RawEvent before returning, so subclasses can omit it.
 */
export abstract class VenueSource extends Source {
  readonly kind = 'venue' as const
  abstract readonly venueId: string

  override async run(ctx: RunContext): Promise<RunOutput> {
    const out = await super.run(ctx)
    for (const e of out.events) {
      if (!e.venueId) e.venueId = this.venueId
    }
    return out
  }
}

/**
 * AggregatorSource — emits venueHint, expects runner to resolve.
 *
 * Subclasses typically override run() because aggregators do an index → detail
 * crawl. parse() is left as a helper for the single-page case.
 */
export abstract class AggregatorSource extends Source {
  readonly kind = 'aggregator' as const
}

// ── Helpers shared by all sources ──────────────────────────────────────────

/** Strip HTML tags + decode common entities. Block tags become newlines. */
export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(?:h[1-6]|p|div|li|section|article|tr|td)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/[ \t]{2,}/g, ' ')
}

/** Current year in JST — for date lines that omit the year. */
export function jstYear(now: number = Date.now()): number {
  return new Date(now + 9 * 3600 * 1000).getFullYear()
}

/**
 * Generic JP date matcher used by aggregator sources.
 *   2026.5.12 / 2026/5/12 / 2026-5-12 / 5.12 / 5/12
 * Returns ISO YYYY-MM-DD or null. Falls back to current JST year.
 */
const DATE_LINE_RE =
  /(?:(\d{4})[.\/\-])?(\d{1,2})[.\/\-](\d{1,2})\b/
export function extractDate(line: string, year: number = jstYear()): string | null {
  const m = DATE_LINE_RE.exec(line)
  if (!m) return null
  const [, yyyy, mm, dd] = m
  const y = yyyy ? Number(yyyy) : year
  const mo = Number(mm)
  const d = Number(dd)
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Helper for runners that build per-source RejectedEvent lists. */
export function reject(
  rawLine: string,
  reason: string,
  extra: Partial<RejectedEvent> = {},
): RejectedEvent {
  return { rawLine, reason, ...extra }
}

/** Helper for sources that produce events one-by-one. */
export function emit(events: RawEvent[], rejected: RejectedEvent[] = []): ParseResult {
  return { events, rejected }
}
