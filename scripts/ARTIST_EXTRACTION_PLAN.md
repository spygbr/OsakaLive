# Artist Extraction Plan — OsakaLive

## Context

- **312 events** scraped from Osaka live venues, stored in `events` table
- **10 artists** manually seeded in `artists` table (Boris, Merzbow, Otoboke Beaver, etc.)
- **0 rows** in `event_artists` junction table — nothing linked
- Goal: populate `artists` + `event_artists` from scraped event data, with human approval before anything goes live

---

## Data Reality

### Signal sources (ranked by reliability)

| Source | Field | Quality | Notes |
|--------|-------|---------|-------|
| Event title as headliner | `events.title_en` | Medium | Namba BEARS reliably puts the headliner as title; other venues use show/series names |
| Supporting acts | `events.description_en` | Mixed | Scraper stores "With A, B, C." — but also captured pricing strings and genre labels |
| Tour/release context | `events.title_en` | Low | e.g. "seven oops LIVE tour 2026" → artist is "seven oops" but needs extraction |

### Known noise patterns in `description_en`

**Pricing/ticket garbage** (discard entirely):
- Contains `円`, `D代`, `1D`, `1ドリンク`, `前方`, `一般`, `優先`, `チケット`, `入場時`, `別途`
- Matches `-\s*/\s*-` (ticket tier dashes like "前方 - / 一般 -")

**Genre labels** (discard token, not the whole string):
```
HARDCORE, METAL, POWERVIOLENCE, ALTERNATIVE, PUNK, NOISE, ROCK, POP,
JAZZ, HIPHOP, HIP-HOP, ELECTRONIC, TECHNO, HOUSE, INDIE, EMO, CORE,
HEAVYMETAL, DEATH METAL, BLACK METAL, GRINDCORE, POST-ROCK, SHOEGAZE
```

**Venue boilerplate** (discard token):
- `[VENUE NAME] presents` — venue self-promotion (e.g. "HOKAGE presents", "TSUKAMARO presents")
- `LIVE INFO`, `...more schedule`, `公演に関する注意事項はこちら`, `ワンマン`
- Debut anniversary strings: `Debut Nth Anniversary`

### Known noise patterns in `title_en` (indicates NOT an artist name)

Strip these → if remainder is empty or < 4 chars, title is not an artist name:
- `X presents` / `X present.` / `X pre.` / `X pres.`
- `Vol.N` / `#N` / `Day.N` / `Part N`
- `Release Event` / `Release Party` / `Release Live`
- `Birthday Live` / `Birthday Party` / `生誕祭` / `生誕`
- `Anniversary` / `周年`
- `Tour` / `ツアー`
- `Festival` / `Fest` / `FEST`
- `NIGHT` / `DAY` / `MORNING` (standalone, too generic)
- `presents` anywhere in string
- Contains `『』` `【】` `〜〜` brackets wrapping the whole title
- Japanese particles as strong indicator of phrase-not-name: `の`, `は`, `を`, `が`, `で`, `に`, `へ`, `と` (when in middle of string)
- Length > 40 chars (almost certainly a show title)

### Title patterns that suggest IS an artist name:
- All-caps ASCII, length 3–25, no noise patterns → high confidence
- Mixed case, length 3–25, no noise patterns → medium confidence
- Japanese text, length 2–10, no Japanese particles → medium (LLM review needed)
- Appears as title in 3+ events → strong signal it's a real act

---

## Database Changes

### New staging table

```sql
CREATE TABLE artist_candidates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_name      text NOT NULL,
  source        text NOT NULL CHECK (source IN ('title', 'description')),
  confidence    text NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'discard')),
  confidence_reason text,           -- human-readable explanation of score
  event_id      uuid REFERENCES events(id) ON DELETE CASCADE,
  llm_reviewed  boolean DEFAULT false,
  llm_verdict   text CHECK (llm_verdict IN ('artist', 'not_artist', 'uncertain')),
  promoted      boolean DEFAULT false,
  artist_id     uuid REFERENCES artists(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX ON artist_candidates (raw_name);
CREATE INDEX ON artist_candidates (confidence);
CREATE INDEX ON artist_candidates (promoted);
```

**No RLS needed** — this is an internal admin table, never exposed to the client app.

---

## Phase 1 — Extract candidates (`scripts/extract-artist-candidates.ts`)

Run locally with `npx tsx scripts/extract-artist-candidates.ts`. Non-destructive — only writes to `artist_candidates`, never touches `artists` or `event_artists`.

### Algorithm

```
For each event in events:

  A. Title extraction
     1. Apply noise-strip rules to title_en
     2. If remainder >= 4 chars:
        - Score confidence (see rules below)
        - INSERT into artist_candidates (source='title')

  B. Description extraction
     1. Extract "With X, Y, Z[.]" clause from description_en
     2. Split on commas
     3. For each token:
        a. Trim whitespace, strip trailing punctuation
        b. Check against pricing pattern → discard if match
        c. Check against genre blocklist → discard if match
        d. Check against boilerplate list → discard if match
        e. Length check: < 3 or > 40 chars → discard
        f. Score remaining tokens
        g. INSERT into artist_candidates (source='description')
```

### Confidence scoring rules

| Condition | Score |
|-----------|-------|
| Exact match to existing `artists.name_en` (case-insensitive) | high |
| Appears as raw_name in 3+ events | high |
| All-caps ASCII, 3–20 chars, no noise | high |
| Mixed case ASCII, 3–25 chars, no noise | medium |
| Appears in 2 events | medium |
| Japanese text only, 2–10 chars, no particles | medium |
| Single appearance, long, or ambiguous | low |
| Matches any noise pattern | discard |

Discarded candidates are still inserted with `confidence='discard'` for auditability, but excluded from the review queue.

### Deduplication within the staging table

After insertion, run a normalisation pass:
- Lowercase + strip punctuation → `normal_key`
- Group by `normal_key`, keep the most-common casing as canonical `raw_name`
- Set all duplicates to point to the same canonical row (or just note count in a view)

Add a helper view for review:

```sql
CREATE VIEW artist_candidate_summary AS
SELECT
  raw_name,
  confidence,
  llm_verdict,
  COUNT(DISTINCT event_id) AS event_count,
  COUNT(*) AS total_rows,
  bool_or(promoted) AS already_promoted
FROM artist_candidates
WHERE confidence != 'discard'
GROUP BY raw_name, confidence, llm_verdict
ORDER BY event_count DESC, confidence;
```

---

## Phase 2 — LLM classification pass (`scripts/review-artist-candidates.ts`)

Runs after Phase 1. Targets all `confidence IN ('medium', 'low')` and `llm_reviewed = false`.

### Per-candidate prompt

```
You are classifying strings extracted from Japanese live music event listings.

Classify this string as ONE of: "artist", "not_artist", or "uncertain"

Rules:
- "artist": a performing band or solo artist name
- "not_artist": a show title, series name, genre label, venue name, or pricing string
- "uncertain": genuinely ambiguous — could be either

String: "{raw_name}"
Event title it appeared in: "{title_en}"
Event description: "{description_en}"

Respond with JSON only: {"verdict": "artist"|"not_artist"|"uncertain", "reason": "..."}
```

Use `claude-haiku-4-5-20251001` (cheapest, sufficient for classification).
Batch in groups of 20 with 500ms delay. Update `llm_reviewed=true`, `llm_verdict` for each.

---

## Phase 3 — Human review

Before running the promote script, Diku reviews via SQL:

```sql
-- Candidates ready to promote (high confidence OR LLM-confirmed)
SELECT raw_name, confidence, llm_verdict, event_count
FROM artist_candidate_summary
WHERE (confidence = 'high' OR llm_verdict = 'artist')
  AND NOT already_promoted
ORDER BY event_count DESC;

-- Uncertain / needs manual decision
SELECT raw_name, confidence, llm_verdict, event_count
FROM artist_candidate_summary
WHERE llm_verdict = 'uncertain' OR (confidence = 'low' AND llm_verdict IS NULL)
ORDER BY event_count DESC;
```

For manual overrides, update the verdict directly:
```sql
UPDATE artist_candidates SET llm_verdict = 'artist' WHERE raw_name = 'SOME BAND';
UPDATE artist_candidates SET llm_verdict = 'not_artist' WHERE raw_name = 'YAMINABE DEATH MATCH';
```

---

## Phase 4 — Promote to `artists` + link `event_artists` (`scripts/promote-artists.ts`)

Runs only after Diku approves the staging data.

### Promotion logic

```
For each distinct raw_name WHERE (confidence='high' OR llm_verdict='artist') AND NOT promoted:

  1. Check if artists row already exists (case-insensitive name_en match)
     - If yes: use existing artist_id
     - If no: INSERT new artists row:
         name_en = raw_name (preserve original casing)
         name_ja = null     (fill later manually or via separate enrichment)
         slug    = slugify(raw_name) + collision suffix if needed
         bio_en  = null
         genre_id = null
         image_url = null   (image scraper handles this separately)

  2. For each event_id linked to this raw_name in artist_candidates:
     INSERT INTO event_artists (event_id, artist_id, billing_order)
     VALUES (event_id, artist_id,
       CASE WHEN source='title' THEN 1 ELSE 2 END)
     ON CONFLICT DO NOTHING

  3. UPDATE artist_candidates SET promoted=true, artist_id=<new_id>
     WHERE raw_name = ...
```

### Slug generation

```ts
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // strip special chars
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}
// If slug already exists in artists table, append -2, -3, etc.
```

For Japanese-only names where slugify produces an empty string, use a random 8-char hex suffix: `artist-{randomHex}`. These will need manual slug cleanup later.

---

## Phase 5 — Image enrichment

After promotion, run the existing `scripts/scrape-artist-images.ts` again. It targets all artists with `image_url = null` — which will now include the newly promoted artists. The same Instagram → website fallback logic applies.

For newly promoted artists with no `instagram_url` or `website_url` (most of them), the scraper will skip them. A separate web-search enrichment pass (similar to what was done for the original 10) will be needed — but that's a future task.

---

## File summary

| File | Purpose | When to run |
|------|---------|-------------|
| `scripts/extract-artist-candidates.ts` | Phase 1 — populate staging table | Once (re-runnable, upserts) |
| `scripts/review-artist-candidates.ts` | Phase 2 — LLM classification | Once after Phase 1 |
| `scripts/promote-artists.ts` | Phase 4 — promote to production | After human review of staging table |
| `scripts/scrape-artist-images.ts` | Phase 5 — image enrichment | After Phase 4 |

---

---

## Phase 6 — UI cross-referencing & data completeness

### 6a. Missing event detail page — `/app/event/[slug]/page.tsx`

`getEventBySlug` already exists in `lib/supabase/queries.ts` and returns full event data including the `artists` array. But **no page renders it** — there is no `/event/[slug]` route at all. Every event card that links to `/event/{slug}` is currently a dead link.

This page needs to be created. It should display:
- Event title, date, doors/start time, ticket prices, availability badge
- Venue name + address with link to `/venues/[slug]`
- Ticket URL button (external)
- **Artist lineup section** — each artist as a card/chip with:
  - `image_url` thumbnail (or placeholder)
  - `name_en` / `name_ja`
  - Genre tag
  - Link to `/artists/[slug]`
- Description (bio_en from event if set)
- Genre tags

This is a pure frontend task — no new queries or DB changes needed.

### 6b. Add `image_url` to artist joins in event queries

In `lib/supabase/queries.ts`, `EVENT_SELECT` and `EVENT_SELECT_FULL` both select artists as:
```ts
event_artists(billing_order, artist:artists(name_en, name_ja, slug))
```

Update both to include `image_url` so artist thumbnails can be shown on event cards and the event detail page:
```ts
event_artists(billing_order, artist:artists(name_en, name_ja, slug, image_url))
```

Also update the `EventArtist` type in queries.ts:
```ts
export type EventArtist = {
  name_en: string
  name_ja: string | null
  slug: string
  image_url: string | null   // add this
  bio_en?: string | null
  billing_order: number
}
```

### 6c. Artist bio enrichment for newly promoted artists

After Phase 4 (promote), most new artist rows will have `bio_en = null`. Options in priority order:

1. **Wikipedia/web scrape** — for well-known acts, a short bio can be fetched from their Wikipedia page or official site. Add a `scripts/enrich-artist-bios.ts` script that fetches the official website, looks for an About/Bio section, and uses Claude to summarise it into 2–3 sentences.

2. **LLM generation from event context** — for lesser-known acts with no web presence, Claude can generate a placeholder bio from: the artist name, genre (if set), and a sample of their event titles. Mark these as `bio_source = 'generated'` so they can be reviewed. (This requires a `bio_source` column or a convention like prefixing with `[Auto] `.)

3. **Leave null** — the artist page already handles `bio_en = null` gracefully with "No biography available." This is acceptable for the initial launch.

Recommended approach: leave null for launch, add `enrich-artist-bios.ts` as a follow-up task in Chat E.

### 6d. `name_ja` for newly promoted artists

Extracted artists will have `name_ja = null`. For Japanese-language band names extracted from title_en (which the scraper stores in English), the Japanese name is often the same string. For bands with both scripts, this needs manual lookup or a separate enrichment pass.

The promote script should set `name_ja = raw_name` when `raw_name` contains Japanese characters (CJK Unicode range `\u3000-\u9fff`), since in that case the raw_name IS the Japanese name and `name_en` should be left for a manual transliteration.

```ts
const hasJapanese = /[\u3000-\u9fff\uff00-\uffef]/.test(rawName)
const name_en = hasJapanese ? slug  // placeholder — needs manual fix
const name_ja = hasJapanese ? rawName : null
```

Flag these in a post-promote review query:
```sql
SELECT slug, name_en, name_ja FROM artists
WHERE name_en = slug  -- slug used as placeholder
ORDER BY created_at DESC;
```

### 6e. Social link enrichment for newly promoted artists

After promotion, `instagram_url` and `website_url` will be null for all new artists. The image scraper will skip them. A web-search enrichment pass is needed (same pattern as was done for the original 10 artists in this conversation).

Add this as an explicit step in Chat D — not just for images but for social links first, then images.

---

## Implementation order for separate chat sessions

Each chat should start by reading this file.

**Chat A — Staging infrastructure**
- Apply `artist_candidates` migration via Supabase MCP
- Create `artist_candidate_summary` view
- Write and test `scripts/extract-artist-candidates.ts`

**Chat B — LLM review script**
- Write `scripts/review-artist-candidates.ts`
- Run it and verify `llm_verdict` values look sensible on a sample

**Chat C — Promote script**
- After Diku has reviewed the staging table
- Write and run `scripts/promote-artists.ts`
- Handle Japanese name detection (6d)
- Verify `artists` count, `event_artists` count, spot-check slugs

**Chat D — Social link + image enrichment for new artists**
- Web-search `instagram_url` / `website_url` for newly promoted high-profile acts
- SQL update social links
- Re-run `scripts/scrape-artist-images.ts`

**Chat E — Event detail page + query fixes**
- Create `/app/event/[slug]/page.tsx` with artist lineup section (6a)
- Update `EVENT_SELECT` and `EventArtist` type to include `image_url` (6b)
- Optional: `scripts/enrich-artist-bios.ts` (6c)
