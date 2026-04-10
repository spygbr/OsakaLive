"use client";

import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";

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

export interface FilterState {
  area: string;
  genre: string;
  price: string;
  dateFrom: string;
  dateTo: string;
  hasActiveFilters: boolean;
  isTonightActive: boolean;
  isWeekendActive: boolean;
  isAllUpcomingActive: boolean;
  today: string;
  weekend: { sat: string; sun: string };
  setParam: (updates: Record<string, string | null>) => void;
  clearAll: () => void;
}

export function useFilters(): FilterState {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

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

  const clearAll = useCallback(
    () =>
      setParam({
        area: null,
        genre: null,
        price: null,
        date_from: null,
        date_to: null,
      }),
    [setParam],
  );

  const today = getTodayJST();
  const weekend = getWeekendDates();

  return {
    area,
    genre,
    price,
    dateFrom,
    dateTo,
    hasActiveFilters,
    isTonightActive: dateFrom === today && dateTo === today,
    isWeekendActive: dateFrom === weekend.sat && dateTo === weekend.sun,
    isAllUpcomingActive: !dateFrom && !dateTo,
    today,
    weekend,
    setParam,
    clearAll,
  };
}
