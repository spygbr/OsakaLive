import { Sidebar } from "@/components/Sidebar";
import { MobileTicketBar } from "@/components/MobileTicketBar";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, MapPin, Calendar, Clock, Ticket, Share2, ExternalLink, CalendarPlus } from "lucide-react";
import { getEventBySlug, getAllEventSlugs } from "@/lib/supabase/queries";
import { formatTime, formatPrice, formatEventDate, availLabel, availClasses, placeholderImage } from "@/lib/utils";
import { getLang } from "@/lib/i18n/server";
import { createT } from "@/lib/i18n/translations";

export const revalidate = 60;

export async function generateStaticParams() {
  const slugs = await getAllEventSlugs();
  return slugs.map((slug) => ({ id: slug }));
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: slug } = await params;
  const lang = await getLang();
  const t = createT(lang);
  const event = await getEventBySlug(slug);

  if (!event) notFound();

  const venue = event.venue;
  const genres = event.genres;
  const artists = event.artists;

  const eventTitle = (lang === "ja" && event.title_ja) ? event.title_ja : event.title_en;
  const eventDesc = (lang === "ja" && event.description_ja) ? event.description_ja : event.description_en;
  const artistName = (a: { name_en: string; name_ja: string | null }) =>
    (lang === "ja" && a.name_ja) ? a.name_ja : a.name_en;
  const venueName = venue
    ? (lang === "ja"
        ? `${venue.name_ja} / ${venue.name_en}`
        : `${venue.name_en} / ${venue.name_ja}`)
    : "—";
  const venueNameShort = venue
    ? (lang === "ja" ? venue.name_ja : venue.name_en)
    : "—";

  const billingLabel = (i: number, total: number) => {
    if (i === 0) return t("event_headliner");
    if (i === total - 1) return t("event_support");
    return t("event_specialGuest");
  };

  // ── Calendar export URLs ───────────────────────────────────────────────────
  const gcalDate = event.event_date.replace(/-/g, '');
  const gcalVenue = venue ? `${venue.name_en}, Osaka` : 'Osaka';
  const gcalUrl =
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(eventTitle)}` +
    `&dates=${gcalDate}/${gcalDate}` +
    `&location=${encodeURIComponent(gcalVenue)}` +
    (eventDesc ? `&details=${encodeURIComponent(eventDesc.slice(0, 500))}` : '');
  const icalUrl = `/api/event/${event.slug}/ical`;

  return (
    <>
      <Sidebar />
      <main className="flex-1 bg-surface-dim pb-32 md:pb-0 overflow-x-hidden">

        {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
        <div className="hidden md:flex items-center justify-between px-8 py-4 border-b border-outline-variant bg-surface-container-lowest">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-outline">
            <Link href="/" className="hover:text-primary transition-colors">{t("breadcrumb_root")}</Link>
            <ChevronRight className="w-3 h-3" />
            <Link href="/search" className="hover:text-primary transition-colors">{t("breadcrumb_events")}</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-primary truncate max-w-[200px]">{event.slug.toUpperCase()}</span>
          </div>
          <div className="text-[10px] font-mono text-outline uppercase tracking-widest">
            {t("common_status")}: [{availLabel(event.availability)}]
          </div>
        </div>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="relative w-full aspect-[16/9] md:aspect-[21/9] bg-surface-container-highest border-b border-outline-variant">
          <Image
            src={placeholderImage(event.slug, 1400, 600)}
            alt={eventTitle}
            fill
            className="object-cover grayscale contrast-125 mix-blend-luminosity opacity-60"
            unoptimized
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />

          <div className="absolute bottom-0 left-0 w-full p-4 md:p-8">
            <div className="flex flex-wrap gap-2 mb-3 md:mb-4">
              {event.is_featured && (
                <span className="bg-primary text-on-primary font-headline font-bold text-[10px] px-2 py-1 uppercase tracking-widest">
                  {t("home_featured")}
                </span>
              )}
              {genres.map((g) => (
                <span key={g.slug} className="border border-outline text-outline font-headline font-bold text-[10px] px-2 py-1 uppercase tracking-widest">
                  {g.name_en}
                </span>
              ))}
            </div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-black font-headline tracking-tighter uppercase leading-none text-on-background mb-2">
              {eventTitle}
            </h1>
            {artists.length > 0 && (
              <p className="text-lg md:text-2xl font-bold font-headline text-on-surface-variant uppercase tracking-tight">
                {artists.map((a) => artistName(a)).join(" / ")}
              </p>
            )}
          </div>
        </section>

        {/* ── Main Content Grid ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12">

          {/* Left Column */}
          <section className="lg:col-span-8 border-r border-outline-variant">

            {/* Quick Info Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-outline-variant border-b border-outline-variant bg-surface-container-low">
              <div className="p-4 flex flex-col gap-1">
                <span className="text-[10px] font-mono text-primary uppercase tracking-widest flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> {t("event_date")}
                </span>
                <span className="font-headline font-bold text-sm uppercase">
                  {formatEventDate(event.event_date)}
                </span>
              </div>
              <div className="p-4 flex flex-col gap-1">
                <span className="text-[10px] font-mono text-primary uppercase tracking-widest flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {t("event_time")}
                </span>
                <span className="font-headline font-bold text-sm uppercase">
                  {t("event_open")} {formatTime(event.doors_time)} / {t("event_start")} {formatTime(event.start_time)}
                </span>
              </div>
              <div className="p-4 flex flex-col gap-1">
                <span className="text-[10px] font-mono text-primary uppercase tracking-widest flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {t("event_venue")}
                </span>
                <span className="font-headline font-bold text-sm uppercase">
                  {venueName}
                </span>
              </div>
              <div className="p-4 flex flex-col gap-1">
                <span className="text-[10px] font-mono text-primary uppercase tracking-widest flex items-center gap-1">
                  <Ticket className="w-3 h-3" /> {t("event_price")}
                </span>
                <span className="font-headline font-bold text-sm uppercase">
                  {`${t("common_adv")} ${formatPrice(event.ticket_price_adv)} / DOOR ${formatPrice(event.ticket_price_door)}`}
                  {(event.ticket_price_adv === 0 || event.ticket_price_door === 0)
                    ? t("event_freeEntry")
                    : `${t("common_adv")} ${formatPrice(event.ticket_price_adv)} / DOOR ${formatPrice(event.ticket_price_door)}`}
                </span>
              </div>
            </div>

            {/* Description — collapsible on mobile, open by default */}
            {eventDesc && (
              <details className="border-b border-outline-variant group" open>
                <summary className="md:hidden flex items-center justify-between p-4 cursor-pointer list-none font-headline font-black text-sm uppercase text-primary">
                  {t("event_details")}
                  <span className="text-outline group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="p-6 md:p-8 md:block">
                  <h3 className="hidden md:block font-headline font-black text-xl tracking-tighter uppercase mb-4 text-primary">
                    {t("event_details")} / {lang === "en" ? "イベント詳細" : "EVENT DETAILS"}
                  </h3>
                  <div className="prose prose-invert prose-p:font-body prose-p:text-on-surface-variant prose-p:leading-relaxed prose-p:text-sm max-w-none">
                    {eventDesc.split("\n").map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                </div>
              </details>
            )}

            {/* Lineup — collapsible on mobile, open by default */}
            {artists.length > 0 && (
              <details className="border-b border-outline-variant bg-surface-container-lowest group" open>
                <summary className="md:hidden flex items-center justify-between p-4 cursor-pointer list-none font-headline font-black text-sm uppercase text-primary">
                  {t("event_lineup")}
                  <span className="text-outline group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="p-6 md:p-8 md:block">
                  <h3 className="hidden md:block font-headline font-black text-xl tracking-tighter uppercase mb-6 text-primary">
                    {t("event_lineup")} / {lang === "en" ? "出演者" : "LINEUP"}
                  </h3>
                  <div className="flex flex-col gap-4">
                    {artists.map((artist, i) => (
                      <div key={artist.slug} className="flex items-center gap-4 group/artist">
                        <div className="w-16 h-16 bg-surface-container-highest relative overflow-hidden shrink-0">
                          <Image
                            src={placeholderImage(artist.slug, 200, 200)}
                            alt={artistName(artist)}
                            fill
                            className="object-cover grayscale group-hover/artist:grayscale-0 transition-all"
                            unoptimized
                          />
                        </div>
                        <div className="flex-1 border-b border-outline-variant pb-4 group-hover/artist:border-primary transition-colors">
                          <h4 className="font-headline font-bold text-2xl uppercase tracking-tight group-hover/artist:text-primary transition-colors">
                            {artistName(artist)}
                          </h4>
                          <p className="font-mono text-[10px] text-outline uppercase tracking-widest">
                            {billingLabel(i, artists.length)}
                          </p>
                        </div>
                        <ChevronRight className="w-6 h-6 text-outline group-hover/artist:text-primary transition-colors" />
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            )}

            {/* Timetable — collapsible on mobile, closed by default */}
            <details className="group">
              <summary className="md:hidden flex items-center justify-between p-4 cursor-pointer list-none font-headline font-black text-sm uppercase text-primary border-b border-outline-variant">
                {t("event_timetable")}
                <span className="text-outline group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="p-6 md:p-8 md:block">
                <h3 className="hidden md:block font-headline font-black text-xl tracking-tighter uppercase mb-6 text-primary">
                  {t("event_timetable")} / {lang === "en" ? "タイムテーブル" : "TIMETABLE"}
                </h3>
                <div className="relative border-l-2 border-outline-variant ml-4 md:ml-8 flex flex-col gap-8 pb-4">
                  <div className="relative pl-6">
                    <div className="absolute w-3 h-3 bg-background border-2 border-primary rounded-full -left-[7.5px] top-1.5" />
                    <p className="font-mono text-xs text-primary font-bold mb-1">
                      {formatTime(event.doors_time)}
                    </p>
                    <p className="font-headline font-bold uppercase">{t("event_doorsOpen")}</p>
                  </div>
                  {artists.map((artist, i) => (
                    <div key={artist.slug} className="relative pl-6">
                      <div
                        className={`absolute w-3 h-3 rounded-full -left-[7.5px] top-1.5 ${
                          i === 0
                            ? "bg-primary shadow-[0_0_10px_rgba(242,202,80,0.5)]"
                            : "bg-outline-variant"
                        }`}
                      />
                      <p
                        className={`font-mono text-xs mb-1 font-bold ${i === 0 ? "text-primary" : "text-outline"}`}
                      >
                        {billingLabel(i, artists.length)}
                      </p>
                      <p
                        className={`font-headline font-bold uppercase ${
                          i === 0
                            ? "text-2xl text-primary font-black"
                            : "text-lg"
                        }`}
                      >
                        {artistName(artist)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </details>

          </section>

          {/* Right Column — sticky */}
          <section className="lg:col-span-4 bg-surface">
            <div className="sticky top-16 flex flex-col">

              {/* Ticket Box */}
              <div className="p-6 md:p-8 border-b border-outline-variant bg-surface-container-low">
                <div
                  className={`text-center py-1 text-[10px] font-black uppercase tracking-widest mb-6 ${availClasses(event.availability)}`}
                >
                  {availLabel(event.availability)}
                </div>

                {event.ticket_price_adv != null && (
                  <div className="flex justify-between items-end mb-6">
                    <div>
                      <p className="text-[10px] font-mono text-outline uppercase mb-1">{t("event_advTicket")}</p>
                      <p className="font-headline font-black text-4xl leading-none">
                        {formatPrice(event.ticket_price_adv)}
                      </p>
                    </div>
                    {event.drink_charge && (
                      <p className="text-[10px] font-mono text-outline uppercase">
                        + 1 DRINK ({formatPrice(event.drink_charge)})
                      </p>
                    )}
                  </div>
                )}

                {event.ticket_url ? (
                  <a
                    href={event.ticket_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full bg-primary text-on-primary font-headline font-black py-4 text-lg uppercase tracking-widest hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2 mb-4"
                  >
                    <Ticket className="w-5 h-5" />
                    {t("event_reserveTicket")}
                  </a>
                ) : (
                  <button
                    disabled
                    className="w-full bg-surface-container-highest text-outline font-headline font-black py-4 text-lg uppercase tracking-widest flex items-center justify-center gap-2 mb-4 cursor-not-allowed"
                  >
                    <Ticket className="w-5 h-5" />
                    {event.availability === "sold_out"
                      ? t("event_soldOut")
                      : t("event_ticketsAtDoor")}
                  </button>
                )}

                <p className="text-[10px] font-mono text-outline-variant text-center uppercase">
                  {t("event_reserveNote")}
                </p>
              </div>

              {/* Venue Info */}
              {venue && (
                <div className="p-6 md:p-8 border-b border-outline-variant">
                  <h3 className="font-headline font-black text-sm tracking-widest uppercase mb-4 text-outline">
                    {t("event_venueInfo")}
                  </h3>
                  <div className="flex items-start gap-4 mb-6">
                    <div className="w-12 h-12 bg-surface-container-highest flex items-center justify-center shrink-0">
                      <MapPin className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <Link
                        href={`/venues/${venue.slug}`}
                        className="font-headline font-bold text-lg uppercase leading-tight hover:text-primary transition-colors"
                      >
                        {venueName}
                      </Link>
                      {venue.address_en && (
                        <p className="font-mono text-[10px] text-outline uppercase mt-1">
                          {venue.address_en}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Map placeholder */}
                  <div className="w-full aspect-video bg-surface-container-highest relative overflow-hidden border border-outline-variant group cursor-pointer mb-4">
                    <Image
                      src={placeholderImage(`${venue.slug}-map`, 600, 300)}
                      alt={`Map of ${venue.name_en}`}
                      fill
                      className="object-cover grayscale opacity-50 group-hover:opacity-80 transition-opacity"
                      unoptimized
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="bg-background/80 px-3 py-1 font-headline font-bold text-xs uppercase tracking-widest border border-outline-variant flex items-center gap-2">
                        {t("event_openInMaps")} <ExternalLink className="w-3 h-3" />
                      </span>
                    </div>
                  </div>

                  {venue.website_url && (
                    <a
                      href={venue.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 border border-outline-variant py-2 font-headline font-bold text-[10px] uppercase tracking-widest hover:bg-surface-container transition-colors text-center block"
                    >
                      {t("event_venueWebsite")}
                    </a>
                  )}
                </div>
              )}

              {/* Add to Calendar */}
              <div className="p-6 md:p-8 border-b border-outline-variant">
                <h3 className="font-headline font-black text-sm tracking-widest uppercase mb-4 text-outline">
                  Add to Calendar
                </h3>
                <div className="flex flex-col gap-2">
                  <a
                    href={gcalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 border border-outline-variant py-2 px-3 font-headline font-bold text-[10px] uppercase tracking-widest hover:bg-surface-container hover:border-primary hover:text-primary transition-colors"
                  >
                    <CalendarPlus className="w-3.5 h-3.5 shrink-0" />
                    Google Calendar
                  </a>
                  <a
                    href={icalUrl}
                    download={`${event.slug}.ics`}
                    className="flex items-center gap-2 border border-outline-variant py-2 px-3 font-headline font-bold text-[10px] uppercase tracking-widest hover:bg-surface-container hover:border-primary hover:text-primary transition-colors"
                  >
                    <CalendarPlus className="w-3.5 h-3.5 shrink-0" />
                    Apple / iCal (.ics)
                  </a>
                </div>
              </div>

              {/* Share */}
              <div className="p-6 md:p-8 flex items-center justify-between">
                <span className="font-headline font-bold text-xs uppercase tracking-widest text-outline">
                  {t("event_shareEvent")}
                </span>
                <button className="text-outline hover:text-primary transition-colors">
                  <Share2 className="w-5 h-5" />
                </button>
              </div>

            </div>
          </section>
        </div>
      </main>

      {/* ── Mobile Sticky Ticket Bar ─────────────────────────────────────── */}
      <MobileTicketBar
        eventTitle={eventTitle}
        venueName={venueNameShort}
        eventDate={formatEventDate(event.event_date)}
        ticketUrl={event.ticket_url}
        ticketPriceAdv={event.ticket_price_adv}
        availability={event.availability}
        reserveLabel={t("event_reserveTicket")}
        soldOutLabel={t("event_soldOut")}
        atDoorLabel={t("event_ticketsAtDoor")}
      />
    </>
  );
}
