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
import { RedstartBanner } from '@/components/RedstartBanner';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { NativePushManager } from '@/components/NativePushManager';
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
  themeColor: '#141034',
};

export const metadata: Metadata = {
  title: 'Lodestar | The Graph Protocol Analytics',
  description: 'Stay oriented. Staking analytics, indexer intelligence, and portfolio tracking for The Graph Protocol.',
  metadataBase: new URL('https://lodestar-dashboard.com'),
  applicationName: 'Lodestar',
  appleWebApp: {
    capable: true,
    title: 'Lodestar',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: 'Lodestar: Stay oriented.',
    description: 'Analytics dashboard for The Graph Protocol ecosystem.',
    siteName: 'Lodestar',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lodestar: Stay oriented.',
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
            <main className="md:pl-[var(--sidebar-width)] lg:pr-[var(--feed-active-width)] pt-[calc(var(--safe-top)+var(--topbar-height))] pb-[calc(var(--bottom-nav-height)+var(--safe-bottom))] md:pb-0 transition-[padding] duration-200">
              <div className="p-4 md:p-6 max-w-[1440px] mx-auto">
                <RedstartBanner />
                {children}
              </div>
            </main>
            <Footer />
            <StarPrompt />
            <NativePushManager />
          </div>
        </Providers>
        <Analytics />
        <SpeedInsights />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
