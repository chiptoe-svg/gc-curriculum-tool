import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { deleteLocal, keyFromLocalUrl } from '@/lib/storage/local-storage';
import {
  getMaterialById,
  deleteMaterial,
  setMaterialIgnored,
  setMaterialIgnoredItems,
  setMaterialUseDigest,
  updateFerpaRisk,
  updateMaterialTier,
} from '@/lib/db/course-materials-queries';

interface RouteContext {
  params: Promise<{ code: string; id: string }>;
}

export async function DELETE(req: Request, { params }: RouteContext): Promise<Response> {
  const { code, id } = await params;
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!(await authorizeCourseWrite(req, code, slug))) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const material = await getMaterialById(id);
  if (!material) {
    return NextResponse.json({ error: 'material not found' }, { status: 404 });
  }
  if (material.courseCode !== code) {
    return NextResponse.json({ error: 'material does not belong to this course' }, { status: 403 });
  }

  // Storage cleanup: local FS, or external URLs (Canvas / Google Docs are
  // passthrough references — nothing to delete). Vercel Blob branch removed
  // 2026-06-04 — zero rows in course_materials still referenced blob.vercel-storage.com.
  const localKey = keyFromLocalUrl(material.blobUrl);
  if (localKey) {
    await deleteLocal(localKey).catch(err => console.error('local delete failed', err));
  }
  await deleteMaterial(id);

  return NextResponse.json({ ok: true });
}

// PATCH /api/courses/[code]/materials/[id]?slug=...
// Body: { ignored?: boolean, useDigest?: boolean, ferpaRisk?: 'low' | 'medium' | 'high', ignoredItems?: string[], tier?: 'high' | 'middle' | 'background' }
// At least one of the supported fields must be provided.
// - `ignored`: toggles whether the material's extracted text feeds AI context.
// - `useDigest`: switches between digest and raw text for AI context.
// - `ferpaRisk`: faculty-set risk band. Typically used to downgrade a
//   false-positive flag (e.g. 'medium' → 'low'); accepts any of the
//   three literal values. `autoSetAside` itself is policy-driven and not
//   editable via this route — faculty override the policy by toggling
//   `ignored`.
// - `ignoredItems`: per-item ignore list for Canvas-list materials. Each
//   entry is the verbatim title of a parsed item (the text after `## `
//   in the concatenated blob). Replaces the existing list; pass `[]` to
//   re-include every item.
export async function PATCH(req: Request, { params }: RouteContext): Promise<Response> {
  const { code, id } = await params;
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!(await authorizeCourseWrite(req, code, slug))) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const material = await getMaterialById(id);
  if (!material) return NextResponse.json({ error: 'material not found' }, { status: 404 });
  if (material.courseCode !== code) {
    return NextResponse.json({ error: 'material does not belong to this course' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const hasIgnored = typeof body.ignored === 'boolean';
  const hasUseDigest = typeof body.useDigest === 'boolean';
  const hasFerpaRisk =
    body.ferpaRisk === 'low' || body.ferpaRisk === 'medium' || body.ferpaRisk === 'high';
  const hasIgnoredItems = Array.isArray(body.ignoredItems)
    && (body.ignoredItems as unknown[]).every(v => typeof v === 'string');
  const hasTier =
    body.tier === 'high' || body.tier === 'middle' || body.tier === 'background';
  if (!hasIgnored && !hasUseDigest && !hasFerpaRisk && !hasIgnoredItems && !hasTier) {
    return NextResponse.json(
      { error: 'at least one of `ignored`, `useDigest`, `ferpaRisk`, `ignoredItems`, or `tier` must be provided' },
      { status: 400 },
    );
  }
  if (body.ferpaRisk !== undefined && !hasFerpaRisk) {
    return NextResponse.json(
      { error: '`ferpaRisk` must be one of "low", "medium", "high"' },
      { status: 400 },
    );
  }
  if (body.ignoredItems !== undefined && !hasIgnoredItems) {
    return NextResponse.json(
      { error: '`ignoredItems` must be an array of strings' },
      { status: 400 },
    );
  }
  if (body.tier !== undefined && !hasTier) {
    return NextResponse.json(
      { error: '`tier` must be one of "high", "middle", "background"' },
      { status: 400 },
    );
  }

  if (hasIgnored) {
    const updated = await setMaterialIgnored(id, body.ignored as boolean);
    if (!updated) return NextResponse.json({ error: 'no row updated' }, { status: 404 });
  }
  if (hasUseDigest) {
    const updated = await setMaterialUseDigest(id, body.useDigest as boolean);
    if (!updated) return NextResponse.json({ error: 'no row updated' }, { status: 404 });
  }
  if (hasFerpaRisk) {
    await updateFerpaRisk({ id, risk: body.ferpaRisk as 'low' | 'medium' | 'high' });
  }
  if (hasIgnoredItems) {
    const updated = await setMaterialIgnoredItems(id, body.ignoredItems as string[]);
    if (!updated) return NextResponse.json({ error: 'no row updated' }, { status: 404 });
  }
  if (hasTier) {
    await updateMaterialTier(id, body.tier as string);
  }

  return NextResponse.json({ ok: true });
}
