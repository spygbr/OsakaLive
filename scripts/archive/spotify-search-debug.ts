/**
 * scripts/spotify-search-debug.ts
 *
 * Credentials are confirmed working (token endpoint returns 200). The 403 must
 * be coming from the search endpoint. This script hits `/v1/search` and prints
 * the full response body + headers so we can see exactly what Spotify is
 * complaining about.
 *
 * Usage:
 *   npx tsx scripts/spotify-search-debug.ts
 */

import fs   from 'fs'
import path from 'path'

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

const ID     = process.env.SPOTIFY_CLIENT_ID!
const SECRET = process.env.SPOTIFY_CLIENT_SECRET!

async function getToken(): Promise<string> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${ID}:${SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`Token fetch failed: HTTP ${res.status} ${await res.text()}`)
  const j = await res.json() as { access_token: string }
  return j.access_token
}

async function probe(token: string, path: string): Promise<void> {
  console.log(`\n▶  GET ${path}`)
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  console.log(`   HTTP ${res.status} ${res.statusText}`)

  // Dump headers Spotify uses for quota / rate-limit info
  const interesting = [
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'retry-after',
    'www-authenticate',
    'content-type',
  ]
  for (const h of interesting) {
    const v = res.headers.get(h)
    if (v) console.log(`   ${h}: ${v}`)
  }

  const text = await res.text()
  console.log(`   body: ${text.slice(0, 800)}`)
}

async function run(): Promise<void> {
  console.log('Getting access token...')
  const token = await getToken()
  console.log(`Token acquired (first 12 chars: ${token.slice(0, 12)}...)`)

  // Endpoints to probe, ordered from "simplest auth-check" to "actual search"
  await probe(token, '/markets')                                         // simple GET, unauthenticated-like
  await probe(token, '/browse/categories?limit=1&country=JP')            // authenticated catalog
  await probe(token, '/artists/6ccVNAcZgz7TzVKu4AH0cF')                  // known artist ID (Boris)
  await probe(token, '/search?q=Boris&type=artist&limit=1')              // the one the POC needs
  await probe(token, '/search?q=Boris&type=artist&limit=1&market=JP')    // with market filter
}

run().catch((e) => { console.error('Fatal:', e); process.exit(1) })
