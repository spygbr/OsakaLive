/**
 * scripts/lib/site-bio.ts
 *
 * Fetch an artist's own website and extract a biography blurb.
 * Used as a last-resort fallback in enrich-artists.ts when no music DB
 * provider returned a usable bio (behind --include-site-fallback).
 *
 * Strategy (in priority order):
 *   1. <meta name="description"> / og:description
 *   2. First paragraph following a heading that matches about|profile|bio|プロフィール|紹介
 *   3. First <p> on the page with enough length
 *
 * Returns a cleaned string (≤800 chars) or null.
 */

const OL_UA = 'OsakaLive/0.1 (https://osaka.live; diku@genkanconsulting.com)'
const MAX_LEN = 800

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
}

function trimToSentence(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  const cut = s.slice(0, maxLen)
  const last = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return last > maxLen / 2 ? cut.slice(0, last + 1).trim() : cut.trim()
}

export async function fetchSiteBio(url: string): Promise<string | null> {
  let html: string
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': OL_UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html')) return null
    html = await res.text()
  } catch {
    return null
  }

  // 1. og:description
  const ogDesc =
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{30,})["']/)??
    html.match(/<meta[^>]+content=["']([^"']{30,})["'][^>]+property=["']og:description["']/)
  if (ogDesc?.[1]) {
    return trimToSentence(decodeEntities(stripTags(ogDesc[1])), MAX_LEN)
  }

  // 2. <meta name="description">
  const metaDesc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{30,})["']/)??
    html.match(/<meta[^>]+content=["']([^"']{30,})["'][^>]+name=["']description["']/)
  if (metaDesc?.[1]) {
    return trimToSentence(decodeEntities(stripTags(metaDesc[1])), MAX_LEN)
  }

  // 3. Paragraph after an about/profile/bio heading
  const aboutPattern = /about|profile|bio|プロフィール|紹介/i
  const headingRe = /<h[1-6][^>]*>([^<]*(?:about|profile|bio|プロフィール|紹介)[^<]*)<\/h[1-6]>/i
  const headingMatch = html.match(headingRe)
  if (headingMatch) {
    const afterHeading = html.slice(html.indexOf(headingMatch[0]) + headingMatch[0].length)
    const pMatch = afterHeading.match(/<p[^>]*>([\s\S]{40,800}?)<\/p>/)
    if (pMatch?.[1]) {
      const text = decodeEntities(stripTags(pMatch[1]))
      if (text.length >= 40) return trimToSentence(text, MAX_LEN)
    }
  }

  // 4. Any <p> with enough content that doesn't look like navigation
  const pTags = [...html.matchAll(/<p[^>]*>([\s\S]{60,1000}?)<\/p>/g)]
  for (const m of pTags) {
    const text = decodeEntities(stripTags(m[1]))
    if (text.length < 60) continue
    // Skip nav-ish short sentences
    if (/(cookie|privacy|©|copyright|\bclick\b|\bhere\b)/i.test(text)) continue
    return trimToSentence(text, MAX_LEN)
  }

  // Check page title-level about patterns even without a heading match
  if (aboutPattern.test(url)) {
    const firstP = html.match(/<p[^>]*>([\s\S]{40,800}?)<\/p>/)
    if (firstP?.[1]) {
      const text = decodeEntities(stripTags(firstP[1]))
      if (text.length >= 40) return trimToSentence(text, MAX_LEN)
    }
  }

  return null
}
