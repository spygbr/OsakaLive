/**
 * Event image enrichment runner.
 *
 * Per-event flow:
 *   1. Select events: image_url IS NULL AND image_attempts < 3 AND event_date >= today-1
 *   2. Venue path: fetch source_url HTML → extract + score candidates
 *   3. Instagram fallback: first lineup artist with instagram_url → oEmbed
 *   4. Download → validate → upload to event-flyers/<event_id>.<ext>
 *   5. Update events row (image_url, image_source, image_scraped_at, image_attempts)
 *   6. On miss: increment image_attempts only
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchPage } from '../fetcher'
import { extractBestCandidate } from './extractor'
import { extractIgHandle, igCheckedRecently, fetchInstagramCandidate } from './instagram'
import type { ImageCandidate, ImageRunResult } from './types'

const STORAGE_BUCKET = 'event-flyers'
const CONCURRENCY    = 3
const MAX_BYTES      = 5 * 1024 * 1024   // 5 MB
const MIN_BYTES      = 50 * 1024         // 50 KB
const FETCH_TIMEOUT  = 15_000
const OL_UA          = 'OsakaLiveBot/1.0 (https://osaka-live.net; diku@genkanconsulting.com)'

// ── Supabase admin client ──────────────────────────────────────────────────────

export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars for image runner')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── Types ──────────────────────────────────────────────────────────────────────

type PendingEvent = {
  id:           string
  event_date:   string
  source_url:   string | null
  image_attempts: number
  artists: {
    artist: {
      instagram_url:         string | null
      image_last_checked_at: string | null
    } | null
  }[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function extFromContentType(ct: string, url: string): string {
  if (ct.includes('png'))  return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif'))  return 'gif'
  return url.split('?')[0].split('.').pop()?.toLowerCase() ?? 'jpg'
}

/** Download image, validate, upload to Storage. Returns public URL or null. */
async function downloadAndUpload(
  supabase: SupabaseClient,
  eventId: string,
  imageUrl: string,
): Promise<string | null> {
  // HEAD probe first — check content-type
  let contentType: string
  try {
    const head = await fetch(imageUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': OL_UA },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    })
    if (!head.ok) return null
    contentType = head.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/') && !contentType.includes('octet-stream')) return null
  } catch {
    return null
  }

  // Download body
  let buf: Buffer
  let ext: string
  try {
    const res = await fetch(imageUrl, {
      headers: { 'User-Agent': OL_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? contentType
    const arrBuf = await res.arrayBuffer()
    if (arrBuf.byteLength < MIN_BYTES || arrBuf.byteLength > MAX_BYTES) return null
    buf = Buffer.from(arrBuf)
    ext = extFromContentType(ct, imageUrl)
    if (['gif', 'svg'].includes(ext)) return null  // reject per spec
  } catch {
    return null
  }

  // Upload to Supabase Storage
  const storagePath = `${eventId}.${ext}`
  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buf, {
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      upsert: true,
    })
  if (uploadErr) {
    console.error(`[image-runner] storage upload failed (${eventId}): ${uploadErr.message}`)
    return null
  }

  const { data: { publicUrl } } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath)

  return publicUrl
}

/** Update event row with found image. */
async function applyImage(
  supabase: SupabaseClient,
  eventId: string,
  publicUrl: string,
  source: 'venue' | 'instagram',
  currentAttempts: number,
): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({
      image_url:        publicUrl,
      image_source:     source,
      image_scraped_at: new Date().toISOString(),
      image_attempts:   currentAttempts + 1,
    })
    .eq('id', eventId)
  if (error) throw new Error(`events update (${eventId}): ${error.message}`)
}

/** Increment attempts on miss (no image found). */
async function incrementAttempts(
  supabase: SupabaseClient,
  eventId: string,
  currentAttempts: number,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({ image_attempts: currentAttempts + 1 })
    .eq('id', eventId)
  if (error) console.warn(`[image-runner] attempt increment (${eventId}): ${error.message}`)

  if (payload) {
    // Log the skip reason to events_rejected for observability
    await supabase.from('events_rejected').insert({
      source_id:  'image-runner',
      source_url: null,
      raw_line:   eventId,
      reason:     'image_invalid',
      payload,
    })
  }
}

/** Update artists.image_last_checked_at so we respect the 7-day IG gate. */
async function touchArtistIgCheck(
  supabase: SupabaseClient,
  igUrl: string,
): Promise<void> {
  const { error } = await supabase
    .from('artists')
    .update({ image_last_checked_at: new Date().toISOString() })
    .eq('instagram_url', igUrl)
  if (error) console.warn(`[image-runner] artist ig touch: ${error.message}`)
}

// ── Per-event processor ────────────────────────────────────────────────────────

async function processEvent(
  supabase: SupabaseClient,
  event: PendingEvent,
): Promise<ImageRunResult> {
  let candidate: ImageCandidate | null = null

  // ── Step 1: Venue path ─────────────────────────────────────────────────────
  if (event.source_url) {
    try {
      const page = await fetchPage(event.source_url, { timeoutMs: FETCH_TIMEOUT })
      if (!page.notModified && page.body) {
        candidate = extractBestCandidate(page.body, page.url)
      }
    } catch {
      // Fall through to IG
    }
  }

  // ── Step 2: Instagram fallback ─────────────────────────────────────────────
  if (!candidate) {
    for (const ea of event.artists) {
      const igUrl = ea.artist?.instagram_url
      if (!igUrl) continue
      if (igCheckedRecently(ea.artist?.image_last_checked_at ?? null)) continue

      const handle = extractIgHandle(igUrl)
      if (!handle) continue

      try {
        const igCandidate = await fetchInstagramCandidate(handle)
        await touchArtistIgCheck(supabase, igUrl)
        if (igCandidate) { candidate = igCandidate; break }
      } catch {
        await touchArtistIgCheck(supabase, igUrl)
      }
    }
  }

  // ── Step 3: Download + upload ──────────────────────────────────────────────
  if (!candidate) {
    const hasIg = event.artists.some((ea) => ea.artist?.instagram_url)
    await incrementAttempts(supabase, event.id, event.image_attempts, {
      image_skip: hasIg ? 'no_qualifying_candidate' : 'no_ig_handle',
    })
    return { eventId: event.id, status: 'miss', reason: 'no_candidate' }
  }

  const publicUrl = await downloadAndUpload(supabase, event.id, candidate.url)
  if (!publicUrl) {
    await incrementAttempts(supabase, event.id, event.image_attempts, {
      image_skip: 'download_or_upload_failed',
      candidate_url: candidate.url,
    })
    return { eventId: event.id, status: 'error', reason: 'upload_failed' }
  }

  await applyImage(supabase, event.id, publicUrl, candidate.source, event.image_attempts)
  return { eventId: event.id, status: 'applied', source: candidate.source }
}

// ── Main entry point ───────────────────────────────────────────────────────────

export type RunImageOptions = {
  supabase?: SupabaseClient
  /** Override event limit (default: no cap — process all pending). */
  limit?: number
}

export async function runImageEnrichment(
  opts: RunImageOptions = {},
): Promise<{ results: ImageRunResult[]; durationMs: number }> {
  const supabase = opts.supabase ?? getAdminClient()
  const t0 = Date.now()

  // Select pending events with their source_url and first-artist IG
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  let q = supabase
    .from('events')
    .select(`
      id,
      event_date,
      image_attempts,
      event_sources!inner(source_url),
      artists:event_artists(
        billing_order,
        artist:artists(instagram_url, image_last_checked_at)
      )
    `)
    .is('image_url', null)
    .lt('image_attempts', 3)
    .gte('event_date', yesterday)
    .order('event_date', { ascending: true })

  if (opts.limit) q = q.limit(opts.limit)

  const { data, error } = await q
  if (error) throw new Error(`[image-runner] query: ${error.message}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: PendingEvent[] = (data ?? []).map((row: any) => ({
    id:             row.id,
    event_date:     row.event_date,
    image_attempts: row.image_attempts ?? 0,
    source_url:     row.event_sources?.[0]?.source_url ?? null,
    artists:        (row.artists ?? [])
      .sort((a: any, b: any) => (a.billing_order ?? 0) - (b.billing_order ?? 0)),
  }))
  // Prioritise events that have actionable data sources so limit=N test runs
  // hit real candidates first: source_url > IG > nothing.
  .sort((a: PendingEvent, b: PendingEvent) => {
    const scoreA = a.source_url ? 2 : a.artists.some((ea) => ea.artist?.instagram_url) ? 1 : 0
    const scoreB = b.source_url ? 2 : b.artists.some((ea) => ea.artist?.instagram_url) ? 1 : 0
    return scoreB - scoreA
  })

  console.log(`[image-runner] ${events.length} pending event(s)`)

  const results: ImageRunResult[] = []
  let i = 0

  async function worker() {
    while (i < events.length) {
      const idx = i++
      const result = await processEvent(supabase, events[idx])
      results[idx] = result
      console.log(`[image-runner] ${result.eventId} → ${result.status}${result.source ? ` [${result.source}]` : ''}${result.reason ? ` (${result.reason})` : ''}`)
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, events.length) }, worker))

  return { results, durationMs: Date.now() - t0 }
}
