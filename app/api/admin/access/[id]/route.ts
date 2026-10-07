import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { listCourses } from '@/lib/db/courses-queries';
import { patchGrant, validateLabel, validateEmail, validateExpiresAt, resolveScope, buildCan, type GrantPatch } from '@/lib/auth/grant-admin';

const NO_STORE = { 'Cache-Control': 'no-store' };

// PATCH /api/admin/access/[id] — edit in place. Body (each key optional):
// { courses?, canCreate?, label?, email?, expiresAt?, slug }. 409s on a
// revoked grant (patchGrant refuses). Course changes take effect immediately
// — authorize() re-reads the stored grant per request, nothing is cached.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!checkAdminAuth(req, { slug: typeof body.slug === 'string' ? body.slug : '' })) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  const patch: GrantPatch = {};

  if ('label' in body) {
    const r = validateLabel(body.label);
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400, headers: NO_STORE });
    patch.label = r.label;
  }
  if ('email' in body) {
    const r = validateEmail(body.email);
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400, headers: NO_STORE });
    patch.email = r.email;
  }
  if ('expiresAt' in body) {
    const r = validateExpiresAt(body.expiresAt);
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400, headers: NO_STORE });
    patch.expiresAt = r.expiresAt;
  }
  if ('courses' in body) {
    const known = (await listCourses()).map((c) => c.code);
    const r = resolveScope(body.courses, known);
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400, headers: NO_STORE });
    patch.scope = r.scope;
  }
  // `can` is always rebuilt from a boolean, same as POST — never from the body directly.
  if ('canCreate' in body) patch.can = buildCan(body.canCreate === true);

  const result = await patchGrant(id, patch);
  if (result === 'not-found') return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
  if (result === 'revoked') return NextResponse.json({ error: 'this grant is revoked' }, { status: 409, headers: NO_STORE });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
