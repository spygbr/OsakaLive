import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "How to Buy Concert Tickets in Osaka | Osaka Live",
  description: "Step-by-step guide to buying live music tickets in Osaka — e+, pia, lawson, and door tickets explained for English speakers.",
  alternates: { canonical: "https://osaka-live.net/tickets" },
};
import Image from "next/image";
import Link from "next/link";
import { ChevronRight, QrCode, Calendar, MapPin } from "lucide-react";

export default function TicketsPage() {
  return (
    <>
      <Sidebar />
      <main className="flex-1 bg-surface-dim pb-20 md:pb-0 overflow-x-hidden">
        {/* Breadcrumbs */}
        <div className="hidden md:flex items-center justify-between px-8 py-4 border-b border-outline-variant bg-surface-container-lowest">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-outline">
            <Link href="/" className="hover:text-primary transition-colors">ROOT</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-primary">MY_TICKETS</span>
          </div>
          <div className="text-[10px] font-mono text-outline uppercase tracking-widest">
            USER: [AUTH_REQUIRED]
          </div>
        </div>

        {/* Header Hero */}
        <section className="p-4 md:p-8 border-b border-outline-variant bg-surface-container">
          <h1 className="text-3xl md:text-5xl font-black font-headline tracking-tighter uppercase leading-none">
            MY TICKETS / <br className="hidden md:block" />
            <span className="text-primary">チケット</span>
          </h1>
          
          {/* Tabs */}
          <div className="flex gap-6 mt-8 border-b border-outline-variant">
            <button className="pb-2 border-b-2 border-primary text-primary font-headline font-bold text-sm uppercase tracking-widest">
              UPCOMING (2)
            </button>
            <button className="pb-2 border-b-2 border-transparent text-outline hover:text-on-surface transition-colors font-headline font-bold text-sm uppercase tracking-widest">
              PAST EVENTS
            </button>
          </div>
        </section>

        {/* Tickets List */}
        <section className="p-4 md:p-8 flex flex-col gap-6">
          
          {/* Ticket 1 */}
          <div className="bg-surface border border-outline-variant flex flex-col md:flex-row overflow-hidden group">
            {/* QR Section */}
            <div className="bg-primary-container p-6 flex flex-col items-center justify-center shrink-0 md:w-48 border-b md:border-b-0 md:border-r border-outline-variant relative">
              <div className="bg-white p-2 mb-2">
                <QrCode className="w-24 h-24 text-black" />
              </div>
              <span className="font-mono text-[10px] text-on-primary-container font-black tracking-widest uppercase">SCAN AT DOOR</span>
              <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-surface-dim border-r border-outline-variant hidden md:block"></div>
              <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-surface-dim border-l border-outline-variant hidden md:block"></div>
            </div>
            
            {/* Details Section */}
            <div className="p-6 flex-1 flex flex-col justify-between relative">
              <div>
                <div className="flex justify-between items-start mb-2">
                  <span className="bg-surface-container-highest text-on-surface px-2 py-1 text-[9px] font-bold font-mono uppercase tracking-widest">TICKET ID: #TK-8921-A</span>
                  <span className="text-primary font-bold font-headline text-xs uppercase tracking-widest animate-pulse">VALID</span>
                </div>
                <h3 className="font-headline font-black text-2xl md:text-3xl uppercase tracking-tighter mb-4">NOISE MASSACRE VOL. 92</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2 text-on-surface-variant">
                    <Calendar className="w-4 h-4 text-primary" />
                    <span className="font-mono text-xs uppercase">2024.11.15 (FRI) 18:30</span>
                  </div>
                  <div className="flex items-center gap-2 text-on-surface-variant">
                    <MapPin className="w-4 h-4 text-primary" />
                    <span className="font-mono text-xs uppercase">HOKAGE / 火影</span>
                  </div>
                </div>
              </div>
              
              <div className="mt-6 pt-4 border-t border-outline-variant flex justify-between items-end">
                <div>
                  <p className="text-[10px] font-mono text-outline uppercase mb-1">TICKET TYPE</p>
                  <p className="font-headline font-bold text-sm uppercase">ADVANCE (1 PERSON)</p>
                </div>
                <Link href="/search" className="text-[10px] font-headline font-bold text-primary border-b border-primary uppercase tracking-widest hover:text-primary-container transition-colors">
                  VIEW EVENT
                </Link>
              </div>
            </div>
          </div>

          {/* Ticket 2 */}
          <div className="bg-surface border border-outline-variant flex flex-col md:flex-row overflow-hidden group">
            {/* QR Section */}
            <div className="bg-surface-container-highest p-6 flex flex-col items-center justify-center shrink-0 md:w-48 border-b md:border-b-0 md:border-r border-outline-variant relative">
              <div className="bg-white/50 p-2 mb-2">
                <QrCode className="w-24 h-24 text-black/50" />
              </div>
              <span className="font-mono text-[10px] text-outline font-black tracking-widest uppercase">NOT YET ACTIVE</span>
              <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-surface-dim border-r border-outline-variant hidden md:block"></div>
              <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-surface-dim border-l border-outline-variant hidden md:block"></div>
            </div>
            
            {/* Details Section */}
            <div className="p-6 flex-1 flex flex-col justify-between relative">
              <div>
                <div className="flex justify-between items-start mb-2">
                  <span className="bg-surface-container-highest text-on-surface px-2 py-1 text-[9px] font-bold font-mono uppercase tracking-widest">TICKET ID: #TK-9044-B</span>
                  <span className="text-outline font-bold font-headline text-xs uppercase tracking-widest">RESERVED</span>
                </div>
                <h3 className="font-headline font-black text-2xl md:text-3xl uppercase tracking-tighter mb-4 text-on-surface-variant">KIKAGAKU MOYO FINAL TOUR</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2 text-outline">
                    <Calendar className="w-4 h-4" />
                    <span className="font-mono text-xs uppercase">2024.12.12 (THU) 19:00</span>
                  </div>
                  <div className="flex items-center gap-2 text-outline">
                    <MapPin className="w-4 h-4" />
                    <span className="font-mono text-xs uppercase">BIGCAT SHINSAIBASHI</span>
                  </div>
                </div>
              </div>
              
              <div className="mt-6 pt-4 border-t border-outline-variant flex justify-between items-end">
                <div>
                  <p className="text-[10px] font-mono text-outline uppercase mb-1">TICKET TYPE</p>
                  <p className="font-headline font-bold text-sm uppercase text-on-surface-variant">ADVANCE (2 PEOPLE)</p>
                </div>
                <Link href="/search" className="text-[10px] font-headline font-bold text-outline border-b border-outline uppercase tracking-widest hover:text-on-surface transition-colors">
                  VIEW EVENT
                </Link>
              </div>
            </div>
          </div>

        </section>
      </main>
    </>
  );
}
