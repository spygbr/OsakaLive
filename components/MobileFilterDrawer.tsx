"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X, Calendar, Map as MapIcon } from "lucide-react";
import { useFilters } from "@/hooks/use-filters";
import { useFilterStore } from "@/lib/stores/filter-store";
import { useFilterDrawer } from "@/lib/filter-drawer-context";
import { useLang } from "@/lib/i18n/LangProvider";
import type { AreaOption, GenreOptionWithCount } from "@/lib/supabase/queries";

interface MobileFilterDrawerProps {
  areas?: AreaOption[];
  genres?: GenreOptionWithCount[];
}

function getTodayJST(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function getWeekendDates(): { sat: string; sun: string } {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = now.getUTCDay();
  const daysToSat = day === 6 ? 0 : 6 - day;
  const satMs = now.getTime() + daysToSat * 86_400_000;
  const sat = new Date(satMs);
  const sun = new Date(satMs + 86_400_000);
  return {
    sat: sat.toISOString().slice(0, 10),
    sun: sun.toISOString().slice(0, 10),
  };
}

export function MobileFilterDrawer({
  areas = [],
  genres = [],
}: MobileFilterDrawerProps) {
  const { isOpen, close } = useFilterDrawer();
  const { t, lang } = useLang();
  const [showAllGenres, setShowAllGenres] = useState(false);

  // URL state (committed)
  const { area: urlArea, genre: urlGenre, price: urlPrice, dateFrom: urlDateFrom, dateTo: urlDateTo, setParam } = useFilters();

  // Pending (staged) state
  const { pending, setPending, syncPending, resetPending } = useFilterStore();

  const today = getTodayJST();
  const weekend = getWeekendDates();

  // Sync pending from URL when drawer opens
  useEffect(() => {
    if (isOpen) {
      syncPending({
        area: urlArea,
        genre: urlGenre,
        price: urlPrice,
        dateFrom: urlDateFrom,
        dateTo: urlDateTo,
      });
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived state from pending
  const isTonightActive = pending.dateFrom === today && pending.dateTo === today;
  const isWeekendActive = pending.dateFrom === weekend.sat && pending.dateTo === weekend.sun;
  const isAllUpcomingActive = !pending.dateFrom && !pending.dateTo;
  const hasPendingFilters = !!(pending.area || pending.genre || pending.price || pending.dateFrom || pending.dateTo);

  const activeCount = [
    pending.area,
    pending.genre,
    pending.price,
    isTonightActive || isWeekendActive,
  ].filter(Boolean).length;

  function handleApply() {
    setParam({
      area: pending.area || null,
      genre: pending.genre || null,
      price: pending.price || null,
      date_from: pending.dateFrom || null,
      date_to: pending.dateTo || null,
    });
    close();
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-black/60"
            onClick={close}
          />

          {/* Sheet */}
          <motion.div
            key="drawer-sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="fixed bottom-0 left-0 right-0 z-[70] bg-surface-container max-h-[80vh] flex flex-col border-t-2 border-primary-container"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 h-12 border-b border-outline-variant shrink-0 bg-surface-container">
              <span className="font-headline font-bold text-sm uppercase tracking-widest text-primary">
                {lang === "ja" ? "フィルター" : "FILTERS"}
              </span>
              <div className="flex items-center gap-3">
                {hasPendingFilters && (
                  <button
                    onClick={resetPending}
                    className="text-[10px] font-mono text-outline hover:text-primary transition-colors uppercase"
                  >
                    {t("sidebar_clear")}
                  </button>
                )}
                <button
                  onClick={close}
                  className="text-outline hover:text-primary transition-colors active:scale-95"
                  aria-label="Close filter drawer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 divide-y divide-outline-variant">
              {/* DATE */}
              <div className="py-4">
                <div className="px-4 mb-2 text-[10px] text-primary font-bold tracking-widest uppercase">
                  {t("sidebar_date")}
                </div>
                {(
                  [
                    {
                      label: t("sidebar_allUpcoming"),
                      active: isAllUpcomingActive,
                      onClick: () => setPending({ dateFrom: "", dateTo: "" }),
                    },
                    {
                      label: t("sidebar_tonight"),
                      active: isTonightActive,
                      onClick: () => setPending({ dateFrom: today, dateTo: today }),
                    },
                    {
                      label: t("sidebar_weekend"),
                      active: isWeekendActive,
                      onClick: () => setPending({ dateFrom: weekend.sat, dateTo: weekend.sun }),
                    },
                  ] as const
                ).map(({ label, active, onClick }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    className={`w-full text-left p-3 px-4 flex items-center gap-3 font-headline uppercase text-xs transition-colors ${
                      active
                        ? "bg-primary-container text-on-primary-container font-bold border-l-4 border-primary"
                        : "text-outline hover:bg-surface-container-high"
                    }`}
                  >
                    <Calendar className="w-4 h-4 shrink-0" />
                    {label}
                  </button>
                ))}
              </div>

              {/* AREA */}
              <div className="py-4">
                <div className="px-4 mb-2 text-[10px] text-primary font-bold tracking-widest uppercase">
                  {t("sidebar_area")}
                </div>
                <button
                  onClick={() => setPending({ area: "" })}
                  className={`w-full text-left p-3 px-4 flex items-center gap-3 font-headline uppercase text-xs transition-colors ${
                    !pending.area
                      ? "bg-primary-container text-on-primary-container font-bold border-l-4 border-primary"
                      : "text-outline hover:bg-surface-container-high"
                  }`}
                >
                  <MapIcon className="w-4 h-4 shrink-0" />
                  {t("sidebar_allAreas")}
                </button>
                {areas.map((a) => (
                  <button
                    key={a.slug}
                    onClick={() => setPending({ area: pending.area === a.slug ? "" : a.slug })}
                    className={`w-full text-left p-3 px-4 flex items-center gap-3 font-headline uppercase text-xs transition-colors ${
                      pending.area === a.slug
                        ? "bg-primary-container text-on-primary-container font-bold border-l-4 border-primary"
                        : "text-outline hover:bg-surface-container-high"
                    }`}
                  >
                    <MapIcon className="w-4 h-4 shrink-0" />
                    {lang === "ja"
                      ? `${a.name_ja} / ${a.name_en}`
                      : `${a.name_en} / ${a.name_ja}`}
                  </button>
                ))}
              </div>

              {/* GENRE */}
              <div className="py-4">
                <div className="px-4 mb-2 flex items-center justify-between">
                  <div className="text-[10px] text-primary font-bold tracking-widest uppercase">
                    {t("sidebar_genre")}
                  </div>
                  {genres.some((g) => g.upcoming_count === 0) && (
                    <button
                      onClick={() => setShowAllGenres((v) => !v)}
                      className="text-[9px] font-mono text-outline hover:text-primary transition-colors uppercase"
                    >
                      {showAllGenres ? "LESS" : "ALL"}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-px bg-outline-variant border-y border-outline-variant mx-4">
                  <button
                    data-testid="genre-all-btn"
                    onClick={() => setPending({ genre: "" })}
                    className={`p-2 text-[10px] font-bold uppercase transition-colors ${
                      !pending.genre
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container text-outline hover:bg-surface-container-high"
                    }`}
                  >
                    {t("sidebar_all")}
                  </button>
                  {genres
                    .filter((g) => showAllGenres || g.upcoming_count > 0 || pending.genre === g.slug)
                    .map((g) => (
                      <button
                        key={g.slug}
                        data-testid="genre-btn"
                        data-slug={g.slug}
                        onClick={() => setPending({ genre: pending.genre === g.slug ? "" : g.slug })}
                        className={`p-2 text-[10px] font-bold uppercase transition-colors ${
                          pending.genre === g.slug
                            ? "bg-primary text-on-primary"
                            : "bg-surface-container text-outline hover:bg-surface-container-high"
                        }`}
                      >
                        {g.name_en}
                        {g.upcoming_count > 0 && (
                          <span className="ml-1 opacity-60">({g.upcoming_count})</span>
                        )}
                      </button>
                    ))}
                </div>
              </div>

              {/* PRICE */}
              <div className="py-4 pb-6">
                <div className="px-4 mb-2 text-[10px] text-primary font-bold tracking-widest uppercase">
                  {t("sidebar_price")}
                </div>
                <div className="grid grid-cols-3 gap-px bg-outline-variant border-y border-outline-variant mx-4">
                  {(
                    [
                      { labelKey: "sidebar_all" as const, value: "" },
                      { labelKey: "sidebar_free" as const, value: "free" },
                      { labelKey: "sidebar_paid" as const, value: "paid" },
                    ] as const
                  ).map(({ labelKey, value }) => (
                    <button
                      key={value}
                      onClick={() => setPending({ price: value })}
                      className={`p-2 text-[10px] font-bold uppercase transition-colors ${
                        pending.price === value
                          ? "bg-primary text-on-primary"
                          : "bg-surface-container text-outline hover:bg-surface-container-high"
                      }`}
                    >
                      {t(labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sticky footer */}
            <div className="shrink-0 h-16 bg-surface-container border-t-2 border-outline-variant flex items-center px-4 gap-3">
              <div className="flex-1">
                {activeCount > 0 ? (
                  <p className="text-[10px] font-mono text-primary uppercase">
                    {activeCount} FILTER{activeCount !== 1 ? "S" : ""} ACTIVE
                  </p>
                ) : (
                  <p className="text-[10px] font-mono text-outline uppercase">
                    ALL EVENTS
                  </p>
                )}
              </div>
              <button
                onClick={handleApply}
                className="bg-primary text-on-primary font-headline font-black text-xs uppercase px-6 py-3 active:scale-95 transition-transform"
              >
                APPLY
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
