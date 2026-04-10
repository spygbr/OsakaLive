import Link from "next/link";
import type { EventWithVenue } from "@/lib/supabase/queries";
import type { Lang } from "@/lib/i18n/translations";

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function chipClasses(availability: string): string {
  if (availability === "sold_out")
    return "border-l-secondary-container opacity-60";
  if (availability === "waitlist") return "border-l-primary opacity-80";
  return "border-l-primary";
}

function chipTextClasses(availability: string): string {
  if (availability === "sold_out") return "text-secondary line-through";
  return "";
}

interface CalendarDesktopProps {
  year: number;
  month: number;
  events: EventWithVenue[];
  today: { year: number; month: number; day: number };
  lang: Lang;
  numRows: number;
  leadingBlanks: number;
  totalDays: number;
  trailingBlanks: number;
  tickerText: string;
  className?: string;
}

export function CalendarDesktop({
  year,
  month,
  events,
  today,
  lang,
  numRows,
  leadingBlanks,
  totalDays,
  trailingBlanks,
  tickerText,
  className = "",
}: CalendarDesktopProps) {
  const isCurrentMonth = year === today.year && month === today.month;

  // Group events by day
  const eventsByDay = new Map<number, EventWithVenue[]>();
  for (const event of events) {
    const day = parseInt(event.event_date.slice(8, 10));
    if (!eventsByDay.has(day)) eventsByDay.set(day, []);
    eventsByDay.get(day)!.push(event);
  }

  return (
    <div className={`hidden md:flex flex-col flex-1 overflow-hidden ${className}`}>
      {/* ── Day-of-week labels ─────────────────────────────────────────── */}
      <div className="grid grid-cols-7 border-b border-outline-variant bg-surface-container-low shrink-0">
        {DAY_NAMES.map((day) => (
          <div
            key={day}
            className="py-2 text-center font-headline text-xs font-bold text-outline border-r border-outline-variant last:border-r-0"
          >
            {day}
          </div>
        ))}
      </div>

      {/* ── Calendar grid ─────────────────────────────────────────────── */}
      <div
        className="flex-1 grid grid-cols-7 bg-outline-variant gap-[1px] overflow-y-auto"
        style={{ gridTemplateRows: `repeat(${numRows}, minmax(80px, 1fr))` }}
      >
        {/* Leading blanks */}
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div
            key={`pre-${i}`}
            className="bg-surface-container-lowest opacity-25 p-1 md:p-2"
          />
        ))}

        {/* Days */}
        {Array.from({ length: totalDays }).map((_, i) => {
          const dayNum = i + 1;
          const dayEvents = eventsByDay.get(dayNum) ?? [];
          const isToday = isCurrentMonth && dayNum === today.day;

          return (
            <div
              key={dayNum}
              className={`flex flex-col gap-[3px] p-1 md:p-2 transition-colors group ${
                isToday
                  ? "bg-surface-container-highest border-2 border-primary z-10"
                  : "bg-surface-container hover:bg-surface-container-highest"
              }`}
            >
              <span
                className={`font-headline font-bold text-xs md:text-sm leading-none shrink-0 ${
                  isToday ? "text-primary" : "text-on-surface"
                }`}
              >
                {String(dayNum).padStart(2, "0")}
              </span>

              {dayEvents.slice(0, 3).map((event, idx) => {
                const label =
                  lang === "ja"
                    ? (event.artists[0]?.name_ja ??
                      event.artists[0]?.name_en ??
                      event.title_ja ??
                      event.title_en)
                    : (event.artists[0]?.name_en ?? event.title_en);
                return (
                  <Link
                    key={event.id}
                    href={`/event/${event.slug}`}
                    className={`bg-surface-container-high px-1 py-[2px] border-l-2 hover:opacity-70 transition-opacity block ${chipClasses(event.availability)} ${idx > 0 ? "hidden md:block" : ""}`}
                    title={event.title_en}
                  >
                    <span
                      className={`font-headline text-[8px] md:text-[9px] uppercase leading-none block truncate ${chipTextClasses(event.availability)}`}
                    >
                      {event.availability === "sold_out" ? "✕ " : ""}
                      {label}
                    </span>
                    {event.venue && (
                      <span className="hidden md:block font-mono text-[7px] text-outline truncate uppercase">
                        {lang === "ja"
                          ? event.venue.name_ja
                          : event.venue.name_en}
                      </span>
                    )}
                  </Link>
                );
              })}

              {dayEvents.length > 3 && (
                <span className="hidden md:block text-[8px] font-mono text-outline uppercase">
                  +{dayEvents.length - 3} more
                </span>
              )}
            </div>
          );
        })}

        {/* Trailing blanks */}
        {Array.from({ length: trailingBlanks }).map((_, i) => (
          <div
            key={`post-${i}`}
            className="bg-surface-container-lowest opacity-25 p-1 md:p-2"
          />
        ))}
      </div>

      {/* ── Ticker ────────────────────────────────────────────────────── */}
      <div className="h-8 bg-surface-container-highest border-t border-outline-variant flex items-center overflow-hidden whitespace-nowrap shrink-0">
        <div className="animate-[marquee_30s_linear_infinite] inline-block font-headline text-[10px] uppercase tracking-widest text-primary px-4">
          {tickerText}
        </div>
      </div>
    </div>
  );
}
