/**
 * HTML → ImageCandidate extractor for venue event detail pages.
 *
 * Scoring (higher = better, accept threshold: 60):
 *   og:image / twitter:image present    +50
 *   JSON-LD Event.image                 +40
 *   <img> w×h ≥ 600×600                +30
 *   Aspect ratio square-ish or portrait +15
 *   Path keyword (flyer/poster/event…)  +10
 *   Same domain as page                 +10
 *   gif penalty                         −20
 *   svg penalty                         −30
 *   width < 400                         −40
 *   data-uri                           −100
 */

import type { ImageCandidate } from './types'

const ACCEPT_THRESHOLD = 60

const FLYER_KEYWORDS = /flyer|poster|event|cover|show|concert|live/i
const SKIP_PATTERN   = /icon|logo|favicon|sprite|pixel|blank|loading|placeholder|avatar/i

function resolveUrl(raw: string, base: string): string | null {
  if (raw.startsWith('data:')) return null
  try { return new URL(raw, base).href } catch { return null }
}

function domain(url: string): string {
  try { return new URL(url).hostname } catch { return '' }
}

function extOf(url: string): string {
  const path = url.split('?')[0].split('#')[0]
  return path.split('.').pop()?.toLowerCase() ?? ''
}

function scoreCandidate(
  url: string,
  opts: {
    metaBonus: number   // +50 for og/twitter, +40 for json-ld
    width?: number
    height?: number
    pageUrl: string
  },
): number {
  if (url.startsWith('data:')) return -100

  let score = opts.metaBonus

  const ext = extOf(url)
  if (ext === 'gif') score -= 20
  if (ext === 'svg') score -= 30

  const { width, height } = opts
  if (width !== undefined && height !== undefined) {
    if (width >= 600 && height >= 600) score += 30
    if (width < 400) score -= 40
    const aspect = width / height
    if ((aspect >= 0.7 && aspect <= 1.3) || (aspect >= 0.6 && aspect <= 0.8)) score += 15
  }

  if (FLYER_KEYWORDS.test(url)) score += 10
  if (domain(url) === domain(opts.pageUrl)) score += 10

  return score
}

/** Extract the best ImageCandidate from raw HTML at pageUrl. Returns null if nothing exceeds threshold. */
export function extractBestCandidate(
  html: string,
  pageUrl: string,
): ImageCandidate | null {
  const candidates: ImageCandidate[] = []
  const baseDomain = domain(pageUrl)

  // ── og:image ──────────────────────────────────────────────────────────────
  const og =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
  if (og) {
    const url = resolveUrl(og.trim(), pageUrl)
    if (url) {
      const score = scoreCandidate(url, { metaBonus: 50, pageUrl })
      candidates.push({ url, source: 'venue', score })
    }
  }

  // ── twitter:image ─────────────────────────────────────────────────────────
  const tw =
    html.match(/<meta[^>]+(?:name|property)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']twitter:image["']/i)?.[1]
  if (tw && tw !== og) {
    const url = resolveUrl(tw.trim(), pageUrl)
    if (url) {
      const score = scoreCandidate(url, { metaBonus: 50, pageUrl })
      candidates.push({ url, source: 'venue', score })
    }
  }

  // ── JSON-LD Event.image ───────────────────────────────────────────────────
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const ld = JSON.parse(m[1]) as Record<string, unknown>
      const entries = Array.isArray(ld) ? ld : [ld]
      for (const entry of entries) {
        if (entry['@type'] !== 'Event' && entry['@type'] !== 'MusicEvent') continue
        const img = entry['image']
        const imgUrl = typeof img === 'string'
          ? img
          : (img as Record<string, string> | undefined)?.url
        if (imgUrl) {
          const url = resolveUrl(imgUrl, pageUrl)
          if (url) {
            const score = scoreCandidate(url, { metaBonus: 40, pageUrl })
            candidates.push({ url, source: 'venue', score })
          }
        }
      }
    } catch { /* malformed JSON-LD */ }
  }

  // ── <img> tags near event content ─────────────────────────────────────────
  for (const m of html.matchAll(/<img\b[^>]+>/gi)) {
    const tag = m[0]
    const src =
      tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]?.trim() ??
      tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1]?.trim()
    if (!src || SKIP_PATTERN.test(src)) continue

    const url = resolveUrl(src, pageUrl)
    if (!url || url.startsWith('data:')) continue

    const wStr = tag.match(/\bwidth=["']?(\d+)/i)?.[1]
    const hStr = tag.match(/\bheight=["']?(\d+)/i)?.[1]
    const width  = wStr ? parseInt(wStr, 10) : undefined
    const height = hStr ? parseInt(hStr, 10) : undefined

    // Skip tiny images (thumbnails, icons)
    if (width !== undefined && width < 200) continue
    if (height !== undefined && height < 200) continue

    const score = scoreCandidate(url, { metaBonus: 0, width, height, pageUrl })
    if (score > -30) candidates.push({ url, source: 'venue', score, width, height })
  }

  if (candidates.length === 0) return null

  // Sort descending; pick best above threshold
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  return best.score >= ACCEPT_THRESHOLD ? best : null
}

export { ACCEPT_THRESHOLD }
