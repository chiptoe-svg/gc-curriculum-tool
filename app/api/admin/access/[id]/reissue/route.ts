import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { reissueGrant, buildAccessLink } from '@/lib/auth/grant-admin';

const NO_STORE = { 'Cache-Control': 'no-store' };

// POST /api/admin/access/[id]/reissue — "Send a new link": revokes the old
// grant and mints a replacement with the same details, atomically (see
// reissueGrant in lib/auth/grant-admin.ts for why revoke-not-rotate).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!checkAdminAuth(req, { slug: typeof body.slug === 'string' ? body.slug : '' })) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  const result = await reissueGrant(id);
  if (!result) return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });

  const link = buildAccessLink(result.token, process.env.PUBLIC_HTTPS_ORIGIN?.trim() || undefined);
  return NextResponse.json({ grant: result.grant, link }, { headers: NO_STORE });
}
