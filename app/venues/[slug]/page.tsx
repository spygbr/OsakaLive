import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, MapPin, Users, ExternalLink, Instagram } from "lucide-react";
import { getVenueBySlug, getAllVenueSlugs } from "@/lib/supabase/queries";
import {
  placeholderImage,
  formatEventDate,
  formatTime,
  formatPrice,
  formatEventMonth,
  availLabel,
  availClasses,
} from "@/lib/utils";

export const revalidate = 60;

export async function generateStaticParams() {
  const slugs = await getAllVenueSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const venue = await getVenueBySlug(slug);
  if (!venue) return {};
  const area = venue.area?.name_en ?? "Osaka";
  const desc = venue.description_en
    ? venue.description_en.slice(0, 155)
    : `Live music at ${venue.name_en} in ${area}, Osaka. Upcoming shows, tickets, and venue info.`;
  return {
    title: `${venue.name_en} | ${area} Live Music Venue`,
    description: desc,
    alternates: { canonical: `https://osaka-live.net/venues/${slug}` },
    openGraph: {
      title: `${venue.name_en} — ${area} Live Music`,
      description: desc,
      url: `https://osaka-live.net/venues/${slug}`,
    },
  };
}

export default async function VenueDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const venue = await getVenueBySlug(slug);
  if (!venue) notFound();

  const { upcomingEvents } = venue;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const area = (venue as any).area as { name_en: string; name_ja: string; slug: string } | null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicVenue",
    name: venue.name_en,
    alternateName: venue.name_ja,
    address: {
      "@type": "PostalAddress",
      addressLocality: area?.name_en ?? "Osaka",
      addressCountry: "JP",
      streetAddress: (venue as any).address_en ?? undefined,
    },
    url: venue.website_url ?? `https://osaka-live.net/venues/${slug}`,
    ...(venue.capacity && { maximumAttendeeCapacity: venue.capacity }),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Sidebar />
      <main className="flex-1 bg-surface-dim pb-20 md:pb-0 overflow-x-hidden">

        {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
        <div className="hidden md:flex items-center gap-2 px-8 py-4 border-b border-outline-variant bg-surface-container-lowest font-mono text-[10px] uppercase tracking-widest text-outline">
          <Link href="/" className="hover:text-primary transition-colors">ROOT</Link>
          <ChevronRight className="w-3 h-3" />
          <Link href="/venues" className="hover:text-primary transition-colors">VENUES</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-primary">{venue.name_en}</span>
        </div>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="relative border-b-2 border-outline-variant">
          <div className="h-56 md:h-72 relative overflow-hidden">
            <Image
              src={venue.image_url ?? placeholderImage(venue.slug, 1200, 600)}
              alt={venue.name_en}
              fill
              className="object-cover grayscale brightness-40 contrast-125"
              unoptimized
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
          </div>

          <div className="absolute bottom-0 left-0 right-0 px-4 md:px-8 pb-6 md:pb-8">
            {area && (
              <p className="font-mono text-[10px] text-primary uppercase tracking-widest mb-2">
                {area.name_en} / {area.name_ja}
              </p>
            )}
            <h1 className="font-headline font-black text-4xl md:text-7xl tracking-tighter uppercase leading-none text-on-background">
              {venue.name_en}
            </h1>
            {venue.name_ja !== venue.name_en && (
              <p className="font-headline font-bold text-lg md:text-2xl text-outline mt-1">
                {venue.name_ja}
              </p>
            )}
          </div>
        </section>

        {/* ── Quick-info bar ───────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:flex-wrap gap-0 border-b border-outline-variant bg-surface-container md:divide-x divide-outline-variant divide-y md:divide-y-0">
          {venue.address_en && (
            <div className="flex items-center gap-2 px-4 md:px-6 py-3">
              <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="font-mono text-[10px] uppercase text-on-surface-variant">
                {venue.address_en}
              </span>
            </div>
          )}
          {venue.capacity && (
            <div className="flex items-center gap-2 px-4 md:px-6 py-3">
              <Users className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="font-mono text-[10px] uppercase text-on-surface-variant">
                CAP. {venue.capacity.toLocaleString()}
              </span>
            </div>
          )}
          {venue.website_url && (
            <a
              href={venue.website_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 md:px-6 py-3 hover:text-primary transition-colors group"
            >
              <ExternalLink className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="font-mono text-[10px] uppercase text-on-surface-variant group-hover:text-primary transition-colors">
                WEBSITE
              </span>
            </a>
          )}
          {venue.instagram_url && (
            <a
              href={venue.instagram_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 md:px-6 py-3 hover:text-primary transition-colors group"
            >
              <Instagram className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="font-mono text-[10px] uppercase text-on-surface-variant group-hover:text-primary transition-colors">
                INSTAGRAM
              </span>
            </a>
          )}
        </div>

        {/* ── Content grid ────────────────────────────────────────────────── */}
        <div className="md:grid md:grid-cols-12">

          {/* About — left column */}
          <section className="md:col-span-4 p-4 md:p-8 border-b md:border-b-0 md:border-r border-outline-variant">
            <h2 className="font-headline font-black text-sm tracking-widest uppercase text-outline mb-4">
              ABOUT / 会場について
            </h2>
            {venue.description_en ? (
              <p className="text-on-surface-variant text-sm leading-relaxed">
                {venue.description_en}
              </p>
            ) : (
              <p className="text-outline font-mono text-xs uppercase">No description available.</p>
            )}
            {venue.description_ja && (
              <p className="mt-4 text-on-surface-variant text-sm leading-relaxed border-t border-outline-variant pt-4">
                {venue.description_ja}
              </p>
            )}

            {/* Stats block */}
            <div className="mt-6 pt-6 border-t border-outline-variant grid grid-cols-2 gap-4">
              <div>
                <p className="font-mono text-[9px] text-outline uppercase tracking-widest">District</p>
                <p className="font-headline font-bold text-sm uppercase mt-1">{area?.name_en ?? "—"}</p>
              </div>
              <div>
                <p className="font-mono text-[9px] text-outline uppercase tracking-widest">Capacity</p>
                <p className="font-headline font-bold text-sm uppercase mt-1">
                  {venue.capacity ? venue.capacity.toLocaleString() : "—"}
                </p>
              </div>
              <div>
                <p className="font-mono text-[9px] text-outline uppercase tracking-widest">Upcoming</p>
                <p className="font-headline font-bold text-sm uppercase mt-1">
                  {upcomingEvents.length} SHOW{upcomingEvents.length !== 1 ? "S" : ""}
                </p>
              </div>
            </div>
          </section>

          {/* Upcoming shows — right column */}
          <section className="md:col-span-8 p-4 md:p-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-headline font-black text-sm tracking-widest uppercase text-outline">
                UPCOMING SHOWS / 今後のライブ
              </h2>
              <Link
                href={`/calendar`}
                className="font-mono text-[9px] text-outline hover:text-primary uppercase tracking-widest transition-colors"
              >
                VIEW CALENDAR →
              </Link>
            </div>

            {upcomingEvents.length === 0 ? (
              <div className="py-8 text-center border border-outline-variant">
                <p className="text-outline font-mono text-xs uppercase tracking-widest">
                  No upcoming shows at this venue.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-px bg-outline-variant border border-outline-variant">
                {upcomingEvents.map((event) => (
                  <Link
                    key={event.id}
                    href={`/event/${event.slug}`}
                    className="bg-surface-container hover:bg-surface-container-highest transition-colors p-4 flex gap-4 items-start group"
                  >
                    {/* Date block */}
                    <div className="shrink-0 w-14 text-center border-r border-outline-variant pr-4">
                      <p className="font-headline font-black text-xl text-primary leading-none">
                        {event.event_date.slice(8)}
                      </p>
                      <p className="font-mono text-[9px] text-outline uppercase mt-0.5">
                        {formatEventMonth(event.event_date).toUpperCase()}
                      </p>
                    </div>

                    {/* Event info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-[9px] text-outline uppercase mb-1">
                        {formatEventDate(event.event_date)}
                      </p>
                      <h3 className="font-headline font-bold text-base uppercase tracking-tight leading-tight group-hover:text-primary transition-colors">
                        {event.artists.length > 0
                          ? event.artists.map((a) => a.name_en).join(" + ")
                          : event.title_en}
                      </h3>
                      {event.artists.length > 0 && (
                        <p className="text-[10px] text-outline-variant uppercase font-mono mt-0.5 truncate">
                          {event.title_en}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                        {event.genres[0] && (
                          <span className="font-mono text-[10px] text-outline-variant uppercase">
                            {event.genres[0].name_en}
                          </span>
                        )}
                        {event.doors_time && (
                          <span className="font-mono text-[10px] text-outline-variant uppercase">
                            OPEN: {formatTime(event.doors_time)}
                          </span>
                        )}
                        {event.start_time && (
                          <span className="font-mono text-[10px] text-outline-variant uppercase">
                            START: {formatTime(event.start_time)}
                          </span>
                        )}
                        {event.ticket_price_adv != null && (
                          <span className="font-mono text-[10px] text-outline-variant uppercase">
                            ADV: {formatPrice(event.ticket_price_adv)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Availability */}
                    <span className={`shrink-0 px-2 py-0.5 text-[9px] font-bold uppercase ${availClasses(event.availability)}`}>
                      {availLabel(event.availability)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

      </main>
    </>
  );
}
