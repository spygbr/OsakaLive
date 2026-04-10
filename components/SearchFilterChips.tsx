"use client";

import { X } from "lucide-react";
import { useFilters } from "@/hooks/use-filters";
import { useLang } from "@/lib/i18n/LangProvider";
import type { AreaOption, GenreOption } from "@/lib/supabase/queries";

interface SearchFilterChipsProps {
  areas: AreaOption[];
  genres: GenreOption[];
  eventCount: number;
}

export function SearchFilterChips({
  areas,
  genres,
  eventCount,
}: SearchFilterChipsProps) {
  const { t, lang } = useLang();
  const {
    area,
    genre,
    price,
    isTonightActive,
    isWeekendActive,
    hasActiveFilters,
    setParam,
  } = useFilters();

  // Find human-readable labels
  const areaLabel = areas.find((a) => a.slug === area);
  const genreLabel = genres.find((g) => g.slug === genre);
  const priceLabel = price === "free" ? t("sidebar_free") : price === "paid" ? t("sidebar_paid") : null;
  const dateLabel = isTonightActive
    ? t("sidebar_tonight").split(" /")[0].trim()
    : isWeekendActive
      ? t("sidebar_weekend").split(" /")[0].trim()
      : null;

  return (
    <>
      {/* Active filter chips — mobile only */}
      <div className="md:hidden flex gap-2 px-4 py-3 overflow-x-auto no-scrollbar bg-surface-container border-b border-outline-variant">
        {!hasActiveFilters && (
          <span className="text-[10px] text-outline font-mono uppercase whitespace-nowrap">
            ALL EVENTS
          </span>
        )}
        {areaLabel && (
          <button
            onClick={() => setParam({ area: null })}
            className="flex items-center gap-1 px-2 py-1 bg-primary-container text-on-primary-container text-[10px] font-bold uppercase whitespace-nowrap shrink-0"
          >
            {lang === "ja" ? areaLabel.name_ja : areaLabel.name_en}
            <X className="w-3 h-3" />
          </button>
        )}
        {genreLabel && (
          <button
            onClick={() => setParam({ genre: null })}
            className="flex items-center gap-1 px-2 py-1 bg-primary-container text-on-primary-container text-[10px] font-bold uppercase whitespace-nowrap shrink-0"
          >
            {genreLabel.name_en}
            <X className="w-3 h-3" />
          </button>
        )}
        {priceLabel && (
          <button
            onClick={() => setParam({ price: null })}
            className="flex items-center gap-1 px-2 py-1 bg-primary-container text-on-primary-container text-[10px] font-bold uppercase whitespace-nowrap shrink-0"
          >
            {priceLabel}
            <X className="w-3 h-3" />
          </button>
        )}
        {dateLabel && (
          <button
            onClick={() => setParam({ date_from: null, date_to: null })}
            className="flex items-center gap-1 px-2 py-1 bg-primary-container text-on-primary-container text-[10px] font-bold uppercase whitespace-nowrap shrink-0"
          >
            {dateLabel}
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Result count strip — mobile only */}
      <div className="md:hidden px-4 py-2 bg-surface-container text-[10px] font-mono text-outline uppercase border-b border-outline-variant">
        {eventCount} EVENT{eventCount !== 1 ? "S" : ""}
      </div>
    </>
  );
}
