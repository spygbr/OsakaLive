import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Live Music Calendar | Upcoming Shows in Osaka",
  description: "Browse upcoming live music events in Osaka by date. Punk, metal, jazz, electronic and more at Namba, Shinsaibashi & Osaka livehouses.",
  alternates: { canonical: "https://osaka-live.net/calendar" },
};
import { CalendarDesktop } from "@/components/CalendarDesktop";
import { CalendarMobile } from "@/components/CalendarMobile";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { getEventsForMonth, getAreas, getGenresWithCounts } from "@/lib/supabase/queries";
import type { EventWithVenue } from "@/lib/supabase/queries";
import { getLang } from "@/lib/i18n/server";

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

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    month?: string;
    area?: string;
    genre?: string;
    price?: string;
  }>;
}) {
  const params = await searchParams;
  const today = getTodayJST();

  const year = params.year ? parseInt(params.year) : today.year;
  const month = params.month ? parseInt(params.month) : today.month;

  const calendarFilters = {
    area: params.area || undefined,
    genre: params.genre || undefined,
    price: (params.price === "free" ? "free" : params.price === "paid" ? "paid" : undefined) as
      | "free"
      | "paid"
      | undefined,
  };

  const [events, areas, genres, lang] = await Promise.all([
    getEventsForMonth(year, month, calendarFilters),
    getAreas(),
    getGenresWithCounts(),
    getLang(),
  ]);

  const totalDays = daysInMonth(year, month);
  const leadingBlanks = firstDayOfWeek(year, month);
  const totalCells = Math.ceil((leadingBlanks + totalDays) / 7) * 7;
  const trailingBlanks = totalCells - leadingBlanks - totalDays;
  const numRows = totalCells / 7;

  const prev = prevMonth(year, month);
  const next = nextMonth(year, month);
  const isCurrentMonth = year === today.year && month === today.month;

  const monthLabel = lang === "ja"
    ? `${year}年${MONTH_NAMES_JA[month - 1]}`
    : `${MONTH_NAMES_EN[month - 1]} ${year}`;

  // Build ticker text from real sold-out events this month
  const soldOut = events.filter((e) => e.availability === "sold_out");
  const eventLabel = (e: EventWithVenue) =>
    lang === "ja" && (e.artists[0]?.name_ja ?? e.title_ja)
      ? (e.artists[0]?.name_ja ?? e.title_ja ?? e.title_en)
      : (e.artists[0]?.name_en ?? e.title_en);
  const tickerText =
    soldOut.length > 0
      ? soldOut
          .map(
            (e) =>
              `${lang === "ja" ? "売り切れ" : "SOLD OUT"}: ${eventLabel(e)} @ ${
                lang === "ja"
                  ? (e.venue?.name_ja ?? e.venue?.name_en ?? "—")
                  : (e.venue?.name_en ?? "—")
              }`,
          )
          .join(" // ") + " // OSAKA LIVE HOUSE ARCHIVE V.2.04 //"
      : `OSAKA LIVE HOUSE ARCHIVE V.2.04 // ${events.length} ${lang === "ja" ? "イベント" : "EVENTS"} ${lang === "ja" ? "IN " : "IN "}${monthLabel} //`;

  // Build filter query string (for prev/next nav + passing to child)
  const filterQs = [
    calendarFilters.area && `area=${calendarFilters.area}`,
    calendarFilters.genre && `genre=${calendarFilters.genre}`,
    calendarFilters.price && `price=${calendarFilters.price}`,
  ]
    .filter(Boolean)
    .join("&");

  function monthHref(y: number, m: number) {
    const base = `year=${y}&month=${m}`;
    return `/calendar?${filterQs ? `${base}&${filterQs}` : base}`;
  }

  return (
    <>
      <Sidebar areas={areas} genres={genres} />
      <main className="flex-1 flex flex-col bg-surface overflow-hidden relative pb-20 md:pb-0">

        {/* ── Desktop Header ─────────────────────────────────────────────── */}
        <div className="hidden md:flex items-center justify-between px-4 md:px-8 py-4 md:py-6 border-b border-outline-variant bg-surface-container-lowest">
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
              href={monthHref(prev.year, prev.month)}
              className="bg-surface-container-highest p-2 md:p-3 border border-outline-variant hover:bg-primary hover:text-on-primary transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-5 h-5" />
            </Link>

            {!isCurrentMonth && (
              <Link
                href={filterQs ? `/calendar?${filterQs}` : "/calendar"}
                className="hidden md:flex items-center bg-surface-container-highest px-3 py-2 border border-outline-variant hover:bg-surface-container text-[9px] font-headline font-bold uppercase tracking-widest transition-colors"
              >
                {lang === "ja" ? "今日" : "TODAY"}
              </Link>
            )}

            <Link
              href={monthHref(next.year, next.month)}
              className="bg-surface-container-highest p-2 md:p-3 border border-outline-variant hover:bg-primary hover:text-on-primary transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="w-5 h-5" />
            </Link>
          </div>
        </div>

        {/* ── Desktop Calendar Grid ──────────────────────────────────────── */}
        <CalendarDesktop
          year={year}
          month={month}
          events={events}
          today={today}
          lang={lang}
          numRows={numRows}
          leadingBlanks={leadingBlanks}
          totalDays={totalDays}
          trailingBlanks={trailingBlanks}
          tickerText={tickerText}
        />

        {/* ── Mobile Split-Screen Calendar ──────────────────────────────── */}
        <CalendarMobile
          year={year}
          month={month}
          events={events}
          today={today}
          lang={lang}
          filterQs={filterQs}
        />

      </main>
    </>
  );
}
