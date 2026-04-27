import { Sidebar } from "@/components/Sidebar";
import { SearchFilterChips } from "@/components/SearchFilterChips";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  getFilteredEvents,
  getAreas,
  getGenresWithCounts,
  type FilterParams,
} from "@/lib/supabase/queries";
import {
  formatPrice,
  formatTime,
  formatEventDate,
  availLabel,
  availClasses,
  placeholderImage,
} from "@/lib/utils";
import { getLang } from "@/lib/i18n/server";
import { createT } from "@/lib/i18n/translations";

export const revalidate = 60;

type SearchPageProps = {
  searchParams: Promise<{
    area?: string;
    genre?: string;
    date_from?: string;
    date_to?: string;
    price?: string;
    q?: string;
  }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const lang = await getLang();
  const t = createT(lang);

  const filters: FilterParams = {
    area: params.area || undefined,
    genre: params.genre || undefined,
    dateFrom: params.date_from || undefined,
    dateTo: params.date_to || undefined,
    price:
      params.price === "free" ? "free"
      : params.price === "paid" ? "paid"
      : undefined,
    q: params.q || undefined,
  };

  const [events, areas, genres] = await Promise.all([
    getFilteredEvents(filters, 50),
    getAreas(),
    getGenresWithCounts(),
  ]);

  const hasFilters = Object.values(filters).some(Boolean);

  const eventTitle = (ev: { title_en: string; title_ja: string | null }) =>
    (lang === 'ja' && ev.title_ja) ? ev.title_ja : ev.title_en;
  const venueName = (v: { name_en: string; name_ja: string } | null) =>
    v ? (lang === 'ja' ? `${v.name_ja}` : v.name_en) : '—';

  return (
    <>
      <Sidebar areas={areas} genres={genres} />
      <main className="flex-1 bg-surface-dim pb-20 md:pb-0">

        {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
        <div className="hidden md:flex items-center justify-between px-8 py-4 border-b border-outline-variant bg-surface-container-lowest">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-outline">
            <Link href="/" className="hover:text-primary transition-colors">{t('breadcrumb_root')}</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-primary">
              {t('breadcrumb_events')} ({events.length}){hasFilters ? ` ${t('breadcrumb_filtered')}` : ""}
            </span>
          </div>
          <div className="text-[10px] font-mono text-outline uppercase tracking-widest">
            {t('search_sortDate')}
          </div>
        </div>

        {/* ── Mobile filter chips + count strip ───────────────────────────── */}
        <SearchFilterChips areas={areas} genres={genres} eventCount={events.length} />

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <section className="p-4 md:p-8 border-b border-outline-variant bg-surface-container">
          <h1 className="text-3xl md:text-5xl font-black font-headline tracking-tighter uppercase leading-none">
            {t('search_heading')} / <br className="hidden md:block" />
            <span className="text-primary">{t('search_subheading')}</span>
          </h1>
          <p className="mt-4 text-on-surface-variant font-mono text-xs max-w-2xl leading-relaxed uppercase">
            {hasFilters
              ? `${events.length} ${t('search_filtered')}`
              : `${t('search_archiving').replace('UPCOMING EVENTS', `${events.length} UPCOMING EVENT${events.length !== 1 ? 'S' : ''}`)}`}
          </p>
          {filters.q && (
            <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-primary">
              {lang === 'ja' ? '検索' : 'Searching'}: &quot;{filters.q}&quot;
            </p>
          )}
        </section>

        {/* ── Event List ──────────────────────────────────────────────────── */}
        {events.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-outline font-mono text-sm uppercase tracking-widest">
              {hasFilters ? t('search_noMatch') : t('search_noEvents')}
            </p>
            {hasFilters && filters.genre && genres.find(g => g.slug === filters.genre)?.upcoming_count === 0 && (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-outline max-w-sm mx-auto">
                {t('search_genreSparse')}
              </p>
            )}
            {hasFilters && (
              <Link
                href="/search"
                className="mt-4 inline-block text-[10px] font-mono text-primary hover:underline uppercase tracking-widest"
              >
                {t('search_clearFilters')}
              </Link>
            )}
          </div>
        ) : (
          <section className="divide-y divide-outline-variant border-b border-outline-variant">
            {events.map((event) => {
              const venue = event.venue;
              const eventGenres = event.genres;
              const priceDisplay = event.ticket_price_adv
                ? `${formatPrice(event.ticket_price_adv)}${event.drink_charge ? " (+1 DRINK)" : ""}`
                : lang === 'ja' ? "料金要確認" : "¥ TBA";

              return (
                <div
                  key={event.id}
                  className="flex flex-col md:flex-row group hover:bg-surface-container-high transition-colors"
                >
                  {/* Thumbnail */}
                  <div className="md:w-48 shrink-0 relative aspect-[2/1] md:aspect-square overflow-hidden border-b md:border-b-0 md:border-r border-outline-variant">
                    <Image
                      src={placeholderImage(event.slug, 400, 400)}
                      alt={eventTitle(event)}
                      fill
                      className="object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
                      unoptimized
                    />
                    <div className="absolute top-0 left-0 bg-primary text-on-primary text-[10px] font-bold px-2 py-1 font-mono">
                      {formatEventDate(event.event_date).split(" ")[0]}
                    </div>
                  </div>

                  {/* Details */}
                  <div className="flex-1 p-4 md:p-6 grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 items-center">
                    {/* Title + venue + genres */}
                    <div className="md:col-span-5">
                      {venue && (
                        <div className="text-[10px] text-primary font-bold uppercase tracking-widest mb-1">
                          {t('search_liveHouse')}: {venueName(venue)}{venue.name_ja && lang === 'en' ? ` / ${venue.name_ja}` : ''}
                        </div>
                      )}
                      <Link href={`/event/${event.slug}`}>
                        <h2 className="text-xl md:text-2xl font-bold font-headline tracking-tight uppercase group-hover:text-primary transition-colors">
                          {eventTitle(event)}
                        </h2>
                      </Link>
                      {eventGenres.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {eventGenres.map((g) => (
                            <span
                              key={g.slug}
                              className="text-[9px] px-1 border border-outline text-outline uppercase"
                            >
                              {g.name_en}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Time + price */}
                    <div className="md:col-span-3 font-mono text-xs uppercase leading-tight text-on-surface-variant flex md:block justify-between items-center">
                      <div>
                        {event.doors_time && <div>{t('event_open')}: {formatTime(event.doors_time)}</div>}
                        {event.start_time && <div>{t('event_start')}: {formatTime(event.start_time)}</div>}
                      </div>
                      <div className="md:mt-2 text-primary font-bold">{priceDisplay}</div>
                    </div>

                    {/* Availability + CTA */}
                    <div className="md:col-span-4 flex flex-col items-start md:items-end gap-3">
                      <div className={`text-[10px] font-black px-3 py-1 tracking-widest uppercase ${availClasses(event.availability)}`}>
                        {availLabel(event.availability)}
                      </div>
                      <Link
                        href={`/event/${event.slug}`}
                        className={`w-full md:w-auto px-3 md:px-6 py-2 border-2 font-headline font-bold text-xs uppercase transition-all text-center ${
                          event.availability === "sold_out"
                            ? "border-outline-variant text-outline hover:bg-surface-container-highest"
                            : "border-primary text-primary hover:bg-primary hover:text-on-primary"
                        }`}
                      >
                        {t('search_viewDetails')} / {lang === 'en' ? '詳細' : 'Details'}
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </main>
    </>
  );
}
