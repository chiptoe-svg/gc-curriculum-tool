import { NextResponse } from 'next/server';
import { markInvited, logPartnerEvent } from '@/lib/partners/queries';

interface RouteContext {
  params: Promise<{ partnerId: string }>;
}

/**
 * POST /api/admin/partners/[partnerId]/mark-invited
 * Body: {}
 * Returns: { invitedAt: ISO string }
 *
 * Stamps invitedAt on the partner row. Called by the admin UI's
 * "Mark invited" button after the admin sends the magic-link email
 * from their own client (Outlook, Apple Mail, etc.).
 *
 * No email is sent from this endpoint — the admin sends it manually.
 * The endpoint exists only to record that the admin has done so, so
 * the table can show "invited 3 days ago" and the admin knows who
 * still needs a nudge.
 */
export async function POST(_req: Request, { params }: RouteContext): Promise<Response> {
  const { partnerId } = await params;
  if (!partnerId) return NextResponse.json({ error: 'partnerId required' }, { status: 400 });

  await markInvited(partnerId);
  await logPartnerEvent(partnerId, 'invite_marked_sent');

  return NextResponse.json({ invitedAt: new Date().toISOString() });
}
