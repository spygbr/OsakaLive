import { Sidebar } from "@/components/Sidebar";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { getEventsForMonth } from "@/lib/supabase/queries";
import type { EventWithVenue } from "@/lib/supabase/queries";

export const revalidate = 60;

// ─── Constants ───────────────────────────────────────────────────────────────

const MONTH_NAMES_EN = [
  "JAN","FEB","MAR","APR","MAY","JUN",
  "JUL","AUG","SEP","OCT","NOV","DEC",
];
const MONTH_NAMES_JA = [
  "1月","2月","3月","4月","5月","6月",
  "7月","8月","9月","10月","11月","12月",
];
const DAY_NAMES = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTodayJST(): { year: number; month: number; day: number } {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function prevMonth(y: number, m: number) {
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

function nextMonth(y: number, m: number) {
  return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
}

/** Number of days in a given month (month is 1-based) */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Day-of-week (0=Sun) for the 1st of the month */
function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

function chipClasses(availability: string): string {
  if (availability === "sold_out")
    return "border-l-secondary-container opacity-60";
  if (availability === "waitlist")
    return "border-l-primary opacity-80";
  return "border-l-primary";
}

function chipTextClasses(availability: string): string {
  if (availability === "sold_out") return "text-secondary line-through";
  return "";
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const params = await searchParams;
  const today = getTodayJST();

  const year = params.year ? parseInt(params.year) : today.year;
  const month = params.month ? parseInt(params.month) : today.month;

  const events = await getEventsForMonth(year, month);

  // Group events by day number
  const eventsByDay = new Map<number, EventWithVenue[]>();
  for (const event of events) {
    const day = parseInt(event.event_date.slice(8, 10));
    if (!eventsByDay.has(day)) eventsByDay.set(day, []);
    eventsByDay.get(day)!.push(event);
  }

  const totalDays = daysInMonth(year, month);
  const leadingBlanks = firstDayOfWeek(year, month);
  const totalCells = Math.ceil((leadingBlanks + totalDays) / 7) * 7;
  const trailingBlanks = totalCells - leadingBlanks - totalDays;
  const numRows = totalCells / 7;

  const prev = prevMonth(year, month);
  const next = nextMonth(year, month);
  const isCurrentMonth = year === today.year && month === today.month;

  // Build ticker text from real sold-out events this month
  const soldOut = events.filter((e) => e.availability === "sold_out");
  const tickerText =
    soldOut.length > 0
      ? soldOut
          .map(
            (e) =>
              `SOLD OUT: ${e.artists[0]?.name_en ?? e.title_en} @ ${e.venue?.name_en ?? "—"}`
          )
          .join(" // ") + " // OSAKA LIVE HOUSE ARCHIVE V.2.04 //"
      : `OSAKA LIVE HOUSE ARCHIVE V.2.04 // ${events.length} EVENTS IN ${MONTH_NAMES_EN[month - 1]} ${year} //`;

  return (
    <>
      <Sidebar />
      <main className="flex-1 flex flex-col bg-surface overflow-hidden relative pb-20 md:pb-0">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 md:px-8 py-4 md:py-6 border-b border-outline-variant bg-surface-container-lowest">
          <div>
            <h1 className="font-headline text-3xl md:text-5xl font-black tracking-tighter text-on-surface uppercase">
              {MONTH_NAMES_EN[month - 1]} {year}{" "}
              <span className="text-primary opacity-50 text-xl md:text-3xl">
                / {year}年{MONTH_NAMES_JA[month - 1]}
              </span>
            </h1>
            <p className="text-[10px] font-mono text-outline uppercase mt-1 tracking-widest">
              {events.length} EVENT{events.length !== 1 ? "S" : ""} THIS MONTH
            </p>
          </div>

          <div className="flex gap-[2px]">
            <Link
              href={`/calendar?year=${prev.year}&month=${prev.month}`}
              className="bg-surface-container-highest p-2 md:p-3 border border-outline-variant hover:bg-primary hover:text-on-primary transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-5 h-5" />
            </Link>

            {!isCurrentMonth && (
              <Link
                href="/calendar"
                className="hidden md:flex items-center bg-surface-container-highest px-3 py-2 border border-outline-variant hover:bg-surface-container text-[9px] font-headline font-bold uppercase tracking-widest transition-colors"
              >
                TODAY
              </Link>
            )}

            <Link
              href={`/calendar?year=${next.year}&month=${next.month}`}
              className="bg-surface-container-highest p-2 md:p-3 border border-outline-variant hover:bg-primary hover:text-on-primary transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="w-5 h-5" />
            </Link>
          </div>
        </div>

        {/* ── Day-of-week labels ───────────────────────────────────────────── */}
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

        {/* ── Calendar grid ───────────────────────────────────────────────── */}
        <div
          className="flex-1 grid grid-cols-7 bg-outline-variant gap-[1px] overflow-y-auto"
          style={{ gridTemplateRows: `repeat(${numRows}, minmax(80px, 1fr))` }}
        >
          {/* Leading blanks — previous month overflow */}
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div
              key={`pre-${i}`}
              className="bg-surface-container-lowest opacity-25 p-1 md:p-2"
            />
          ))}

          {/* Days of this month */}
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
                {/* Day number */}
                <span
                  className={`font-headline font-bold text-xs md:text-sm leading-none shrink-0 ${
                    isToday ? "text-primary" : "text-on-surface"
                  }`}
                >
                  {String(dayNum).padStart(2, "0")}
                </span>

                {/* Event chips (max 3 visible on desktop, 1 on mobile) */}
                {dayEvents.slice(0, 3).map((event, idx) => {
                  const label =
                    event.artists[0]?.name_en ?? event.title_en;
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
                          {event.venue.name_en}
                        </span>
                      )}
                    </Link>
                  );
                })}

                {/* Overflow count */}
                {dayEvents.length > 3 && (
                  <span className="hidden md:block text-[8px] font-mono text-outline uppercase">
                    +{dayEvents.length - 3} more
                  </span>
                )}

                {/* Mobile: show count badge if multiple events */}
                {dayEvents.length > 1 && (
                  <span className="md:hidden text-[8px] font-mono text-primary uppercase">
                    ×{dayEvents.length}
                  </span>
                )}
              </div>
            );
          })}

          {/* Trailing blanks — next month overflow */}
          {Array.from({ length: trailingBlanks }).map((_, i) => (
            <div
              key={`post-${i}`}
              className="bg-surface-container-lowest opacity-25 p-1 md:p-2"
            />
          ))}
        </div>

        {/* ── Ticker ──────────────────────────────────────────────────────── */}
        <div className="h-8 bg-surface-container-highest border-t border-outline-variant flex items-center overflow-hidden whitespace-nowrap shrink-0">
          <div className="animate-[marquee_30s_linear_infinite] inline-block font-headline text-[10px] uppercase tracking-widest text-primary px-4">
            {tickerText}
          </div>
        </div>

      </main>
    </>
  );
}
