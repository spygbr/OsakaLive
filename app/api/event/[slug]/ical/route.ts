/**
 * GET /api/event/[slug]/ical
 *
 * Returns a standards-compliant iCalendar (.ics) file for a single event.
 * Compatible with Apple Calendar, Google Calendar, Outlook, and any RFC 5545
 * compliant calendar app.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getEventBySlug } from '@/lib/supabase/queries'

/** Fold long lines per RFC 5545 §3.1 (max 75 octets, continuation with CRLF + SPACE) */
function foldLine(line: string): string {
  const MAX = 75
  if (line.length <= MAX) return line
  let result = ''
  let pos = 0
  while (pos < line.length) {
    if (pos === 0) {
      result += line.slice(0, MAX)
      pos = MAX
    } else {
      result += '\r\n ' + line.slice(pos, pos + MAX - 1)
      pos += MAX - 1
    }
  }
  return result
}

/** Escape text values per RFC 5545 §3.3.11 */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Format YYYY-MM-DD → YYYYMMDD for iCal DATE value */
function toICalDate(isoDate: string): string {
  return isoDate.replace(/-/g, '')
}

/**
 * Format YYYY-MM-DD + HH:MM → YYYYMMDDTHHmmss for iCal DATETIME value (JST).
 * We output local time with TZID=Asia/Tokyo rather than UTC to keep the
 * displayed time correct if the user's device is not in JST.
 */
function toICalDateTime(isoDate: string, time: string): string {
  const d = isoDate.replace(/-/g, '')
  const t = time.replace(':', '') + '00'
  return `${d}T${t}`
}

/** Generate a deterministic UID for an event (avoids duplicates on re-download) */
function eventUID(slug: string): string {
  return `${slug}@osaka-live.app`
}

/** RFC 5545 timestamp for DTSTAMP (UTC) */
function nowStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params
  const event = await getEventBySlug(slug)

  if (!event) {
    return new NextResponse('Event not found', { status: 404 })
  }

  const venue = event.venue
  const title = event.title_en
  const description = event.description_en ?? ''
  const location = venue
    ? `${venue.name_en}, ${venue.address_en ?? 'Osaka, Japan'}`
    : 'Osaka, Japan'

  // Build DTSTART / DTEND.
  // If we have a start time, use a DATETIME (1-hour duration assumed when no end time).
  // Otherwise use a DATE-only all-day event.
  let dtstart: string
  let dtend: string
  let dtType: 'datetime' | 'date'

  if (event.start_time) {
    dtType = 'datetime'
    dtstart = toICalDateTime(event.event_date, event.start_time)
    // Assume 2-hour duration when no explicit end time is stored
    const [h, m] = event.start_time.split(':').map(Number)
    const endH = String((h + 2) % 24).padStart(2, '0')
    const endM = String(m).padStart(2, '0')
    dtend = toICalDateTime(event.event_date, `${endH}:${endM}`)
  } else {
    dtType = 'date'
    const d = toICalDate(event.event_date)
    dtstart = d
    // All-day end is the next calendar day
    const next = new Date(event.event_date + 'T00:00:00Z')
    next.setUTCDate(next.getUTCDate() + 1)
    dtend = next.toISOString().slice(0, 10).replace(/-/g, '')
  }

  // Build description with ticket price info
  const descParts: string[] = []
  if (event.ticket_price_adv) {
    descParts.push(`Adv ¥${event.ticket_price_adv.toLocaleString()}` +
      (event.ticket_price_door ? ` / Door ¥${event.ticket_price_door.toLocaleString()}` : ''))
  }
  if (event.doors_time) descParts.push(`Doors ${event.doors_time}`)
  if (event.start_time) descParts.push(`Start ${event.start_time}`)
  if (description) descParts.push(description)
  if (event.ticket_url) descParts.push(`Tickets: ${event.ticket_url}`)
  const fullDesc = descParts.join('\\n')

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OsakaLive//OsakaLive//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    foldLine(`UID:${eventUID(slug)}`),
    foldLine(`DTSTAMP:${nowStamp()}`),
    dtType === 'datetime'
      ? foldLine(`DTSTART;TZID=Asia/Tokyo:${dtstart}`)
      : foldLine(`DTSTART;VALUE=DATE:${dtstart}`),
    dtType === 'datetime'
      ? foldLine(`DTEND;TZID=Asia/Tokyo:${dtend}`)
      : foldLine(`DTEND;VALUE=DATE:${dtend}`),
    foldLine(`SUMMARY:${escapeText(title)}`),
    foldLine(`LOCATION:${escapeText(location)}`),
    ...(fullDesc ? [foldLine(`DESCRIPTION:${fullDesc}`)] : []),
    ...(event.ticket_url ? [foldLine(`URL:${event.ticket_url}`)] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  const ics = lines.join('\r\n') + '\r\n'

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}.ics"`,
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
}
