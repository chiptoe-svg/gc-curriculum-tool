import { notFound } from 'next/navigation';
import {
  findPartnerByToken,
  markFirstOpenedIfNull,
  bumpLastActive,
  logPartnerEvent,
} from '@/lib/partners/queries';
import { getPartnerStats } from '@/lib/partners/stats';
import { WelcomeScreen } from './WelcomeScreen';
import { PartnerDashboard } from './PartnerDashboard';

interface Props {
  params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

export default async function PartnerLandingPage({ params }: Props) {
  const { token } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return notFound();

  // The session cookie is issued by middleware.ts — Next.js forbids cookie
  // mutation during a Server Component render. The URL token stays
  // authoritative; the cookie is just the convenience credential.

  // First-time arrival side effects.
  if (!partner.firstOpenedAt) {
    await markFirstOpenedIfNull(partner.id);
    // Do NOT include the magic token in event metadata — it's a bearer credential.
    // The partner is already identified via the partnerId FK.
    await logPartnerEvent(partner.id, 'opened', { firstOpen: true });
  } else {
    await bumpLastActive(partner.id);
  }

  const stats = await getPartnerStats(partner.id);
  const hasActivity = stats.drafts + stats.submitted + stats.ratingsCount > 0;

  if (!hasActivity) {
    return <WelcomeScreen partner={partner} />;
  }
  return <PartnerDashboard partner={partner} stats={stats} />;
}
