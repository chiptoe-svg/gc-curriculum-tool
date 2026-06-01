import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Fraunces, DM_Sans, IBM_Plex_Mono } from 'next/font/google';
import { FeedbackWidget } from './FeedbackWidget';
import './globals.css';

const serif = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
});

const sans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono-plex',
  weight: ['400', '500'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'GC Curriculum Tool — Prototype',
  description: 'A prototype for the Clemson Graphic Communications curriculum design tool.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        {/* Widget self-gates on `?slug=` presence so it never renders on
            partner / preview / unauthenticated landings. Wrapped in Suspense
            so useSearchParams works during Next 15 streaming. */}
        <Suspense fallback={null}>
          <FeedbackWidget />
        </Suspense>
      </body>
    </html>
  );
}
