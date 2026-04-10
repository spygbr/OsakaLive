"use client";

import { Ticket } from "lucide-react";

interface MobileTicketBarProps {
  eventTitle: string;
  venueName: string;
  eventDate: string;
  ticketUrl: string | null;
  ticketPriceAdv: number | null;
  availability: string;
  reserveLabel: string;
  soldOutLabel: string;
  atDoorLabel: string;
}

function formatPriceLocal(p: number | null | undefined): string {
  if (!p) return "";
  return `¥${p.toLocaleString()}`;
}

export function MobileTicketBar({
  eventTitle,
  venueName,
  eventDate,
  ticketUrl,
  ticketPriceAdv,
  availability,
  reserveLabel,
  soldOutLabel,
  atDoorLabel,
}: MobileTicketBarProps) {
  return (
    <div
      className="md:hidden fixed left-0 right-0 z-40 bg-surface-container border-t-2 border-primary-container flex items-center gap-3 px-4 py-3"
      style={{
        bottom: `calc(64px + env(safe-area-inset-bottom))`,
      }}
    >
      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-mono text-outline uppercase truncate">
          {venueName} · {eventDate}
        </p>
        <p className="text-sm font-headline font-bold uppercase leading-tight truncate">
          {eventTitle}
        </p>
      </div>

      {/* Price + CTA */}
      <div className="flex items-center gap-2 shrink-0">
        {ticketPriceAdv && (
          <span className="text-sm font-black font-headline text-primary">
            {formatPriceLocal(ticketPriceAdv)}
          </span>
        )}
        {ticketUrl ? (
          <a
            href={ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary text-on-primary font-headline font-black text-xs uppercase px-4 py-2 active:scale-95 transition-transform flex items-center gap-1.5"
          >
            <Ticket className="w-3 h-3" />
            {reserveLabel}
          </a>
        ) : (
          <span className="text-outline font-headline font-black text-xs uppercase px-4 py-2 bg-surface-container-highest">
            {availability === "sold_out" ? soldOutLabel : atDoorLabel}
          </span>
        )}
      </div>
    </div>
  );
}
