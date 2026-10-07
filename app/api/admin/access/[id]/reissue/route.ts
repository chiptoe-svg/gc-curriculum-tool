import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { hasJsonContentType } from '@/lib/http/require-json';
import { reissueGrant, buildAccessLink, isValidGrantId } from '@/lib/auth/grant-admin';

const NO_STORE = { 'Cache-Control': 'no-store' };

// POST /api/admin/access/[id]/reissue — "Send a new link": revokes the old
// grant and mints a replacement with the same details, atomically (see
// reissueGrant in lib/auth/grant-admin.ts for why revoke-not-rotate, and for
// the admin-managed/revoked/expired refusals below — fix round 1, M1/L1/L5).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Content-type gate before auth/parsing (fix round 1, M2) — see route.ts.
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: 'content-type must be application/json' }, { status: 415, headers: NO_STORE });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!checkAdminAuth(req, { slug: typeof body.slug === 'string' ? body.slug : '' })) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  if (!isValidGrantId(id)) {
    return NextResponse.json({ error: 'not found' }, { status: 400, headers: NO_STORE });
  }

  const result = await reissueGrant(id);
  if (result === 'not-found') return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
  if (result === 'revoked') return NextResponse.json({ error: 'this grant is already revoked' }, { status: 409, headers: NO_STORE });
  if (result === 'admin-managed') {
    return NextResponse.json({ error: 'this access is managed from the command line' }, { status: 409, headers: NO_STORE });
  }
  if (result === 'expired') {
    return NextResponse.json({ error: 'this grant is expired — edit the expiry first' }, { status: 409, headers: NO_STORE });
  }

  const link = buildAccessLink(result.token, process.env.PUBLIC_HTTPS_ORIGIN?.trim() || undefined);
  return NextResponse.json({ grant: result.grant, link }, { headers: NO_STORE });
}
