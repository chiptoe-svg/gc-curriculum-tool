import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FeedbackWidget } from './FeedbackWidget';
import './globals.css';

export const metadata: Metadata = {
  title: 'GC Curriculum Tool — Prototype',
  description: 'A prototype for the Clemson Graphic Communications curriculum design tool.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
