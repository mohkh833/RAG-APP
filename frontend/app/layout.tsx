import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic, Inter, Newsreader } from 'next/font/google';
import './globals.css';
import { AppStateProvider } from '@/components/app-state';
import { NavBar } from '@/components/nav-bar';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  display: 'swap',
});

// Arabic answers get a face actually designed for the script, rather than
// falling back to a Latin one that renders the glyphs but not the rhythm.
const plexArabic = IBM_Plex_Sans_Arabic({
  variable: '--font-arabic-sans',
  subsets: ['arabic'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Verdigris — RAG console',
  description: 'Ask questions of your ingested documents.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${inter.variable} ${newsreader.variable} ${plexArabic.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <AppStateProvider>
          <NavBar />
          <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-8">
            {children}
          </main>
        </AppStateProvider>
      </body>
    </html>
  );
}
