"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import type { EventWithVenue } from "@/lib/supabase/queries";
import type { Lang } from "@/lib/i18n/translations";
import { availLabel, availClasses, placeholderImage } from "@/lib/utils";

interface MobileHeroCarouselProps {
  events: EventWithVenue[];
  lang: Lang;
}

export function MobileHeroCarousel({ events, lang }: MobileHeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const count = events.length;

  const title = (ev: EventWithVenue) =>
    lang === "ja" && ev.title_ja ? ev.title_ja : ev.title_en;

  // Auto-advance every 5s
  const startInterval = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setActiveIndex((i) => (i + 1) % count);
    }, 5000);
  };

  useEffect(() => {
    if (count > 1) startInterval();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const goTo = (index: number) => {
    setActiveIndex(Math.max(0, Math.min(count - 1, index)));
    startInterval();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = touchStartX.current - e.changedTouches[0].clientX;
    touchStartX.current = null;
    if (Math.abs(delta) < 40) return;
    if (delta > 0) {
      goTo(Math.min(activeIndex + 1, count - 1));
    } else {
      goTo(Math.max(activeIndex - 1, 0));
    }
  };

  if (count === 0) {
    return (
      <section className="md:hidden relative w-full aspect-square overflow-hidden">
        <div className="w-full h-full bg-surface-container flex items-center justify-center">
          <p className="text-outline font-mono text-xs uppercase">
            No featured events
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="md:hidden relative w-full aspect-square overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Slides container */}
      <div
        className="flex h-full transition-transform duration-300 ease-out"
        style={{
          width: `${count * 100}%`,
          transform: `translateX(-${(activeIndex / count) * 100}%)`,
        }}
      >
        {events.map((event) => (
          <Link
            key={event.id}
            href={`/event/${event.slug}`}
            className="relative block shrink-0"
            style={{ width: `${100 / count}%` }}
          >
            <Image
              src={placeholderImage(event.slug, 800, 800)}
              alt={title(event)}
              fill
              className="object-cover grayscale brightness-50"
              unoptimized
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
            <div className="absolute bottom-10 left-6 right-6">
              <span
                className={`inline-block px-2 py-0.5 text-xs font-bold font-headline mb-2 uppercase tracking-widest ${availClasses(event.availability)}`}
              >
                {availLabel(event.availability)}
              </span>
              <h2 className="text-4xl font-black font-headline text-primary-container leading-none uppercase tracking-tighter mb-1">
                {title(event)}
              </h2>
              {event.title_ja && lang === "en" && (
                <p className="text-xl font-bold font-headline text-white/90">
                  {event.title_ja}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>

      {/* Pagination dots */}
      {count > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
          {events.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === activeIndex
                  ? "bg-primary"
                  : "bg-outline-variant"
              }`}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
