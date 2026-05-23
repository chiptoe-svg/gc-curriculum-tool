import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import {
  listMaterialsByCourse,
  insertMaterial,
  updateExtractionResult,
} from '@/lib/db/course-materials-queries';
import {
  extractGoogleWorkspaceReferences,
  type GoogleWorkspaceKind,
  type GoogleWorkspaceReference,
} from '@/lib/google-docs/extract-urls';
import { fetchGoogleFileText } from '@/lib/google-docs/fetch-doc';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

export const maxDuration = 60;

function fileNamePrefix(kind: GoogleWorkspaceKind): string {
  return kind === 'document' ? 'Google Doc' : 'Google Slides';
}

// POST /api/courses/[code]/scan-linked-docs?slug=...
//
// Scans every existing material's extractedText for Google Workspace URLs
// (Docs and Slides today; Sheets and Drive files not yet supported),
// fetches each unique file via the public-export endpoint, and inserts a
// new course_materials row per fetched file. Files that aren't shared
// publicly are recorded with extractionStatus = 'failed' so faculty can
// see they were tried and flagged.
//
// Idempotent: skips files already represented by an existing material's
// blobUrl. Re-running picks up new references without duplicating.
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const materials = await listMaterialsByCourse(courseCode);

  // Collect every distinct (kind, fileId) referenced across the course's
  // materials. The map key is `${kind}:${fileId}` to avoid mixing types.
  const referenced = new Map<string, GoogleWorkspaceReference>();
  for (const m of materials) {
    if (!m.extractedText) continue;
    for (const ref of extractGoogleWorkspaceReferences(m.extractedText)) {
      referenced.set(`${ref.kind}:${ref.fileId}`, ref);
    }
  }

  // Skip files already represented via an existing material (by URL match
  // on blobUrl). Same kind+id pair must match — a doc and a slide can share
  // an opaque ID in theory, so type matters.
  const alreadyStored = new Set<string>();
  for (const m of materials) {
    if (!m.blobUrl) continue;
    for (const ref of extractGoogleWorkspaceReferences(m.blobUrl)) {
      alreadyStored.add(`${ref.kind}:${ref.fileId}`);
    }
  }

  const toFetch = [...referenced.entries()].filter(([key]) => !alreadyStored.has(key));

  const results: Array<{
    kind: GoogleWorkspaceKind;
    fileId: string;
    status: 'ok' | 'inaccessible';
    fileName?: string;
    errorReason?: string;
  }> = [];

  for (const [, ref] of toFetch) {
    const fetched = await fetchGoogleFileText(ref);
    const prefix = fileNamePrefix(ref.kind);
    if (fetched.status === 'ok') {
      const fileName = `${prefix}: ${fetched.title}`;
      const row = await insertMaterial({
        courseCode,
        fileName,
        blobUrl: ref.canonicalUrl,
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(fetched.text, 'utf8'),
        ipHash,
      });
      await updateExtractionResult({
        id: row.id,
        extractionStatus: 'ok',
        extractionMethod: 'text',
        extractedText: fetched.text,
      });
      results.push({ kind: ref.kind, fileId: ref.fileId, status: 'ok', fileName });
    } else {
      const fileName = `${prefix}: ${ref.fileId.slice(0, 12)}… (not shared)`;
      const row = await insertMaterial({
        courseCode,
        fileName,
        blobUrl: ref.canonicalUrl,
        mimeType: 'text/plain',
        sizeBytes: 0,
        ipHash,
      });
      await updateExtractionResult({
        id: row.id,
        extractionStatus: 'failed',
        extractionMethod: 'text',
      });
      results.push({ kind: ref.kind, fileId: ref.fileId, status: 'inaccessible', fileName, errorReason: fetched.errorReason });
    }
  }

  const okCount = results.filter(r => r.status === 'ok').length;
  const failedCount = results.filter(r => r.status === 'inaccessible').length;
  const byKind = {
    documents: results.filter(r => r.kind === 'document').length,
    presentations: results.filter(r => r.kind === 'presentation').length,
  };

  return NextResponse.json({
    referenced: [...referenced.values()].map(r => ({ kind: r.kind, fileId: r.fileId })),
    skipped: referenced.size - toFetch.length,
    fetched: okCount,
    inaccessible: failedCount,
    byKind,
    results,
  });
}
