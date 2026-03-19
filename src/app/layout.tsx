import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

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
            <main className="pl-[var(--sidebar-width)] pt-[var(--topbar-height)]">
              <div className="p-6 max-w-[1440px]">{children}</div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
