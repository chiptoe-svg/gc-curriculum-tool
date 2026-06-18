import { NextResponse, after } from 'next/server';
import { authorizeCourseWrite, resolveScopedSession } from '@/lib/sandbox/access';
import { authorizedForBasicAuth } from '@/lib/auth/basic-auth';
import { putLocal, courseSlug, safeFilename, keyFromLocalUrl, deleteLocal } from '@/lib/storage/local-storage';
import { getCourseByCode, clearCourseCanvasImport } from '@/lib/db/courses-queries';
import { hashIp } from '@/lib/ip-hash';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { insertMaterial, listMaterialsByCourse, deleteMaterial, updateMaterialTier } from '@/lib/db/course-materials-queries';
import { createVectorStore, tenantForCourse } from '@/lib/capture/vector-store';
import { enqueue } from '@/lib/capture/ingest-queue';
import { isTriageEnabled } from '@/lib/capture/triage-flag';
import { probeSize } from '@/lib/capture/size-probe';
import { classifyManifestItem } from '@/lib/capture/material-tier';
import { SUPPORTED_MIME_TYPES, LEGACY_OFFICE_MIME_TYPES } from '@/lib/courses/material-extractor';

export const maxDuration = 120;

// The middleware body-limit was raised to 600 MB for IMSCC cartridge imports
// (see middleware.ts). This route-level cap is therefore the binding constraint.
// 100 MB covers image-heavy lecture decks (typical 25–31 MB PPTX with embedded
// screenshots) without allowing arbitrary large uploads.
const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
// Allowlist combines modern formats (handled directly by the extractor)
// with legacy Office formats (transparently converted via LibreOffice in
// extract-text.ts when soffice is on PATH — local Mac only). Vercel can
// accept the legacy uploads too, but extraction will fail with a clear
// error message; rejecting at the upload layer would surface the same
// error earlier but with less context. Letting it through and failing in
// extraction is fine.
const ALLOWED_MIME_TYPES = new Set<string>([
  ...SUPPORTED_MIME_TYPES,
  ...LEGACY_OFFICE_MIME_TYPES,
]);

interface RouteContext {
  params: Promise<{ code: string }>;
}

/**
 * Basic-Auth gate, enforced HERE because the bare /materials path is EXCLUDED
 * from the middleware matcher (see middleware.ts): Node-runtime middleware
 * buffers/replays the request body, and on real-size multipart PDF uploads
 * that replay throws "Response body object should not be disturbed or locked"
 * before the route runs (intermittent, worsens under concurrent load — the
 * GC 2400 500s). Same gate + FACULTY_BASIC_AUTH env var + no-op-when-unset
 * semantics as the middleware. A scoped external-tester session bound to THIS
 * course authorizes in place of faculty Basic Auth (this route is on the
 * sandbox allowlist). The slug second factor is still checked separately by
 * authorizeCourseWrite. Mirrors imscc-import + transcribe.
 */
async function gateBasicAuth(req: Request, code: string): Promise<Response | null> {
  const scoped = await resolveScopedSession(req);
  if (scoped?.courseCode === code) return null;
  const expectedAuth = process.env.FACULTY_BASIC_AUTH;
  if (expectedAuth && !authorizedForBasicAuth(req.headers.get('authorization'), expectedAuth)) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="GC Curriculum Tool - Faculty"' },
    });
  }
  return null;
}

// DELETE /api/courses/[code]/materials?slug=...
// Bulk wipe: removes EVERY material for the course — DB rows, local-disk
// blobs, and the per-material chunks in the course's Weaviate tenant — then
// clears the Canvas/cartridge import provenance stamp. The per-id DELETE
// route only removes the row + file; this is the only path that also clears
// the vector chunks, so a wiped course leaves no orphaned chunks behind for
// the audit agent to retrieve. UI: "Clear all materials" in the Materials
// manager, behind a typed confirmation.
export async function DELETE(req: Request, { params }: RouteContext): Promise<Response> {
  const { code } = await params;
  const authFail = await gateBasicAuth(req, code);
  if (authFail) return authFail;
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!(await authorizeCourseWrite(req, code, slug))) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const course = await getCourseByCode(code);
  if (!course) {
    return NextResponse.json({ error: `course not found: ${code}` }, { status: 404 });
  }

  const materials = await listMaterialsByCourse(code);
  const vectorStore = createVectorStore();
  const tenant = tenantForCourse(code);

  for (const m of materials) {
    // Vector chunks first — a failure here must not orphan the row, but a
    // failed chunk-delete shouldn't abort the whole wipe either.
    try {
      await vectorStore.deleteByMaterial(tenant, m.id);
    } catch (err) {
      console.error(`[materials wipe] vector delete failed for ${m.id}:`, err);
    }
    const localKey = keyFromLocalUrl(m.blobUrl);
    if (localKey) {
      await deleteLocal(localKey).catch(err => console.error('local delete failed', err));
    }
    await deleteMaterial(m.id);
  }

  await clearCourseCanvasImport(code);

  return NextResponse.json({ deleted: materials.length });
}

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { code } = await params;
  const authFail = await gateBasicAuth(req, code);
  if (authFail) return authFail;

  // Parse multipart form data.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 });
  }

  const slug = typeof form.get('slug') === 'string' ? (form.get('slug') as string) : '';
  if (!(await authorizeCourseWrite(req, code, slug))) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  // Verify the course exists.
  const course = await getCourseByCode(code);
  if (!course) {
    return NextResponse.json({ error: `course not found: ${code}` }, { status: 404 });
  }

  // IP rate limit.
  const ipHash = hashIp(req);
  const rl = await checkIpRateLimit(ipHash);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate limit exceeded — try again in an hour' }, { status: 429 });
  }

  // Validate the uploaded file.
  // Use duck-type check rather than `instanceof File` — jsdom and undici expose
  // different File constructors, so instanceof can fail in test environments
  // even though the object is a valid File-like blob.
  const file = form.get('file') as File | null;
  if (!file || typeof file !== 'object' || typeof (file as File).arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error:
          `Unsupported MIME type: ${file.type}. Allowed: PDF, DOCX/DOC, PPTX/PPT, XLSX/XLS, CSV, HTML, PNG, JPG. ` +
          `PPTX/XLSX/CSV/HTML/image and legacy .doc/.ppt/.xls require the local Docling + LibreOffice pipeline (Phase 2 hybrid deploy).`,
      },
      { status: 400 },
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `file too large: ${file.size} bytes (max ${MAX_SIZE_BYTES})` },
      { status: 400 },
    );
  }

  // Store on local disk; we do NOT extract/index on the request path — that
  // happens in the background ingest worker so the upload returns immediately
  // and a burst doesn't saturate the box (see lib/capture/ingest-queue.ts).
  const fileBytes = Buffer.from(await file.arrayBuffer());
  const storageKey = `${courseSlug(code)}/${Date.now()}-${safeFilename(file.name)}`;
  let stored;
  try {
    stored = await putLocal({ key: storageKey, bytes: fileBytes });
  } catch (err) {
    console.error('local storage write failed', err);
    return NextResponse.json({ error: 'failed to store uploaded file on disk' }, { status: 503 });
  }

  const material = await insertMaterial({
    courseCode: code,
    fileName: file.name,
    blobUrl: stored.url,
    mimeType: file.type,
    sizeBytes: file.size,
    ipHash,
  });

  if (isTriageEnabled()) {
    // Phase-1 (list-mode) upload: store now, but do NOT enqueue and do NOT block
    // the response on tier classification. Processing waits for the explicit
    // Ingest step (Phase 2), mirroring the Canvas list-mode import pattern.
    //
    // Tier classification (probe + 'material-classify' LLM call) used to run
    // synchronously here, which added seconds of fixed per-file latency to every
    // upload — independent of file size. It now runs via after(): the response
    // returns the instant the file is on disk, and probe/classify happen in the
    // background using the bytes already in memory. Background classifications of
    // sequential uploads pipeline (each runs while the next file transfers), and
    // tiers are settled well before the user reaches the Ingest step. A classifier
    // hiccup is logged and leaves tier null (TriageStep treats null as 'high').
    after(async () => {
      try {
        const probe = await probeSize(fileBytes, file.type);
        const tier = await classifyManifestItem({
          kind: 'file',
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: probe.sizeBytes,
          pageCount: probe.pageCount,
          slideCount: probe.slideCount,
        });
        await updateMaterialTier(material.id, tier);
      } catch (err) {
        console.error('[materials upload] background tier classification failed (non-fatal):', err);
      }
    });
    return NextResponse.json({
      id: material.id,
      fileName: material.fileName,
      blobUrl: material.blobUrl,
      indexingStatus: 'pending',
    });
  }

  // Flag off: existing behavior — enqueue immediately for background indexing.
  await enqueue(material.id);

  return NextResponse.json({
    id: material.id,
    fileName: material.fileName,
    blobUrl: material.blobUrl,
    indexingStatus: 'queued',
  });
}
