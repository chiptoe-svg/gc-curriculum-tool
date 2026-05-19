import { NextResponse } from 'next/server';
import { resolvePartner } from '@/lib/partners/auth';
import { submitDraft } from '@/lib/partners/submission-queries';
import { bumpLastActive, logPartnerEvent } from '@/lib/partners/queries';

interface Ctx { params: Promise<{ submissionId: string }>; }

export async function POST(req: Request, { params }: Ctx) {
  const url = new URL(req.url);
  const partner = await resolvePartner(req, url.searchParams.get('token'));
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { submissionId } = await params;
  const row = await submitDraft(partner.id, submissionId);
  if (!row) return NextResponse.json({ error: 'draft not found or already submitted' }, { status: 409 });
  await bumpLastActive(partner.id);
  await logPartnerEvent(partner.id, 'submitted_position', {
    submissionId: row.id,
    careerTargetId: row.careerTargetId,
    unmappedTargetLabel: row.unmappedTargetLabel,
  });
  return NextResponse.json({ submission: row });
}
