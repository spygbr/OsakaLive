import type { Metadata } from 'next';
import { Space_Grotesk, Inter } from 'next/font/google';
import './globals.css';
import { TopNav, BottomNav } from '@/components/Navigation';
import { Footer } from '@/components/Footer';
import { ErrorHandler } from '@/components/ErrorHandler';
import { LangProvider } from '@/lib/i18n/LangProvider';
import { getLang } from '@/lib/i18n/server';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Osaka Live House Guide',
  description: 'Underground music events in Osaka',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang} className={`${spaceGrotesk.variable} ${inter.variable} dark`} suppressHydrationWarning>
      <body className="bg-background text-on-background font-body selection:bg-primary selection:text-on-primary min-h-screen flex flex-col" suppressHydrationWarning>
        <LangProvider initialLang={lang}>
          <ErrorHandler />
          <TopNav />
          <div className="flex flex-1">
            {children}
          </div>
          <Footer />
          <BottomNav />
        </LangProvider>
      </body>
    </html>
  );
}
