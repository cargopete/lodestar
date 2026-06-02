import type { Metadata, Viewport } from 'next';
import { DM_Sans, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { BottomNav } from '@/components/layout/BottomNav';
import { IntelFeed } from '@/components/layout/IntelFeed';
import { Footer } from '@/components/layout/Footer';
import { StarPrompt } from '@/components/StarPrompt';
import { CampBanner } from '@/components/CampBanner';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Lodestar | The Graph Protocol Analytics',
  description: 'Stay oriented. Staking analytics, indexer intelligence, and portfolio tracking for The Graph Protocol.',
  metadataBase: new URL('https://lodestar-dashboard.com'),
  openGraph: {
    title: 'Lodestar — Stay oriented.',
    description: 'Analytics dashboard for The Graph Protocol ecosystem.',
    siteName: 'Lodestar',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lodestar — Stay oriented.',
    description: 'Analytics dashboard for The Graph Protocol ecosystem.',
  },
  icons: {
    icon: '/lodestar.png',
    apple: '/lodestar.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${dmSans.variable} ${geist.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <div className="min-h-screen">
            <Sidebar />
            <Topbar />
            <BottomNav />
            <IntelFeed />
            <main className="md:pl-[var(--sidebar-width)] lg:pr-[var(--feed-active-width)] pt-[var(--topbar-height)] pb-[calc(var(--bottom-nav-height)+var(--safe-bottom))] md:pb-0 transition-[padding] duration-200">
              <div className="p-4 md:p-6 max-w-[1440px] mx-auto">
                <CampBanner />
                {children}
              </div>
            </main>
            <Footer />
            <StarPrompt />
          </div>
        </Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
