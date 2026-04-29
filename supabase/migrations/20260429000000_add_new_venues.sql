-- ============================================================================
-- Add newly discovered Osaka live houses (venue discovery pass, 2026-04-29)
--
-- Discovery sources: super-nice.net, livehouse.tv, Songkick, Bandsintown,
-- GigLifePro, Osaka.com, WalkerPlus, Ragnet
--
-- All venues added with scrape_enabled = false.
-- Sources are inserted with enabled = false — flip to true once a scraper
-- source class is implemented in lib/scraper/v2/sources/.
-- ============================================================================

begin;

-- ── Shinsaibashi / Amerikamura area (area_id = 2) ───────────────────────────

insert into public.venues
  (slug, area_id, name_en, name_ja, capacity, website_url, scrape_url, scrape_enabled)
values
  ('shinsaibashi-fanj',
   2, 'Shinsaibashi FANJ', '心斎橋FANJ',
   200, 'http://www.fanj.co.jp/', 'http://www.fanj.co.jp/', false),

  ('shinsaibashi-fanj-twice',
   2, 'Shinsaibashi FANJ twice', '心斎橋FANJ twice',
   350, 'http://www.fanj-twice.com/', 'http://www.fanj-twice.com/', false),

  ('conpass',
   2, 'CONPASS', '東心斎橋CONPASS',
   null, 'http://www.conpass.jp/', 'http://www.conpass.jp/live/', false),

  ('shinsaibashi-paradigm',
   2, 'Shinsaibashi paradigm', '心斎橋paradigm',
   null, 'http://shinsaibashi-paradigm.com/', 'http://shinsaibashi-paradigm.com/schedule/', false),

  ('osaka-varon',
   2, 'Shinsaibashi VARON', '心斎橋VARON',
   250, 'https://osaka-varon.jp/', 'https://osaka-varon.jp/schedule/', false),

  ('clapper',
   2, 'Americamura CLAPPER', 'アメリカ村CLAPPER',
   null, 'https://www.clapper.jp/', 'https://www.clapper.jp/', false),

  ('knave',
   2, 'Minami-Horie knave', '南堀江knave',
   230, 'http://www.knave.co.jp/', 'http://www.knave.co.jp/schedule/', false),

  ('loft-plus-one-west',
   2, 'Loft Plus One West', 'ロフトプラスワンウエスト',
   null, 'https://www.loft-prj.co.jp/WEST/', 'https://www.loft-prj.co.jp/WEST/schedule/', false),

  ('shinsaibashi-anima',
   2, 'Live House Anima', 'ライブハウスAnima',
   null, 'https://www.livehouse-anima.com/', null, false),

  ('seven-house',
   2, 'SEVEN HOUSE', 'セブンハウス',
   null, null, null, false),

  ('club-vijon',
   2, 'Club Vijon', 'クラブビジョン',
   null, 'http://club-vijon.com/', 'http://club-vijon.com/schedule/', false)

on conflict (slug) do nothing;

-- ── Umeda / Kita area (area_id = 3) ─────────────────────────────────────────

insert into public.venues
  (slug, area_id, name_en, name_ja, capacity, website_url, scrape_url, scrape_enabled)
values
  ('shangri-la',
   3, 'Umeda Shangri-La', '梅田Shangri-La',
   350, 'http://shan-gri-la.jp/', 'http://shan-gri-la.jp/', false),

  ('billboard-live-osaka',
   3, 'Billboard Live Osaka', '大阪ビルボードライブ',
   320, 'https://www.billboard-live.com/osaka/', 'https://www.billboard-live.com/osaka/schedules', false),

  ('fukushima-2nd-line',
   3, 'Fukushima LIVE SQUARE 2nd LINE', '福島LIVE SQUARE 2nd LINE',
   250, 'http://www.arm-live.com/2nd/', 'http://www.arm-live.com/2nd/schedule/', false)

on conflict (slug) do nothing;

-- ── Other Osaka areas (area_id = null — outside the 3 main districts) ────────

insert into public.venues
  (slug, area_id, name_en, name_ja, capacity, website_url, scrape_url, scrape_enabled)
values
  ('esaka-muse',
   null, 'ESAKA MUSE', 'ESAKA MUSE',
   350, 'http://www.arm-live.com/muse/esaka/', 'http://www.arm-live.com/muse/esaka/', false),

  ('teradamachi-fireloop',
   null, 'Teradamachi Fireloop', '寺田町Fireloop',
   200, 'http://fireloop.net/', 'http://fireloop.net/schedule/', false),

  ('abeno-rocktown',
   null, 'Abeno ROCKTOWN', '阿倍野ROCKTOWN',
   null, 'http://www.rocktown.jp/', 'http://www.rocktown.jp/schedule/', false)

on conflict (slug) do nothing;

-- ── Sources (disabled — enable after scraper class is implemented) ───────────

insert into public.sources (id, kind, display_name, venue_id, base_url, enabled)
select
  'venue:' || v.slug,
  'venue',
  coalesce(v.name_en, v.slug),
  v.id,
  v.scrape_url,
  false          -- disabled until scraper class exists
from public.venues v
where v.slug in (
  'shinsaibashi-fanj',
  'shinsaibashi-fanj-twice',
  'conpass',
  'shinsaibashi-paradigm',
  'osaka-varon',
  'knave',
  'loft-plus-one-west',
  'shangri-la',
  'billboard-live-osaka',
  'fukushima-2nd-line',
  'esaka-muse',
  'teradamachi-fireloop',
  'abeno-rocktown'
)
  and v.scrape_url is not null
on conflict (id) do nothing;

commit;
