import Link from 'next/link';
import { SandboxGrantsPanel } from './SandboxGrantsPanel';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-slate-600">
          Operator tools.{' '}
          <Link href="/admin/partners?slug=" className="text-blue-700 underline">Partners</Link>
          {' · '}
          <Link href="/admin/synthesis" className="text-blue-700 underline">Synthesis</Link>
        </p>
      </header>
      <SandboxGrantsPanel />
    </main>
  );
}
