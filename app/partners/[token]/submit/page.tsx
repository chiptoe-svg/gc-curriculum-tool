import { notFound } from 'next/navigation';
import { findPartnerByToken } from '@/lib/partners/queries';
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { SubmissionWizard } from './SubmissionWizard';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ draft?: string }>;
}

export const dynamic = 'force-dynamic';

export default async function SubmitPage({ params, searchParams }: Props) {
  const [{ token }, { draft }] = await Promise.all([params, searchParams]);
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return notFound();

  const targets = await db.select({
    id: careerTargets.id,
    name: careerTargets.name,
    shortDefinition: careerTargets.shortDefinition,
    industryContexts: careerTargets.industryContexts,
  }).from(careerTargets).orderBy(asc(careerTargets.displayOrder));

  return <SubmissionWizard token={token} targets={targets} draftId={draft ?? null} />;
}
