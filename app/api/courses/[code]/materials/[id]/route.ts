import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { isValidSlug } from '@/lib/slug';
import { getMaterialById, deleteMaterial } from '@/lib/db/course-materials-queries';

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

  // Remove from Vercel Blob first, then the DB row.
  await del(material.blobUrl);
  await deleteMaterial(id);

  return NextResponse.json({ ok: true });
}
