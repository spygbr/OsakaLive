"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { EventWithVenue } from "@/lib/supabase/queries";
import type { Lang } from "@/lib/i18n/translations";
import { formatTime, formatPrice, availLabel, availClasses } from "@/lib/utils";

const MONTH_NAMES_EN = [
  "JAN","FEB","MAR","APR","MAY","JUN",
  "JUL","AUG","SEP","OCT","NOV","DEC",
];
const MONTH_NAMES_JA = [
  "1月","2月","3月","4月","5月","6月",
  "7月","8月","9月","10月","11月","12月",
];
const DAY_NAMES_SHORT = ["S","M","T","W","T","F","S"];
const DAY_NAMES_LONG = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

interface CalendarMobileProps {
  year: number;
  month: number;
  events: EventWithVenue[];
  today: { year: number; month: number; day: number };
  lang: Lang;
  filterQs: string;
  className?: string;
}

export function CalendarMobile({
  year,
  month,
  events,
  today,
  lang,
  filterQs,
  className = "",
}: CalendarMobileProps) {
  const isCurrentMonth = year === today.year && month === today.month;
  const defaultDay = isCurrentMonth ? today.day : 1;
  const [selectedDay, setSelectedDay] = useState<number>(defaultDay);

  // Build eventsByDay map
  const eventsByDay = new Map<number, EventWithVenue[]>();
  for (const event of events) {
    const day = parseInt(event.event_date.slice(8, 10));
    if (!eventsByDay.has(day)) eventsByDay.set(day, []);
    eventsByDay.get(day)!.push(event);
  }

  const totalDays = daysInMonth(year, month);
  const leadingBlanks = firstDayOfWeek(year, month);
  const totalCells = Math.ceil((leadingBlanks + totalDays) / 7) * 7;

  // Month navigation helpers
  function prevMonthHref() {
    const m = month === 1 ? 12 : month - 1;
    const y = month === 1 ? year - 1 : year;
    const base = `year=${y}&month=${m}`;
    return `/calendar?${filterQs ? `${base}&${filterQs}` : base}`;
  }
  function nextMonthHref() {
    const m = month === 12 ? 1 : month + 1;
    const y = month === 12 ? year + 1 : year;
    const base = `year=${y}&month=${m}`;
    return `/calendar?${filterQs ? `${base}&${filterQs}` : base}`;
  }

  const selectedEvents = eventsByDay.get(selectedDay) ?? [];

  // Format selected date header
  const selectedDateObj = new Date(year, month - 1, selectedDay);
  const selectedDayName = DAY_NAMES_LONG[selectedDateObj.getDay()];
  const selectedDateHeader =
    lang === "ja"
      ? `${month}月${selectedDay}日（${selectedDayName}）`
      : `${MONTH_NAMES_EN[month - 1]} ${String(selectedDay).padStart(2, "0")} · ${selectedDayName}`;

  const eventTitle = (ev: EventWithVenue) =>
    lang === "ja" && ev.title_ja ? ev.title_ja : ev.title_en;
  const venueName = (v: EventWithVenue["venue"]) =>
    v ? (lang === "ja" ? v.name_ja : v.name_en) : "—";

  return (
    <div
      className={`md:hidden flex flex-col h-[calc(100dvh-64px-64px)] overflow-hidden ${className}`}
    >
      {/* ── Mobile month nav header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant bg-surface-container-lowest shrink-0">
        <Link
          href={prevMonthHref()}
          className="bg-surface-container-highest p-2 border border-outline-variant hover:bg-primary hover:text-on-primary transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>

        <div className="text-center">
          <h1 className="font-headline font-black text-2xl tracking-tighter text-on-surface uppercase">
            {MONTH_NAMES_EN[month - 1]} {year}
          </h1>
          <p className="text-[10px] font-mono text-outline uppercase mt-0.5">
            {events.length} EVENT{events.length !== 1 ? "S" : ""} THIS MONTH
          </p>
        </div>

        <Link
          href={nextMonthHref()}
          className="bg-surface-container-highest p-2 border border-outline-variant hover:bg-primary hover:text-on-primary transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="w-5 h-5" />
        </Link>
      </div>

      {/* ── Panel 1: Mini calendar matrix ──────────────────────────────── */}
      <div
        className="shrink-0 bg-surface-container-lowest border-b-2 border-outline-variant overflow-hidden"
        style={{ height: "260px" }}
      >
        {/* Day-of-week labels */}
        <div className="grid grid-cols-7 border-b border-outline-variant bg-surface-container-low">
          {DAY_NAMES_SHORT.map((d, i) => (
            <div
              key={i}
              className="py-1.5 text-center font-headline text-[10px] font-bold text-outline"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar cells */}
        <div
          className="grid grid-cols-7 gap-[1px] bg-outline-variant"
          style={{
            gridTemplateRows: `repeat(${totalCells / 7}, 1fr)`,
            height: "calc(260px - 28px)", // subtract day-name row
          }}
        >
          {/* Leading blanks */}
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div
              key={`pre-${i}`}
              className="bg-surface-container-lowest opacity-25"
            />
          ))}

          {/* Days */}
          {Array.from({ length: totalDays }).map((_, i) => {
            const dayNum = i + 1;
            const hasEvents = (eventsByDay.get(dayNum)?.length ?? 0) > 0;
            const isToday = isCurrentMonth && dayNum === today.day;
            const isSelected = dayNum === selectedDay;

            return (
              <button
                key={dayNum}
                onClick={() => setSelectedDay(dayNum)}
                className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  isSelected
                    ? "bg-primary text-on-primary"
                    : isToday
                      ? "bg-surface-container border-2 border-primary"
                      : "bg-surface-container hover:bg-surface-container-high"
                }`}
              >
                <span
                  className={`font-headline font-bold text-xs leading-none ${
                    isSelected
                      ? "text-on-primary"
                      : isToday
                        ? "text-primary"
                        : "text-on-surface"
                  }`}
                >
                  {dayNum}
                </span>
                {hasEvents && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isSelected ? "bg-on-primary" : "bg-primary"
                    }`}
                  />
                )}
              </button>
            );
          })}

          {/* Trailing blanks */}
          {Array.from({
            length: totalCells - leadingBlanks - totalDays,
          }).map((_, i) => (
            <div
              key={`post-${i}`}
              className="bg-surface-container-lowest opacity-25"
            />
          ))}
        </div>
      </div>

      {/* ── Panel 2: Daily agenda ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-surface px-4 py-4">
        {/* Date header */}
        <h2 className="font-headline font-black text-sm tracking-widest uppercase text-primary mb-4 border-b border-outline-variant pb-2">
          {selectedDateHeader}
        </h2>

        {selectedEvents.length === 0 ? (
          <p className="text-outline font-mono text-xs text-center py-8 uppercase">
            {lang === "ja"
              ? "この日のイベントはありません"
              : "No events on this date."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {selectedEvents.map((event) => (
              <Link
                key={event.id}
                href={`/event/${event.slug}`}
                className="bg-surface-container border border-outline-variant p-3 flex gap-3 items-start hover:bg-surface-container-high transition-colors group"
              >
                {/* Time column */}
                <div className="shrink-0 w-12 text-center">
                  <p className="font-headline font-bold text-base text-primary leading-none">
                    {formatTime(event.start_time)}
                  </p>
                  <p className="font-mono text-[8px] text-outline uppercase mt-0.5">
                    {lang === "ja" ? "開演" : "START"}
                  </p>
                </div>

                {/* Info column */}
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[9px] text-primary uppercase truncate mb-0.5">
                    {venueName(event.venue)}
                  </p>
                  <h3 className="font-headline font-bold text-sm uppercase leading-tight truncate group-hover:text-primary transition-colors">
                    {eventTitle(event)}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`text-[8px] font-bold px-1.5 py-0.5 uppercase ${availClasses(event.availability)}`}
                    >
                      {availLabel(event.availability)}
                    </span>
                    {event.ticket_price_adv != null && (
                      <span className="font-mono text-[9px] text-outline-variant uppercase">
                        {formatPrice(event.ticket_price_adv)}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* View all link */}
        <Link
          href={filterQs ? `/search?${filterQs}` : "/search"}
          className="mt-6 block text-center text-[10px] font-mono text-outline hover:text-primary transition-colors uppercase border-t border-outline-variant pt-4"
        >
          {lang === "ja"
            ? "今月の全イベントを見る →"
            : "View all events this month →"}
        </Link>
      </div>
    </div>
  );
}
