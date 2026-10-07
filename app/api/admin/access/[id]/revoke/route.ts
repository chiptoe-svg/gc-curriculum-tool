import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { hasJsonContentType } from '@/lib/http/require-json';
import { revokeGrant, isValidGrantId } from '@/lib/auth/grant-admin';

const NO_STORE = { 'Cache-Control': 'no-store' };

// POST /api/admin/access/[id]/revoke — sets revoked_at. Idempotent. Unlike
// PATCH/reissue, revoking a CLI admin grant is allowed (killing access is
// always safe; only re-minting/editing one is refused — see L1 in grant-admin.ts).
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

  const result = await revokeGrant(id);
  if (result === 'not-found') return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
