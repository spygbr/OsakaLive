"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Home, Calendar, MapPin, User } from "lucide-react";
import { useLang } from "@/lib/i18n/LangProvider";
import { useFilterDrawer } from "@/lib/filter-drawer-context";
import { SearchOverlay } from "@/components/SearchOverlay";

export function TopNav() {
  const pathname = usePathname();
  const { t, toggle, lang } = useLang();
  const { open: openFilterDrawer } = useFilterDrawer();
  const [searchOpen, setSearchOpen] = useState(false);

  // ⌘K / Ctrl+K toggles the search overlay from any page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="flex justify-between items-center w-full px-4 md:px-6 h-16 sticky top-0 z-50 bg-neutral-900 md:bg-[#131313] border-b md:border-b-2 border-primary-container md:border-outline-variant">
      <div className="flex items-center gap-4 md:gap-8">
        <Link
          href="/"
          aria-label="Osaka Live House Guide — home"
          className="flex items-center shrink-0"
        >
          <Image
            src="/og-image.png"
            alt="Osaka Live House Guide"
            width={1200}
            height={630}
            priority
            className="h-10 md:h-12 w-auto"
          />
        </Link>
        <nav className="hidden md:flex items-center gap-6 font-headline uppercase tracking-tighter text-sm">
          <Link
            href="/"
            className={`${pathname === "/" ? "text-primary border-b-2 border-primary pb-1 translate-y-[1px]" : "text-[#cecece] hover:text-primary transition-colors"}`}
          >
            {t("nav_home")}
          </Link>
          <Link
            href="/calendar"
            className={`${pathname === "/calendar" ? "text-primary border-b-2 border-primary pb-1 translate-y-[1px]" : "text-[#cecece] hover:text-primary transition-colors"}`}
          >
            {t("nav_calendar")}
          </Link>
          <Link
            href="/search"
            className={`${pathname === "/search" ? "text-primary border-b-2 border-primary pb-1 translate-y-[1px]" : "text-[#cecece] hover:text-primary transition-colors"}`}
          >
            {t("nav_venues")}
          </Link>
          <Link
            href="/artists"
            className={`${pathname === "/artists" ? "text-primary border-b-2 border-primary pb-1 translate-y-[1px]" : "text-[#cecece] hover:text-primary transition-colors"}`}
          >
            {t("nav_artists")}
          </Link>
          <Link
            href="/tickets"
            className={`${pathname === "/tickets" ? "text-primary border-b-2 border-primary pb-1 translate-y-[1px]" : "text-[#cecece] hover:text-primary transition-colors"}`}
          >
            {t("nav_tickets")}
          </Link>
          <Link
            href="/guide"
            className={`${pathname === "/guide" ? "text-primary border-b-2 border-primary pb-1 translate-y-[1px]" : "text-[#cecece] hover:text-primary transition-colors"}`}
          >
            {t("nav_guide")}
          </Link>
          <button
            onClick={toggle}
            className="text-[#cecece] hover:text-primary transition-colors border border-outline-variant px-2 py-0.5 text-xs font-bold hover:border-primary active:scale-95"
            title={lang === "en" ? "Switch to Japanese" : "英語に切り替え"}
          >
            {t("nav_lang")}
          </button>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={openFilterDrawer}
          className="md:hidden bg-neutral-800 text-primary-container px-3 py-1 text-xs font-headline font-bold border border-primary-container hover:bg-red-900/20 active:scale-95 transition-transform"
        >
          {t("nav_filterBtn")}
        </button>
        <button
          onClick={toggle}
          className="md:hidden text-primary-container font-headline font-bold tracking-tighter uppercase text-sm hover:text-primary transition-colors active:scale-95"
          title={lang === "en" ? "Switch to Japanese" : "英語に切り替え"}
        >
          {t("nav_lang")}
        </button>
        <button
          onClick={() => setSearchOpen(true)}
          className="hidden md:flex material-symbols-outlined text-primary hover:text-primary-container active:scale-95 transition-transform"
          aria-label={lang === "ja" ? "検索を開く" : "Open search"}
          title={lang === "ja" ? "検索 (⌘K)" : "Search (⌘K)"}
        >
          <Search className="w-6 h-6" />
        </button>
      </div>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const { t } = useLang();

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-stretch h-16 bg-neutral-900 border-t border-primary-container font-headline text-[10px] font-bold uppercase"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <Link
        href="/"
        className={`flex flex-col items-center justify-center p-1 flex-1 transition-colors ${pathname === "/" ? "bg-primary-container text-black" : "text-primary-container hover:bg-red-900/40 active:bg-red-800"}`}
      >
        <Home className="w-6 h-6 mb-1" />
        <span>{t("nav_home")}</span>
      </Link>
      <Link
        href="/calendar"
        className={`flex flex-col items-center justify-center p-1 flex-1 transition-colors ${pathname === "/calendar" ? "bg-primary-container text-black" : "text-primary-container hover:bg-red-900/40 active:bg-red-800"}`}
      >
        <Calendar className="w-6 h-6 mb-1" />
        <span>{t("nav_calendar")}</span>
      </Link>
      <Link
        href="/search"
        className={`flex flex-col items-center justify-center p-1 flex-1 transition-colors ${pathname === "/search" ? "bg-primary-container text-black" : "text-primary-container hover:bg-red-900/40 active:bg-red-800"}`}
      >
        <MapPin className="w-6 h-6 mb-1" />
        <span>{t("nav_venues")}</span>
      </Link>
      <Link
        href="/artists"
        className={`flex flex-col items-center justify-center p-1 flex-1 transition-colors ${pathname === "/artists" ? "bg-primary-container text-black" : "text-primary-container hover:bg-red-900/40 active:bg-red-800"}`}
      >
        <User className="w-6 h-6 mb-1" />
        <span>{t("nav_artists")}</span>
      </Link>
    </nav>
  );
}
