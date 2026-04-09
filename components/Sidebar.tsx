"use client";

import { Map as MapIcon, Calendar, Settings, HelpCircle } from "lucide-react";

export function Sidebar() {
  return (
    <aside className="hidden md:flex flex-col h-[calc(100vh-64px)] sticky top-16 left-0 overflow-y-auto bg-surface-container-lowest border-r border-outline-variant divide-y divide-outline-variant w-64 shrink-0">
      <div className="p-6">
        <div className="text-lg font-bold text-primary font-headline uppercase">FILTER SYSTEM</div>
        <div className="text-[10px] text-outline font-mono tracking-widest mt-1">V.2.04_ARCHIVE</div>
      </div>
      <div className="py-4">
        <div className="px-6 mb-2 text-[10px] text-primary font-bold tracking-widest uppercase">DATE / 日程</div>
        <div className="bg-primary-container text-background font-bold p-3 px-6 flex items-center gap-3 font-headline uppercase text-xs border-l-4 border-primary">
          <Calendar className="w-4 h-4" />
          ALL UPCOMING
        </div>
        <div className="text-outline p-3 px-6 hover:bg-surface-container flex items-center gap-3 font-headline uppercase text-xs transition-colors cursor-pointer">
          <Calendar className="w-4 h-4" />
          TONIGHT
        </div>
        <div className="text-outline p-3 px-6 hover:bg-surface-container flex items-center gap-3 font-headline uppercase text-xs transition-colors cursor-pointer">
          <Calendar className="w-4 h-4" />
          WEEKEND
        </div>
      </div>
      <div className="py-4">
        <div className="px-6 mb-2 text-[10px] text-primary font-bold tracking-widest uppercase">AREA / エリア</div>
        <div className="text-outline p-3 px-6 hover:bg-surface-container flex items-center gap-3 font-headline uppercase text-xs transition-colors cursor-pointer">
          <MapIcon className="w-4 h-4" />
          NAMBA / 難波
        </div>
        <div className="text-outline p-3 px-6 hover:bg-surface-container flex items-center gap-3 font-headline uppercase text-xs transition-colors cursor-pointer">
          <MapIcon className="w-4 h-4" />
          SHINSAIBASHI / 心斎橋
        </div>
        <div className="text-outline p-3 px-6 hover:bg-surface-container flex items-center gap-3 font-headline uppercase text-xs transition-colors cursor-pointer">
          <MapIcon className="w-4 h-4" />
          UMEDA / 梅田
        </div>
      </div>
      <div className="py-4">
        <div className="px-6 mb-2 text-[10px] text-primary font-bold tracking-widest uppercase">GENRE / ジャンル</div>
        <div className="grid grid-cols-2 gap-px bg-outline-variant border-y border-outline-variant">
          <button className="bg-surface-container-lowest text-outline p-2 hover:bg-surface-container text-[10px] font-bold uppercase">ROCK</button>
          <button className="bg-surface-container-lowest text-outline p-2 hover:bg-surface-container text-[10px] font-bold uppercase">PUNK</button>
          <button className="bg-surface-container-lowest text-outline p-2 hover:bg-surface-container text-[10px] font-bold uppercase">INDIE</button>
          <button className="bg-surface-container-lowest text-outline p-2 hover:bg-surface-container text-[10px] font-bold uppercase">NOISE</button>
        </div>
      </div>
      <div className="mt-auto p-6 flex flex-col gap-4">
        <button className="bg-primary text-on-primary font-headline font-bold py-3 text-sm tracking-tighter uppercase active:translate-y-[1px] transition-all">
          APPLY FILTERS
        </button>
        <div className="flex justify-between items-center text-[10px] text-outline">
          <span className="hover:text-primary cursor-pointer uppercase flex items-center gap-1"><Settings className="w-3 h-3"/> SETTINGS</span>
          <span className="hover:text-primary cursor-pointer uppercase flex items-center gap-1"><HelpCircle className="w-3 h-3"/> HELP</span>
        </div>
      </div>
    </aside>
  );
}
