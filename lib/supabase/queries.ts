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
}

export type AreaOption = { id: number; name_en: string; name_ja: string; slug: string }
export type GenreOption = { id: number; name_en: string; slug: string }

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
  area: { name_en: string; name_ja: string; slug: string } | null
}

export type EventArtist = {
  name_en: string
  name_ja: string | null
  slug: string
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
  genre: { name_en: string; slug: string } | null
}

// ---------------------------------------------------------------------------
// Normalise raw Supabase join shapes
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEvent(raw: any): EventWithVenue {
  return {
    ...raw,
    venue: raw.venue ?? null,
    genres: (raw.event_genres ?? [])
      .map((eg: any) => eg.genre)
      .filter(Boolean),
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
  event_genres(genre:genres(name_en, slug)),
  event_artists(billing_order, artist:artists(name_en, name_ja, slug))
`

const EVENT_SELECT_FULL = `
  *,
  venue:venues(id, name_en, name_ja, slug, address_en, address_ja, website_url, area:areas(name_en, name_ja, slug)),
  event_genres(genre:genres(name_en, slug)),
  event_artists(billing_order, artist:artists(name_en, name_ja, slug, bio_en))
`

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

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
  if (error) console.error('[getFeaturedEvents]', error.message)
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
  if (error) console.error('[getTonightEvents]', error.message)
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
  if (error) console.error('[getUpcomingEvents]', error.message)
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
  if (error) console.error('[getAllUpcomingEvents]', error.message)
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
  if (filters.price === 'free') return []

  const supabase = createServerClient()
  const today = getTodayJST()
  const dateFrom = filters.dateFrom ?? today

  // Resolve optional venue IDs (area filter)
  let venueIds: string[] | null = null
  if (filters.area) {
    const { data: areaRow } = await supabase
      .from('areas')
      .select('id')
      .eq('slug', filters.area)
      .maybeSingle()
    if (areaRow) {
      const { data: venueRows } = await supabase
        .from('venues')
        .select('id')
        .eq('area_id', areaRow.id)
      venueIds = (venueRows ?? []).map((v) => v.id)
      if (venueIds.length === 0) return [] // area exists but has no venues
    }
  }

  // Resolve optional event IDs (genre filter)
  let genreEventIds: string[] | null = null
  if (filters.genre) {
    const { data: genreRow } = await supabase
      .from('genres')
      .select('id')
      .eq('slug', filters.genre)
      .maybeSingle()
    if (genreRow) {
      const { data: egRows } = await supabase
        .from('event_genres')
        .select('event_id')
        .eq('genre_id', genreRow.id)
      genreEventIds = (egRows ?? []).map((eg) => eg.event_id as string)
      if (genreEventIds.length === 0) return [] // genre exists but has no events
    }
  }

  // Build main query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('events')
    .select(EVENT_SELECT)
    .gte('event_date', dateFrom)
    .order('event_date', { ascending: true })
    .range(offset, offset + limit - 1)

  if (filters.dateTo) query = query.lte('event_date', filters.dateTo)
  if (filters.price === 'paid') {
    query = query.or('ticket_price_adv.gt.0,ticket_price_door.gt.0')
  }
  if (venueIds !== null) query = query.in('venue_id', venueIds)
  if (genreEventIds !== null) query = query.in('id', genreEventIds)

  const { data, error } = await query
  if (error) console.error('[getFilteredEvents]', error.message)
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
  if (error) console.error('[getEventBySlug]', error.message)
  return data ? normalizeEvent(data) : null
}

/** All event slugs (for generateStaticParams) */
export async function getAllEventSlugs(): Promise<string[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase.from('events').select('slug')
  if (error) console.error('[getAllEventSlugs]', error.message)
  return (data ?? []).map((e) => e.slug)
}

/** Events for a given year/month (for the calendar view), with optional area/genre/price filters */
export async function getEventsForMonth(
  year: number,
  month: number,
  filters: Pick<FilterParams, 'area' | 'genre' | 'price'> = {},
): Promise<EventWithVenue[]> {
  if (filters.price === 'free') return []

  const supabase = createServerClient()
  const mm = String(month).padStart(2, '0')
  const start = `${year}-${mm}-01`
  // Compute the real last day — invalid dates like 2026-04-31 cause a Postgres
  // error that is silently swallowed, returning 0 events for 30-day months.
  const lastDay = new Date(year, month, 0).getDate() // month is 1-indexed here
  const end = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`

  // Resolve optional venue IDs (area filter)
  let venueIds: string[] | null = null
  if (filters.area) {
    const { data: areaRow } = await supabase
      .from('areas')
      .select('id')
      .eq('slug', filters.area)
      .maybeSingle()
    if (areaRow) {
      const { data: venueRows } = await supabase
        .from('venues')
        .select('id')
        .eq('area_id', areaRow.id)
      venueIds = (venueRows ?? []).map((v) => v.id)
      if (venueIds.length === 0) return []
    }
  }

  // Resolve optional event IDs (genre filter)
  let genreEventIds: string[] | null = null
  if (filters.genre) {
    const { data: genreRow } = await supabase
      .from('genres')
      .select('id')
      .eq('slug', filters.genre)
      .maybeSingle()
    if (genreRow) {
      const { data: egRows } = await supabase
        .from('event_genres')
        .select('event_id')
        .eq('genre_id', genreRow.id)
      genreEventIds = (egRows ?? []).map((eg) => eg.event_id as string)
      if (genreEventIds.length === 0) return []
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('events')
    .select(EVENT_SELECT)
    .gte('event_date', start)
    .lte('event_date', end)
    .order('event_date', { ascending: true })

  if (filters.price === 'paid') {
    query = query.or('ticket_price_adv.gt.0,ticket_price_door.gt.0')
  }
  if (venueIds !== null) query = query.in('venue_id', venueIds)
  if (genreEventIds !== null) query = query.in('id', genreEventIds)

  const { data, error } = await query
  if (error) console.error('[getEventsForMonth]', error.message)
  return normalizeEvents(data ?? [])
}

/** All artists, A-Z */
export async function getAllArtists(): Promise<ArtistWithGenre[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('artists')
    .select('*, genre:genres(name_en, slug)')
    .order('name_en', { ascending: true })
  if (error) console.error('[getAllArtists]', error.message)
  return (data ?? []) as ArtistWithGenre[]
}

/** All venues */
export async function getAllVenues() {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('venues')
    .select('*, area:areas(name_en, name_ja, slug)')
    .order('name_en', { ascending: true })
  if (error) console.error('[getAllVenues]', error.message)
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
  if (artistError) console.error('[getArtistBySlug]', artistError.message)
  if (!artist) return null

  // Fetch upcoming events this artist is billed on
  const { data: eventArtistRows, error: evError } = await supabase
    .from('event_artists')
    .select(`event:events(${EVENT_SELECT})`)
    .eq('artist_id', artist.id)
  if (evError) console.error('[getArtistBySlug:events]', evError.message)

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
  if (error) console.error('[getAllArtistSlugs]', error.message)
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
  if (venueError) console.error('[getVenueBySlug]', venueError.message)
  if (!venue) return null

  const { data: events, error: evError } = await supabase
    .from('events')
    .select(EVENT_SELECT)
    .eq('venue_id', venue.id)
    .gte('event_date', today)
    .order('event_date', { ascending: true })
  if (evError) console.error('[getVenueBySlug:events]', evError.message)

  return { ...venue, upcomingEvents: normalizeEvents(events ?? []) }
}

/** All venue slugs (for generateStaticParams) */
export async function getAllVenueSlugs(): Promise<string[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase.from('venues').select('slug')
  if (error) console.error('[getAllVenueSlugs]', error.message)
  return (data ?? []).map((v) => v.slug)
}

/** All areas (for sidebar filter) */
export async function getAreas(): Promise<AreaOption[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('areas')
    .select('id, name_en, name_ja, slug')
    .order('name_en', { ascending: true })
  if (error) console.error('[getAreas]', error.message)
  return (data ?? []) as AreaOption[]
}

/** All genres (for sidebar filter) */
export async function getGenres(): Promise<GenreOption[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('genres')
    .select('id, name_en, slug')
    .order('name_en', { ascending: true })
  if (error) console.error('[getGenres]', error.message)
  return (data ?? []) as GenreOption[]
}
