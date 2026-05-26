import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { isValidSlug } from '@/lib/slug';
import { getMaterialById, deleteMaterial, setMaterialIgnored, setMaterialUseDigest } from '@/lib/db/course-materials-queries';

interface RouteContext {
  params: Promise<{ code: string; id: string }>;
}

export async function DELETE(req: Request, { params }: RouteContext): Promise<Response> {
  const { code, id } = await params;
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const material = await getMaterialById(id);
  if (!material) {
    return NextResponse.json({ error: 'material not found' }, { status: 404 });
  }
  if (material.courseCode !== code) {
    return NextResponse.json({ error: 'material does not belong to this course' }, { status: 403 });
  }

  // Only call del() for real Vercel Blob URLs; Canvas imports use the Canvas URL as blobUrl.
  if (material.blobUrl.includes('blob.vercel-storage.com')) {
    await del(material.blobUrl);
  }
  await deleteMaterial(id);

  return NextResponse.json({ ok: true });
}

// PATCH /api/courses/[code]/materials/[id]?slug=...
// Body: { ignored?: boolean, useDigest?: boolean }
// At least one of `ignored` or `useDigest` must be provided as a boolean.
// Toggles whether a material's extracted text feeds AI context, or whether to use
// the AI-generated digest instead of raw text. The row stays in the table either way.
export async function PATCH(req: Request, { params }: RouteContext): Promise<Response> {
  const { code, id } = await params;
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
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
  if (!hasIgnored && !hasUseDigest) {
    return NextResponse.json({ error: 'at least one of `ignored` or `useDigest` must be a boolean' }, { status: 400 });
  }

  if (hasIgnored) {
    const updated = await setMaterialIgnored(id, body.ignored as boolean);
    if (!updated) return NextResponse.json({ error: 'no row updated' }, { status: 404 });
  }
  if (hasUseDigest) {
    const updated = await setMaterialUseDigest(id, body.useDigest as boolean);
    if (!updated) return NextResponse.json({ error: 'no row updated' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
