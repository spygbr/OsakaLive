-- ============================================================================
-- Re-add events.slug as a generated stored column derived from id.
-- The v1 schema had a separate text slug; the v2 reset dropped it. The app
-- still routes /event/[id] by slug, so we expose the UUID as the slug for
-- now. A prettier slug (date + title) can be added later.
-- ============================================================================

alter table public.events
  add column slug text generated always as (id::text) stored;

create unique index if not exists events_slug_key on public.events(slug);
