-- ============================================================================
-- Seed the sources table.
--
-- Aggregators are inserted explicitly (one row each).
-- Venue sources are derived from venues that already had scrape_enabled=true
-- in the legacy schema. If venues.scrape_enabled / scrape_url no longer exist
-- (because the v1 schema dropped them), this just inserts the aggregators.
-- ============================================================================

begin;

-- ── Aggregators ─────────────────────────────────────────────────────────────
insert into public.sources (id, kind, display_name, base_url) values
  ('punx',      'aggregator', 'Punx Save The Earth', 'https://punxsavetheearth.com/category/live-info/'),
  ('icegrills', 'aggregator', 'Ice Grills',           'https://icegrills.jp/tour/'),
  ('udiscover', 'aggregator', 'uDiscover Music JP',   'https://www.udiscovermusic.jp/news/2022-coming-to-japan-musicians'),
  ('unionway',  'aggregator', 'Unionway JP',          'https://unionwayjp.com/')
on conflict (id) do nothing;

-- ── Venue sources ───────────────────────────────────────────────────────────
-- Only runs if the legacy columns survived the reset migration. Wrap in a
-- DO block so the script doesn't fail when those columns don't exist.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='venues' and column_name='scrape_url'
  ) then
    execute $sql$
      insert into public.sources (id, kind, display_name, venue_id, base_url)
      select
        'venue:' || v.slug,
        'venue',
        coalesce(v.name_en, v.name_ja, v.slug),
        v.id,
        v.scrape_url
      from public.venues v
      where v.scrape_url is not null
        and coalesce(v.scrape_enabled, true)
      on conflict (id) do nothing
    $sql$;
  end if;
end $$;

commit;
