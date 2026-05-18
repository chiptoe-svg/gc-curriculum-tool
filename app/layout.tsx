import type { Metadata } from 'next';
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
      </body>
    </html>
  );
}
