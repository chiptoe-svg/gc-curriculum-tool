import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import {
  listMaterialsByCourse,
  insertMaterial,
  updateExtractionResult,
} from '@/lib/db/course-materials-queries';
import { extractGoogleDocReferences } from '@/lib/google-docs/extract-urls';
import { fetchGoogleDocText } from '@/lib/google-docs/fetch-doc';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// Sufficient for ~20-30 docs at a few seconds each. Whisper is the only
// other route at 60s; this matches the existing budget pattern.
export const maxDuration = 60;

// POST /api/courses/[code]/scan-linked-docs?slug=...
//
// Scans every existing material's extractedText for Google Docs URLs,
// fetches each unique doc via the public-export endpoint, and inserts a new
// course_materials row per fetched doc. Docs that aren't shared publicly
// (sign-in required) are recorded with extractionStatus = 'failed' so
// faculty can see they were tried and flagged.
//
// Idempotent: skips docs already represented by an existing material's
// blobUrl. Re-running picks up new references without duplicating prior work.
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

  // Collect every distinct Google Doc ID referenced across the course's materials.
  const referenced = new Map<string, string>(); // docId -> canonicalUrl
  for (const m of materials) {
    if (!m.extractedText) continue;
    for (const ref of extractGoogleDocReferences(m.extractedText)) {
      if (!referenced.has(ref.docId)) referenced.set(ref.docId, ref.canonicalUrl);
    }
  }

  // Skip docs we already represent via an existing material (by URL match).
  const alreadyStored = new Set<string>();
  for (const m of materials) {
    if (!m.blobUrl) continue;
    for (const ref of extractGoogleDocReferences(m.blobUrl)) {
      alreadyStored.add(ref.docId);
    }
  }

  const toFetch = [...referenced.entries()].filter(([id]) => !alreadyStored.has(id));

  const results: Array<{
    docId: string;
    status: 'ok' | 'inaccessible';
    fileName?: string;
    errorReason?: string;
  }> = [];

  for (const [docId, canonicalUrl] of toFetch) {
    const fetched = await fetchGoogleDocText(docId);
    if (fetched.status === 'ok') {
      const fileName = `Google Doc: ${fetched.title}`;
      const row = await insertMaterial({
        courseCode,
        fileName,
        blobUrl: canonicalUrl,
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
      results.push({ docId, status: 'ok', fileName });
    } else {
      // Record the failed attempt so the materials panel shows what we tried.
      // Faculty can delete the row if they don't want it surfaced.
      const fileName = `Google Doc: ${docId.slice(0, 12)}… (not shared)`;
      const row = await insertMaterial({
        courseCode,
        fileName,
        blobUrl: canonicalUrl,
        mimeType: 'text/plain',
        sizeBytes: 0,
        ipHash,
      });
      await updateExtractionResult({
        id: row.id,
        extractionStatus: 'failed',
        extractionMethod: 'text',
      });
      results.push({ docId, status: 'inaccessible', fileName, errorReason: fetched.errorReason });
    }
  }

  return NextResponse.json({
    referenced: [...referenced.keys()],
    skipped: referenced.size - toFetch.length,
    fetched: results.filter(r => r.status === 'ok').length,
    inaccessible: results.filter(r => r.status === 'inaccessible').length,
    results,
  });
}
