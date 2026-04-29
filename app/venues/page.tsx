import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight, MapPin, Users } from "lucide-react";
import { getAllVenues } from "@/lib/supabase/queries";
import { placeholderImage } from "@/lib/utils";
import { getLang } from "@/lib/i18n/server";
import { createT } from "@/lib/i18n/translations";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Venues | Osaka Live House Guide",
  description:
    "Browse all live music venues in Osaka. Discover live houses by district, capacity, and upcoming shows.",
  alternates: { canonical: "https://osaka-live.net/venues" },
};

export default async function VenuesPage() {
  const venues = await getAllVenues();
  const lang = await getLang();
  const t = createT(lang);

  const venueName = (v: { name_en: string; name_ja: string }) =>
    lang === "ja" ? v.name_ja : v.name_en;

  // Group by area
  const byArea: Record<string, typeof venues> = {};
  for (const venue of venues) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const areaName = (venue as any).area?.name_en ?? "Other";
    if (!byArea[areaName]) byArea[areaName] = [];
    byArea[areaName].push(venue);
  }
  const areaNames = Object.keys(byArea).sort();

  return (
    <>
      <Sidebar />
      <main className="flex-1 bg-surface-dim pb-20 md:pb-0 overflow-x-hidden">

        {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
        <div className="hidden md:flex items-center justify-between px-8 py-4 border-b border-outline-variant bg-surface-container-lowest">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-outline">
            <Link href="/" className="hover:text-primary transition-colors">
              {t("breadcrumb_root")}
            </Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-primary">
              {t("breadcrumb_venues")} ({venues.length})
            </span>
          </div>
          <div className="text-[10px] font-mono text-outline uppercase tracking-widest">
            {lang === "ja" ? "エリア別" : "BY DISTRICT"}
          </div>
        </div>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <section className="p-4 md:p-8 border-b border-outline-variant bg-surface-container">
          <h1 className="text-3xl md:text-5xl font-black font-headline tracking-tighter uppercase leading-none">
            {lang === "ja" ? "会場 /" : "VENUES /"}{" "}
            <br className="hidden md:block" />
            <span className="text-primary">
              {lang === "ja" ? "大阪のライブハウス" : "OSAKA LIVE HOUSES"}
            </span>
          </h1>
          <p className="mt-4 text-on-surface-variant font-mono text-xs max-w-2xl leading-relaxed uppercase">
            {lang === "ja"
              ? `大阪の ${venues.length} 会場を掲載。ライブハウス、クラブ、ミュージックバーなど。`
              : `${venues.length} venues across Osaka — live houses, clubs, and music bars.`}
          </p>
        </section>

        {/* ── Venue Grid ──────────────────────────────────────────────────── */}
        {areaNames.map((area) => (
          <section key={area} className="border-b border-outline-variant">
            {/* Area header */}
            <div className="px-4 md:px-8 py-3 bg-surface-container-lowest border-b border-outline-variant">
              <h2 className="font-mono text-[10px] uppercase tracking-widest text-outline">
                <span className="text-primary font-bold">{area}</span>
                {" "}— {byArea[area].length}{" "}
                {byArea[area].length === 1 ? "VENUE" : "VENUES"}
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:gap-px bg-outline-variant/30">
              {byArea[area].map((venue) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const areaData = (venue as any).area as { name_en: string; name_ja: string; slug: string } | null;
                return (
                  <Link
                    key={venue.id}
                    href={`/venues/${venue.slug}`}
                    className="group flex flex-col bg-surface-container hover:bg-surface-container-high transition-colors border border-outline-variant/0"
                  >
                    {/* Thumbnail */}
                    <div className="relative aspect-[16/9] overflow-hidden border-b border-outline-variant">
                      <Image
                        src={venue.image_url ?? placeholderImage(venue.slug, 600, 338)}
                        alt={venueName(venue)}
                        fill
                        className="object-cover grayscale group-hover:grayscale-0 transition-all duration-500 brightness-75"
                        unoptimized
                      />
                      {areaData && (
                        <div className="absolute top-2 left-2 bg-black/70 text-primary text-[9px] font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
                          {areaData.name_en}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-4 flex-1 flex flex-col gap-2">
                      <h3 className="font-headline font-black text-lg uppercase tracking-tight leading-tight group-hover:text-primary transition-colors">
                        {venueName(venue)}
                      </h3>
                      {venue.name_ja !== venue.name_en && (
                        <p className="font-headline text-sm text-outline -mt-1">
                          {lang === "en" ? venue.name_ja : venue.name_en}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-3 mt-auto pt-2">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(venue as any).address_en && (
                          <div className="flex items-center gap-1 text-[10px] font-mono text-on-surface-variant uppercase">
                            <MapPin className="w-3 h-3 text-primary shrink-0" />
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(venue as any).address_en}
                          </div>
                        )}
                        {venue.capacity && (
                          <div className="flex items-center gap-1 text-[10px] font-mono text-on-surface-variant uppercase">
                            <Users className="w-3 h-3 text-primary shrink-0" />
                            CAP. {venue.capacity.toLocaleString()}
                          </div>
                        )}
                      </div>

                      <div className="mt-2 text-[9px] font-mono text-primary uppercase tracking-widest group-hover:underline">
                        {lang === "ja" ? "詳細を見る →" : "VIEW VENUE →"}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
