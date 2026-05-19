import type { ReactNode } from 'react';
import './partner-shell.css';

interface Props {
  children: ReactNode;
}

export default function PartnerLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Clemson Graphic Communications</div>
            <div className="text-sm font-medium">Industry Partner Survey</div>
          </div>
          <div className="text-xs text-slate-500">Thanks for your time.</div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-4xl px-6 py-12 text-xs text-slate-500">
        Your responses go directly to the GC faculty curriculum committee.
      </footer>
    </div>
  );
}
