import { Sidebar } from "@/components/Sidebar";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getAllUpcomingEvents } from "@/lib/supabase/queries";
import { formatPrice, formatTime, formatEventDate, availLabel, availClasses, placeholderImage } from "@/lib/utils";

export const revalidate = 60;

export default async function SearchPage() {
  const events = await getAllUpcomingEvents(50);

  return (
    <>
      <Sidebar />
      <main className="flex-1 bg-surface-dim pb-20 md:pb-0">

        {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
        <div className="hidden md:flex items-center justify-between px-8 py-4 border-b border-outline-variant bg-surface-container-lowest">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-outline">
            <Link href="/" className="hover:text-primary transition-colors">ROOT</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-primary">EVENTS ({events.length})</span>
          </div>
          <div className="text-[10px] font-mono text-outline uppercase tracking-widest">
            SORT: [DATE_ASC]
          </div>
        </div>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <section className="p-4 md:p-8 border-b border-outline-variant bg-surface-container">
          <h1 className="text-3xl md:text-5xl font-black font-headline tracking-tighter uppercase leading-none">
            UPCOMING SHOWS / <br className="hidden md:block" />
            <span className="text-primary">ライブスケジュール</span>
          </h1>
          <p className="mt-4 text-on-surface-variant font-mono text-xs max-w-2xl leading-relaxed uppercase">
            ARCHIVING {events.length} UPCOMING EVENT{events.length !== 1 ? "S" : ""} IN THE GREATER OSAKA METROPOLITAN AREA.
            ALL TIMES JST.
          </p>
        </section>

        {/* ── Event List ──────────────────────────────────────────────────── */}
        {events.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-outline font-mono text-sm uppercase tracking-widest">No upcoming events found.</p>
          </div>
        ) : (
          <section className="divide-y divide-outline-variant border-b border-outline-variant">
            {events.map((event) => {
              const venue = event.venue;
              const genres = event.genres;
              const priceDisplay = event.ticket_price_adv
                ? `${formatPrice(event.ticket_price_adv)}${event.drink_charge ? " (+1 DRINK)" : ""}`
                : "FREE";

              return (
                <div
                  key={event.id}
                  className="flex flex-col md:flex-row group hover:bg-surface-container-high transition-colors"
                >
                  {/* Thumbnail */}
                  <div className="md:w-48 shrink-0 relative aspect-[16/9] md:aspect-square overflow-hidden border-b md:border-b-0 md:border-r border-outline-variant">
                    <Image
                      src={placeholderImage(event.slug, 400, 400)}
                      alt={event.title_en}
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
                          LIVE HOUSE: {venue.name_en}{venue.name_ja ? ` / ${venue.name_ja}` : ""}
                        </div>
                      )}
                      <Link href={`/event/${event.slug}`}>
                        <h2 className="text-xl md:text-2xl font-bold font-headline tracking-tight uppercase group-hover:text-primary transition-colors">
                          {event.title_en}
                        </h2>
                      </Link>
                      {genres.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {genres.map((g) => (
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
                        {event.doors_time && <div>OPEN: {formatTime(event.doors_time)}</div>}
                        {event.start_time && <div>START: {formatTime(event.start_time)}</div>}
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
                        className={`w-full md:w-auto px-6 py-2 border-2 font-headline font-bold text-xs uppercase transition-all text-center ${
                          event.availability === "sold_out"
                            ? "border-outline-variant text-outline hover:bg-surface-container-highest"
                            : "border-primary text-primary hover:bg-primary hover:text-on-primary"
                        }`}
                      >
                        VIEW DETAILS / 詳細
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
