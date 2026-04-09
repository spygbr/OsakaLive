import { Share2, Rss } from "lucide-react";

export function Footer() {
  return (
    <footer className="hidden md:grid w-full py-12 px-8 grid-cols-1 md:grid-cols-3 gap-8 bg-background border-t-2 border-outline-variant">
      <div className="flex flex-col gap-4">
        <div className="text-md font-bold text-primary font-headline uppercase tracking-tighter">OSAKA LIVE HOUSE GUIDE</div>
        <p className="font-mono text-[10px] text-outline uppercase leading-relaxed">
          ©2024 OSAKA LIVE HOUSE GUIDE. ALL RIGHTS RESERVED. Unauthorized duplication is a violation of applicable laws.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-widest">
          <a className="text-outline hover:text-primary underline" href="#">Sitemap</a>
          <a className="text-outline hover:text-primary underline" href="#">Privacy Policy</a>
          <a className="text-outline hover:text-primary underline" href="#">Contact</a>
        </div>
        <div className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-widest">
          <a className="text-outline hover:text-primary underline" href="#">Terms of Service</a>
          <a className="text-outline hover:text-primary underline" href="#">Venue Submission</a>
          <a className="text-outline hover:text-primary underline" href="#">Artist Portal</a>
        </div>
      </div>
      <div className="flex flex-col items-start md:items-end gap-4">
        <div className="bg-primary-container text-background p-2 text-[10px] font-bold font-mono">STAMP: VERIFIED_OSAKA_HUB</div>
        <div className="flex gap-4">
          <Rss className="w-5 h-5 text-outline hover:text-primary cursor-pointer" />
          <Share2 className="w-5 h-5 text-outline hover:text-primary cursor-pointer" />
        </div>
      </div>
    </footer>
  );
}
