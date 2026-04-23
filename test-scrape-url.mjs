import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://geulxxpotxttmxzesuyi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdldWx4eHBvdHh0dG14emVzdXlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NDIyMDUsImV4cCI6MjA5MTIxODIwNX0.105s7cLDuu7iX-wxilsk36lrXO2Ki0knqxMfwmhWk30'
)

// 1. Check which venues have scrape_url populated
const { data: venues } = await supabase
  .from('venues')
  .select('slug, name_en, scrape_url, website_url')
  .order('slug')

console.log('\n=== VENUES scrape_url status ===')
for (const v of venues ?? []) {
  const has = v.scrape_url ? '✓' : '✗'
  console.log(`${has} ${v.slug.padEnd(30)} ${v.scrape_url ?? '(null)'}`)
}

// 2. Check a real event query returns scrape_url
const { data: event } = await supabase
  .from('events')
  .select(`
    slug,
    venue:venues(slug, name_en, website_url, scrape_url)
  `)
  .order('event_date', { ascending: true })
  .limit(1)
  .maybeSingle()

console.log('\n=== Sample event venue data ===')
console.log(JSON.stringify(event, null, 2))
