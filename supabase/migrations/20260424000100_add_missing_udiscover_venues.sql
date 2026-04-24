-- Add venues referenced by udiscover aggregator that were missing from the
-- venues table, causing 22 venue_unresolved rejections per scrape cycle.
-- scrape_enabled = false: these are resolver targets only (not scraped directly).

INSERT INTO venues (slug, area_id, name_en, name_ja, scrape_enabled)
VALUES
  ('namba-hatch',        1,    'Namba Hatch',        'なんばHatch',           false),
  ('zepp-namba',         1,    'Zepp Namba',          'Zepp難波',              false),
  ('socore-factory',     1,    'SOCORE FACTORY',      '南堀江SOCORE FACTORY',  false),
  ('festival-hall',      3,    'Festival Hall',       'フェスティバルホール',   false),
  ('gran-cube-osaka',    3,    'Grand Cube Osaka',    'グランキューブ大阪',     false),
  ('zepp-osaka-bayside', NULL, 'Zepp Osaka Bayside',  'Zepp Osaka Bayside',    false),
  ('osaka-jo-hall',      NULL, 'Osaka-Jo Hall',       '大阪城ホール',           false)
ON CONFLICT (slug) DO NOTHING;
