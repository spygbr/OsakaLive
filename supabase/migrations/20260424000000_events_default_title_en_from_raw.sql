-- ============================================================================
-- Auto-fill events.title_en from title_raw when scraper leaves it null.
-- Frontend reads title_en (with title_ja fallback) — both null = blank card.
-- A future enrichment pass can overwrite title_en with a translated/cleaned
-- value; this trigger only fills the gap so cards never render nameless.
-- ============================================================================

create or replace function public.events_fill_title_en()
returns trigger
language plpgsql
as $$
begin
  if new.title_en is null or btrim(new.title_en) = '' then
    new.title_en := new.title_raw;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_fill_title_en on public.events;
create trigger trg_events_fill_title_en
  before insert or update on public.events
  for each row execute function public.events_fill_title_en();
