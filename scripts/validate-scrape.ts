import fs from 'fs'
import path from 'path'
import { parseEventsFromHtml } from '../lib/scraper/parse'
import { validateVenueEvents, type VenueValidationMetrics } from '../lib/scraper/validate'

type SampleVenue = {
  slug: string
  samplePath: string
  sourceUrl: string
  enabled?: boolean
}

type SampleIndex = {
  venues: SampleVenue[]
}

const SAMPLE_ROOT = path.resolve(process.cwd(), 'data/scrape-samples')
const SAMPLE_INDEX = path.join(SAMPLE_ROOT, 'index.json')
const REPORT_DIR = path.resolve(process.cwd(), 'reports/scrape-validation')
const TOP_N = Number(process.env.SCRAPE_VALIDATE_TOP_N ?? 5)

function readSampleIndex(): SampleVenue[] {
  if (fs.existsSync(SAMPLE_INDEX)) {
    const parsed = JSON.parse(fs.readFileSync(SAMPLE_INDEX, 'utf8')) as SampleIndex
    return parsed.venues.filter((v) => v.enabled !== false)
  }

  if (!fs.existsSync(SAMPLE_ROOT)) {
    return []
  }

  return fs
    .readdirSync(SAMPLE_ROOT)
    .filter((f) => f.endsWith('.html'))
    .map((f) => ({
      slug: path.basename(f, '.html'),
      samplePath: f,
      sourceUrl: `file://${f}`,
      enabled: true,
    }))
}

function buildMarkdown(metrics: VenueValidationMetrics[]): string {
  const lines: string[] = []
  lines.push('# Scrape Validation Report')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')

  for (const m of metrics.sort((a, b) => a.venueSlug.localeCompare(b.venueSlug))) {
    lines.push(`## ${m.venueSlug}`)
    lines.push('')
    lines.push(`- Total events: **${m.totalEvents}**`)
    lines.push(`- % with non-null ADV price: **${m.pctWithAdvPrice}%**`)
    lines.push(`- % with doors/start times: **${m.pctWithDoorsOrStart}%**`)
    lines.push(`- Suspect rows: **${m.suspectRows}**`)
    lines.push('')

    if (m.suspectEvents.length === 0) {
      lines.push('_No suspect events found._')
      lines.push('')
      continue
    }

    lines.push(`Top ${m.suspectEvents.length} suspect event(s):`)
    lines.push('')
    for (const [idx, s] of m.suspectEvents.entries()) {
      lines.push(`${idx + 1}. **${s.title}** (${s.eventDate})`)
      lines.push(`   - Source URL: ${s.sourceUrl}`)
      lines.push(`   - Reason: ${s.reason}`)
      if (s.sourceContext) {
        lines.push(`   - Context: \`${s.sourceContext.replace(/`/g, "'").slice(0, 220)}\``)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function main() {
  const venues = readSampleIndex()
  if (venues.length === 0) {
    console.error(
      'No HTML samples found. Add data/scrape-samples/index.json (or *.html files) to run static validation.',
    )
    process.exit(1)
  }

  const metrics: VenueValidationMetrics[] = []

  for (const venue of venues) {
    const sampleFile = path.isAbsolute(venue.samplePath)
      ? venue.samplePath
      : path.join(SAMPLE_ROOT, venue.samplePath)

    if (!fs.existsSync(sampleFile)) {
      console.warn(`[validate-scrape] missing sample for ${venue.slug}: ${sampleFile}`)
      continue
    }

    const html = fs.readFileSync(sampleFile, 'utf8')
    const events = parseEventsFromHtml(html, venue.slug, venue.sourceUrl)
    metrics.push(validateVenueEvents(venue.slug, events, TOP_N))
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true })
  fs.writeFileSync(path.join(REPORT_DIR, 'report.json'), JSON.stringify({ venues: metrics }, null, 2))
  fs.writeFileSync(path.join(REPORT_DIR, 'report.md'), buildMarkdown(metrics))

  console.log(`[validate-scrape] wrote ${metrics.length} venue report(s) to ${REPORT_DIR}`)
}

main().catch((err) => {
  console.error('[validate-scrape] failed:', err)
  process.exit(1)
})
