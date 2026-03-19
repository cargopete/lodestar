import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { BottomNav } from '@/components/layout/BottomNav';
import { IntelFeed } from '@/components/layout/IntelFeed';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <div className="min-h-screen bg-[var(--bg)]">
            <Sidebar />
            <Topbar />
            <BottomNav />
            <IntelFeed />
            <main className="md:pl-[var(--sidebar-width)] lg:pr-[var(--feed-active-width)] pt-[var(--topbar-height)] pb-[calc(var(--bottom-nav-height)+var(--safe-bottom))] md:pb-0 transition-[padding] duration-200">
              <div className="p-4 md:p-6 max-w-[1440px]">{children}</div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
