import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { isValidSlug } from '@/lib/slug';
import { getMaterialById, deleteMaterial, setMaterialIgnored } from '@/lib/db/course-materials-queries';

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
// Body: { ignored: boolean }
// Toggles whether a material's extracted text feeds AI context. The row
// stays in the table either way.
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
  if (typeof body.ignored !== 'boolean') {
    return NextResponse.json({ error: 'ignored must be a boolean' }, { status: 400 });
  }

  const updated = await setMaterialIgnored(id, body.ignored);
  if (!updated) return NextResponse.json({ error: 'no row updated' }, { status: 404 });
  return NextResponse.json({ ok: true, ignored: body.ignored });
}
