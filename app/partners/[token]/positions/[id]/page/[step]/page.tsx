import { notFound, redirect } from 'next/navigation';
import { findPartnerByToken } from '@/lib/partners/queries';
import { getPositionCaptureById } from '@/lib/db/position-capture-queries';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { PositionWizard } from './PositionWizard';

interface Props { params: Promise<{ token: string; id: string; step: string }> }

const VALID_STEPS = ['1', '2', '3', '4', '5', '6'] as const;

export const dynamic = 'force-dynamic';

export default async function WizardStepPage({ params }: Props) {
  const { token, id, step } = await params;
  if (!VALID_STEPS.includes(step as typeof VALID_STEPS[number])) notFound();

  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) notFound();

  const capture = await getPositionCaptureById(id);
  if (!capture) notFound();
  if (capture.partnerId !== partner.id) notFound();
  if (capture.status !== 'draft') {
    redirect(`/partners/${encodeURIComponent(token)}`);
  }

  const target = await getTargetById(capture.careerTargetId);
  if (!target) notFound();

  return (
    <PositionWizard
      token={token}
      step={parseInt(step, 10) as 1 | 2 | 3 | 4 | 5 | 6}
      capture={{
        id: capture.id,
        positionTitle: capture.positionTitle,
        company: capture.company,
        structuredInputs: capture.structuredInputs ?? {},
        ratedSkills: capture.ratedSkills,
        sessionId: capture.sessionId,
      }}
      target={{ id: target.id, name: target.name, shortDefinition: target.shortDefinition ?? '' }}
    />
  );
}
