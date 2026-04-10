import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { TopNav, BottomNav } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { ErrorHandler } from "@/components/ErrorHandler";
import { LangProvider } from "@/lib/i18n/LangProvider";
import { FilterDrawerProvider } from "@/lib/filter-drawer-context";
import { MobileFilterDrawer } from "@/components/MobileFilterDrawer";
import { getLang } from "@/lib/i18n/server";
import { getAreas, getGenres } from "@/lib/supabase/queries";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Osaka Live House Guide",
  description: "Underground music events in Osaka",
  themeColor: "#f2ca50",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [lang, areas, genres] = await Promise.all([
    getLang(),
    getAreas(),
    getGenres(),
  ]);

  return (
    <html
      lang={lang}
      className={`${spaceGrotesk.variable} ${inter.variable} dark`}
      suppressHydrationWarning
    >
      <body
        className="bg-background text-on-background font-body selection:bg-primary selection:text-on-primary min-h-screen flex flex-col"
        suppressHydrationWarning
      >
        <LangProvider initialLang={lang}>
          <FilterDrawerProvider>
            <ErrorHandler />
            <TopNav />
            <MobileFilterDrawer areas={areas} genres={genres} />
            <div className="flex flex-1">{children}</div>
            <Footer />
            <BottomNav />
          </FilterDrawerProvider>
        </LangProvider>
      </body>
    </html>
  );
}
