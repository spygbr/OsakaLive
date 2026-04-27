import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ExternalLink, Instagram } from "lucide-react";
import { getArtistBySlug, getAllArtistSlugs } from "@/lib/supabase/queries";
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
  const slugs = await getAllArtistSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);
  if (!artist) return {};
  const genre = artist.genre?.name_en ?? "music";
  const desc = artist.bio_en
    ? artist.bio_en.slice(0, 155)
    : `${artist.name_en} — ${genre} artist playing live in Osaka. Upcoming shows, tour dates & tickets.`;
  return {
    title: `${artist.name_en} | Osaka Live`,
    description: desc,
    alternates: { canonical: `https://osaka-live.net/artists/${slug}` },
    openGraph: {
      title: `${artist.name_en} — Live in Osaka`,
      description: desc,
      url: `https://osaka-live.net/artists/${slug}`,
    },
  };
}

export default async function ArtistDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);
  if (!artist) notFound();

  const { upcomingEvents } = artist;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: artist.name_en,
    ...(artist.name_ja && { alternateName: artist.name_ja }),
    ...(artist.genre?.name_en && { genre: artist.genre.name_en }),
    ...(artist.bio_en && { description: artist.bio_en }),
    url: `https://osaka-live.net/artists/${artist.slug}`,
    ...(artist.image_url && { image: artist.image_url }),
    sameAs: [artist.website_url, artist.instagram_url].filter(Boolean),
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
          <Link href="/artists" className="hover:text-primary transition-colors">ARTISTS</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-primary">{artist.name_en}</span>
        </div>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="relative border-b-2 border-outline-variant">
          <div className="h-56 md:h-80 relative overflow-hidden">
            <Image
              src={artist.image_url ?? placeholderImage(artist.slug, 1200, 600)}
              alt={artist.name_en}
              fill
              className="object-cover grayscale brightness-40 contrast-125"
              unoptimized
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          </div>

          <div className="absolute bottom-0 left-0 right-0 px-4 md:px-8 pb-6 md:pb-8">
            {artist.genre && (
              <p className="font-mono text-[10px] text-primary uppercase tracking-widest mb-2">
                {artist.genre.name_en}
              </p>
            )}
            <h1 className="font-headline font-black text-4xl md:text-7xl tracking-tighter uppercase leading-none text-on-background">
              {artist.name_en}
            </h1>
            {artist.name_ja && (
              <p className="font-headline font-bold text-lg md:text-2xl text-outline mt-1">
                {artist.name_ja}
              </p>
            )}

            {/* Social links */}
            <div className="flex gap-3 mt-4">
              {artist.website_url && (
                <a
                  href={artist.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 bg-surface-container border border-outline-variant px-3 py-3 md:py-1.5 min-h-[44px] font-mono text-[10px] uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  WEBSITE
                </a>
              )}
              {artist.instagram_url && (
                <a
                  href={artist.instagram_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 bg-surface-container border border-outline-variant px-3 py-3 md:py-1.5 min-h-[44px] font-mono text-[10px] uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
                >
                  <Instagram className="w-3 h-3" />
                  INSTAGRAM
                </a>
              )}
            </div>
          </div>
        </section>

        {/* ── Content grid ────────────────────────────────────────────────── */}
        <div className="md:grid md:grid-cols-12">

          {/* Bio — left column */}
          <section className="md:col-span-5 p-4 md:p-8 border-b md:border-b-0 md:border-r border-outline-variant">
            <h2 className="font-headline font-black text-sm tracking-widest uppercase text-outline mb-4">
              ABOUT / プロフィール
            </h2>
            {artist.bio_en ? (
              <details className="group/bio">
                <summary className="md:hidden list-none cursor-pointer">
                  <p className="text-on-surface-variant text-sm leading-relaxed line-clamp-4 group-open/bio:line-clamp-none">
                    {artist.bio_en}
                  </p>
                  <span className="group-open/bio:hidden mt-1 inline-block text-[10px] font-mono text-primary uppercase">
                    READ MORE ▼
                  </span>
                  <span className="hidden group-open/bio:inline-block mt-1 text-[10px] font-mono text-outline uppercase">
                    SHOW LESS ▲
                  </span>
                </summary>
                <p className="hidden md:block text-on-surface-variant text-sm leading-relaxed">
                  {artist.bio_en}
                </p>
              </details>
            ) : (
              <p className="text-outline font-mono text-xs uppercase">No biography available.</p>
            )}
            {artist.bio_ja && (
              <p className="mt-4 text-on-surface-variant text-sm leading-relaxed border-t border-outline-variant pt-4">
                {artist.bio_ja}
              </p>
            )}
          </section>

          {/* Upcoming shows — right column */}
          <section className="md:col-span-7 p-4 md:p-8">
            <h2 className="font-headline font-black text-sm tracking-widest uppercase text-outline mb-4">
              UPCOMING SHOWS / 今後のライブ
            </h2>

            {upcomingEvents.length === 0 ? (
              <div className="py-8 text-center border border-outline-variant">
                <p className="text-outline font-mono text-xs uppercase tracking-widest">
                  No upcoming shows scheduled.
                </p>
                <Link
                  href="/calendar"
                  className="mt-3 inline-block text-primary font-headline font-bold text-xs uppercase border-b border-primary"
                >
                  Browse Calendar →
                </Link>
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
                    <div className="shrink-0 w-16 text-center border-r border-outline-variant pr-4">
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
                      <h3 className="font-headline font-bold text-base uppercase tracking-tight leading-tight group-hover:text-primary transition-colors truncate">
                        {event.title_en}
                      </h3>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                        {event.venue && (
                          <span className="font-mono text-[10px] text-outline-variant uppercase">
                            {event.venue.name_en}
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
