# OsakaLive — Scraping & Artist Pipeline

## Overview

Two independent pipelines:

- **Event scraper** — runs automatically every day, no intervention needed
- **Artist extraction pipeline** — semi-manual, run periodically (monthly cadence recommended)

---

## Part 1 — Event Scraper (Automated)

Scrapes event listings from Osaka live house websites and upserts them into the `events` table. Deduplication is handled automatically.

**Code:** `lib/scraper/` + `app/api/cron/scrape-events/route.ts`

**Schedule:** Vercel Cron triggers `GET /api/cron/scrape-events` daily at 02:00 JST (17:00 UTC). Configured in `vercel.json`.

**Manual trigger:**
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://osaka-live.vercel.app/api/cron/scrape-events
```

Or kick it off from the Vercel dashboard → Cron Jobs.

---

## Part 2 — Artist Extraction Pipeline (Manual, Periodic)

Takes raw event data and promotes it into the live `artists` table. Intentionally semi-manual — a human reviews candidates before anything is promoted.

### Prerequisites

All scripts require `.env.local` in the project root with:
```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=...   # required for steps 2 and 5
```

Run scripts from the project root with:
```bash
NODE_PATH=/tmp/script-deps/node_modules npx tsx scripts/<script-name>.ts
```

If deps aren't cached (fresh machine or `/tmp` cleared):
```bash
mkdir /tmp/script-deps && cd /tmp/script-deps && npm init -y && npm install @supabase/supabase-js
```

---

### Step 1 — Extract candidates

**Script:** `scripts/extract-artist-candidates.ts`

Reads all events, applies noise filters, and populates the `artist_candidates` staging table. Safe to re-run — clears only unreviewed/unpromoted rows.

```bash
npx tsx scripts/extract-artist-candidates.ts            # full run
npx tsx scripts/extract-artist-candidates.ts --dry-run  # preview only
```

Artist names are pulled from two sources: `title_en` (headliner) and the `description_en` "With X, Y, Z" clause (supporting acts). Candidates are scored `high / medium / low / discard` based on frequency, casing, and noise patterns. Tour descriptors, pricing strings, anniversary strings (`記念`, `周年`), genre labels, and boilerplate are discarded.

**Frequency:** Once per pipeline cycle, before Step 2.

---

### Step 2 — LLM review

**Script:** `scripts/review-artist-candidates.ts`

Sends all unreviewed `medium` and `low` confidence candidates to Claude Haiku for classification (`artist / not_artist / uncertain`). High-confidence candidates skip this step. Costs ~$0.01–0.05 per cycle.

```bash
npx tsx scripts/review-artist-candidates.ts
npx tsx scripts/review-artist-candidates.ts --dry-run
npx tsx scripts/review-artist-candidates.ts --limit 50
```

**Frequency:** Once per pipeline cycle, after Step 1.

---

### Step 3 — Human review (SQL)

Review candidates in the Supabase SQL editor before promoting anything.

```sql
-- Candidates ready to promote
SELECT raw_name, confidence, llm_verdict, event_count
FROM artist_candidate_summary
WHERE (confidence = 'high' OR llm_verdict = 'artist')
  AND NOT already_promoted
ORDER BY event_count DESC;

-- Uncertain — needs a manual call
SELECT raw_name, confidence, llm_verdict, event_count
FROM artist_candidate_summary
WHERE llm_verdict = 'uncertain'
ORDER BY event_count DESC;
```

Override a verdict manually:
```sql
UPDATE artist_candidates SET llm_verdict = 'artist'     WHERE raw_name = 'BAND NAME';
UPDATE artist_candidates SET llm_verdict = 'not_artist' WHERE raw_name = 'NOT A BAND';
```

**Frequency:** Every pipeline cycle, after Step 2.

---

### Step 4 — Promote

**Script:** `scripts/promote-artists.ts`

Promotes approved candidates to the live `artists` table and creates `event_artists` junction rows. Only targets `confidence = 'high' OR llm_verdict = 'artist'` rows that haven't been promoted yet. Won't touch existing artist rows.

```bash
npx tsx scripts/promote-artists.ts
npx tsx scripts/promote-artists.ts --dry-run
```

**Frequency:** Once per pipeline cycle, after Step 3.

---

### Step 5 — Enrichment (image + genre + website + instagram)

**Script:** `scripts/enrich-artists.ts`

Single-pass enrichment for all artists missing `image_url`. Runs music-database
providers (Deezer, Bandcamp, Wikipedia, TheAudioDB, Discogs, Wikidata,
MusicBrainz, iTunes, unavatar, Spotify) in parallel per artist, scores
candidates, uploads the winner to Supabase Storage, and in the same UPDATE
also writes `website_url` (from TheAudioDB/Discogs), `genre_id` (from
Spotify/TheAudioDB genre tags), and `instagram_url` (Claude Haiku fallback,
only when APIs don't provide a website and instagram is unknown).

```bash
npx tsx scripts/enrich-artists.ts               # full run — all missing images
npx tsx scripts/enrich-artists.ts --dry-run     # preview without writes
npx tsx scripts/enrich-artists.ts --limit 20
npx tsx scripts/enrich-artists.ts --slugs boris,merzbow
npx tsx scripts/enrich-artists.ts --skip-llm   # skip instagram fallback
npx tsx scripts/enrich-artists.ts --skip-image # only genres + socials
npx tsx scripts/enrich-artists.ts --force      # re-enrich artists with existing image_url
npx tsx scripts/enrich-artists.ts --sources deezer,spotify,wikipedia
npx tsx scripts/enrich-artists.ts --threshold 0.65
```

After each run, `tmp/enrich-artists/report.json` and `miss-list.csv` are written.
Fill `override_image_url` in the CSV for misses, then apply:

```bash
npx tsx scripts/apply-manual-image-overrides.ts
```

**Frequency:** After each promote cycle. Safe to re-run at any time.

---

### Step 6 — Music URL enrichment

**Script:** `scripts/enrich-music-urls.ts`

Finds and writes `music_url` for all artists where it is NULL. Searches Spotify,
Bandcamp, Deezer, and Apple Music in parallel per artist, scores each hit by name
similarity, then picks the best match from the highest-priority platform
(Spotify > Bandcamp > Deezer > Apple Music).

```bash
npx tsx scripts/enrich-music-urls.ts               # full run — all missing music_url
npx tsx scripts/enrich-music-urls.ts --dry-run     # preview without writes
npx tsx scripts/enrich-music-urls.ts --limit 20
npx tsx scripts/enrich-music-urls.ts --slugs boris,merzbow
npx tsx scripts/enrich-music-urls.ts --force       # overwrite existing music_url
npx tsx scripts/enrich-music-urls.ts --sources spotify,bandcamp
npx tsx scripts/enrich-music-urls.ts --threshold 0.65
```

After each run, `tmp/enrich-music-urls/report.json` is written, plus a
`miss-list.csv` of artists not found automatically. Fill the `manual_music_url`
column in that CSV and apply via the Supabase table editor or a SQL UPDATE.

Requires `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` in `.env.local` to enable
the Spotify source (highest-priority). Deezer, Bandcamp, and Apple Music work
without credentials.

**Frequency:** After each Step 5 (enrich-artists) run. Safe to re-run at any time.

---

## Part 3 — Maintenance

### Name cleanup

**Script:** `scripts/clean-artist-names.ts`

Normalises all artist names (strips trailing years, ONE MAN suffixes, event descriptors, section prefixes), merges duplicates by normalised key (keeping the row with the most event links), and deletes rows that aren't valid artist names.

```bash
NODE_PATH=/tmp/script-deps/node_modules npx tsx scripts/clean-artist-names.ts
```

No dry-run flag — review the console output carefully. Run whenever dirty names appear in the artists table, or after a large promote cycle.

---

## Summary

```
1. extract-artist-candidates.ts   populate staging table
2. review-artist-candidates.ts    LLM classification
3. [Human review in Supabase]     approve / reject candidates
4. promote-artists.ts             push to live artists table
5. enrich-artists.ts              image + genre + website + instagram (single pass)
6. enrich-music-urls.ts           Spotify / Bandcamp / Deezer / Apple Music links
```

Steps 5 and 6 can be re-run independently at any time without re-running the full pipeline.

**Archive:** superseded PoC scripts are in `scripts/archive/` for reference.
