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
import { getAreas, getGenresWithCounts } from "@/lib/supabase/queries";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const BASE_URL = "https://osaka-live.net";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "Osaka Live House Guide | Underground Music Events & Venues",
    template: "%s | Osaka Live",
  },
  description:
    "Discover underground live music in Osaka — punk, metal, jazz, electronic & more. Upcoming shows, ticket info, and a venue guide for Namba, Shinsaibashi & beyond.",
  keywords: [
    "osaka live music",
    "osaka livehouse",
    "osaka live house",
    "osaka underground music",
    "namba live music",
    "kansai live music",
    "osaka concerts",
    "osaka punk",
    "osaka metal",
    "osaka jazz",
    "japan live music",
    "osaka shows tonight",
  ],
  authors: [{ name: "Osaka Live" }],
  creator: "Osaka Live",
  publisher: "Osaka Live",
  robots: { index: true, follow: true },
  alternates: { canonical: BASE_URL },
  openGraph: {
    type: "website",
    locale: "en_US",
    alternateLocale: "ja_JP",
    url: BASE_URL,
    siteName: "Osaka Live House Guide",
    title: "Osaka Live House Guide | Underground Music Events & Venues",
    description:
      "Discover underground live music in Osaka — punk, metal, jazz, electronic & more. Upcoming shows, ticket info, and venue guide.",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "Osaka Live" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Osaka Live House Guide",
    description: "Underground live music in Osaka — upcoming shows, venues & tickets.",
    images: ["/icons/icon-512.png"],
  },
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
    getGenresWithCounts(),
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
