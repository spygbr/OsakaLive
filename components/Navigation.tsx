"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search, Home, Calendar, MapPin, User } from "lucide-react";

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="flex justify-between items-center w-full px-4 md:px-6 h-16 sticky top-0 z-50 bg-neutral-900 md:bg-[#131313] border-b md:border-b-2 border-primary-container md:border-outline-variant">
      <div className="flex items-center gap-4 md:gap-8">
        <button className="md:hidden active:scale-95 transition-transform text-primary-container">
          <Menu className="w-6 h-6" />
        </button>
        <Link href="/" className="text-xl md:text-xl font-black text-primary-container md:text-primary tracking-widest md:tracking-tighter font-headline uppercase">
          OSAKA LIVE<span className="hidden md:inline"> HOUSE GUIDE</span>
        </Link>
        <nav className="hidden md:flex items-center gap-6 font-headline uppercase tracking-tighter text-sm">
          <Link href="/" className={`${pathname === '/' ? 'text-primary border-b-2 border-primary pb-1 translate-y-[1px]' : 'text-[#cecece] hover:text-primary transition-colors'}`}>HOME</Link>
          <Link href="/calendar" className={`${pathname === '/calendar' ? 'text-primary border-b-2 border-primary pb-1 translate-y-[1px]' : 'text-[#cecece] hover:text-primary transition-colors'}`}>CALENDAR</Link>
          <Link href="/search" className={`${pathname === '/search' ? 'text-primary border-b-2 border-primary pb-1 translate-y-[1px]' : 'text-[#cecece] hover:text-primary transition-colors'}`}>VENUES</Link>
          <Link href="/artists" className={`${pathname === '/artists' ? 'text-primary border-b-2 border-primary pb-1 translate-y-[1px]' : 'text-[#cecece] hover:text-primary transition-colors'}`}>ARTISTS</Link>
          <Link href="/tickets" className={`${pathname === '/tickets' ? 'text-primary border-b-2 border-primary pb-1 translate-y-[1px]' : 'text-[#cecece] hover:text-primary transition-colors'}`}>TICKETS</Link>
          <Link href="#" className="text-[#cecece] hover:text-primary transition-colors">JP/EN</Link>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <button className="md:hidden bg-neutral-800 text-primary-container px-3 py-1 text-xs font-headline font-bold border border-primary-container hover:bg-red-900/20 active:scale-95 transition-transform">
          FILTER / 検索
        </button>
        <span className="md:hidden text-primary-container font-headline font-bold tracking-tighter uppercase text-sm">JA/EN</span>
        <button className="hidden md:flex material-symbols-outlined text-primary">
          <Search className="w-6 h-6" />
        </button>
      </div>
    </header>
  );
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-stretch h-16 bg-neutral-900 border-t border-primary-container font-headline text-[10px] font-bold uppercase">
      <Link href="/" className={`flex flex-col items-center justify-center p-1 flex-1 transition-colors ${pathname === '/' ? 'bg-primary-container text-black' : 'text-primary-container hover:bg-red-900/40 active:bg-red-800'}`}>
        <Home className="w-6 h-6 mb-1" />
        <span>Home</span>
      </Link>
      <Link href="/calendar" className={`flex flex-col items-center justify-center p-1 flex-1 transition-colors ${pathname === '/calendar' ? 'bg-primary-container text-black' : 'text-primary-container hover:bg-red-900/40 active:bg-red-800'}`}>
        <Calendar className="w-6 h-6 mb-1" />
        <span>Calendar</span>
      </Link>
      <Link href="/search" className={`flex flex-col items-center justify-center p-1 flex-1 transition-colors ${pathname === '/search' ? 'bg-primary-container text-black' : 'text-primary-container hover:bg-red-900/40 active:bg-red-800'}`}>
        <MapPin className="w-6 h-6 mb-1" />
        <span>Venues</span>
      </Link>
      <Link href="/artists" className={`flex flex-col items-center justify-center p-1 flex-1 transition-colors ${pathname === '/artists' ? 'bg-primary-container text-black' : 'text-primary-container hover:bg-red-900/40 active:bg-red-800'}`}>
        <User className="w-6 h-6 mb-1" />
        <span>Artists</span>
      </Link>
    </nav>
  );
}
