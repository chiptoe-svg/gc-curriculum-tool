import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  findPartnerByToken,
  markFirstOpenedIfNull,
  bumpLastActive,
  logPartnerEvent,
} from '@/lib/partners/queries';
import { createSession, SESSION_COOKIE } from '@/lib/partners/sessions';
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

  // Issue / refresh the session cookie. The token in the URL is authoritative;
  // the cookie is a convenience so /api calls don't need to re-include the token.
  const session = await createSession(partner.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: session.expiresAt,
    path: '/',
  });

  // First-time arrival side effects.
  if (!partner.firstOpenedAt) {
    await markFirstOpenedIfNull(partner.id);
    await logPartnerEvent(partner.id, 'opened', { token });
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
