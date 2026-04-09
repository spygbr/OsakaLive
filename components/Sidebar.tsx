"use client";

import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { Map as MapIcon, Calendar, X } from "lucide-react";
import type { AreaOption, GenreOption } from "@/lib/supabase/queries";
import { useLang } from "@/lib/i18n/LangProvider";

interface SidebarProps {
  areas?: AreaOption[];
  genres?: GenreOption[];
}

function getTodayJST(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function getWeekendDates(): { sat: string; sun: string } {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = now.getUTCDay(); // 0=Sun … 6=Sat
  const daysToSat = day === 6 ? 0 : 6 - day;
  const satMs = now.getTime() + daysToSat * 86_400_000;
  const sat = new Date(satMs);
  const sun = new Date(satMs + 86_400_000);
  return {
    sat: sat.toISOString().slice(0, 10),
    sun: sun.toISOString().slice(0, 10),
  };
}

export function Sidebar({ areas = [], genres = [] }: SidebarProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { t, lang } = useLang();

  const area = searchParams.get("area") ?? "";
  const genre = searchParams.get("genre") ?? "";
  const price = searchParams.get("price") ?? "";
  const dateFrom = searchParams.get("date_from") ?? "";
  const dateTo = searchParams.get("date_to") ?? "";

  const hasActiveFilters = !!(area || genre || price || dateFrom || dateTo);

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, val] of Object.entries(updates)) {
        if (val === null || val === "") {
          params.delete(key);
        } else {
          params.set(key, val);
        }
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, pathname, router],
  );

  const today = getTodayJST();
  const weekend = getWeekendDates();

  const isTonightActive = dateFrom === today && dateTo === today;
  const isWeekendActive = dateFrom === weekend.sat && dateTo === weekend.sun;
  const isAllUpcomingActive = !dateFrom && !dateTo;

  const activeFilterLabels = [
    area && t('sidebar_area').split('/')[0].trim(),
    genre && t('sidebar_genre').split('/')[0].trim(),
    price && t('sidebar_price').split('/')[0].trim(),
    (dateFrom || dateTo) && t('sidebar_date').split('/')[0].trim(),
  ].filter(Boolean);

  return (
    <aside className="hidden md:flex flex-col h-[calc(100vh-64px)] sticky top-16 left-0 overflow-y-auto bg-surface-container-lowest border-r border-outline-variant divide-y divide-outline-variant w-64 shrink-0">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="p-6 flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-primary font-headline uppercase">{t('sidebar_filterSystem')}</div>
          <div className="text-[10px] text-outline font-mono tracking-widest mt-1">{t('sidebar_version')}</div>
        </div>
        {hasActiveFilters && (
          <button
            onClick={() =>
              setParam({ area: null, genre: null, price: null, date_from: null, date_to: null })
            }
            className="flex items-center gap-1 text-[9px] font-mono text-outline hover:text-primary transition-colors uppercase"
            title="Clear all filters"
          >
            <X className="w-3 h-3" />
            {t('sidebar_clear')}
          </button>
        )}
      </div>

      {/* ── Date presets (Search page only — calendar has its own nav) ───── */}
      {pathname !== "/calendar" && (
        <div className="py-4">
          <div className="px-6 mb-2 text-[10px] text-primary font-bold tracking-widest uppercase">{t('sidebar_date')}</div>
          {(
            [
              {
                label: t('sidebar_allUpcoming'),
                active: isAllUpcomingActive,
                onClick: () => setParam({ date_from: null, date_to: null }),
              },
              {
                label: t('sidebar_tonight'),
                active: isTonightActive,
                onClick: () => setParam({ date_from: today, date_to: today }),
              },
              {
                label: t('sidebar_weekend'),
                active: isWeekendActive,
                onClick: () => setParam({ date_from: weekend.sat, date_to: weekend.sun }),
              },
            ] as const
          ).map(({ label, active, onClick }) => (
            <button
              key={label}
              onClick={onClick}
              className={`w-full text-left p-3 px-6 flex items-center gap-3 font-headline uppercase text-xs transition-colors ${
                active
                  ? "bg-primary-container text-on-primary-container font-bold border-l-4 border-primary"
                  : "text-outline hover:bg-surface-container"
              }`}
            >
              <Calendar className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Area ──────────────────────────────────────────────────────────── */}
      <div className="py-4">
        <div className="px-6 mb-2 text-[10px] text-primary font-bold tracking-widest uppercase">{t('sidebar_area')}</div>
        <button
          onClick={() => setParam({ area: null })}
          className={`w-full text-left p-3 px-6 flex items-center gap-3 font-headline uppercase text-xs transition-colors ${
            !area
              ? "bg-primary-container text-on-primary-container font-bold border-l-4 border-primary"
              : "text-outline hover:bg-surface-container"
          }`}
        >
          <MapIcon className="w-4 h-4 shrink-0" />
          {t('sidebar_allAreas')}
        </button>
        {areas.map((a) => (
          <button
            key={a.slug}
            onClick={() => setParam({ area: area === a.slug ? null : a.slug })}
            className={`w-full text-left p-3 px-6 flex items-center gap-3 font-headline uppercase text-xs transition-colors ${
              area === a.slug
                ? "bg-primary-container text-on-primary-container font-bold border-l-4 border-primary"
                : "text-outline hover:bg-surface-container"
            }`}
          >
            <MapIcon className="w-4 h-4 shrink-0" />
            {lang === 'ja' ? `${a.name_ja} / ${a.name_en}` : `${a.name_en} / ${a.name_ja}`}
          </button>
        ))}
      </div>

      {/* ── Genre ─────────────────────────────────────────────────────────── */}
      <div className="py-4">
        <div className="px-6 mb-2 text-[10px] text-primary font-bold tracking-widest uppercase">{t('sidebar_genre')}</div>
        <div className="grid grid-cols-2 gap-px bg-outline-variant border-y border-outline-variant">
          <button
            onClick={() => setParam({ genre: null })}
            className={`p-2 text-[10px] font-bold uppercase transition-colors ${
              !genre
                ? "bg-primary text-on-primary"
                : "bg-surface-container-lowest text-outline hover:bg-surface-container"
            }`}
          >
            {t('sidebar_all')}
          </button>
          {genres.map((g) => (
            <button
              key={g.slug}
              onClick={() => setParam({ genre: genre === g.slug ? null : g.slug })}
              className={`p-2 text-[10px] font-bold uppercase transition-colors ${
                genre === g.slug
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-outline hover:bg-surface-container"
              }`}
            >
              {g.name_en}
            </button>
          ))}
        </div>
      </div>

      {/* ── Price ─────────────────────────────────────────────────────────── */}
      <div className="py-4">
        <div className="px-6 mb-2 text-[10px] text-primary font-bold tracking-widest uppercase">{t('sidebar_price')}</div>
        <div className="grid grid-cols-3 gap-px bg-outline-variant border-y border-outline-variant">
          {(
            [
              { labelKey: 'sidebar_all' as const, value: "" },
              { labelKey: 'sidebar_free' as const, value: "free" },
              { labelKey: 'sidebar_paid' as const, value: "paid" },
            ]
          ).map(({ labelKey, value }) => (
            <button
              key={value}
              onClick={() => setParam({ price: value || null })}
              className={`p-2 text-[10px] font-bold uppercase transition-colors ${
                price === value
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-outline hover:bg-surface-container"
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Active filter summary ──────────────────────────────────────────── */}
      {hasActiveFilters && (
        <div className="px-6 py-3 bg-surface-container-low">
          <div className="text-[10px] font-mono text-primary uppercase tracking-widest">
            {activeFilterLabels.join(" + ")} {t('sidebar_active')}
          </div>
        </div>
      )}
    </aside>
  );
}
