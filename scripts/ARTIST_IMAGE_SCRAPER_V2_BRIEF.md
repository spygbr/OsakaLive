# Artist Image Scraper — v2 Build Brief

## Context (read first)

OsakaLive is a Next.js + Supabase app that scrapes Japanese live music event listings. The `artists` table has a `image_url` column that needs to be populated.

**Three iterations so far, none good enough:**

1. **`scripts/scrape-artist-images.ts`** — original. Used `og:image` from `instagram_url` → fallback to `website_url`. Instagram serves login walls; site `og:image` is usually a logo, not a band photo. Effectively broken.
2. **`scripts/spotify-image-poc.ts`** — blocked. Spotify's Web API now requires the app owner to have Spotify Premium (2024 policy change). Owner has now subscribed; script is viable once propagation completes, but we're not blocking on it.
3. **`scripts/multi-source-image-poc.ts`** — current best. Tries iTunes + Wikidata + MusicBrainz + unavatar. **Hit rate: 3/10 on the seed artists.** Miss rate is too high for Japanese underground/indie/noise acts (Boris, Merzbow, Otoboke Beaver, etc.).

**Goal for v2:** ≥ 70% hit rate on the current 10 seed artists, measured as "a visually-correct band photo that a human reviewer would accept."

**Constraints:**
- Keep `multi-source-image-poc.ts` (v1) unchanged — v2 is a separate file.
- READ-ONLY against Supabase. No writes to `artists` or Storage. Reports + downloads go to `tmp/multi-source-poc-v2/`.
- No new runtime dependencies on the Next.js app. `package.json` can grow with dev-only deps if truly needed, but prefer using `fetch` + DOM-lite parsing (regex / lightweight extractor) over adding cheerio/jsdom.
- TypeScript, run with `npx tsx`.

## Reference files

Before writing code, skim these for existing conventions (env loader, Supabase client init, CLI flag parsing, report format, sleep/retry patterns):

- `scripts/multi-source-image-poc.ts` — v1, this is the pattern to evolve
- `scripts/enrich-artist-socials.ts` — existing Claude-API pattern (for LLM fallback)
- `scripts/ARTIST_EXTRACTION_PLAN.md` — broader pipeline context (Phase 5 is where this script sits)
- `lib/supabase/types.ts` — DB types

## Deliverables

1. **`scripts/multi-source-image-poc-v2.ts`** — the main script
2. **`scripts/apply-manual-image-overrides.ts`** — companion script that consumes the CSV (spec below)
3. No changes to existing files

## Architecture

### Provider interface

```ts
interface SourceProvider {
  name: Source                  // stable id used in reports + CLI flags
  weight: number                // 0..1, multiplied into final score
  /** Returns raw candidates. Must not throw — return [] on any error. */
  search(artist: Artist): Promise<RawCandidate[]>
}

interface RawCandidate {
  sourceId:    string           // provider's id for this artist (e.g. Q-id, mbid, deezer id)
  sourceUrl:   string           // canonical page on that provider
  imageUrl:    string           // URL to the image itself
  width?:      number
  height?:     number
  matchName:   string           // the name the provider returned — used for name-match scoring
  notes?:      string
  externalIds?: Record<string, string>  // for cross-validation, e.g. { mbid: "...", wikidata: "Q..." }
}
```

### Execution flow

```
for each artist in DB where image_url IS NULL (or --force):
  1. Run all enabled providers in parallel via Promise.allSettled
     - Each provider has its own 12s timeout (wrap with AbortSignal.timeout)
     - Collect all RawCandidate[] into a flat pool
  2. If pool is empty or no candidate scores ≥ 0.7:
       → optionally trigger LLM fallback (if ANTHROPIC_API_KEY set and --llm flag)
  3. Score every candidate:
       nameScore     = scoreName(artist, candidate.matchName)  // v1 already has this
       final         = nameScore × provider.weight
       crossValBonus = +0.10 if ≥ 2 DIFFERENT providers return candidates
                       whose matchNames normalize to the same string
       final        += crossValBonus
       sizePenalty   = -0.20 if known width < 300 (unknown = no penalty)
       final        += sizePenalty
  4. Sort descending by final score, then by provider priority
  5. Winner = top-scored candidate IF final ≥ 0.7
  6. Ambiguous IF top two final scores within 0.05 AND different normalized names
  7. HEAD the winner's imageUrl to verify it actually exists (2xx) and get
     content-length / content-type. If it 404s → move to 2nd-place candidate.
```

### Provider weights

| Provider | Weight | Notes |
|---|---|---|
| `wikipedia` | 1.00 | infobox image = real band photo |
| `wikidata` | 1.00 | P18 = real band photo |
| `theaudiodb` | 1.00 | `strArtistThumb` is the band photo |
| `bandcamp` | 1.00 | scraped band-page photo |
| `deezer` | 0.95 | `picture_xl` is artist photo, occasionally logo |
| `unavatar` | 0.95 | IG profile pic, trusted since handle came from our DB |
| `discogs` | 0.90 | `primary` image is usually correct, sometimes misc release art |
| `spotify` | 1.00 | when owner's Premium propagates; optional until then |
| `itunes` | 0.50 | album art, not band photo — only useful as last resort |
| `musicbrainz` | 0.50 | artist-level cover art is rare + often album-derived |

### Source specs

Each provider can be disabled via `--sources a,b,c`. Skip silently if its required env var is missing (except for zero-auth providers).

#### `deezer` (new, zero-auth)
```
GET https://api.deezer.com/search/artist?q=<urlencoded name>
Response: { data: [{ id, name, picture_big (500x500), picture_xl (1000x1000), nb_fan, link }, ...] }
```
- No auth. 50 req/s soft limit; 200ms between calls is safe.
- Use `picture_xl`. Reject if missing.
- Query both `name_en` and `name_ja` separately; dedupe by `id`.

#### `bandcamp` (new, scrape)
```
Step 1: GET https://bandcamp.com/search?q=<urlencoded>&item_type=b
  - Parse HTML. First .searchresult a[href] that points to a *.bandcamp.com or custom domain band page.
  - Lightweight regex extraction; avoid adding cheerio.
Step 2: GET that band page
  - Extract og:image (reliable here — Bandcamp pages have real band photo as og:image)
  - Also look for <div class="bio-pic"><img src="..."> as an alternative
```
- Name match: compare artist name in the <title> against ours.
- 1s delay between requests, descriptive UA.

#### `wikipedia` (new, zero-auth)
```
GET https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*
    &prop=pageimages&piprop=original&titles=<title>
Response: { query: { pages: { <id>: { title, original: { source, width, height } } } } }
```
- Try `name_en` first on en.wikipedia, then `name_ja` on ja.wikipedia if available.
- `pageimages` returns the infobox image — broader than Wikidata P18.
- Validate the candidate by fetching the page's first paragraph (also via the API, `prop=extracts|exintro|explaintext`) and checking for band/musician keywords. Reject if not a musician (namesake disambiguation).

#### `theaudiodb` (new, test key "2")
```
GET https://www.theaudiodb.com/api/v1/json/2/search.php?s=<urlencoded name>
Response: { artists: [{ idArtist, strArtist, strArtistThumb, strArtistLogo,
                        strArtistFanart, strBiographyEN, strCountry, strGenre }, ...] }
```
- Use `strArtistThumb` (fallback `strArtistFanart` if thumb missing — flag as fanart in notes).
- Name match against `strArtist`.
- Country check: if `strCountry` doesn't include "Japan" and our artist is JP-indie, note it but don't reject.

#### `discogs` (new, token optional)
```
GET https://api.discogs.com/database/search?q=<name>&type=artist
Header: Authorization: Discogs token=<DISCOGS_TOKEN>   (optional; higher rate limit)
Header: User-Agent: OsakaLive/0.1 +https://osaka.live
Response: { results: [{ id, title, cover_image, thumb, type: "artist" }, ...] }
```
- Then GET `https://api.discogs.com/artists/{id}` for the richer response with `images: [{ uri, type: "primary" | "secondary" }]`.
- Use `type: "primary"` image. If none, first `secondary`.
- Rate limit: 60/min authenticated, 25/min unauth. Sleep 2.5s between requests when unauth.

#### `spotify` (optional, only if `SPOTIFY_CLIENT_ID/SECRET` present)
```
POST https://accounts.spotify.com/api/token
  (Basic auth, grant_type=client_credentials)
GET  https://api.spotify.com/v1/search?q=<name>&type=artist&limit=5&market=JP
```
- Skip entirely (no error) if credentials not set OR if token fetch 403s (Premium not yet propagated).
- Cache token in memory for the run.
- Match: `items[].name` against ours. Use `images[0]` (largest).

#### `llm-fallback` (optional, only with `--llm` AND `ANTHROPIC_API_KEY`)
- Model: `claude-haiku-4-5-20251001` (matches existing pattern in `enrich-artist-socials.ts`)
- Prompt asks for: a single image URL that shows a photo of the specific artist.
- Response schema: `{ image_url: string | null, source_page: string | null, confidence: "high"|"medium"|"low", reason: string }`
- ALWAYS follow up with a HEAD request to verify the URL resolves and is an `image/*`. Discard on failure.
- Only runs when other providers produced no winner ≥ 0.7.
- Weight: 0.85 (slightly below first-party sources due to hallucination risk).

## Scoring refinements beyond v1

v1's `scoreName` is fine; keep it. The new bits:

```ts
// Normalize first
function normAll(s: string): string    // NFKC + lowercase + strip punct (v1 already has this)

// Cross-validation bonus
function crossValidationBonus(allCandidates: RawCandidate[]): Map<string, number> {
  // Group candidates by norm(matchName)
  // For each group that has ≥ 2 DIFFERENT providers, every candidate in that
  // group gets +0.10 to its final score.
}
```

Also add a **progressive query retry** inside providers that support it (deezer, discogs, theaudiodb, wikipedia, spotify) — if the primary query returns zero candidates:

1. Try `name_en` with parentheticals stripped: `"Boris (band)"` → `"Boris"`
2. If `name_ja` exists, try that
3. (Optional) romanize katakana/hiragana → romaji — SKIP for v2, out of scope

## CLI

```
npx tsx scripts/multi-source-image-poc-v2.ts [options]

  --limit N              Process only first N artists
  --force                Also re-test artists that already have image_url
  --sources a,b,c        Comma-separated provider names; default = all enabled
                         Names: deezer,bandcamp,wikipedia,theaudiodb,discogs,
                                wikidata,musicbrainz,itunes,unavatar,spotify
  --llm                  Enable Claude fallback for artists that miss
  --download             Save winner image to tmp/multi-source-poc-v2/{slug}.{source}.{ext}
  --download-all         Save ALL candidates (not just winner) for visual review
  --artist <slug>        Run against a single artist (debug)
  --threshold N          Override winner score threshold (default 0.7)
```

## Output

### `tmp/multi-source-poc-v2/report.json`
Array of rows:
```ts
{
  slug, name_en, name_ja,
  winner: RawCandidate & { source, finalScore } | null,
  verdict: "hit" | "ambiguous" | "miss",
  candidates: (RawCandidate & { source, finalScore, nameScore, crossVal: boolean })[],
  providerErrors: { source: Source, error: string }[]  // which providers threw/timed out
}
```

### `tmp/multi-source-poc-v2/miss-list.csv`
For every artist where verdict !== "hit", emit a row:
```
slug,name_en,name_ja,best_source,best_source_url,best_match_name,best_final_score,override_image_url
```
- `override_image_url` is blank — human fills it in
- Diku uses this to manually paste image URLs for the long tail

### Console summary (end of run)
```
─────────────────────────────────────────────────────
  HIT        X  (X%)
  AMBIGUOUS  X  (X%)
  MISS       X  (X%)
─────────────────────────────────────────────────────
  Wins by source (hits only):
    deezer        5
    wikipedia     3
    bandcamp      2
  Provider reliability (non-empty responses / artists tried):
    deezer        10/10
    bandcamp       8/10
    ...
  LLM fallback triggered for: N artists (M saved)
```

## Manual override script: `scripts/apply-manual-image-overrides.ts`

Reads `tmp/multi-source-poc-v2/miss-list.csv`. For each row where `override_image_url` is non-empty:

1. Download the image (with timeout + size cap, e.g. ≤ 10 MB)
2. Upload to Supabase Storage at `artist-images/{slug}.{ext}` (matches existing path convention from `scrape-artist-images.ts` for now)
3. `UPDATE artists SET image_url = '<CDN URL>' WHERE slug = <slug>`
4. Report success/failure per row

Same env loading + Supabase client pattern as the existing scripts. Takes `--dry-run` flag.

## Env vars (all optional except the Supabase ones)

```
NEXT_PUBLIC_SUPABASE_URL=...            (required)
SUPABASE_SERVICE_ROLE_KEY=...           (required)
SPOTIFY_CLIENT_ID=...                   (optional; enables spotify provider)
SPOTIFY_CLIENT_SECRET=...               (optional)
DISCOGS_TOKEN=...                       (optional; raises discogs rate limit)
ANTHROPIC_API_KEY=...                   (optional; needed for --llm flag)
```

Add any missing ones to `.env.local.example` if that file exists; otherwise don't create it.

## Acceptance criteria

1. Script runs to completion on the 10 seed artists with no crashes (providers may individually fail — that's expected, `providerErrors` captures it)
2. All providers + the CLI flags enumerated above are implemented
3. `report.json`, `miss-list.csv`, and the console summary all match the specs above
4. Hit rate on the 10 seed artists is ≥ 7/10 (the main success signal; if it's below that, investigate which providers are failing and whether the scoring threshold is too strict)
5. `apply-manual-image-overrides.ts` round-trips: given a CSV with one override filled in, it uploads the image and updates the DB — verify with a spot-check SQL against the `artists` table
6. v1 file (`multi-source-image-poc.ts`) is unchanged

## Non-goals for v2

- Moving to the real enrichment path (that's a later step — v2 is still READ-ONLY)
- Schema migration (`image_source`, `image_source_id`, `artist_image_candidates`) — planned but out of scope for this brief
- Automated image-hashing dedup — cross-validation by name is enough for now
- Storage path change to `artists/{slug}/{source}-{hash8}.{ext}` — deferred to the real enrichment script

## Handoff

When done, reply to Diku with:
1. The console summary block from a full run
2. Any seed artists still in the `miss` bucket and why (per-artist: which providers fired, what they returned, why nothing passed threshold)
3. Recommendation for next iteration — tighten scoring? add another source? accept manual-override for the long tail?
