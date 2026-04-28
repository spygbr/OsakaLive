"use client";

import { Share2, Rss } from "lucide-react";
import { useLang } from "@/lib/i18n/LangProvider";

interface FooterProps {
  lastUpdated?: string | null; // ISO timestamp
}

function formatLastUpdated(iso: string | null | undefined, lang: "en" | "ja"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  // Render in JST
  const fmt = new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${fmt.format(d)} JST`;
}

export function Footer({ lastUpdated }: FooterProps) {
  const { t, lang } = useLang();
  const formatted = formatLastUpdated(lastUpdated, lang);

  return (
    <footer className="hidden md:grid w-full py-12 px-8 grid-cols-1 md:grid-cols-3 gap-8 bg-background border-t-2 border-outline-variant">
      <div className="flex flex-col gap-4">
        <div className="text-md font-bold text-primary font-headline uppercase tracking-tighter">OSAKA LIVE HOUSE GUIDE</div>
        <p className="font-mono text-[10px] text-outline uppercase leading-relaxed">
          {t('footer_copyright')}
        </p>
        {formatted && (
          <p className="font-mono text-[10px] text-outline uppercase leading-relaxed">
            {lang === "ja" ? "最終更新: " : "Last Updated: "}
            <span className="text-primary">{formatted}</span>
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-widest">
          <a className="text-outline hover:text-primary underline" href="/sitemap.xml">{t('footer_sitemap')}</a>
          <a className="text-outline hover:text-primary underline" href="/privacy">{t('footer_privacy')}</a>
          <a className="text-outline hover:text-primary underline" href="#">{t('footer_contact')}</a>
        </div>
        <div className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-widest">
          <a className="text-outline hover:text-primary underline" href="/terms">{t('footer_terms')}</a>
          <a className="text-outline hover:text-primary underline" href="#">{t('footer_venueSubmission')}</a>
          <a className="text-outline hover:text-primary underline" href="#">{t('footer_artistPortal')}</a>
        </div>
      </div>
      <div className="flex flex-col items-start md:items-end gap-4">
        <div className="flex gap-4">
          <Rss className="w-5 h-5 text-outline hover:text-primary cursor-pointer" />
          <Share2 className="w-5 h-5 text-outline hover:text-primary cursor-pointer" />
        </div>
      </div>
    </footer>
  );
}
