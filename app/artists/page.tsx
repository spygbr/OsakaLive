import { Sidebar } from "@/components/Sidebar";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getAllArtists } from "@/lib/supabase/queries";
import { ArtistFilter } from "./ArtistFilter";

export const revalidate = 60;

export default async function ArtistsPage() {
  const artists = await getAllArtists();

  return (
    <>
      <Sidebar />
      <main className="flex-1 bg-surface-dim pb-20 md:pb-0 overflow-x-hidden">

        {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
        <div className="hidden md:flex items-center justify-between px-8 py-4 border-b border-outline-variant bg-surface-container-lowest">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-outline">
            <Link href="/" className="hover:text-primary transition-colors">ROOT</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-primary">ARTISTS ({artists.length})</span>
          </div>
          <div className="text-[10px] font-mono text-outline uppercase tracking-widest">
            INDEX: [A-Z]
          </div>
        </div>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <section className="p-4 md:p-8 border-b border-outline-variant bg-surface-container">
          <h1 className="text-3xl md:text-5xl font-black font-headline tracking-tighter uppercase leading-none">
            ARTIST DIRECTORY / <br className="hidden md:block" />
            <span className="text-primary">アーティスト</span>
          </h1>
          <p className="mt-4 text-on-surface-variant font-mono text-xs max-w-2xl leading-relaxed uppercase">
            DATABASE OF {artists.length} ACTIVE PERFORMER{artists.length !== 1 ? "S" : ""} IN THE KANSAI UNDERGROUND SCENE.
          </p>
        </section>

        {/* ── Interactive filter + grid (client component) ─────────────── */}
        <ArtistFilter artists={artists} />

      </main>
    </>
  );
}
