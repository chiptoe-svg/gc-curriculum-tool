import { listPartners, magicLinkUrl, countPositionsByPartner } from '@/lib/partners/queries';
import { PartnersTable } from './PartnersTable';
import { ImportCsvDialog } from './ImportCsvDialog';
import { AddPartnerDialog } from './AddPartnerDialog';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function AdminPartnersPage({ searchParams }: Props) {
  const { slug } = await searchParams;
  if (!slug) {
    return <main className="p-8"><p className="text-sm text-slate-600">Missing slug query param.</p></main>;
  }
  const [raw, positionCounts] = await Promise.all([listPartners(), countPositionsByPartner()]);
  // Compute magicLinkUrl server-side (reads PARTNERS_BASE_URL from process.env,
  // which isn't available in the client bundle) before stripping magicToken.
  // Convert Date columns to ISO strings so they cross the server→client
  // component boundary cleanly and match PartnersTable's prop type.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const partners = raw.map(({ magicToken, ...rest }) => ({
    ...rest,
    magicLinkUrl: magicLinkUrl({ magicToken }),
    invitedAt: rest.invitedAt ? rest.invitedAt.toISOString() : null,
    lastActiveAt: rest.lastActiveAt ? rest.lastActiveAt.toISOString() : null,
    firstOpenedAt: rest.firstOpenedAt ? rest.firstOpenedAt.toISOString() : null,
    createdAt: rest.createdAt.toISOString(),
    tokenExpiresAt: rest.tokenExpiresAt ? rest.tokenExpiresAt.toISOString() : null,
    draftCount: positionCounts.get(rest.id)?.draft ?? 0,
    submittedCount: positionCounts.get(rest.id)?.submitted ?? 0,
  }));

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Industry partners</h1>
          <p className="text-sm text-slate-600">{partners.length} on file.</p>
        </div>
        <div className="flex items-center gap-2">
          <AddPartnerDialog slug={slug} />
          <ImportCsvDialog slug={slug} />
        </div>
      </header>
      <PartnersTable partners={partners} slug={slug} />
    </main>
  );
}
