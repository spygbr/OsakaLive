/**
 * Instagram fallback image fetcher.
 *
 * Tries the public oEmbed endpoint to get a thumbnail for the artist's
 * most recent post. No auth required for public profiles.
 *
 * Rate-limit gate: 1 request / artist / 7 days (via artists.image_last_checked_at).
 * Validation: must be square or 4:5, jpg/png, ≥ 800px shortest side.
 */

import type { ImageCandidate } from './types'

const OL_UA = 'OsakaLiveBot/1.0 (https://osaka-live.net; diku@genkanconsulting.com)'
const IG_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000  // 1 week

/** Extract @handle from a full Instagram URL. */
export function extractIgHandle(url: string): string | null {
  try {
    const u = new URL(url)
    if (!u.hostname.includes('instagram.com')) return null
    const seg = u.pathname.split('/').filter(Boolean)[0]
    return seg && /^[\w.]+$/.test(seg) ? seg : null
  } catch {
    return null
  }
}

/** True if the artist's IG was checked within the past 7 days. */
export function igCheckedRecently(imageLastCheckedAt: string | null): boolean {
  if (!imageLastCheckedAt) return false
  return Date.now() - new Date(imageLastCheckedAt).getTime() < IG_CHECK_INTERVAL_MS
}

/**
 * Attempt to retrieve a public IG profile's most recent post thumbnail via oEmbed.
 * Returns an ImageCandidate with source='instagram', or null on any failure.
 */
export async function fetchInstagramCandidate(handle: string): Promise<ImageCandidate | null> {
  // The oEmbed endpoint gives us a thumbnail for the profile's latest post
  const profileUrl = `https://www.instagram.com/${handle}/`
  const oembedUrl =
    `https://graph.facebook.com/v18.0/instagram_oembed` +
    `?url=${encodeURIComponent(profileUrl)}&maxwidth=1080`

  // Try oEmbed first (works for public profiles on some IG graph configs)
  try {
    const res = await fetch(oembedUrl, {
      headers: { 'User-Agent': OL_UA },
      signal: AbortSignal.timeout(12_000),
    })
    if (res.ok) {
      const json = await res.json() as { thumbnail_url?: string; thumbnail_width?: number; thumbnail_height?: number }
      if (json.thumbnail_url) {
        const candidate = validateIgImage(json.thumbnail_url, json.thumbnail_width, json.thumbnail_height)
        if (candidate) return candidate
      }
    }
  } catch { /* fall through */ }

  // Fallback: try the public profile page for og:image
  try {
    const res = await fetch(profileUrl, {
      headers: {
        'User-Agent': OL_UA,
        Accept: 'text/html,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.5',
      },
      signal: AbortSignal.timeout(12_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const html = await res.text()

    const og =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
    if (og) {
      const candidate = validateIgImage(og.trim(), undefined, undefined)
      if (candidate) return candidate
    }
  } catch { /* give up */ }

  return null
}

/** Validate an IG image URL: must be jpg/png and ≥ 800px shortest side (if dims known). */
function validateIgImage(
  url: string,
  width: number | undefined,
  height: number | undefined,
): ImageCandidate | null {
  if (!url) return null

  // Must be http(s)
  if (!url.startsWith('http')) return null

  // Must be jpg or png (not gif, svg, webp)
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  if (ext && !['jpg', 'jpeg', 'png'].includes(ext)) return null

  // If we have dimensions, validate size and aspect ratio
  if (width !== undefined && height !== undefined) {
    const shorter = Math.min(width, height)
    if (shorter < 800) return null
    // Accept square (0.85–1.15) or portrait 4:5 (0.75–0.85)
    const aspect = width / height
    if (aspect < 0.75 || aspect > 1.15) return null
  }

  return { url, source: 'instagram', width, height, score: 70 }
}
