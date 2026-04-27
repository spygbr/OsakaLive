"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X, Calendar, Map as MapIcon } from "lucide-react";
import { useFilters } from "@/hooks/use-filters";
import { useFilterDrawer } from "@/lib/filter-drawer-context";
import { useLang } from "@/lib/i18n/LangProvider";
import type { AreaOption, GenreOptionWithCount } from "@/lib/supabase/queries";

interface MobileFilterDrawerProps {
  areas?: AreaOption[];
  genres?: GenreOptionWithCount[];
}

export function MobileFilterDrawer({
  areas = [],
  genres = [],
}: MobileFilterDrawerProps) {
  const { isOpen, close } = useFilterDrawer();
  const { t, lang } = useLang();
  const [showAllGenres, setShowAllGenres] = useState(false);
  const {
    area,
    genre,
    price,
    isTonightActive,
    isWeekendActive,
    isAllUpcomingActive,
    today,
    weekend,
    setParam,
    clearAll,
    hasActiveFilters,
  } = useFilters();

  const activeCount = [
    area,
    genre,
    price,
    isTonightActive || isWeekendActive,
  ].filter(Boolean).length;

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
                {t("sidebar_filterSystem")} / フィルター
              </span>
              <div className="flex items-center gap-3">
                {hasActiveFilters && (
                  <button
                    onClick={clearAll}
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
                      onClick: () =>
                        setParam({ date_from: null, date_to: null }),
                    },
                    {
                      label: t("sidebar_tonight"),
                      active: isTonightActive,
                      onClick: () =>
                        setParam({ date_from: today, date_to: today }),
                    },
                    {
                      label: t("sidebar_weekend"),
                      active: isWeekendActive,
                      onClick: () =>
                        setParam({
                          date_from: weekend.sat,
                          date_to: weekend.sun,
                        }),
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
                  onClick={() => setParam({ area: null })}
                  className={`w-full text-left p-3 px-4 flex items-center gap-3 font-headline uppercase text-xs transition-colors ${
                    !area
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
                    onClick={() =>
                      setParam({ area: area === a.slug ? null : a.slug })
                    }
                    className={`w-full text-left p-3 px-4 flex items-center gap-3 font-headline uppercase text-xs transition-colors ${
                      area === a.slug
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
                    onClick={() => setParam({ genre: null })}
                    className={`p-2 text-[10px] font-bold uppercase transition-colors ${
                      !genre
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container text-outline hover:bg-surface-container-high"
                    }`}
                  >
                    {t("sidebar_all")}
                  </button>
                  {genres
                    .filter((g) => showAllGenres || g.upcoming_count > 0 || genre === g.slug)
                    .map((g) => (
                      <button
                        key={g.slug}
                        onClick={() =>
                          setParam({ genre: genre === g.slug ? null : g.slug })
                        }
                        className={`p-2 text-[10px] font-bold uppercase transition-colors ${
                          genre === g.slug
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
                      onClick={() => setParam({ price: value || null })}
                      className={`p-2 text-[10px] font-bold uppercase transition-colors ${
                        price === value
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
                onClick={close}
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
