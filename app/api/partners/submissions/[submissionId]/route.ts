import { NextResponse } from 'next/server';
import { resolvePartner } from '@/lib/partners/auth';
import { findSubmission, updateDraft, deleteSubmission } from '@/lib/partners/submission-queries';
import { bumpLastActive } from '@/lib/partners/queries';

interface Ctx { params: Promise<{ submissionId: string }>; }

async function authed(req: Request) {
  const url = new URL(req.url);
  return resolvePartner(req, url.searchParams.get('token'));
}

export async function GET(req: Request, { params }: Ctx) {
  const partner = await authed(req);
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { submissionId } = await params;
  const submission = await findSubmission(partner.id, submissionId);
  if (!submission) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ submission });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const partner = await authed(req);
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { submissionId } = await params;
  const body = await req.json().catch(() => ({}));
  const updated = await updateDraft(partner.id, submissionId, body);
  if (!updated) return NextResponse.json({ error: 'draft not found or already submitted' }, { status: 404 });
  await bumpLastActive(partner.id);
  return NextResponse.json({ submission: updated });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const partner = await authed(req);
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { submissionId } = await params;
  const ok = await deleteSubmission(partner.id, submissionId);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await bumpLastActive(partner.id);
  return new NextResponse(null, { status: 204 });
}
