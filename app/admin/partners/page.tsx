import { listPartners, magicLinkUrl, countPositionsByPartner } from '@/lib/partners/queries';
import { PartnersTable } from './PartnersTable';
import { ImportCsvDialog } from './ImportCsvDialog';
import { AddPartnerDialog } from './AddPartnerDialog';

import '../admin.css';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function AdminPartnersPage({ searchParams }: Props) {
  const { slug } = await searchParams;
  if (!slug) {
    return <main className="ad ad-main"><p className="ad-meta">Missing slug query param.</p></main>;
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
    <div className="ad min-h-screen bg-background">
      <header className="ad-header">
        <div className="ad-header-inner">
          <div>
            <p className="ad-eyebrow">Admin</p>
            <h1 className="ad-title">Industry partners</h1>
            <p className="ad-meta" style={{ marginTop: 4 }}>{partners.length} on file.</p>
          </div>
          <div className="ad-nav">
            <AddPartnerDialog slug={slug} />
            <ImportCsvDialog slug={slug} />
          </div>
        </div>
      </header>
      <main className="ad-main">
        <PartnersTable partners={partners} slug={slug} />
      </main>
    </div>
  );
}
