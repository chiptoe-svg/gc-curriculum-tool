import { NextResponse } from 'next/server';
import { resolvePartner } from '@/lib/partners/auth';
import { listSubmissions, createDraft } from '@/lib/partners/submission-queries';
import { bumpLastActive, logPartnerEvent } from '@/lib/partners/queries';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const partner = await resolvePartner(req, url.searchParams.get('token'));
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const submissions = await listSubmissions(partner.id);
  return NextResponse.json({ submissions });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const partner = await resolvePartner(req, url.searchParams.get('token'));
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body.positionTitle || typeof body.positionTitle !== 'string') {
    return NextResponse.json({ error: 'positionTitle is required' }, { status: 400 });
  }

  const submission = await createDraft(partner.id, body);
  await bumpLastActive(partner.id);
  await logPartnerEvent(partner.id, 'started_submission', { submissionId: submission.id });
  return NextResponse.json({ submission }, { status: 201 });
}
