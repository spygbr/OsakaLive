import { Sidebar } from "@/components/Sidebar";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Star, ArrowRight } from "lucide-react";
import { getFeaturedEvents, getTonightEvents, getUpcomingEvents } from "@/lib/supabase/queries";
import { formatTime, formatPrice, formatEventDateShort, availLabel, availClasses, placeholderImage } from "@/lib/utils";
import { getLang } from "@/lib/i18n/server";
import { createT } from "@/lib/i18n/translations";

export const revalidate = 60; // ISR: refresh every 60 seconds

export default async function Home() {
  const lang = await getLang();
  const t = createT(lang);

  const [featuredEvents, tonightEvents, upcomingEvents] = await Promise.all([
    getFeaturedEvents(3),
    getTonightEvents(10),
    getUpcomingEvents(4),
  ]);

  const hero = featuredEvents[0];

  // Helper: pick the right language field
  const title = (ev: { title_en: string; title_ja: string | null }) =>
    (lang === 'ja' && ev.title_ja) ? ev.title_ja : ev.title_en;
  const artistName = (a: { name_en: string; name_ja: string | null }) =>
    (lang === 'ja' && a.name_ja) ? a.name_ja : a.name_en;
  const venueName = (v: { name_en: string; name_ja: string } | null) =>
    v ? (lang === 'ja' ? v.name_ja : v.name_en) : '—';

  return (
    <>
      <Sidebar />
      <main className="flex-1 bg-surface-container-lowest overflow-x-hidden pb-20 md:pb-0">

        {/* ── Mobile Hero ─────────────────────────────────────────────────── */}
        <section className="md:hidden relative w-full aspect-square overflow-hidden">
          {hero ? (
            <>
              <Image
                src={placeholderImage(hero.slug, 800, 800)}
                alt={title(hero)}
                fill
                className="object-cover grayscale brightness-50"
                unoptimized
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6">
                <span className={`inline-block px-2 py-0.5 text-xs font-bold font-headline mb-2 uppercase tracking-widest ${availClasses(hero.availability)}`}>
                  {availLabel(hero.availability)}
                </span>
                <h2 className="text-4xl font-black font-headline text-primary-container leading-none uppercase tracking-tighter mb-1">
                  {title(hero)}
                </h2>
                {hero.title_ja && lang === 'en' && (
                  <p className="text-xl font-bold font-headline text-white/90">{hero.title_ja}</p>
                )}
              </div>
            </>
          ) : (
            <div className="w-full h-full bg-surface-container flex items-center justify-center">
              <p className="text-outline font-mono text-xs uppercase">{t('home_noEventsTonight')}</p>
            </div>
          )}
        </section>

        {/* ── Desktop Hero: Featured Shows ────────────────────────────────── */}
        <section className="hidden md:block border-b-2 border-outline-variant">
          <div className="p-6 flex justify-between items-end border-b border-outline-variant bg-surface">
            <div>
              <h2 className="text-4xl font-black font-headline tracking-tighter text-on-background uppercase">
                {t('home_featuredShows')}
              </h2>
              <p className="text-primary font-mono text-xs mt-1 uppercase">
                {t('home_featuredSubtitle')}
              </p>
            </div>
            <div className="flex gap-2">
              <button className="w-10 h-10 border border-outline-variant hover:bg-surface-container-highest flex items-center justify-center">
                <ChevronLeft className="w-6 h-6 text-on-surface" />
              </button>
              <button className="w-10 h-10 border border-outline-variant hover:bg-surface-container-highest flex items-center justify-center">
                <ChevronRight className="w-6 h-6 text-on-surface" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {featuredEvents.map((event, i) => {
              const genres = event.genres.map((g) => g.name_en).join(" / ");
              const artistLine = event.artists.map((a) => artistName(a)).join(" + ") || title(event);
              const venue = event.venue;
              return (
                <Link
                  key={event.id}
                  href={`/event/${event.slug}`}
                  className={`${i === 2 ? "hidden lg:block" : ""} border-r border-outline-variant relative group cursor-pointer block`}
                >
                  <div className="aspect-[4/5] bg-surface-container overflow-hidden relative">
                    <Image
                      src={placeholderImage(event.slug, 600, 800)}
                      alt={title(event)}
                      fill
                      className="object-cover filter contrast-125 grayscale group-hover:grayscale-0 transition-all duration-500"
                      unoptimized
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-80" />
                  </div>
                  <div className="absolute top-4 left-4 flex flex-col gap-1">
                    <span className={`px-2 py-1 font-headline font-bold text-[10px] tracking-widest uppercase ${availClasses(event.availability)}`}>
                      {availLabel(event.availability)}
                    </span>
                    {event.is_featured && (
                      <span className="bg-primary text-on-primary px-2 py-1 font-headline font-bold text-[10px] tracking-widest uppercase">
                        {t('home_featured')}
                      </span>
                    )}
                  </div>
                  <div className="p-5 absolute bottom-0 w-full border-t border-outline-variant bg-surface/90 backdrop-blur-sm">
                    {genres && (
                      <p className="text-primary font-mono text-[10px] mb-1 uppercase">{genres}</p>
                    )}
                    <h3 className="text-2xl font-black font-headline leading-none tracking-tight mb-2 uppercase">
                      {artistLine}
                    </h3>
                    <div className="grid grid-cols-2 gap-4 border-t border-outline-variant pt-3">
                      <div>
                        <p className="text-[9px] text-outline font-bold uppercase">{t('event_venue')}</p>
                        <p className="text-xs font-bold text-on-surface uppercase">{venueName(venue)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-outline font-bold uppercase">{t('event_open')} / {t('event_start')}</p>
                        <p className="text-xs font-bold text-on-surface uppercase">
                          {formatTime(event.doors_time)} / {formatTime(event.start_time)}
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}

            {/* Fill empty slots if fewer than 3 featured events */}
            {featuredEvents.length < 2 && (
              <div className="border-r border-outline-variant bg-surface-container-low hidden md:flex items-center justify-center aspect-[4/5]">
                <p className="text-outline font-mono text-xs uppercase">{t('home_moreEventsSoon')}</p>
              </div>
            )}
          </div>
        </section>

        {/* ── Desktop Main Grid ──────────────────────────────────────────── */}
        <div className="hidden md:grid grid-cols-1 lg:grid-cols-12">

          {/* Happening Tonight — wide column */}
          <section className="lg:col-span-8 border-r border-outline-variant">
            <div className="p-4 bg-surface-container-low border-b border-outline-variant flex justify-between items-center">
              <h3 className="font-headline font-black text-sm tracking-widest text-on-surface uppercase">
                {t('home_happeningSubtitle')}
              </h3>
              <span className="text-[10px] font-mono text-outline uppercase">
                {tonightEvents.length} EVENT{tonightEvents.length !== 1 ? "S" : ""} LISTED
              </span>
            </div>

            {tonightEvents.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-outline font-mono text-xs uppercase tracking-widest">{t('home_noEventsTonight')}</p>
                <Link href="/search" className="mt-4 inline-block text-primary font-headline font-bold text-xs uppercase border-b border-primary">
                  {t('home_browseUpcoming')}
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-outline-variant">
                {tonightEvents.map((event) => (
                  <Link
                    key={event.id}
                    href={`/event/${event.slug}`}
                    className="flex hover:bg-surface-container transition-colors group"
                  >
                    <div className="w-24 h-24 bg-surface-container-highest shrink-0 overflow-hidden grayscale group-hover:grayscale-0 relative">
                      <Image
                        src={placeholderImage(event.slug, 200, 200)}
                        alt={title(event)}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    <div className="flex-1 p-3 flex flex-col justify-center">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[10px] text-primary font-bold uppercase">
                            {venueName(event.venue)}
                          </p>
                          <h4 className="font-headline font-bold text-lg tracking-tight uppercase">
                            {event.artists.map((a) => artistName(a)).join(" + ") || title(event)}
                          </h4>
                        </div>
                        <span className={`px-2 py-0.5 text-[9px] font-bold uppercase ${availClasses(event.availability)}`}>
                          {availLabel(event.availability)}
                        </span>
                      </div>
                      <div className="flex gap-6 mt-2">
                        {event.genres[0] && (
                          <p className="text-[11px] font-mono text-outline-variant uppercase">
                            {t('common_genre')}: {event.genres[0].name_en}
                          </p>
                        )}
                        {event.start_time && (
                          <p className="text-[11px] font-mono text-outline-variant uppercase">
                            {t('common_start')}: {formatTime(event.start_time)}
                          </p>
                        )}
                        {event.ticket_price_adv && (
                          <p className="text-[11px] font-mono text-outline-variant uppercase">
                            {t('common_price')}: {formatPrice(event.ticket_price_adv)}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            <Link
              href="/search"
              className="w-full py-4 bg-surface font-headline font-bold text-xs tracking-[0.2em] border-t border-outline-variant hover:bg-surface-container transition-colors uppercase flex items-center justify-center"
            >
              {t('home_viewAllUpcoming')}
            </Link>
          </section>

          {/* Upcoming — narrow column */}
          <section className="lg:col-span-4 bg-surface-container-lowest">
            <div className="p-4 bg-surface-container-low border-b border-outline-variant">
              <h3 className="font-headline font-black text-sm tracking-widest text-on-surface uppercase">
                {t('home_upcomingSubtitle')}
              </h3>
            </div>
            <div className="p-4 flex flex-col gap-4">
              {upcomingEvents.map((event) => (
                <Link
                  key={event.id}
                  href={`/event/${event.slug}`}
                  className="border border-outline-variant bg-surface p-3 group block"
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="bg-outline-variant text-on-surface px-1.5 py-0.5 text-[9px] font-bold">
                      {formatEventDateShort(event.event_date)}
                    </span>
                    {event.is_featured && <Star className="w-4 h-4 text-primary fill-primary" />}
                  </div>
                  <h5 className="font-headline font-bold text-base leading-tight mb-1 group-hover:text-primary transition-colors uppercase">
                    {title(event)}
                  </h5>
                  <p className="text-[10px] text-outline uppercase mb-2">{venueName(event.venue)}</p>
                  <div className="h-[1px] w-full bg-outline-variant mb-2" />
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-mono text-on-surface-variant">
                      {t('common_adv')}: {formatPrice(event.ticket_price_adv)}
                    </span>
                    <span className="text-[9px] font-black uppercase text-primary border-b border-primary">
                      {t('common_details')}
                    </span>
                  </div>
                </Link>
              ))}
            </div>

            {/* Promo block */}
            <div className="m-4 border-2 border-primary p-4 bg-surface-container relative overflow-hidden">
              <div className="absolute top-0 right-0 p-2 bg-primary text-on-primary font-bold text-[8px]">{t('common_promo')}</div>
              <p className="font-headline font-black text-xl leading-none text-primary italic mb-2 uppercase">
                {lang === 'ja'
                  ? 'RECORD SHOP ROUGH TRADE 大阪がオープン'
                  : 'RECORD SHOP ROUGH TRADE OSAKA NOW OPEN'}
              </p>
              <p className="text-[10px] text-on-surface leading-snug uppercase">
                {lang === 'ja'
                  ? '心斎橋にて日本限定ノイズ盤が入手可能。'
                  : 'VISIT US IN SHINSAIBASHI FOR EXCLUSIVE JAPANESE NOISE PRESSINGS.'}
              </p>
              <div className="mt-4 flex justify-between items-end">
                <span className="text-[8px] font-mono text-outline uppercase">LOC: SHINSAIBASHI 2-14-1</span>
                <ArrowRight className="w-5 h-5 text-primary" />
              </div>
            </div>
          </section>
        </div>

        {/* ── Mobile: Happening Tonight ───────────────────────────────────── */}
        <section className="md:hidden mt-6 px-4">
          <div className="flex justify-between items-center mb-4 border-b border-primary-container/50 pb-2">
            <h2 className="text-lg font-black font-headline tracking-tighter uppercase text-primary">
              {t('home_happeningSubtitle')}
            </h2>
            <span className="text-[10px] font-bold text-secondary-container animate-pulse uppercase">
              {tonightEvents.length > 0 ? t('home_liveNow') : t('home_checkCalendar')}
            </span>
          </div>

          {tonightEvents.length > 0 ? (
            <div className="flex flex-col gap-px bg-primary-container/20 border border-primary-container/20">
              {tonightEvents.map((event) => (
                <Link
                  key={event.id}
                  href={`/event/${event.slug}`}
                  className="bg-black p-3 flex items-center gap-4 hover:bg-red-900/10 transition-colors"
                >
                  <div className="flex flex-col items-center min-w-[60px] border-r border-primary-container/30 pr-3">
                    <span className="text-sm font-black font-headline text-primary">
                      {formatTime(event.start_time)}
                    </span>
                    <span className="text-[9px] font-bold text-outline uppercase tracking-tighter">{t('event_start')}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start">
                      <h4 className="text-sm font-bold uppercase tracking-tight">
                        {event.artists[0] ? artistName(event.artists[0]) : title(event)}
                      </h4>
                      <span className={`text-[9px] px-1 font-bold uppercase ${availClasses(event.availability)}`}>
                        {availLabel(event.availability)}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-1 items-center">
                      <span className="text-[10px] font-bold text-primary-container">
                        {venueName(event.venue)}
                      </span>
                      {event.genres[0] && (
                        <>
                          <span className="w-1 h-1 bg-primary-container/50 rounded-full" />
                          <span className="text-[10px] text-outline">{event.genres[0].name_en}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-black">{formatPrice(event.ticket_price_adv)}</div>
                    {event.drink_charge && (
                      <div className="text-[8px] text-outline">+1 Drink</div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="border border-primary-container/20 p-8 text-center">
              <p className="text-outline font-mono text-xs uppercase">{t('home_noEventsTonight')}</p>
              <Link href="/search" className="mt-3 inline-block text-primary font-headline font-bold text-xs uppercase border-b border-primary">
                {t('home_browseUpcoming')}
              </Link>
            </div>
          )}

          <Link
            href="/search"
            className="w-full mt-4 border border-primary-container py-3 font-headline font-black text-xs uppercase tracking-[0.2em] flex items-center justify-center active:bg-primary-container active:text-black transition-colors"
          >
            {t('home_viewAllUpcoming')}
          </Link>
        </section>

        {/* ── Desktop: Browse by District ─────────────────────────────────── */}
        <section className="hidden md:block border-t-2 border-outline-variant bg-surface p-6">
          <div className="mb-6">
            <h3 className="font-headline font-black text-2xl tracking-tighter uppercase">
              {t('home_browseSubtitle')}
            </h3>
            <div className="h-1 w-24 bg-primary mt-1" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { num: "01", en: "NAMBA",        ja: "難波" },
              { num: "02", en: "UMEDA",        ja: "梅田" },
              { num: "03", en: "AMERICAMURA",  ja: "アメリカ村" },
              { num: "04", en: "SHINSAIBASHI", ja: "心斎橋" },
            ].map((area) => (
              <Link
                key={area.en}
                href="/search"
                className="aspect-square bg-surface-container border border-outline-variant p-4 flex flex-col justify-between hover:bg-primary group transition-all"
              >
                <span className="font-headline font-black text-4xl text-outline-variant group-hover:text-on-primary/20">
                  {area.num}
                </span>
                <div className="text-right">
                  <p className="font-headline font-bold text-lg leading-none group-hover:text-on-primary uppercase">
                    {lang === 'ja' ? area.ja : area.en}
                  </p>
                  <p className="text-[10px] font-mono text-outline group-hover:text-on-primary/70 uppercase">
                    {lang === 'ja' ? area.en : area.ja}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>

      </main>
    </>
  );
}
