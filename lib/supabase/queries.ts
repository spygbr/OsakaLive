import { createServerClient } from './server'

/** Returns today's date as YYYY-MM-DD in JST (UTC+9) */
function getTodayJST(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

export type FilterParams = {
  area?: string          // area slug
  genre?: string         // genre slug
  dateFrom?: string      // YYYY-MM-DD (inclusive)
  dateTo?: string        // YYYY-MM-DD (inclusive)
  price?: 'free' | 'paid'
  q?: string             // free-text search across event title (en/ja/norm)
}

export type AreaOption = { id: number; name_en: string; name_ja: string; slug: string }
export type GenreOption = { id: number; name_en: string; slug: string }
export type GenreOptionWithCount = GenreOption & { upcoming_count: number }

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type EventVenue = {
  id: string
  name_en: string
  name_ja: string
  slug: string
  address_en: string | null
  address_ja?: string | null
  website_url?: string | null
  scrape_url?: string | null
  area: { name_en: string; name_ja: string; slug: string } | null
}

export type EventArtist = {
  name_en: string
  name_ja: string | null
  slug: string
  image_url: string | null
  bio_en?: string | null
  billing_order: number
}

export type EventGenre = {
  name_en: string
  slug: string
}

export type EventWithVenue = {
  id: string
  slug: string
  title_en: string
  title_ja: string | null
  event_date: string
  doors_time: string | null
  start_time: string | null
  ticket_price_adv: number | null
  ticket_price_door: number | null
  drink_charge: number | null
  availability: string
  description_en: string | null
  description_ja: string | null
  is_featured: boolean | null
  ticket_url: string | null
  source_url: string | null
  venue: EventVenue | null
  genres: EventGenre[]
  artists: EventArtist[]
}

export type ArtistWithGenre = {
  id: string
  slug: string
  name_en: string
  name_ja: string | null
  bio_en: string | null
  bio_ja: string | null
  image_url: string | null
  website_url: string | null
  instagram_url: string | null
  music_url: string | null
  genre: { name_en: string; slug: string } | null
}

// ---------------------------------------------------------------------------
// Normalise raw Supabase join shapes
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEvent(raw: any): EventWithVenue {
  return {
    ...raw,
    source_url: (raw.event_sources?.[0]?.source_url) ?? null,
    venue: raw.venue ?? null,
    // genres now flow through artists.genre_id, not a join table.
    // Derive distinct genres from the event's artists.
    genres: (() => {
      const seen = new Set<string>()
      const out: { name_en: string; slug: string }[] = []
      for (const ea of (raw.event_artists ?? [])) {
        const g = ea.artist?.genre
        if (g && !seen.has(g.slug)) { seen.add(g.slug); out.push(g) }
      }
      return out
    })(),
    artists: (raw.event_artists ?? [])
      .map((ea: any) => ({ ...ea.artist, billing_order: ea.billing_order ?? 0 }))
      .filter((a: any) => a.name_en)
      .sort((a: any, b: any) => a.billing_order - b.billing_order),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEvents(raws: any[]): EventWithVenue[] {
  return raws.map(normalizeEvent)
}

const EVENT_SELECT = `
  *,
  venue:venues(id, name_en, name_ja, slug, address_en, website_url, area:areas(name_en, name_ja, slug)),
  event_artists(billing_order, artist:artists(name_en, name_ja, slug, image_url, genre:genres(name_en, slug)))
`

const EVENT_SELECT_FULL = `
  *,
  venue:venues(id, name_en, name_ja, slug, address_en, address_ja, website_url, scrape_url, area:areas(name_en, name_ja, slug)),
  event_artists(billing_order, artist:artists(name_en, name_ja, slug, image_url, bio_en, genre:genres(name_en, slug))),
  event_sources(source_url)
`

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ResolvedFilterIds = {
  venueIds: string[] | null
  genreEventIds: string[] | null
  /** true = the filter matched nothing — caller should return [] immediately */
  empty: boolean
}

/**
 * Resolves area and genre filter slugs to the concrete ID sets needed for
 * the main event query. Extracted to avoid duplicating ~60 lines of
 * sequential sub-queries across getFilteredEvents and getEventsForMonth.
 */
async function resolveFilterIds(
  supabase: ReturnType<typeof createServerClient>,
  filters: Pick<FilterParams, 'area' | 'genre'>,
): Promise<ResolvedFilterIds> {
  // Area slug → venue IDs
  let venueIds: string[] | null = null
  if (filters.area) {
    const { data: areaRow, error: areaErr } = await supabase
      .from('areas')
      .select('id')
      .eq('slug', filters.area)
      .maybeSingle()
    if (areaErr) throw new Error(`[resolveFilterIds:area] ${areaErr.message}`)
    if (areaRow) {
      const { data: venueRows, error: venueErr } = await supabase
        .from('venues')
        .select('id')
        .eq('area_id', areaRow.id)
      if (venueErr) throw new Error(`[resolveFilterIds:venues] ${venueErr.message}`)
      venueIds = (venueRows ?? []).map((v) => v.id)
      if (venueIds.length === 0) return { venueIds: null, genreEventIds: null, empty: true }
    }
  }

  // Genre slug → event IDs (via artist → genre → event_artists)
  let genreEventIds: string[] | null = null
  if (filters.genre) {
    const { data: genreRow, error: genreErr } = await supabase
      .from('genres')
      .select('id')
      .eq('slug', filters.genre)
      .maybeSingle()
    if (genreErr) throw new Error(`[resolveFilterIds:genre] ${genreErr.message}`)
    if (genreRow) {
      const { data: artistRows, error: artistErr } = await supabase
        .from('artists')
        .select('id')
        .eq('genre_id', genreRow.id)
      if (artistErr) throw new Error(`[resolveFilterIds:artists] ${artistErr.message}`)
      const artistIds = (artistRows ?? []).map((a) => a.id as string)
      if (artistIds.length === 0) return { venueIds, genreEventIds: null, empty: true }
      const { data: eaRows, error: eaErr } = await supabase
        .from('event_artists')
        .select('event_id')
        .in('artist_id', artistIds)
      if (eaErr) throw new Error(`[resolveFilterIds:event_artists] ${eaErr.message}`)
      genreEventIds = Array.from(new Set((eaRows ?? []).map((ea) => ea.event_id as string)))
      if (genreEventIds.length === 0) return { venueIds, genreEventIds: null, empty: true }
    }
  }

  return { venueIds, genreEventIds, empty: false }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Most recent events.updated_at — proxy for last scraper run. ISO string or null. */
export async function getLastScrapedAt(): Promise<string | null> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('events')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error(`[getLastScrapedAt] ${error.message}`)
    return null
  }
  return data?.updated_at ?? null
}

/** Featured upcoming events (is_featured = true, ≥ today) */
export async function getFeaturedEvents(limit = 3): Promise<EventWithVenue[]> {
  const supabase = createServerClient()
  const today = getTodayJST()
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_SELECT)
    .eq('is_featured', true)
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`[getFeaturedEvents] ${error.message}`)
  return normalizeEvents(data ?? [])
}

/** Events happening today (JST) */
export async function getTonightEvents(limit = 10): Promise<EventWithVenue[]> {
  const supabase = createServerClient()
  const today = getTodayJST()
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_SELECT)
    .eq('event_date', today)
    .order('start_time', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`[getTonightEvents] ${error.message}`)
  return normalizeEvents(data ?? [])
}

/** Next N upcoming events after today */
export async function getUpcomingEvents(limit = 5): Promise<EventWithVenue[]> {
  const supabase = createServerClient()
  const today = getTodayJST()
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_SELECT)
    .gt('event_date', today)
    .order('event_date', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`[getUpcomingEvents] ${error.message}`)
  return normalizeEvents(data ?? [])
}

/** All upcoming events (≥ today), paginated */
export async function getAllUpcomingEvents(limit = 50, offset = 0): Promise<EventWithVenue[]> {
  const supabase = createServerClient()
  const today = getTodayJST()
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_SELECT)
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`[getAllUpcomingEvents] ${error.message}`)
  return normalizeEvents(data ?? [])
}

/**
 * Filtered upcoming events — used by the Search page.
 * Applies area, genre, date range, and price filters from URL params.
 */
export async function getFilteredEvents(
  filters: FilterParams = {},
  limit = 50,
  offset = 0,
): Promise<EventWithVenue[]> {
  const supabase = createServerClient()
  const today = getTodayJST()
  const dateFrom = filters.dateFrom ?? today

  const { venueIds, genreEventIds, empty } = await resolveFilterIds(supabase, filters)
  if (empty) return []

  // Build main query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('events')
    .select(EVENT_SELECT)
    .gte('event_date', dateFrom)
    .order('event_date', { ascending: true })
    .range(offset, offset + limit - 1)

  if (filters.dateTo) query = query.lte('event_date', filters.dateTo)
  if (filters.price === 'free') query = query.is('ticket_price_adv', null)
  if (filters.price === 'paid') query = query.not('ticket_price_adv', 'is', null)
  if (venueIds !== null) query = query.in('venue_id', venueIds)
  if (genreEventIds !== null) query = query.in('id', genreEventIds)

  // Free-text search. PostgREST .or() takes comma-separated filters, so we
  // strip characters that would break the parser or the LIKE pattern itself.
  if (filters.q && filters.q.trim()) {
    const term = filters.q
      .trim()
      .replace(/[,()*%_]/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
    if (term.length > 0) {
      const pat = `%${term}%`
      query = query.or(
        `title_en.ilike.${pat},title_ja.ilike.${pat},title_norm.ilike.${pat},title_raw.ilike.${pat}`,
      )
    }
  }

  const { data, error } = await query
  if (error) throw new Error(`[getFilteredEvents] ${error.message}`)
  return normalizeEvents(data ?? [])
}

/** Single event by slug — returns null if not found */
export async function getEventBySlug(slug: string): Promise<EventWithVenue | null> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_SELECT_FULL)
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(`[getEventBySlug] ${error.message}`)
  return data ? normalizeEvent(data) : null
}

/** All event slugs (for generateStaticParams) */
export async function getAllEventSlugs(): Promise<string[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase.from('events').select('slug')
  if (error) throw new Error(`[getAllEventSlugs] ${error.message}`)
  return (data ?? []).map((e) => e.slug).filter((s): s is string => s !== null)
}

/** Events for a given year/month (for the calendar view), with optional area/genre/price filters */
export async function getEventsForMonth(
  year: number,
  month: number,
  filters: Pick<FilterParams, 'area' | 'genre' | 'price'> = {},
): Promise<EventWithVenue[]> {
  const supabase = createServerClient()
  const mm = String(month).padStart(2, '0')
  const start = `${year}-${mm}-01`
  // Compute the real last day — invalid dates like 2026-04-31 cause a Postgres
  // error that is silently swallowed, returning 0 events for 30-day months.
  const lastDay = new Date(year, month, 0).getDate() // month is 1-indexed here
  const end = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`

  const { venueIds, genreEventIds, empty } = await resolveFilterIds(supabase, filters)
  if (empty) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('events')
    .select(EVENT_SELECT)
    .gte('event_date', start)
    .lte('event_date', end)
    .order('event_date', { ascending: true })

  if (filters.price === 'free') query = query.is('ticket_price_adv', null)
  if (filters.price === 'paid') query = query.not('ticket_price_adv', 'is', null)
  if (venueIds !== null) query = query.in('venue_id', venueIds)
  if (genreEventIds !== null) query = query.in('id', genreEventIds)

  const { data, error } = await query
  if (error) throw new Error(`[getEventsForMonth] ${error.message}`)
  return normalizeEvents(data ?? [])
}

/** All artists, A-Z */
export async function getAllArtists(): Promise<ArtistWithGenre[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('artists')
    .select('*, genre:genres(name_en, slug)')
    .order('name_en', { ascending: true })
  if (error) throw new Error(`[getAllArtists] ${error.message}`)
  return (data ?? []) as ArtistWithGenre[]
}

/** All venues */
export async function getAllVenues() {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('venues')
    .select('*, area:areas(name_en, name_ja, slug)')
    .order('name_en', { ascending: true })
  if (error) throw new Error(`[getAllVenues] ${error.message}`)
  return data ?? []
}

/** Single artist by slug with genre + upcoming events */
export async function getArtistBySlug(slug: string) {
  const supabase = createServerClient()
  const today = getTodayJST()

  const { data: artist, error: artistError } = await supabase
    .from('artists')
    .select('*, genre:genres(name_en, slug)')
    .eq('slug', slug)
    .maybeSingle()
  if (artistError) throw new Error(`[getArtistBySlug] ${artistError.message}`)
  if (!artist) return null

  // Fetch upcoming events this artist is billed on
  const { data: eventArtistRows, error: evError } = await supabase
    .from('event_artists')
    .select(`event:events(*, venue:venues(id, name_en, name_ja, slug, address_en, website_url, area:areas(name_en, name_ja, slug)))`)
    .eq('artist_id', artist.id)
  if (evError) throw new Error(`[getArtistBySlug:events] ${evError.message}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upcomingEvents: EventWithVenue[] = (eventArtistRows ?? [])
    .map((row: any) => row.event)
    .filter((e: any) => e && e.event_date >= today)
    .map(normalizeEvent)
    .sort((a: EventWithVenue, b: EventWithVenue) =>
      a.event_date.localeCompare(b.event_date)
    )

  return { ...artist, upcomingEvents }
}

/** All artist slugs (for generateStaticParams) */
export async function getAllArtistSlugs(): Promise<string[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase.from('artists').select('slug')
  if (error) throw new Error(`[getAllArtistSlugs] ${error.message}`)
  return (data ?? []).map((a) => a.slug)
}

/** Single venue by slug with area + upcoming events */
export async function getVenueBySlug(slug: string) {
  const supabase = createServerClient()
  const today = getTodayJST()

  const { data: venue, error: venueError } = await supabase
    .from('venues')
    .select('*, area:areas(name_en, name_ja, slug)')
    .eq('slug', slug)
    .maybeSingle()
  if (venueError) throw new Error(`[getVenueBySlug] ${venueError.message}`)
  if (!venue) return null

  const { data: events, error: evError } = await supabase
    .from('events')
    .select(EVENT_SELECT)
    .eq('venue_id', venue.id)
    .gte('event_date', today)
    .order('event_date', { ascending: true })
  if (evError) throw new Error(`[getVenueBySlug:events] ${evError.message}`)

  return { ...venue, upcomingEvents: normalizeEvents(events ?? []) }
}

/** All venue slugs (for generateStaticParams) */
export async function getAllVenueSlugs(): Promise<string[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase.from('venues').select('slug')
  if (error) throw new Error(`[getAllVenueSlugs] ${error.message}`)
  return (data ?? []).map((v) => v.slug)
}

/** All areas (for sidebar filter) */
export async function getAreas(): Promise<AreaOption[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('areas')
    .select('id, name_en, name_ja, slug')
    .order('name_en', { ascending: true })
  if (error) throw new Error(`[getAreas] ${error.message}`)
  return (data ?? []) as AreaOption[]
}

/** All genres (for sidebar filter) */
export async function getGenres(): Promise<GenreOption[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('genres')
    .select('id, name_en, slug')
    .order('name_en', { ascending: true })
  if (error) throw new Error(`[getGenres] ${error.message}`)
  return (data ?? []) as GenreOption[]
}

/**
 * All genres with upcoming event counts (for sidebar filter with counts).
 * Uses 4 queries: genres, genre-tagged artists, their event_artist rows, then
 * filters those events to upcoming-only. All sets are small (≤35 artists,
 * ≤~100 event IDs) so no URL-limit risk.
 */
export async function getGenresWithCounts(): Promise<GenreOptionWithCount[]> {
  const supabase = createServerClient()
  const today = getTodayJST()

  const [genresRes, artistsRes] = await Promise.all([
    supabase.from('genres').select('id, name_en, slug').order('name_en', { ascending: true }),
    supabase.from('artists').select('id, genre_id').not('genre_id', 'is', null),
  ])

  if (genresRes.error) throw new Error(`[getGenresWithCounts:genres] ${genresRes.error.message}`)
  const genres = (genresRes.data ?? []) as GenreOption[]
  const artistsWithGenre = (artistsRes.data ?? []) as { id: string; genre_id: number }[]

  if (!artistsWithGenre.length) return genres.map((g) => ({ ...g, upcoming_count: 0 }))

  const artistIds = artistsWithGenre.map((a) => a.id)
  const artistGenreMap = new Map(artistsWithGenre.map((a) => [a.id, a.genre_id]))

  // Get event_artist rows for genre-tagged artists
  const { data: eaRows, error: eaError } = await supabase
    .from('event_artists')
    .select('event_id, artist_id')
    .in('artist_id', artistIds)
  if (eaError) throw new Error(`[getGenresWithCounts:event_artists] ${eaError.message}`)

  // Build genre_id → Set<event_id>
  const genreEventMap = new Map<number, Set<string>>()
  for (const ea of eaRows ?? []) {
    const gid = artistGenreMap.get(ea.artist_id)
    if (!gid) continue
    if (!genreEventMap.has(gid)) genreEventMap.set(gid, new Set())
    genreEventMap.get(gid)!.add(ea.event_id)
  }

  const allEventIds = [...new Set((eaRows ?? []).map((ea) => ea.event_id as string))]
  if (!allEventIds.length) return genres.map((g) => ({ ...g, upcoming_count: 0 }))

  // Filter to upcoming events only
  const { data: upcomingRows, error: upError } = await supabase
    .from('events')
    .select('id')
    .in('id', allEventIds)
    .gte('event_date', today)
  if (upError) throw new Error(`[getGenresWithCounts:events] ${upError.message}`)
  const upcomingSet = new Set((upcomingRows ?? []).map((e) => e.id as string))

  // Count distinct upcoming events per genre
  const genreCounts = new Map<number, number>()
  for (const [gid, eventIds] of genreEventMap) {
    let count = 0
    for (const eid of eventIds) if (upcomingSet.has(eid)) count++
    genreCounts.set(gid, count)
  }

  return genres.map((g) => ({ ...g, upcoming_count: genreCounts.get(g.id) ?? 0 }))
}
