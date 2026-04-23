-- ============================================================================
-- Event pipeline reset
--
-- Drops the existing event/artist data tables and recreates them with the new
-- pipeline-aware schema:
--
--   sources              ── one row per scraper (venue or aggregator)
--   events               ── canonical event row, deduped on (venue, date, title_norm)
--   event_sources        ── many sources can corroborate one event
--   events_rejected      ── quarantine for lines the validator killed
--   scrape_logs          ── per-source run metrics
--   artist_candidates    ── staging table for the human review gate
--   artists              ── promoted artists only (kept; reset)
--   event_artists        ── join (kept; reset)
--   artist_aliases       ── alternate spellings → canonical artist
--
-- Reference data (areas, genres, venues) is preserved.
--
-- This migration assumes the existing events / artist data is disposable.
-- ============================================================================

begin;

-- ── Drop dependent objects in safe order ────────────────────────────────────
drop table if exists public.event_artists       cascade;
drop table if exists public.event_genres        cascade;
drop table if exists public.artist_candidates   cascade;
drop table if exists public.artist_aliases      cascade;
drop table if exists public.events_rejected     cascade;
drop table if exists public.event_sources       cascade;
drop table if exists public.scrape_logs         cascade;
drop table if exists public.events              cascade;
drop table if exists public.artists             cascade;
drop table if exists public.sources             cascade;

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- Normalise a title for dedup: lowercase, strip punctuation, collapse
-- whitespace, normalise full-width → half-width for ASCII range.
-- Pure SQL so it can back a generated column.
create or replace function public.normalize_title(input text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        lower(
          translate(
            coalesce(input, ''),
            -- full-width ASCII → half-width
            '　０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ',
            ' 0123456789abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'
          )
        ),
        '[[:punct:]]', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

-- ── sources ─────────────────────────────────────────────────────────────────
-- One row per scraper. Venue scrapers reference venues.id; aggregators don't.
create table public.sources (
  id              text primary key,                 -- e.g. 'punx', 'icegrills', 'venue:namba-bears'
  kind            text not null check (kind in ('venue', 'aggregator')),
  display_name    text not null,
  venue_id        uuid references public.venues(id) on delete cascade,
  base_url        text not null,
  enabled         boolean not null default true,
  -- Scheduling hints
  fetch_interval_minutes integer not null default 1440,
  -- HTTP caching
  last_etag       text,
  last_modified   text,
  last_content_hash text,
  last_fetched_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((kind = 'venue') = (venue_id is not null))
);
create index sources_enabled_idx on public.sources(enabled) where enabled;

-- ── events ──────────────────────────────────────────────────────────────────
create table public.events (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references public.venues(id) on delete cascade,
  event_date      date not null,
  title_raw       text not null,
  -- Generated normalised title for dedup. STORED so the unique index works.
  title_norm      text generated always as (public.normalize_title(title_raw)) stored,
  title_en        text,                              -- optional translated/cleaned title
  title_ja        text,
  description     text,
  start_time      time,
  doors_time      time,
  ticket_price_adv  integer,
  ticket_price_door integer,
  ticket_url      text,
  availability    text not null default 'on_sale',
  is_featured     boolean not null default false,
  primary_source_id text references public.sources(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Dedup key: same venue + date + normalised title = same event
  constraint events_dedup_unique unique (venue_id, event_date, title_norm)
);
create index events_event_date_idx on public.events(event_date);
create index events_venue_date_idx on public.events(venue_id, event_date);

-- ── event_sources ───────────────────────────────────────────────────────────
-- Records every source that found a given event. The first finder also
-- becomes the event's primary_source_id.
create table public.event_sources (
  event_id     uuid not null references public.events(id) on delete cascade,
  source_id    text not null references public.sources(id) on delete cascade,
  source_url   text not null,
  raw_payload  jsonb,
  scraped_at   timestamptz not null default now(),
  primary key (event_id, source_id)
);
create index event_sources_source_idx on public.event_sources(source_id);

-- ── events_rejected ─────────────────────────────────────────────────────────
-- Quarantine for lines the validator killed. No dedup; this is a tuning queue.
create table public.events_rejected (
  id           bigserial primary key,
  source_id    text references public.sources(id) on delete set null,
  source_url   text,
  raw_line     text not null,
  reason       text not null,
  payload      jsonb,
  scraped_at   timestamptz not null default now()
);
create index events_rejected_scraped_at_idx on public.events_rejected(scraped_at desc);
create index events_rejected_reason_idx     on public.events_rejected(reason);

-- ── scrape_logs ─────────────────────────────────────────────────────────────
create table public.scrape_logs (
  id            bigserial primary key,
  source_id     text not null references public.sources(id) on delete cascade,
  status        text not null check (status in ('success', 'partial', 'failed', 'skipped')),
  fetched       integer not null default 0,
  parsed        integer not null default 0,
  rejected      integer not null default 0,
  unresolved    integer not null default 0,
  upserted      integer not null default 0,
  duration_ms   integer not null default 0,
  error_message text,
  started_at    timestamptz not null default now()
);
create index scrape_logs_source_started_idx on public.scrape_logs(source_id, started_at desc);

-- ── artists ─────────────────────────────────────────────────────────────────
create table public.artists (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name_en      text not null,
  name_ja      text,
  bio_en       text,
  bio_ja       text,
  genre_id     integer references public.genres(id) on delete set null,
  image_url    text,
  website_url  text,
  instagram_url text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── artist_aliases ──────────────────────────────────────────────────────────
-- Alternate spellings (JP/EN/romaji/typos) that should resolve to the same
-- canonical artist. Used by stage 2 to auto-link without creating duplicates.
create table public.artist_aliases (
  artist_id    uuid not null references public.artists(id) on delete cascade,
  alias_norm   text primary key,            -- normalize_title applied
  alias_raw    text not null,
  created_at   timestamptz not null default now()
);
create index artist_aliases_artist_idx on public.artist_aliases(artist_id);

-- ── artist_candidates ───────────────────────────────────────────────────────
-- Staging queue for the human review gate. One row per distinct candidate name.
create table public.artist_candidates (
  id              bigserial primary key,
  name_norm       text not null unique,
  name_display    text not null,
  event_count     integer not null default 1,
  confidence      text not null default 'low'
                  check (confidence in ('high', 'medium', 'low')),
  llm_verdict     text check (llm_verdict in ('artist', 'not_artist', 'uncertain')),
  llm_reason      text,
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'merged')),
  merged_into_artist_id uuid references public.artists(id) on delete set null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);
create index artist_candidates_status_idx     on public.artist_candidates(status);
create index artist_candidates_confidence_idx on public.artist_candidates(confidence) where status = 'pending';

-- ── event_artists ───────────────────────────────────────────────────────────
create table public.event_artists (
  event_id       uuid not null references public.events(id) on delete cascade,
  artist_id      uuid not null references public.artists(id) on delete cascade,
  role           text not null default 'performer'
                 check (role in ('headliner', 'support', 'dj', 'performer')),
  billing_order  integer,
  confidence     text not null default 'auto'
                 check (confidence in ('auto', 'human')),
  primary key (event_id, artist_id)
);
create index event_artists_artist_idx on public.event_artists(artist_id);

-- ── updated_at triggers ─────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sources_touch_updated_at
  before update on public.sources
  for each row execute function public.touch_updated_at();

create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_updated_at();

create trigger artists_touch_updated_at
  before update on public.artists
  for each row execute function public.touch_updated_at();

commit;
