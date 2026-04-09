import type { Metadata } from 'next';
import { Space_Grotesk, Inter } from 'next/font/google';
import './globals.css';
import { TopNav, BottomNav } from '@/components/Navigation';
import { Footer } from '@/components/Footer';
import { ErrorHandler } from '@/components/ErrorHandler';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable} dark`} suppressHydrationWarning>
      <body className="bg-background text-on-background font-body selection:bg-primary selection:text-on-primary min-h-screen flex flex-col" suppressHydrationWarning>
        <ErrorHandler />
        <TopNav />
        <div className="flex flex-1">
          {children}
        </div>
        <Footer />
        <BottomNav />
      </body>
    </html>
  );
}
