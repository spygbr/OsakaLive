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
import { getAreas, getGenresWithCounts, getLastScrapedAt } from "@/lib/supabase/queries";
import { SpeedInsights } from "@vercel/speed-insights/next";

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
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-48x48.png", type: "image/png", sizes: "48x48" },
      { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    alternateLocale: "ja_JP",
    url: BASE_URL,
    siteName: "Osaka Live House Guide",
    title: "Osaka Live House Guide | Underground Music Events & Venues",
    description:
      "Discover underground live music in Osaka — punk, metal, jazz, electronic & more. Upcoming shows, ticket info, and venue guide.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Osaka Live House Guide" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Osaka Live House Guide",
    description: "Underground live music in Osaka — upcoming shows, venues & tickets.",
    images: ["/og-image.png"],
  },
  themeColor: "#f2ca50",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [lang, areas, genres, lastUpdated] = await Promise.all([
    getLang(),
    getAreas(),
    getGenresWithCounts(),
    getLastScrapedAt(),
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
            <Footer lastUpdated={lastUpdated} />
            <BottomNav />
          </FilterDrawerProvider>
        </LangProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
