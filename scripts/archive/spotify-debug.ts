/**
 * scripts/spotify-debug.ts
 *
 * Diagnostic for Spotify client-credentials failures.
 *
 * Prints the state of SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in a way
 * that is safe to share (only character counts + first/last 4 chars), then
 * tries three variants of the token request to isolate the cause of
 * `invalid_client`:
 *
 *   A. Basic-auth header, body only grant_type      (canonical)
 *   B. Body credentials (client_id + client_secret) (fallback; some libraries use this)
 *   C. Basic-auth header, but with TRIMMED values   (catches whitespace issues)
 *
 * Usage:
 *   npx tsx scripts/spotify-debug.ts
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
      const val = m[2]                           // KEEP surrounding whitespace — we want to see it
        .replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  }
}

const ID     = process.env.SPOTIFY_CLIENT_ID     ?? ''
const SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? ''

function describe(label: string, value: string): void {
  const trimmed = value.trim()
  const hasInvis = value !== trimmed
  const hex  = Buffer.from(value).toString('hex')
  const head = value.slice(0, 4)
  const tail = value.slice(-4)
  console.log(`  ${label}:`)
  console.log(`    length raw / trimmed : ${value.length} / ${trimmed.length}`)
  console.log(`    head...tail          : "${head}...${tail}"`)
  console.log(`    has invisible chars  : ${hasInvis ? '⚠️  YES' : 'no'}`)
  if (hasInvis) {
    console.log(`    raw bytes (hex)      : ${hex}`)
  }
}

// Spotify client IDs are 32 hex-ish chars; secrets are also 32. Sanity check shape.
function shapeCheck(label: string, value: string): void {
  const v = value.trim()
  const looksHex32 = /^[a-f0-9]{32}$/.test(v)
  const looksLenOk = v.length === 32
  console.log(
    `    shape                : length=${v.length} ${looksLenOk ? '✓' : '✗ (expected 32)'}, ` +
    `hex-only=${looksHex32 ? '✓' : '✗ (expected 32 lowercase hex)'}`,
  )
  if (!looksLenOk || !looksHex32) {
    console.log(`    → This does NOT look like a valid Spotify ${label.toLowerCase()}.`)
  }
}

console.log('\n🔎  Spotify credential diagnostic\n')
console.log('Reading from', envPath)
console.log('')
if (!ID || !SECRET) {
  console.error('❌  One or both env vars are missing.')
  console.error(`    SPOTIFY_CLIENT_ID     set: ${Boolean(ID)}`)
  console.error(`    SPOTIFY_CLIENT_SECRET set: ${Boolean(SECRET)}`)
  process.exit(1)
}

describe('SPOTIFY_CLIENT_ID',     ID)
shapeCheck('CLIENT_ID',     ID)
describe('SPOTIFY_CLIENT_SECRET', SECRET)
shapeCheck('CLIENT_SECRET', SECRET)

// Detect the classic swap
if (/^[a-f0-9]{32}$/.test(ID.trim()) && /^[a-f0-9]{32}$/.test(SECRET.trim())) {
  console.log('  (both values look like 32-char hex — swap is possible but not detectable by shape)')
}

// ── Attempts ───────────────────────────────────────────────────────────────────
type Attempt = { label: string; status: number; body: string }

async function attempt(
  label: string,
  init: RequestInit,
): Promise<Attempt> {
  try {
    const res  = await fetch('https://accounts.spotify.com/api/token', init)
    const body = await res.text()
    return { label, status: res.status, body }
  } catch (e) {
    return { label, status: -1, body: e instanceof Error ? e.message : String(e) }
  }
}

async function run(): Promise<void> {
  console.log('\n──────────────────────────────────────────────────────')
  console.log('Attempt A: Basic-auth header, grant_type in body (canonical)')
  const basicRaw = Buffer.from(`${ID}:${SECRET}`).toString('base64')
  const a = await attempt('A', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicRaw}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  console.log(`  HTTP ${a.status}`)
  console.log(`  body: ${a.body.slice(0, 300)}`)

  console.log('\nAttempt B: client_id + client_secret in body (no Basic auth)')
  const b = await attempt('B', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      `grant_type=client_credentials` +
      `&client_id=${encodeURIComponent(ID.trim())}` +
      `&client_secret=${encodeURIComponent(SECRET.trim())}`,
  })
  console.log(`  HTTP ${b.status}`)
  console.log(`  body: ${b.body.slice(0, 300)}`)

  console.log('\nAttempt C: Basic-auth with trim() applied to both values')
  const basicTrimmed = Buffer.from(`${ID.trim()}:${SECRET.trim()}`).toString('base64')
  const c = await attempt('C', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicTrimmed}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  console.log(`  HTTP ${c.status}`)
  console.log(`  body: ${c.body.slice(0, 300)}`)

  console.log('\n──────────────────────────────────────────────────────')
  console.log('Interpretation:')
  console.log('')

  if (a.status === 200 || b.status === 200 || c.status === 200) {
    const winner =
      a.status === 200 ? 'A (canonical)'
      : b.status === 200 ? 'B (body creds)'
      : 'C (trimmed)'
    console.log(`✅  Got a token via ${winner}.`)
    if (c.status === 200 && a.status !== 200) {
      console.log('    Attempt C succeeded but A did not → your .env.local has leading/trailing')
      console.log('    whitespace on one of the credentials. The existing loader already strips')
      console.log('    quotes but not whitespace. Re-save the file with no trailing spaces, or')
      console.log('    tell me to harden the loader.')
    }
    if (b.status === 200 && a.status !== 200) {
      console.log('    Attempt B succeeded but A did not → base64 encoding of the Basic auth is')
      console.log('    wrong (unusual — would suggest the credentials contain characters that')
      console.log('    don\'t round-trip through utf8). Check for smart quotes copied from a PDF.')
    }
  } else {
    console.log('❌  All three attempts failed. Most likely causes:')
    console.log('    1. You copy-pasted the Client ID (visible on the app page) instead of the')
    console.log('       Client Secret (which requires clicking "View client secret").')
    console.log('       The dashboard shows ID prominently; the secret is hidden behind a button.')
    console.log('    2. The secret was regenerated since you saved .env.local.')
    console.log('       → On the app page, click "View client secret" or regenerate it, then')
    console.log('         paste the fresh value.')
    console.log('    3. The app is not saved — the dashboard requires clicking "Save" after')
    console.log('       the initial creation form, otherwise credentials exist but are inert.')
    console.log('    4. You\'re looking at credentials for a different app than the one whose')
    console.log('       ID is in your .env.local.')
  }
}

run().catch((e) => { console.error('Fatal:', e); process.exit(1) })
