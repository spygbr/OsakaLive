"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useLang } from "@/lib/i18n/LangProvider";

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Full-width header dropdown that submits a free-text search to /search?q=…
 *
 * The /search page reads `q` and passes it to getFilteredEvents(), which
 * ilike-matches against event title_en / title_ja / title_norm / title_raw.
 *
 * Closes on Esc or backdrop click. Pre-fills with the current ?q if present
 * so the user can refine without retyping.
 */
export function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { lang } = useLang();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on open; reset value to current ?q each time it opens.
  useEffect(() => {
    if (open) {
      setValue(searchParams.get("q") ?? "");
      // Defer focus so the element is in the DOM and visible.
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open, searchParams]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const placeholder =
    lang === "ja" ? "イベント・アーティスト・タイトルを検索" : "Search events, artists, titles…";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const term = value.trim();
    const params = new URLSearchParams(searchParams.toString());
    if (term) params.set("q", term);
    else params.delete("q");
    const qs = params.toString();
    router.push(qs ? `/search?${qs}` : "/search");
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4"
      onClick={onClose}
    >
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden />

      {/* dialog */}
      <form
        role="dialog"
        aria-label={placeholder}
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl bg-surface-container border-2 border-primary"
      >
        <div className="flex items-center gap-3 px-4 md:px-5 py-3 md:py-4">
          <Search className="w-5 h-5 text-primary shrink-0" />
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-base md:text-lg font-headline tracking-tight text-on-surface placeholder:text-outline focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === "ja" ? "閉じる" : "Close"}
            className="text-outline hover:text-primary transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="border-t border-outline-variant px-4 md:px-5 py-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-outline">
          <span>
            {lang === "ja" ? "Enter で検索" : "Press Enter to search"}
          </span>
          <span>Esc</span>
        </div>
      </form>
    </div>
  );
}
