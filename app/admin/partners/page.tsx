import { listPartners } from '@/lib/partners/queries';
import { PartnersTable } from './PartnersTable';
import { ImportCsvDialog } from './ImportCsvDialog';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function AdminPartnersPage({ searchParams }: Props) {
  const { slug } = await searchParams;
  if (!slug) {
    return <main className="p-8"><p className="text-sm text-slate-600">Missing slug query param.</p></main>;
  }
  const raw = await listPartners();
  // Strip magicToken; convert Date columns to ISO strings so they cross the
  // server→client component boundary cleanly and match PartnersTable's prop type.
  const partners = raw.map(({ magicToken, ...rest }) => ({
    ...rest,
    invitedAt: rest.invitedAt ? rest.invitedAt.toISOString() : null,
    lastActiveAt: rest.lastActiveAt ? rest.lastActiveAt.toISOString() : null,
    firstOpenedAt: rest.firstOpenedAt ? rest.firstOpenedAt.toISOString() : null,
    createdAt: rest.createdAt.toISOString(),
    tokenExpiresAt: rest.tokenExpiresAt ? rest.tokenExpiresAt.toISOString() : null,
  }));

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Industry partners</h1>
          <p className="text-sm text-slate-600">{partners.length} on file.</p>
        </div>
        <ImportCsvDialog slug={slug} />
      </header>
      <PartnersTable partners={partners} slug={slug} />
    </main>
  );
}
