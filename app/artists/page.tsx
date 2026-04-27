import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Artists | Osaka Underground Music Scene",
  description: "Discover artists playing live in Osaka's underground livehouse scene — punk, metal, jazz, electronic and more.",
  alternates: { canonical: "https://osaka-live.net/artists" },
};
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getAllArtists } from "@/lib/supabase/queries";
import { ArtistFilter } from "./ArtistFilter";
import { getLang } from "@/lib/i18n/server";
import { createT } from "@/lib/i18n/translations";

export const revalidate = 60;

export default async function ArtistsPage() {
  const artists = await getAllArtists();
  const lang = await getLang();
  const t = createT(lang);

  return (
    <>
      <Sidebar />
      <main className="flex-1 bg-surface-dim pb-20 md:pb-0 overflow-x-hidden">

        {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
        <div className="hidden md:flex items-center justify-between px-8 py-4 border-b border-outline-variant bg-surface-container-lowest">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-outline">
            <Link href="/" className="hover:text-primary transition-colors">{t('breadcrumb_root')}</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-primary">{t('breadcrumb_artists')} ({artists.length})</span>
          </div>
          <div className="text-[10px] font-mono text-outline uppercase tracking-widest">
            {t('artists_index')}
          </div>
        </div>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <section className="p-4 md:p-8 border-b border-outline-variant bg-surface-container">
          <h1 className="text-3xl md:text-5xl font-black font-headline tracking-tighter uppercase leading-none">
            {t('artists_heading')} / <br className="hidden md:block" />
            <span className="text-primary">{t('artists_subheading')}</span>
          </h1>
          <p className="mt-4 text-on-surface-variant font-mono text-xs max-w-2xl leading-relaxed uppercase">
            {t('artists_database')} {artists.length} {t('artists_performers')}
          </p>
        </section>

        {/* ── Interactive filter + grid (client component) ─────────────── */}
        <ArtistFilter artists={artists} />

      </main>
    </>
  );
}
