-- Add bio_source column to record which provider won bio enrichment
ALTER TABLE artists ADD COLUMN IF NOT EXISTS bio_source text;
