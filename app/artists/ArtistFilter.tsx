"use client";

import Image from "next/image";
import Link from "next/link";
import { Search, Filter } from "lucide-react";
import { useState, useMemo } from "react";
import type { ArtistWithGenre } from "@/lib/supabase/queries";
import { placeholderImage } from "@/lib/utils";
import { useLang } from "@/lib/i18n/LangProvider";

const LETTERS = ["ALL", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "#"];

export function ArtistFilter({ artists }: { artists: ArtistWithGenre[] }) {
  const [query, setQuery] = useState("");
  const [activeLetter, setActiveLetter] = useState("ALL");
  const { t, lang } = useLang();

  const filtered = useMemo(() => {
    return artists.filter((a) => {
      const matchesLetter =
        activeLetter === "ALL"
          ? true
          : activeLetter === "#"
          ? /^[^A-Za-z]/.test(a.name_en)
          : a.name_en.toUpperCase().startsWith(activeLetter);

      const matchesQuery =
        query.trim() === "" ||
        a.name_en.toLowerCase().includes(query.toLowerCase()) ||
        (a.name_ja ?? "").includes(query);

      return matchesLetter && matchesQuery;
    });
  }, [artists, query, activeLetter]);

  function handleLetterClick(letter: string) {
    setActiveLetter(letter);
    setQuery("");
  }

  function handleSearch(value: string) {
    setQuery(value);
    setActiveLetter("ALL");
  }

  const artistDisplayName = (a: ArtistWithGenre) =>
    lang === 'ja' && a.name_ja ? a.name_ja : a.name_en;
  const artistSubName = (a: ArtistWithGenre) =>
    lang === 'ja' ? a.name_en : (a.name_ja ?? null);

  return (
    <>
      {/* ── Search/Filter Bar ────────────────────────────────────────────── */}
      <div className="px-4 md:px-8 py-4 border-b border-outline-variant bg-surface-container flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t('artists_searchPlaceholder')}
            className="w-full bg-surface-container-lowest border border-outline-variant text-on-surface font-mono text-xs py-2 pl-9 pr-3 focus:outline-none focus:border-primary uppercase placeholder:text-outline-variant"
          />
        </div>
        <button
          onClick={() => {
            setQuery("");
            setActiveLetter("ALL");
          }}
          className="bg-surface-container-highest border border-outline-variant px-3 flex items-center justify-center hover:bg-primary hover:text-on-primary transition-colors"
          title="Clear filters"
        >
          <Filter className="w-4 h-4" />
        </button>
      </div>

      {/* ── Alphabet Index ───────────────────────────────────────────────── */}
      <div className="border-b border-outline-variant bg-surface-container-lowest overflow-x-auto no-scrollbar">
        <div className="flex px-4 md:px-8 py-3 min-w-max gap-1">
          {LETTERS.map((letter) => (
            <button
              key={letter}
              onClick={() => handleLetterClick(letter)}
              className={`px-2 py-1 font-headline font-bold text-xs transition-colors ${
                activeLetter === letter && query === ""
                  ? "bg-primary text-on-primary"
                  : "text-outline hover:text-primary hover:bg-surface-container"
              }`}
            >
              {letter === "ALL" ? t('sidebar_all') : letter}
            </button>
          ))}
        </div>
      </div>

      {/* ── Artist Grid ─────────────────────────────────────────────────── */}
      <section className="p-4 md:p-8">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-outline font-mono text-sm uppercase tracking-widest">
              {t('artists_noResults')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
            {filtered.map((artist) => (
              <Link key={artist.slug} href={`/artists/${artist.slug}`} className="group">
                <div className="aspect-square bg-surface-container-highest relative overflow-hidden border border-outline-variant mb-3">
                  <Image
                    src={artist.image_url ?? placeholderImage(artist.slug, 400, 400)}
                    alt={artist.name_en}
                    fill
                    className="object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
                    unoptimized
                  />
                  <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors" />
                </div>
                <h3 className="font-headline font-bold text-lg uppercase tracking-tight group-hover:text-primary transition-colors leading-tight mb-1">
                  {artistDisplayName(artist)}
                </h3>
                {artistSubName(artist) && (
                  <p className="font-mono text-[10px] text-outline-variant mb-0.5">
                    {artistSubName(artist)}
                  </p>
                )}
                <p className="font-mono text-[10px] text-outline uppercase tracking-widest">
                  {artist.genre?.name_en ?? "—"}
                </p>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 text-center font-mono text-[10px] text-outline uppercase tracking-widest">
          {filtered.length} / {artists.length} {t('breadcrumb_artists')}
        </div>
      </section>
    </>
  );
}
